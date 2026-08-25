/**
 * **Commune** (Witch class feature, *Void for Daggerheart*) — "Once per long
 * rest, during a moment of calm, you can commune with an ancestor, deity, nature
 * spirit, or otherworldly being. Ask them a question, then roll a number of d6s
 * equal to your Spellcast trait. Choose one value from the rolled results and
 * reference the chart below for the effect: 1-3 a flavor, a scent or a
 * sensation; 4-5 sounds or a vision; 6 a scene experienced as if you were there."
 *
 * ## What the Void ships
 *
 * One `effect` action, `uses: 1 / longRest`, `chatDisplay: true`, no cost and no
 * effects. Pressing it therefore already does the one *mechanical* thing the
 * card has: it burns the once-per-long-rest use, asks for confirmation first
 * (the system's own dialog, because the action has `uses`), and posts the card's
 * description — chart and all — to chat. None of that is touched here.
 *
 * The compendium copy also carries `target.type: "any"`, which is left over the
 * same way Gifted Tracker's is: there is nothing present to target when you are
 * asking a spirit a question. That declaration makes the system treat the press
 * as targeted and makes `daggerheart-target-helper` open a picker first, so it
 * is suppressed through `card-targeting.ts` — see `untargetAction` below.
 *
 * ## What is missing, and what this adds
 *
 * The whole oracle. Nothing rolls the d6s, nothing knows how many to roll,
 * nothing offers the choice between them, and nothing brings the GM into it. So
 * this hangs four steps off `daggerheart.postUseAction`:
 *
 * 1. **Roll `Nd6`**, where N is `actor.system.spellcastModifier` — the system's
 *    own highest-subclass Spellcast trait, the same number a Spellcast Roll
 *    would add. The 3D dice are thrown by hand and **awaited** before the
 *    question is asked (see `showDiceEarly` below), then posted as a real Roll
 *    message so the result is verifiable afterwards.
 * 2. **Choose one value.** Only the *distinct* values are offered: two 4s are
 *    one choice, not two. Listed low to high, the way the card prints its chart.
 *    A roll that came up all the same face still raises the prompt, showing the
 *    one option settled — so the player sees what was being asked rather than
 *    having it answered invisibly.
 * 3. **Post what it means** — the chosen value and its chart line.
 * 4. **Ask the GM to answer**, write it into that same card, and put it back in
 *    front of the player who asked.
 *
 * ## Why the chart is here rather than read off the card
 *
 * The card carries its chart as prose inside `system.description`, as three
 * `<li>`s. Parsing bands out of that would be a guess dressed up as a read: it
 * would break on a translation, on a table that reformatted the list, and — worst
 * — it would break *silently*, mapping a 6 to the wrong sentence. The three bands
 * are the rule, so they live here as three localized strings, and the card is
 * matched strictly (flag, then compendium source, then name) so a table that
 * rewrote the chart is running a different card and gets no automation for it.
 *
 * ## Why the GM's half is fire-and-forget
 *
 * Exactly the shape `gifted-tracker.ts` already uses, and for the same reason:
 * the player's client has nothing left to do once it has posted the card, so
 * there is no answer to wait for and no roll being held open. The request names
 * only a message id; everything the GM's dialog says is re-read from that
 * message's own flag, and a message without the flag is refused — so nothing
 * arriving on the socket can steer a GM's client into editing an arbitrary chat
 * message. `isWriter()` picks the one GM who handles it, so a table with three
 * GMs logged in gets one dialog.
 *
 * The **reply** is fire-and-forget too, and carries the words rather than an id.
 * See {@link tellAsker} for why the two directions are deliberately asymmetric:
 * one of them can make a client write, and the other can only make it display.
 *
 * ## Ordering against the system's own card
 *
 * `postUseAction` fires *before* `toChat`, so in principle our messages could
 * land above the card that explains them. They do not: `Hooks.callAll` does not
 * await, so `use()` continues straight into `toChat` while the first `await`
 * here is still pending. The system's card is therefore always sent first. This
 * is worth knowing rather than worth defending against — the worst case is a
 * chat log in a slightly odd order.
 *
 * ## Deliberate silences
 *
 * - **The question is not asked for.** "Ask them a question" happens out loud at
 *   the table; a text box for it would put a transcription step in front of a
 *   conversation that is already happening.
 * - **"During a moment of calm" is not enforced.** Whether the moment qualifies
 *   is a GM's call about fiction, and nothing on the sheet knows it.
 * - **The use is not tracked here.** The card's own `uses` already does it, and
 *   duplicating that would mean two places to be wrong.
 * - **A GM who dismisses the prompt is not chased.** Narrating the answer aloud
 *   instead of typing it is a legitimate answer, and the card stands either way.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS, SOCKET_EVENT } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isWriter } from "../utils/is-writer.js";
import { untargetAction } from "./card-targeting.js";
import { askText, chooseFromRadios, showNotice } from "./feature-prompt.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { rollVisibility, showDiceEarly, withoutApplyButtons } from "./roll-pipeline.js";

/** How the card is recognised: flag, then compendium source, then printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.classes.Item.PKcnVdqacraEf8uL"],
  names: ["Commune"],
};

/** The registry id, which is also what {@link FLAGS.featureId} must say to match. */
const FEATURE_ID = "commune";

/** Prefix for this feature's console lines. */
const LABEL = "Commune";

/** Socket discriminator, namespaced by `type` like the rest of the channel. */
const ASK_ANSWER = "communeAnswerRequest";

/** The reply half of the same exchange: the GM's answer, going back to the asker. */
const TELL_ANSWER = "communeAnswerGiven";

/** The card's die. */
const FACES = 6;

/**
 * Ceiling on the dice rolled, in case `spellcastModifier` arrives absurd.
 *
 * Not a rule — no Daggerheart trait reaches this — but the number goes straight
 * into a roll formula, and a formula built from a value nothing here validated
 * is how one bad Active Effect becomes a hung client.
 */
const MAX_DICE = 20;

/** Cap on the GM's answer. It is written into a chat message the table reads. */
const ANSWER_LIMIT = 600;

/**
 * The card's chart, highest band first so the first match wins.
 *
 * `min` alone rather than a range: the bands are contiguous and cover 1–6, so a
 * second bound would be a fact stated twice and therefore a fact that can
 * disagree with itself.
 */
const CHART = [
  { min: 6, key: "EE.Features.Commune.Scene" },
  { min: 4, key: "EE.Features.Commune.Vision" },
  { min: 1, key: "EE.Features.Commune.Sensation" },
] as const;

/** What one Commune card records, so the GM's half can re-read it. */
interface Communing {
  /** Who asked. Stored rather than read back off the speaker, which can be an alias. */
  name: string;
  /** The value they chose from the rolled results. */
  value: number;
  /** The GM's answer, once there is one. Free text, always escaped. */
  answer?: string;
  /**
   * The user who pressed the card, so the answer can be put back in front of
   * them.
   *
   * Recorded rather than taken from `message.author`, which happens to be the
   * same user today and is answering a different question — who *created this
   * chat message* is not what "who asked the spirits" means, and the two would
   * come apart the moment anything else posts the card.
   */
  askedBy?: string;
}

/** Is this feature switched on? Read per use, so the toggle is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.communeOracle) === true;
}

/**
 * The Commune card behind this action, or null.
 *
 * Mirrors the equivalent in `gifted-tracker.ts`: the action's own Item has to
 * *be* the card the actor holds, so a homebrew card that merely shares a name
 * with one on a different sheet cannot claim the automation.
 */
function communeAction(action: AnyObject | null | undefined): AnyObject | null {
  const actor = action?.["actor"] as AnyObject | undefined;
  const item = action?.["item"] as AnyObject | undefined;
  if (!actor || !item || actor["type"] !== "character") return null;

  const granting = findGrantingItem(actor, FEATURE_ID, MATCH);
  return granting && granting["id"] === item["id"] ? granting : null;
}

/**
 * How many d6s this character rolls.
 *
 * `system.spellcastModifier` is the system's own answer to "what is your
 * Spellcast trait": the highest of the traits your subclasses cast with, which
 * is the same number a Spellcast Roll adds. Reading the trait off the subclass
 * by hand would be a second implementation of that rule, and a wrong one for a
 * multiclassed character.
 */
function diceCount(actor: AnyObject): number {
  const modifier = Math.floor(Number(actor["system"]?.["spellcastModifier"] ?? 0));
  if (!Number.isFinite(modifier)) return 0;
  return Math.min(Math.max(modifier, 0), MAX_DICE);
}

/** The chart line for a rolled value. */
function chartLine(value: number): string {
  const band = CHART.find((entry) => value >= entry.min) ?? CHART[CHART.length - 1]!;
  return game.i18n.localize(band.key);
}

/**
 * The faces that came up, as numbers.
 *
 * Read off the dice rather than from `roll.total`, because the card asks the
 * player to *choose one value* — the sum is the one number this roll has no use
 * for. Inactive results are skipped so the reading stays correct if a table ever
 * puts a modifier on the formula.
 */
function facesOf(roll: Roll): number[] {
  const faces: number[] = [];

  for (const die of roll.dice ?? []) {
    for (const result of (die["results"] ?? []) as AnyObject[]) {
      if (result?.["active"] === false) continue;
      const value = Number(result?.["result"]);
      if (Number.isFinite(value)) faces.push(value);
    }
  }

  return faces;
}

/**
 * The card, built from what the flag records.
 *
 * One function for both halves, so the GM's answer *rebuilds* the message rather
 * than being appended to whatever markup happens to be there. That keeps a
 * second answer from stacking, and keeps the flag — not the HTML — as the record
 * of what happened.
 */
function cardMarkup(record: Communing): string {
  const heading = game.i18n.format("EE.Features.Commune.Result", {
    name: record.name,
    value: record.value,
  });

  const answer =
    typeof record.answer === "string" && record.answer.length > 0
      ? `<p class="ee-commune-answer">${escapeHtml(record.answer)}</p>`
      : "";

  return `<div class="ee-commune">
    <p class="ee-commune-result"><strong>${escapeHtml(heading)}</strong></p>
    <p class="ee-commune-effect">${escapeHtml(chartLine(record.value))}</p>
    ${answer}
  </div>`;
}

/**
 * Ask which of the rolled values to keep.
 *
 * Distinct values only: two 4s are one choice, not two. A roll whose faces are
 * all the same is still *shown*, as a single settled option — the choice is made
 * for the player either way, and a prompt that never appears leaves them unsure
 * a question was ever asked.
 *
 * **Listed low to high, the way the card prints its chart.** The player has the
 * card's three bands in front of them in that order, and a prompt that reverses
 * them makes the reader re-map a list they already know. The *highest* is still
 * the one pre-selected, because it is what a player takes in almost every case
 * — so the default sits at the bottom of the list, which reads oddly for a
 * moment and is the right answer for every press after the first.
 *
 * Radio buttons rather than a dropdown or a button each. Every option carries a
 * consequence the player has to weigh against the others — three chart lines,
 * not three numbers — so all of them have to be on screen at once, which rules
 * out a `<select>`. And they are identically shaped alternatives answered by one
 * confirm, not three separate acts, which rules out a button each.
 */
async function pickValue(faces: readonly number[]): Promise<number | null> {
  const distinct = [...new Set(faces)].sort((a, b) => a - b);
  if (distinct.length === 0) return null;

  const chosen = await chooseFromRadios({
    title: game.i18n.localize("EE.Features.Commune.Title"),
    intro: game.i18n.localize("EE.Features.Commune.Choose"),
    options: distinct.map((value) => ({
      value: String(value),
      label: game.i18n.format("EE.Features.Commune.Option", {
        value,
        effect: chartLine(value),
      }),
    })),
    initial: String(distinct[distinct.length - 1]),
    confirmLabel: game.i18n.localize("EE.Features.Commune.Keep"),
    cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
  });

  if (chosen === null) return null;

  const value = Number(chosen);
  return distinct.includes(value) ? value : null;
}

/**
 * Put the answer request on a GM's screen.
 *
 * Handled locally when this client is the one that would handle it anyway — a GM
 * communing on a character of their own — and sent over the socket otherwise.
 */
async function requestAnswer(messageId: string): Promise<void> {
  if (isWriter()) {
    await answerCommune(messageId);
    return;
  }

  if (!game.socket) {
    console.warn(`${LOG_PREFIX} ${LABEL}: no socket — the GM cannot be asked to answer.`);
    return;
  }

  ui.notifications?.info(game.i18n.localize("EE.Features.Commune.Sent"));
  game.socket.emit(SOCKET_EVENT, { type: ASK_ANSWER, messageId });
}

/**
 * The GM's half: read the card, type what the spirit gave, write it back.
 *
 * The message's own flag is the only thing trusted here. A request naming a
 * message that has no Commune flag is refused rather than acted on — which is
 * what stops an arriving payload from steering this into editing some other
 * message — and one that already carries an answer is left alone.
 */
async function answerCommune(messageId: string): Promise<void> {
  const message = game.messages?.get(messageId) as AnyObject | undefined;
  if (!message) {
    console.debug(`${LOG_PREFIX} ${LABEL}: message ${messageId} is not here; nothing to answer.`);
    return;
  }

  const record = message["flags"]?.[MODULE_ID]?.[FLAGS.commune] as Communing | undefined;
  if (!record || typeof record.value !== "number") {
    console.warn(`${LOG_PREFIX} ${LABEL}: ${messageId} is not a Commune card; ignoring.`);
    return;
  }

  if (typeof record.answer === "string" && record.answer.length > 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: ${messageId} has already been answered.`);
    return;
  }

  const answer = await askText({
    title: game.i18n.localize("EE.Features.Commune.Title"),
    intro: game.i18n.format("EE.Features.Commune.GmIntro", {
      name: record.name,
      value: record.value,
      effect: chartLine(record.value),
    }),
    placeholder: game.i18n.localize("EE.Features.Commune.AnswerPlaceholder"),
    confirmLabel: game.i18n.localize("EE.Features.Commune.AnswerConfirm"),
    cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
    maxLength: ANSWER_LIMIT,
  });

  if (answer === null) {
    // Narrating it aloud instead of typing it is a legitimate answer, so this is
    // reported rather than retried. The card already says what the value bought.
    ui.notifications?.info(game.i18n.localize("EE.Features.Commune.NothingWritten"));
    return;
  }

  const updated: Communing = { ...record, answer };
  await message["update"]?.({
    content: cardMarkup(updated),
    [`flags.${MODULE_ID}.${FLAGS.commune}.answer`]: answer,
  });

  tellAsker(updated);
}

/**
 * Put the answer in front of the player who asked for it.
 *
 * The card already carries it, and that is deliberately not enough: a chat card
 * can be scrolled past, and at a table playing with the log collapsed it will
 * be. The question was theirs and the answer arrived on somebody else's client,
 * so it is delivered rather than left to be found.
 *
 * **The payload carries the words, unlike the request going the other way**, and
 * the asymmetry is the point. That direction can make a GM's client *write*, so
 * it names only a message id and everything else is re-read from the flag. This
 * one can only make a player's client *display*, where the worst a forged
 * payload achieves is a dialog of escaped text that any player could already
 * have typed into chat — and re-reading the flag here would instead race the
 * update that has only just been broadcast.
 */
function tellAsker(record: Communing): void {
  const userId = typeof record.askedBy === "string" ? record.askedBy : "";
  if (!userId) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the card does not say who asked; not delivering.`);
    return;
  }

  // They are reading their own words: this GM communed on a character of their
  // own and typed the answer a moment ago.
  if (userId === game.user?.id) return;

  if (!game.socket) {
    console.warn(`${LOG_PREFIX} ${LABEL}: no socket — the answer stays on the card alone.`);
    return;
  }

  game.socket.emit(SOCKET_EVENT, {
    type: TELL_ANSWER,
    userId,
    value: record.value,
    answer: record.answer,
  });
}

/**
 * Show an arriving answer, having checked it is addressed here and is sane.
 *
 * Everything is re-derived rather than trusted: the value only picks a chart
 * line and is ignored unless it is a face this die has, and the text is capped
 * at the same limit the GM's own box enforces before {@link showNotice} escapes
 * it.
 */
async function showAnswer(payload: AnyObject): Promise<void> {
  const answer = String(payload["answer"] ?? "").slice(0, ANSWER_LIMIT).trim();
  if (answer.length === 0) return;

  const value = Number(payload["value"]);
  const known = Number.isInteger(value) && value >= 1 && value <= FACES;

  await showNotice({
    title: game.i18n.localize("EE.Features.Commune.Title"),
    intro: known
      ? game.i18n.format("EE.Features.Commune.NoticeIntro", {
          value,
          effect: chartLine(value),
        })
      : game.i18n.localize("EE.Features.Commune.NoticePlain"),
    body: answer,
    dismissLabel: game.i18n.localize("EE.Features.Commune.NoticeDismiss"),
  });
}

/**
 * Listen for both halves of the exchange. Called once during `init`.
 *
 * Every client receives every emit, so each branch decides for itself whether it
 * is the addressee: the request is for the one writing GM, the answer is for the
 * one user named in it.
 */
function registerCommuneSocket(): void {
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      if (!enabled()) return;

      if (payload?.["type"] === ASK_ANSWER) {
        if (!isWriter()) return;

        const messageId = typeof payload["messageId"] === "string" ? payload["messageId"] : "";
        if (!messageId) {
          console.warn(`${LOG_PREFIX} ${LABEL}: ignoring an unrecognised answer request.`);
          return;
        }

        void answerCommune(messageId);
        return;
      }

      if (payload?.["type"] === TELL_ANSWER) {
        if (payload["userId"] !== game.user?.id) return;
        void showAnswer(payload);
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not handle a socket message.`, error);
    }
  });
}

/**
 * The whole oracle, from the press to the GM's answer.
 *
 * Every exit past the card check says why: once a player has spent their one use
 * for the long rest, "nothing happened" needs a reason in the console.
 */
async function runCommune(action: AnyObject, config: AnyObject): Promise<void> {
  if (!enabled()) return;

  const item = communeAction(action);
  if (!item) return;

  const actor = action["actor"] as AnyObject | undefined;
  if (!actor) return;

  const count = diceCount(actor);
  if (count < 1) {
    // A literal reading of the card gives this character no dice at all. Said out
    // loud rather than swallowed: the player pressed a button and is owed a
    // reason, and the answer is on their sheet, not in this module.
    ui.notifications?.warn(game.i18n.localize("EE.Features.Commune.NoTrait"));
    return;
  }

  const { whisper, blind } = rollVisibility(config);
  const speaker = ChatMessage.getSpeaker({ actor });

  const roll = await new Roll(`${count}d${FACES}`).evaluate();

  // Thrown by hand and **awaited**, so the picker opens on dice that have already
  // landed rather than over the top of them. Letting the chat message animate
  // would not do: Dice So Nice starts from the message, `toMessage` resolves the
  // moment the message is created, and there is no handle on the animation after
  // that. `showDiceEarly` marks the roll so the message it is about to become
  // does not throw the same dice a second time.
  //
  // Handed a **local** config rather than the action's: the only thing it reads
  // is the message mode, and the only thing it writes is `mute`, which belongs
  // to the system's own `toChat` — running concurrently with this, since
  // `postUseAction` is not awaited. Nothing here needs it, because a suppressed
  // message plays no dice sound to double.
  await showDiceEarly(roll, { selectedMessageMode: config["selectedMessageMode"] });

  await roll.toMessage({
    speaker,
    flavor: game.i18n.localize("EE.Features.Commune.RollFlavor"),
    // These d6s are an oracle, not damage and not healing. Without this the
    // system hangs "Deal Damage" and "Apply Healing" under them, as it does under
    // every plain roll in the world.
    ...withoutApplyButtons(),
    // Omitted rather than passed as null: core reads the presence of the field.
    ...(whisper ? { whisper } : {}),
    blind,
  });

  const value = await pickValue(facesOf(roll));
  if (value === null) {
    // Dismissing the picker leaves the dice standing in chat, which is the whole
    // of what the card mechanically produced. Nothing is undone and nothing else
    // is posted.
    console.debug(`${LOG_PREFIX} ${LABEL}: no value was chosen; the dice stand alone.`);
    return;
  }

  const record: Communing = {
    name: String(actor["name"] ?? ""),
    value,
    askedBy: String(game.user?.id ?? ""),
  };

  const message = (await ChatMessage.create({
    speaker,
    content: cardMarkup(record),
    flags: { [MODULE_ID]: { [FLAGS.commune]: record } },
    ...(whisper ? { whisper } : {}),
    blind,
  })) as AnyObject | undefined;

  const messageId = String(message?.["id"] ?? "");
  if (!messageId) {
    console.warn(`${LOG_PREFIX} ${LABEL}: the card did not post, so the GM cannot be asked.`);
    return;
  }

  await requestAnswer(messageId);
}

/**
 * Install the oracle, the socket listener and the un-targeting rule.
 *
 * The un-targeting rule is registered here rather than patched here: the shared
 * patch in `card-targeting.ts` installs itself at `setup`, and this only has to
 * say which actions it applies to.
 */
export function registerCommune(): void {
  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject) => {
    void runCommune(action, config).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} ${LABEL}: the oracle could not be run.`, error);
    });
  });

  registerCommuneSocket();

  // "You commune with an ancestor, deity, nature spirit, or otherworldly being"
  // — there is nothing on the scene to target, and the compendium copy's
  // `target.type: "any"` is left over from how the card was first built.
  untargetAction((action) => enabled() && communeAction(action) !== null);
}
