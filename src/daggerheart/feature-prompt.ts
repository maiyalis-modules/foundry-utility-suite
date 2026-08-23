/**
 * The one dialog every feature window uses to ask "which of these do you want?".
 *
 * Kept generic and separate from any particular window because consolidating the
 * question is half the reason the registry exists (see `feature-registry.ts`):
 * three Fear-reactive features must produce one dialog, not three.
 *
 * {@link chooseOffers} has two shapes, because a single offer does not deserve a
 * checklist:
 * - one offer  — a plain two-button question, the common case at low levels.
 * - several    — a checkbox per offer, all pre-ticked, and one Apply.
 *
 * Three more shapes belong to features that own their own question rather than
 * asking it out of the registry: {@link chooseUpTo} ("which of these people?",
 * nothing pre-ticked, a hard cap), {@link confirmChoice} ("yes or no?", in the
 * asker's own words) and {@link chooseOne} ("which one?", a button each). All
 * three are local — none crosses a socket.
 *
 * Dismissing the dialog (Escape, the close button, the timeout) means "none",
 * never "all": every caller *holding up a roll* is mid-pipeline holding something
 * back, so the safe answer is always to let the unmodified outcome through.
 * {@link chooseOne} is the exception in a second way — see its own note on why it
 * has no timer at all.
 *
 * ## Why it takes plain data
 *
 * {@link PromptOffer} is deliberately flat, localized and JSON-safe rather than
 * the registry's `FeatureOffer` (which carries live Item and Actor documents).
 * The client that raises this dialog is not always the client that owns the
 * feature — a reaction to a GM-rolled adversary attack is decided by the player
 * whose Hope it costs — so the whole question has to survive a trip over a
 * socket. See `feature-ask.ts`.
 */
import { LOG_PREFIX } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * How long a prompt waits before answering "none" for the player.
 *
 * The window that raised it is holding up the roll — no chat card, no resource
 * updates, nothing — for the whole table, so an unattended client cannot be
 * allowed to stall play indefinitely. Long enough to read three lines and
 * decide, short enough that nobody wonders whether the roll broke.
 */
export const PROMPT_TIMEOUT_MS = 30_000;

/** One offer, as the dialog needs it: localized, flat and serializable. */
export interface PromptOffer {
  /** The feature id, which is also the checkbox name and the answer's value. */
  id: string;
  /** Localized feature name. */
  label: string;
  /** Localized explanatory line, if the feature has one. */
  hint?: string;
  /** The granting Item's name, so the player can see which card this came from. */
  itemName: string;
}

/** One side of a {@link PromptHeadline} — who did it, or who it was done to. */
export interface PromptParty {
  /** Display name. */
  name: string;
  /** Portrait path. Falls back to Foundry's own placeholder when absent. */
  img?: string;
}

/**
 * The "what just happened" banner: two portraits with the verdict between them.
 *
 * A window supplies this only when the event really is one party acting on
 * another *and* there is exactly one of each — otherwise {@link
 * PromptRequest.intro} carries the sentence instead. Two circles cannot honestly
 * show an attack that hit three people, and inventing a "+2" badge for it would
 * be a worse lie than a sentence that just lists them.
 */
export interface PromptHeadline {
  /** Left-hand party: whoever acted. */
  source: PromptParty;
  /** Right-hand party: whoever it landed on. */
  target: PromptParty;
  /**
   * Localized verdict — "Hit", "Critical".
   *
   * Deliberately no accompanying number. What a reacting player needs is whether
   * the attack landed; the total it landed with changes nothing they can decide,
   * and printing it hands out a figure the chat card may be about to withhold.
   */
  verdict: string;
}

/** Everything needed to raise the dialog, and nothing that can't cross a socket. */
export interface PromptRequest {
  title: string;
  /**
   * The event as a sentence. Always supplied: it is what renders when there is
   * no {@link headline}, and it is the form that survives any shape of event.
   */
  intro: string;
  /** The banner form of the same information, when the event fits it. */
  headline?: PromptHeadline;
  offers: PromptOffer[];
}

/**
 * Foundry's own stand-in portrait, used when a party has no image. A core asset,
 * so it is present in every install without this module shipping one.
 */
const PLACEHOLDER_PORTRAIT = "icons/svg/mystery-man.svg";

/** One party: a round portrait with the name beneath it. */
function renderParty(party: PromptParty): string {
  return `<div class="ee-feature-party">
    <img class="ee-feature-portrait" src="${escapeHtml(
      party.img || PLACEHOLDER_PORTRAIT,
    )}" alt="" draggable="false">
    <span class="ee-feature-party-name">${escapeHtml(party.name)}</span>
  </div>`;
}

/**
 * The banner: acting party, verdict, receiving party.
 *
 * The names sit *under* the portraits rather than beside them, which keeps the
 * verdict optically centred however long the two names are — a "Minor Treant"
 * against a "Zella Ironstone" would otherwise push it well off to one side.
 */
function renderHeadline(headline: PromptHeadline): string {
  return `<div class="ee-feature-headline">
    ${renderParty(headline.source)}
    <div class="ee-feature-verdict">
      <span class="ee-feature-verdict-label">${escapeHtml(headline.verdict)}</span>
    </div>
    ${renderParty(headline.target)}
  </div>`;
}

/**
 * One row of the dialog: what the feature is, and which card it came from.
 *
 * The card's name is shown only when it differs from the feature's label — for
 * most features they are the same string, and "Blood Maledict (Blood Maledict)"
 * is noise. It earns its place when a homebrew rewrite has been flagged into an
 * SRD feature's automation and the two names genuinely diverge.
 */
function describeOffer(offer: PromptOffer): string {
  const source =
    offer.itemName && offer.itemName !== offer.label
      ? ` <span class="hint">(${escapeHtml(offer.itemName)})</span>`
      : "";

  return `<strong>${escapeHtml(offer.label)}</strong>${source}${
    offer.hint ? `<p class="hint">${escapeHtml(offer.hint)}</p>` : ""
  }`;
}

/**
 * Race the dialog against a timer, closing it if the timer wins.
 *
 * `DialogV2.wait` hands us the instance through its `render` callback, which is
 * the documented way to get at it — so the timeout can close the dialog rather
 * than leaving a live one on screen whose answer would be ignored. `rejectClose:
 * false` makes dismissal resolve `null` instead of throwing.
 */
async function waitWithTimeout(
  config: AnyObject,
  onRender?: (root: HTMLElement) => void,
): Promise<unknown> {
  let dialog: AnyObject | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      // Closing resolves the dialog's own promise too; the race has already been
      // decided, so that result is simply discarded.
      try {
        void dialog?.["close"]?.();
      } catch {
        /* Already gone. Nothing to do. */
      }
      resolve(null);
    }, PROMPT_TIMEOUT_MS);
  });

  const { DialogV2 } = foundry.applications.api;
  const answered = DialogV2.wait({
    ...config,
    rejectClose: false,
    render: (_event: Event, instance: AnyObject) => {
      dialog = instance;
      // A dialog whose content needs live behaviour (see `chooseUpTo`) wires it
      // here, on the same callback, rather than through a second one the caller
      // would have to remember not to pass — `render` is spread away above.
      try {
        const root = instance?.["element"] as HTMLElement | undefined;
        if (root && onRender) onRender(root);
      } catch (error) {
        // The dialog is already on screen and answerable; losing a nicety in it
        // must not cost the player the question.
        console.warn(`${LOG_PREFIX} Feature prompt: could not wire up the dialog.`, error);
      }
    },
  }).catch(() => null);

  try {
    return await Promise.race([answered, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Ask which of `request.offers` to use, on *this* client. Returns the ids the
 * player accepted.
 *
 * Callers pass only *optional* offers; a feature that is not a choice should be
 * applied without asking.
 */
export async function chooseOffers(request: PromptRequest): Promise<Set<string>> {
  const { title, intro, headline, offers } = request;
  if (offers.length === 0) return new Set();

  const chosen = new Set<string>();
  const introHtml = headline ? renderHeadline(headline) : `<p>${escapeHtml(intro)}</p>`;
  // Scopes the stylesheet, and keeps the banner's rules from reaching any other
  // dialog that happens to use the same element names.
  const classes = ["ee-feature-prompt"];

  if (offers.length === 1) {
    const only = offers[0]!;
    const answer = await waitWithTimeout({
      classes,
      window: { title },
      content: `${introHtml}<p class="ee-feature-offer-single">${describeOffer(only)}</p>`,
      buttons: [
        {
          action: "use",
          label: game.i18n.localize("EE.Features.PromptUse"),
          default: true,
        },
        { action: "skip", label: game.i18n.localize("EE.Features.PromptSkip") },
      ],
    });

    if (answer === "use") chosen.add(only.id);
    return chosen;
  }

  // Several: a checkbox each, pre-ticked, read back off the submitting button's
  // form. `button.form.elements` is the documented way into a DialogV2's content.
  const rows = offers
    .map(
      (offer) =>
        `<label class="ee-feature-offer"><input type="checkbox" name="${escapeHtml(
          offer.id,
        )}" checked> ${describeOffer(offer)}</label>`,
    )
    .join("");

  const answer = await waitWithTimeout({
    classes,
    window: { title },
    content: `${introHtml}<div class="ee-feature-offers">${rows}</div>`,
    buttons: [
      {
        action: "apply",
        label: game.i18n.localize("EE.Features.PromptApply"),
        default: true,
        callback: (_event: Event, button: AnyObject) => {
          const form = button?.["form"];
          const picked = offers
            .filter((offer) => form?.elements?.[offer.id]?.checked === true)
            .map((offer) => offer.id);
          return { picked };
        },
      },
      { action: "skip", label: game.i18n.localize("EE.Features.PromptSkip") },
    ],
  });

  const picked = (answer as AnyObject | null)?.["picked"];
  if (Array.isArray(picked)) for (const id of picked) chosen.add(String(id));
  return chosen;
}

/**
 * One candidate in a {@link chooseUpTo} prompt: a party with an id to answer
 * with, and an optional line of context under the name.
 */
export interface PromptChoice extends PromptParty {
  /** What the answer identifies this choice by — a token id, in practice. */
  id: string;
  /** Localized supporting line — how far away this one is, and so on. */
  detail?: string;
}

/** Everything needed to raise a {@link chooseUpTo} prompt. */
export interface ChoiceRequest {
  title: string;
  /** The situation as a sentence, including what the choice will cost. */
  intro: string;
  choices: PromptChoice[];
  /** How many may be taken. The dialog enforces it rather than trimming after. */
  max: number;
  /** Localized confirm button — it should name the price, not just say "OK". */
  confirmLabel: string;
  /**
   * Localized decline button. Required rather than falling back to the shared
   * `EE.Features.PromptSkip`: that one reads "leave the roll alone", which is
   * right for a feature that would have *rewritten* a roll and wrong here, where
   * declining just means the attack goes at whoever it already went at. Word it
   * as the counterpart of {@link confirmLabel}, not as a cancel.
   */
  declineLabel: string;
}

/**
 * Pick up to `max` of `request.choices`. Returns the ids taken, in the order
 * they were offered; empty for "none", which is what dismissal and the timeout
 * both mean.
 *
 * ## Why this isn't {@link chooseOffers}
 *
 * That one asks *which of your features do you want to use* — a fixed, pre-ticked
 * list where taking everything is the usual answer. This asks *which of these
 * people*, where nothing is a default, the list is whoever happens to be standing
 * nearby, and there is a hard limit the rule sets. Same house style, opposite
 * defaults; folding them together would mean a function whose every argument
 * flipped some behaviour.
 *
 * Unlike `chooseOffers` there is no special case for a single choice: the
 * checkbox is what says "you are choosing people, and you may choose none",
 * which a two-button "Use it / Skip" would quietly turn back into a yes/no.
 */
export async function chooseUpTo(request: ChoiceRequest): Promise<string[]> {
  const { title, intro, choices, max, confirmLabel, declineLabel } = request;
  if (choices.length === 0 || max <= 0) return [];

  const rows = choices
    .map(
      (choice) =>
        `<label class="ee-feature-choice">
          <input type="checkbox" name="${escapeHtml(choice.id)}">
          <img class="ee-feature-portrait" src="${escapeHtml(
            choice.img || PLACEHOLDER_PORTRAIT,
          )}" alt="" draggable="false">
          <span class="ee-feature-choice-name">${escapeHtml(choice.name)}</span>
          ${choice.detail ? `<span class="hint">${escapeHtml(choice.detail)}</span>` : ""}
        </label>`,
    )
    .join("");

  const answer = await waitWithTimeout(
    {
      classes: ["ee-feature-prompt"],
      window: { title },
      content: `<p>${escapeHtml(intro)}</p><div class="ee-feature-choices">${rows}</div>`,
      buttons: [
        {
          action: "confirm",
          label: confirmLabel,
          default: true,
          callback: (_event: Event, button: AnyObject) => {
            const form = button?.["form"];
            // Re-capped here as well as in the UI: the limiter below is a
            // convenience on one client's DOM, and this is the answer everything
            // downstream acts on.
            const picked = choices
              .filter((choice) => form?.elements?.[choice.id]?.checked === true)
              .slice(0, max)
              .map((choice) => choice.id);
            return { picked };
          },
        },
        { action: "skip", label: declineLabel },
      ],
    },
    (root) => limitSelection(root, max),
  );

  const picked = (answer as AnyObject | null)?.["picked"];
  return Array.isArray(picked) ? picked.map(String) : [];
}

/**
 * Stop the player ticking more than `max` boxes, by disabling the unticked ones
 * once the limit is reached.
 *
 * Disabling rather than silently dropping the extras: "choose two" should feel
 * like a limit while you are choosing, not like a surprise when you confirm. A
 * disabled checkbox is still in `form.elements` and still reports `checked`, so
 * the callback above reads the same answer either way.
 */
function limitSelection(root: HTMLElement, max: number): void {
  const boxes = Array.from(
    root.querySelectorAll<HTMLInputElement>('.ee-feature-choice input[type="checkbox"]'),
  );

  const sync = (): void => {
    const taken = boxes.filter((box) => box.checked).length;
    for (const box of boxes) box.disabled = !box.checked && taken >= max;
  };

  for (const box of boxes) box.addEventListener("change", sync);
  sync();
}

/** Everything needed to raise a {@link confirmChoice} prompt. */
export interface ConfirmRequest {
  title: string;
  /** The situation as a sentence, including what saying yes will cost. */
  intro: string;
  /** The banner form of the same information, when the event fits it. */
  headline?: PromptHeadline;
  /** Localized confirm button — it should name the price, not just say "OK". */
  confirmLabel: string;
  /**
   * Localized decline button. Required for the same reason as
   * {@link ChoiceRequest.declineLabel}: the shared `EE.Features.PromptSkip`
   * reads "leave the roll alone", which is only right for a feature that would
   * have rewritten one. Word it as the counterpart of {@link confirmLabel}.
   */
  declineLabel: string;
}

/**
 * Ask one yes/no question. Returns whether it was answered yes; dismissal, the
 * close button and the timeout all mean no.
 *
 * ## Why this isn't {@link chooseOffers}'s single-offer case
 *
 * That branch looks identical on screen and is not: it is asking *"do you want
 * to use this feature you hold"*, so it labels its buttons from the shared
 * strings and describes the granting card in the body. This one is a window
 * asking its own question in its own words — "spend a Hope to focus on her?",
 * "end the feature to reroll?" — where the buttons are half the sentence and the
 * card's name is already in the title. Passing custom labels into `chooseOffers`
 * would have meant a `PromptOffer` with nothing in it but labels.
 */
export async function confirmChoice(request: ConfirmRequest): Promise<boolean> {
  const { title, intro, headline, confirmLabel, declineLabel } = request;

  const answer = await waitWithTimeout({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: headline
      ? `${renderHeadline(headline)}<p>${escapeHtml(intro)}</p>`
      : `<p>${escapeHtml(intro)}</p>`,
    buttons: [
      { action: "confirm", label: confirmLabel, default: true },
      { action: "skip", label: declineLabel },
    ],
  });

  return answer === "confirm";
}

/**
 * One option in a {@link chooseOne} prompt.
 *
 * Supplying any of {@link img}, {@link tag} or {@link stat} switches the whole
 * prompt from plain buttons to **rows**: artwork on the left, the name with its
 * tag beneath, the figure on the right. The shape deliberately mirrors
 * `daggerheart-target-helper`'s target picker, because at this table the two
 * appear one after the other in the same flow — pick a weapon, then pick who to
 * hit with it — and two different-looking lists for two consecutive choices
 * reads as two unrelated features.
 */
export interface PromptOption {
  /** What the answer identifies this option by. */
  id: string;
  /** Localized button text, or the row's name. */
  label: string;
  /** Artwork for a row-styled option. */
  img?: string;
  /** Short localized chip under the name — a range band, and so on. */
  tag?: string;
  /** The figure on the right: a small caption over a value. */
  stat?: { label: string; value: string };
}

/** Everything needed to raise a {@link chooseOne} prompt. */
export interface OneOfRequest {
  title: string;
  /** The question as a sentence. */
  intro: string;
  /** One button each, in the order they should read. */
  options: PromptOption[];
}

/**
 * Ask which *one* of `request.options` to use. Returns the id, or null for a
 * dialog that was dismissed.
 *
 * ## Why this one has no timeout
 *
 * Unlike every other prompt in this file, nothing is being held back while it is
 * open. The others are raised from inside `DHRoll.buildPost`, where the chat card
 * and the resource updates for the whole table are waiting on the answer, so an
 * unattended client cannot be allowed to stall play. This one is raised *after*
 * an action has resolved — the cost is paid, the card has posted — so the only
 * thing an unanswered dialog costs is that player's own follow-through, and
 * timing them out at 30 seconds would take a choice away for no one's benefit.
 */
export async function chooseOne(request: OneOfRequest): Promise<string | null> {
  const { title, intro, options } = request;
  if (options.length === 0) return null;

  const { DialogV2 } = foundry.applications.api;

  // Rows whenever an option carries anything to show; plain buttons otherwise.
  if (options.some((option) => option.img || option.tag || option.stat)) {
    return chooseRow(request);
  }

  const answer = await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>`,
    buttons: options.map((option, index) => ({
      action: option.id,
      label: option.label,
      default: index === 0,
    })),
    rejectClose: false,
  }).catch(() => null);

  return options.some((option) => option.id === answer) ? String(answer) : null;
}

/** One row: artwork, name over its tag, and the figure on the right. */
function renderRow(option: PromptOption): string {
  const tag = option.tag
    ? `<span class="ee-feature-row-tag">${escapeHtml(option.tag)}</span>`
    : "";

  const stat = option.stat
    ? `<span class="ee-feature-row-stat">
        <span class="ee-feature-row-stat-label">${escapeHtml(option.stat.label)}</span>
        <span class="ee-feature-row-stat-value">${escapeHtml(option.stat.value)}</span>
      </span>`
    : "";

  return `<button type="button" class="ee-feature-row" data-ee-choice="${escapeHtml(option.id)}">
    <img class="ee-feature-row-art" src="${escapeHtml(
      option.img || PLACEHOLDER_PORTRAIT,
    )}" alt="" draggable="false">
    <span class="ee-feature-row-label">
      <span class="ee-feature-row-name">${escapeHtml(option.label)}</span>
      ${tag}
    </span>
    ${stat}
  </button>`;
}

/**
 * The row-styled form of {@link chooseOne}.
 *
 * The rows are `<button>`s in the dialog's *content* rather than DialogV2
 * buttons, because a DialogV2 button takes a plain label and this needs
 * structure inside each one. That means the answer cannot come back as the
 * dialog's own result: a row click records the choice and closes the window,
 * which resolves `DialogV2.wait` with the dismissal value, and the recorded
 * choice is what gets returned. Dismissing without picking leaves it null, which
 * is the same "backed out" answer the plain form gives.
 *
 * A Cancel button remains, and is the only DialogV2 button: a dialog with no
 * buttons at all is not a shape DialogV2 supports, and more importantly the
 * player needs somewhere obvious to say no.
 */
async function chooseRow(request: OneOfRequest): Promise<string | null> {
  const { title, intro, options } = request;
  const { DialogV2 } = foundry.applications.api;

  let picked: string | null = null;

  await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p><div class="ee-feature-rows">${options
      .map(renderRow)
      .join("")}</div>`,
    buttons: [{ action: "cancel", label: game.i18n.localize("EE.Features.PromptCancel") }],
    rejectClose: false,
    render: (_event: Event, instance: AnyObject) => {
      try {
        const root = instance?.["element"] as HTMLElement | undefined;
        if (!root) return;

        // One delegated listener on the dialog rather than one per row, reading
        // a `data-*` attribute through `closest()` — the house pattern. Core
        // happens to set `button > * { pointer-events: none }`, so the target is
        // already the row, but `closest()` costs nothing and doesn't depend on
        // that staying true.
        root.addEventListener("click", (event: Event) => {
          const row = (event.target as HTMLElement | null)?.closest?.("[data-ee-choice]");
          if (!row) return;

          const id = row.getAttribute("data-ee-choice");
          // Re-checked against the list this function rendered a moment ago
          // rather than trusted from the DOM.
          if (!options.some((option) => option.id === id)) return;

          picked = id;
          void instance["close"]?.();
        });
      } catch (error) {
        console.warn(`${LOG_PREFIX} Feature prompt: could not wire up the choices.`, error);
      }
    },
  }).catch(() => null);

  return picked;
}

/** Everything needed to raise an {@link askText} prompt. */
export interface TextRequest {
  title: string;
  /** The question as a sentence. */
  intro: string;
  /** Localized ghost text in the empty field — an example, not an instruction. */
  placeholder?: string;
  /** Localized confirm button. */
  confirmLabel: string;
  /** Localized cancel button. */
  cancelLabel: string;
  /**
   * Hard cap on what comes back, in characters.
   *
   * Not a UI nicety: this text is written by one player, sent over the socket and
   * rendered on the GM's screen, so its length is somebody else's problem unless
   * something bounds it here.
   */
  maxLength: number;
}

/**
 * Ask for a line of prose. Returns the trimmed text, or null when the player
 * cancelled, dismissed the dialog, or submitted nothing.
 *
 * Empty is deliberately null rather than `""`: every caller has to handle "they
 * backed out" anyway, and a blank answer means the same thing — there is nothing
 * to act on — so collapsing the two removes a case rather than hiding one.
 *
 * No timeout, for the same reason as {@link chooseOne}: this is raised after an
 * action has resolved, so nothing is being held back while the player types.
 */
export async function askText(request: TextRequest): Promise<string | null> {
  const { title, intro, placeholder, confirmLabel, cancelLabel, maxLength } = request;

  const { DialogV2 } = foundry.applications.api;

  const answer = await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>
      <textarea class="ee-feature-text" name="text" rows="3" maxlength="${maxLength}"
        placeholder="${escapeHtml(placeholder ?? "")}"></textarea>`,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (_event: Event, button: AnyObject) => ({
          text: String(button?.["form"]?.elements?.["text"]?.value ?? ""),
        }),
      },
      { action: "cancel", label: cancelLabel },
    ],
    rejectClose: false,
    render: (_event: Event, instance: AnyObject) => {
      try {
        const root = instance?.["element"] as HTMLElement | undefined;
        // Focused on open: this dialog exists only to be typed into, and a player
        // who has just pressed a card button should not have to click again.
        root?.querySelector<HTMLTextAreaElement>(".ee-feature-text")?.focus();
      } catch (error) {
        console.warn(`${LOG_PREFIX} Feature prompt: could not focus the field.`, error);
      }
    },
  }).catch(() => null);

  // Re-capped here as well as in the markup: `maxlength` is one client's DOM, and
  // this is the value everything downstream acts on.
  const text = String((answer as AnyObject | null)?.["text"] ?? "")
    .slice(0, maxLength)
    .trim();

  return text.length > 0 ? text : null;
}
