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
  /**
   * Localized replacements for the two buttons, for a feature whose choice reads
   * better as two named outcomes than as "use it" / "don't".
   *
   * Honoured **only when this is the sole offer** — with several on screen the
   * buttons act on all of them at once, and borrowing one feature's wording for
   * that would say something untrue about the others. {@link chooseOffers} falls
   * back to the generic pair in that case, so a feature may set these without
   * having to know whether it will be alone.
   */
  useLabel?: string;
  skipLabel?: string;
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
 *
 * `untimed` drops the timer altogether. The 30 seconds exist because most callers
 * are mid-pipeline holding a roll back, and a dialog nobody is at must not freeze
 * the table — so a caller that is holding *nothing* back has no reason to impose
 * it, and every reason not to: a question raised after an action has already
 * resolved can only be answered once, and expiring it silently loses the answer.
 * Same judgement `chooseOne` and `chooseFromList` make by not coming through here
 * at all; this flag is for a prompt that needs the rest of the wiring.
 */
async function waitWithTimeout(
  config: AnyObject,
  onRender?: (root: HTMLElement) => void,
  untimed = false,
): Promise<unknown> {
  let dialog: AnyObject | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Not merely un-raced when `untimed`: the timer closes the dialog when it
  // fires, so one started and then ignored would still shut the question down
  // half a minute in.
  const timeout = untimed
    ? null
    : new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          // Closing resolves the dialog's own promise too; the race has already
          // been decided, so that result is simply discarded.
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
    return timeout ? await Promise.race([answered, timeout]) : await answered;
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
          // A feature may name the two outcomes itself — see `PromptOffer.useLabel`.
          // Only reachable here, where there is exactly one thing being decided.
          label: only.useLabel || game.i18n.localize("EE.Features.PromptUse"),
          default: true,
        },
        {
          action: "skip",
          label: only.skipLabel || game.i18n.localize("EE.Features.PromptSkip"),
        },
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
 *
 * {@link PromptParty.img} stays optional here in a way it does not on a banner.
 * A prompt whose choices are *people* gives every row a portrait and falls back
 * to core's mystery-man for the one that has none; a prompt whose choices are the
 * printed clauses of a card has no portraits at all, and a column of mystery-men
 * beside three sentences would be worse than no column. So the artwork is on when
 * **any** choice supplies it and off when none does — see {@link chooseUpTo}.
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
   * Localized decline button, when there is one.
   *
   * Never falls back to the shared `EE.Features.PromptSkip`: that one reads
   * "leave the roll alone", which is right for a feature that would have
   * *rewritten* a roll and wrong here, where declining just means the attack goes
   * at whoever it already went at. Word it as the counterpart of
   * {@link confirmLabel}, not as a cancel.
   *
   * Omit it when "none" is not a *different answer* but simply an empty one. Two
   * buttons are worth having when they are two decisions the player weighs
   * ("spread the attack" against "leave it on one target"); they are noise when
   * the second only means the first with nothing ticked, and one Confirm reading
   * back whatever the boxes say is the honest control. Pair that with
   * {@link emptyConfirm} so an empty Confirm is still a deliberate act, and note
   * the window's close button and Escape both remain — dismissal already means
   * "nothing", and always has.
   */
  declineLabel?: string;
  /**
   * Localized question to ask when Confirm is pressed with **nothing** ticked.
   *
   * Only meaningful without a {@link declineLabel}: when a single Confirm is the
   * whole of the controls, an empty press and a full one look identical, and one
   * of them throws the choice away. This turns it into a second, deliberate act
   * rather than a disabled button — the rule may well allow taking nothing, and a
   * control that refuses to be pressed cannot say so.
   */
  emptyConfirm?: string;
  /**
   * Drop the 30-second timeout.
   *
   * Set it only when nothing is being held back while the player decides. The
   * timeout is there so a dialog nobody is at cannot freeze a roll mid-pipeline;
   * a prompt raised *after* an action has resolved is holding nothing, and
   * expiring one of those throws away a choice the player can no longer make
   * again. See {@link waitWithTimeout}.
   */
  untimed?: boolean;
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
  const { title, intro, choices, max, confirmLabel, declineLabel, emptyConfirm, untimed } =
    request;
  if (choices.length === 0 || max <= 0) return [];

  // All rows or none: a list where one person has artwork and the next does not
  // still wants the column, so the missing one gets the mystery-man. A list where
  // *nobody* does is not a list of people at all — see `PromptChoice`.
  const withArt = choices.some((choice) => Boolean(choice.img));

  const rows = choices
    .map(
      (choice) =>
        `<label class="ee-feature-choice">
          <input type="checkbox" name="${escapeHtml(choice.id)}">
          ${
            withArt
              ? `<img class="ee-feature-portrait" src="${escapeHtml(
                  choice.img || PLACEHOLDER_PORTRAIT,
                )}" alt="" draggable="false">`
              : ""
          }
          <span class="ee-feature-choice-name">${escapeHtml(choice.name)}</span>
          ${choice.detail ? `<span class="hint">${escapeHtml(choice.detail)}</span>` : ""}
        </label>`,
    )
    .join("");

  const answer = await waitWithTimeout(
    {
      classes: ["ee-feature-prompt"],
      window: { title },
      content: `<p>${escapeHtml(intro)}</p><div class="ee-feature-choices${
        withArt ? "" : " ee-feature-choices-plain"
      }">${rows}</div>`,
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
        // Only when declining is a *different* answer rather than an empty one —
        // see `ChoiceRequest.declineLabel`.
        ...(declineLabel ? [{ action: "skip", label: declineLabel }] : []),
      ],
    },
    (root) => {
      limitSelection(root, max);
      if (emptyConfirm) guardEmptyConfirm(root, title, emptyConfirm);
    },
    untimed === true,
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

/**
 * Make an *empty* Confirm a second, deliberate press.
 *
 * ## Why the listener is on the button, in the capture phase
 *
 * `DialogV2` reaches `_onSubmit` two ways, and both have to be stopped. Its
 * buttons are `type="submit"`, so a click submits the form its `_renderHTML`
 * listens on; and `_initializeApplicationOptions` *also* registers every button's
 * `action` into ApplicationV2's delegated click dispatch. `preventDefault` handles
 * the first, `stopImmediatePropagation` the second — and capture on the button
 * itself is the only place that runs before an ancestor's bubble listener.
 *
 * The re-press is a real `click()` rather than a reach into the dialog's
 * internals, so the answer travels the same path it would have travelled a moment
 * earlier; `armed` is what lets it through. Nothing resets `armed`, because by
 * then the dialog is closing.
 *
 * A failure anywhere here leaves the button working normally, which is the right
 * way to fail: the confirmation is a guard against a slip, not a rule.
 */
function guardEmptyConfirm(root: HTMLElement, title: string, question: string): void {
  const button = root.querySelector<HTMLButtonElement>('button[data-action="confirm"]');
  if (!button) return;

  const anyTicked = (): boolean =>
    Array.from(
      root.querySelectorAll<HTMLInputElement>('.ee-feature-choice input[type="checkbox"]'),
    ).some((box) => box.checked);

  let armed = false;

  button.addEventListener(
    "click",
    (event) => {
      if (armed || anyTicked()) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        try {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["ee-feature-prompt"],
            window: { title },
            content: `<p>${escapeHtml(question)}</p>`,
            rejectClose: false,
          });
          if (confirmed !== true) return;
          armed = true;
          button.click();
        } catch (error) {
          // Let the press through rather than trapping the player behind a
          // confirmation that cannot be answered.
          console.warn(`${LOG_PREFIX} Feature prompt: could not confirm an empty choice.`, error);
          armed = true;
          button.click();
        }
      })();
    },
    true,
  );
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

/** One entry in a {@link chooseFromList} dropdown. */
export interface ListChoice {
  /** What the answer identifies this entry by. */
  value: string;
  /** Localized text in the dropdown. */
  label: string;
}

/** Everything needed to raise a {@link chooseFromList} prompt. */
export interface ListRequest {
  title: string;
  /** The question as a sentence. */
  intro: string;
  /** The entries, in the order they should read. */
  options: readonly ListChoice[];
  /** Which entry is selected when the dialog opens. Defaults to the first. */
  initial?: string;
  /** Localized confirm button. */
  confirmLabel: string;
  /** Localized cancel button. */
  cancelLabel: string;
}

/**
 * Ask which *one* entry of a list, as a dropdown. Returns the value, or null for
 * a dialog that was cancelled or dismissed.
 *
 * ## Why this isn't {@link chooseOne}
 *
 * That one gives every option a button, which is right when the options are few
 * and each deserves its own weight ("primary weapon or secondary?"). This one is
 * for a list that is merely *long* — a count, a die size, a rank — where a row of
 * six identically-shaped buttons reads as a wall rather than as a choice, and the
 * answer is one field with an obvious default. Same reason the system's own roll
 * dialog uses a `<select>` for advantage rather than three buttons.
 *
 * The value comes back off the form at submit time rather than being recorded on
 * click, which is safe here in a way it is not in `actor-picker.ts`: nothing
 * filters this list, so the `<option>` the player chose is still in the document
 * when they confirm.
 *
 * No timeout, for the same reason as {@link chooseOne}: this is raised after an
 * action has resolved, so nothing is being held back while the player decides.
 */
export async function chooseFromList(request: ListRequest): Promise<string | null> {
  const { title, intro, options, initial, confirmLabel, cancelLabel } = request;
  if (options.length === 0) return null;

  const { DialogV2 } = foundry.applications.api;

  const chosen = options.some((option) => option.value === initial)
    ? initial
    : options[0]!.value;

  const markup = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${
          option.value === chosen ? " selected" : ""
        }>${escapeHtml(option.label)}</option>`,
    )
    .join("");

  const answer = await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>
      <select class="ee-feature-select" name="choice">${markup}</select>`,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (_event: Event, button: AnyObject) => ({
          choice: String(button?.["form"]?.elements?.["choice"]?.value ?? ""),
        }),
      },
      { action: "cancel", label: cancelLabel },
    ],
    rejectClose: false,
  }).catch(() => null);

  const value = String((answer as AnyObject | null)?.["choice"] ?? "");
  // Re-checked against the list this function rendered rather than trusted from
  // the form, the way the other prompts do it.
  return options.some((option) => option.value === value) ? value : null;
}

/**
 * Ask which *one* entry of a list, as radio buttons. Returns the value, or null
 * for a dialog that was cancelled or dismissed.
 *
 * ## Why this isn't {@link chooseFromList}
 *
 * Same question, same data — {@link ListRequest} is shared deliberately — but a
 * different bargain about the reader's attention. A `<select>` shows one entry
 * and hides the rest behind a click, which is right when the options are
 * self-evident from their own names (a count, a die size) and the default is
 * usually the answer. Radios show every option at once, which is what a list
 * wants when each entry carries a *consequence* the reader has to weigh against
 * the others — Commune's chart lines, where the choice is between three
 * outcomes and comparing them is the whole decision.
 *
 * A rendering flag on `chooseFromList` would have been fewer lines and worse:
 * the shapes in this file are named after the question they ask, and "which of
 * these, having read them all" is a different question from "pick a number".
 *
 * The answer is read with `:checked` rather than off `form.elements`, which
 * looks equivalent and is not: a group of several radios yields a RadioNodeList
 * whose `value` is the checked entry's, but a group of *one* yields the input
 * itself, whose `value` is its own regardless of whether anybody ticked it.
 * (`:checked` matches a **disabled** input too, which is what makes the
 * single-option case below still answerable.)
 *
 * ## A list of one is shown, not skipped
 *
 * One option renders as one checked, **disabled** radio rather than being
 * returned without a dialog. A caller that never opens the prompt leaves the
 * player with no idea a question was ever asked — the choice was made for them
 * correctly and invisibly, which reads as the feature not working. Showing it
 * says both things at once: here is what you were being asked, and here is why
 * there was nothing to decide. Disabling it is presentational, since a lone
 * radio cannot be un-checked by clicking anyway; it is there to look settled.
 *
 * No timeout, for the same reason as {@link chooseOne}: this is raised after an
 * action has resolved, so nothing is being held back while the player decides.
 */
export async function chooseFromRadios(request: ListRequest): Promise<string | null> {
  const { title, intro, options, initial, confirmLabel, cancelLabel } = request;
  if (options.length === 0) return null;

  const { DialogV2 } = foundry.applications.api;

  const chosen = options.some((option) => option.value === initial)
    ? initial
    : options[0]!.value;

  const settled = options.length === 1;

  const markup = options
    .map(
      (option) =>
        `<label class="ee-feature-radio${settled ? " ee-feature-radio-settled" : ""}">
          <input type="radio" name="choice" value="${escapeHtml(option.value)}"${
            option.value === chosen ? " checked" : ""
          }${settled ? " disabled" : ""}>
          <span class="ee-feature-radio-label">${escapeHtml(option.label)}</span>
        </label>`,
    )
    .join("");

  const answer = await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>
      <div class="ee-feature-radios">${markup}</div>`,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (_event: Event, button: AnyObject) => ({
          choice: String(
            (button?.["form"] as HTMLFormElement | undefined)?.querySelector<HTMLInputElement>(
              "input[name='choice']:checked",
            )?.value ?? "",
          ),
        }),
      },
      { action: "cancel", label: cancelLabel },
    ],
    rejectClose: false,
  }).catch(() => null);

  const value = String((answer as AnyObject | null)?.["choice"] ?? "");
  // Re-checked against the list this function rendered rather than trusted from
  // the form, the way the other prompts do it.
  return options.some((option) => option.value === value) ? value : null;
}

/** Everything needed to raise a {@link showNotice}. */
export interface NoticeRequest {
  title: string;
  /** The framing sentence — what this is and where it came from. */
  intro: string;
  /**
   * The text being delivered, set apart from the framing above it.
   *
   * Always somebody's authored prose rather than the module's own words, which
   * is the whole reason it is a separate field: it is escaped and rendered in a
   * quoted block, so it cannot be mistaken for the sentence introducing it.
   */
  body?: string;
  /** Localized dismiss button. */
  dismissLabel: string;
}

/**
 * Tell one player something, with nothing to answer.
 *
 * The one shape in this file that asks no question. It exists because a feature
 * whose result is decided on *somebody else's* client has no other way to put
 * that result in front of the person it happened to — a chat card can be missed,
 * and at a table playing with chat collapsed it will be. Everything else here
 * returns an answer; this returns when the reader has closed it, and callers are
 * free to ignore even that.
 *
 * No timeout, for the same reason as {@link chooseOne} and more strongly: there
 * is no unmodified outcome waiting to be let through, so an unattended dialog
 * costs nobody anything and expiring it would throw away the only delivery.
 */
export async function showNotice(request: NoticeRequest): Promise<void> {
  const { title, intro, body, dismissLabel } = request;

  const { DialogV2 } = foundry.applications.api;

  const quoted =
    typeof body === "string" && body.length > 0
      ? `<p class="ee-feature-notice">${escapeHtml(body)}</p>`
      : "";

  await DialogV2.wait({
    classes: ["ee-feature-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>${quoted}`,
    buttons: [{ action: "dismiss", label: dismissLabel, default: true }],
    rejectClose: false,
  }).catch(() => null);
}

/**
 * Face counts the system ships artwork for.
 *
 * Its `.dice` rule masks in a die shape from `--svg-die`, which is set by a
 * `.d4`/`.d6`/… class; a denomination it has no file for would leave the mask
 * undefined and render as a bare rectangle, so those get a shape of their own
 * instead. See {@link renderDice}.
 */
const DIE_SHAPES = new Set([4, 6, 8, 10, 12, 20]);

/** One die on a {@link confirmWithToggle} prompt. */
export interface PromptDie {
  /** The face that came up. */
  value: number;
  /** How many sides it has, which picks the shape drawn behind the number. */
  faces: number;
  /** Draw it in the colour that says "this one is what the question is about". */
  marked?: boolean;
}

/**
 * The dice as the player is looking at them.
 *
 * Deliberately built on the **system's own `.dice` class**, which — unlike the
 * rest of its roll styling — is a global rule rather than one scoped to a chat
 * message, so the chips here are masked from the same die artwork the chat card
 * uses. A prompt asking about dice that have just landed should show the dice
 * that landed, not a second visual vocabulary for them. `module.css` adds only
 * the centring the chat log gets from `.roll-die > div`, and the marked colour.
 */
function renderDice(dice: readonly PromptDie[]): string {
  const chips = dice
    .map((die) => {
      const shape = DIE_SHAPES.has(die.faces) ? `d${die.faces}` : "ee-feature-die-plain";
      const marked = die.marked === true ? " ee-feature-die-marked" : "";
      return `<div class="dice ${shape}${marked}">${escapeHtml(String(die.value))}</div>`;
    })
    .join("");

  return `<div class="ee-feature-dice">${chips}</div>`;
}

/** The "and don't ask again" box on a {@link confirmWithToggle} prompt. */
export interface PromptToggle {
  /** Localized label beside the checkbox. */
  label: string;
  /** Localized line under it, saying what ticking it changes. */
  hint?: string;
  /**
   * Take the decline button away while it is ticked.
   *
   * For a box that means *"always do this from now on"*, which is a sentence the
   * decline button contradicts: a player who has just said "never ask me again"
   * and then presses "leave the roll alone" has told the dialog two opposite
   * things, and whichever one it obeyed would be a surprise. Disabling the button
   * says which of the two the box wins, before the click rather than after it.
   */
  locksDecline?: boolean;
}

/** Everything needed to raise a {@link confirmWithToggle} prompt. */
export interface ToggleRequest extends ConfirmRequest {
  toggle: PromptToggle;
  /**
   * Dice to show between the question and the box.
   *
   * For a question *about* dice that have already landed, where naming them in
   * the sentence ("came up 6, 2, 1") makes the reader match numbers to a rule
   * by hand. Showing them lets the colour do it instead, and leaves the sentence
   * free to ask the question.
   */
  dice?: readonly PromptDie[];
}

/** What a {@link confirmWithToggle} prompt comes back with. */
export interface ToggleAnswer {
  /** Whether the confirm button was pressed. */
  confirmed: boolean;
  /** Whether the box was ticked when it was. Always false on a decline. */
  toggled: boolean;
}

/**
 * Ask one yes/no question with a "from now on" box under it.
 *
 * ## Why this isn't {@link confirmChoice}
 *
 * The question is the same shape; the answer is not. This one comes back as two
 * booleans, because the box is a *second* decision — about every future roll
 * rather than this one — and folding it into the first would mean the caller
 * could not tell "yes, once" from "yes, always". Keeping it out of
 * `confirmChoice` also keeps that function honest for the eight callers that
 * have nothing to remember.
 *
 * The box is never pre-ticked. A caller only raises this when the standing
 * preference is *off* — with it on there is nothing to ask — so a ticked box
 * would be showing the player a setting they do not have.
 *
 * Acting on {@link ToggleAnswer.toggled} is the caller's job, and it is
 * deliberately not done here: this file writes no settings and knows no feature.
 */
export async function confirmWithToggle(request: ToggleRequest): Promise<ToggleAnswer> {
  const { title, intro, headline, confirmLabel, declineLabel, toggle, dice } = request;

  const banner = headline ? renderHeadline(headline) : "";
  const faces = dice && dice.length > 0 ? renderDice(dice) : "";
  const hint = toggle.hint ? `<p class="hint">${escapeHtml(toggle.hint)}</p>` : "";

  const answer = await waitWithTimeout(
    {
      classes: ["ee-feature-prompt"],
      window: { title },
      content: `${banner}<p>${escapeHtml(intro)}</p>${faces}
        <label class="ee-feature-toggle">
          <input type="checkbox" name="toggle">
          <span class="ee-feature-toggle-label">${escapeHtml(toggle.label)}</span>
          ${hint}
        </label>`,
      buttons: [
        {
          action: "confirm",
          label: confirmLabel,
          default: true,
          callback: (_event: Event, button: AnyObject) => ({
            confirmed: true,
            toggled: button?.["form"]?.elements?.["toggle"]?.checked === true,
          }),
        },
        { action: "skip", label: declineLabel },
      ],
    },
    toggle.locksDecline === true ? lockDeclineWhileTicked : undefined,
  );

  const result = answer as AnyObject | null;
  // Anything that isn't the confirm button's own return — the decline action's
  // bare string, a dismissal, the timeout — is a no, and a no never remembers.
  return result?.["confirmed"] === true
    ? { confirmed: true, toggled: result["toggled"] === true }
    : { confirmed: false, toggled: false };
}

/**
 * Grey out the decline button for as long as the box is ticked.
 *
 * Wired on `render` rather than baked into the markup because DialogV2 builds the
 * buttons itself — `data-action` is the only handle on them, and it exists only
 * once the dialog is on screen.
 */
function lockDeclineWhileTicked(root: HTMLElement): void {
  const box = root.querySelector<HTMLInputElement>("input[name='toggle']");
  const decline = root.querySelector<HTMLButtonElement>("button[data-action='skip']");
  if (!box || !decline) return;

  const sync = (): void => {
    decline.disabled = box.checked;
  };

  box.addEventListener("change", sync);
  sync();
}
