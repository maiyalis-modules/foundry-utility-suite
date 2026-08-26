/**
 * **Strange Patterns** (Wizard, SRD p.25) — "Choose a number between 1 and 12.
 * When you roll that number on a Duality Die, gain a Hope or clear a Stress. You
 * can change this number when you take a long rest."
 *
 * `Compendium.daggerheart.classes.Item.6YsfFjmCGuFYVhT4`.
 *
 * ## What the SRD already does, and what it leaves out
 *
 * This is the rare card the system ships **fully automated for the half that
 * matters**. Its one action, "Clear Stress", carries a `dualityRoll` trigger
 * whose script reads both dice, counts how many of them show the chosen number,
 * and opens a dialog to split that many rewards between Hope gained and Stress
 * cleared. Nothing in this file touches any of that — the matching, the counting
 * and the reward dialog are the system's, and they work.
 *
 * What the system ships no rule for at all is **the number itself**. It is
 * stored as an item resource of type `diceValue`:
 *
 * ```
 * item.system.resource.diceStates = { "0": { value: 7, used: false } }
 * ```
 *
 * and the only way to put a value there is the little d12 widget on the card's
 * sheet row, which opens `ResourceDiceDialog` — a free-form number field and a
 * "reroll" button, available at any moment, to anyone who owns the sheet. So the
 * card as shipped has both halves of its own rule missing: nothing tells a new
 * holder they are supposed to choose, and nothing stops the number being changed
 * to whatever the dice just showed, on the roll it would pay out on.
 *
 * That is what this file adds, and all of it. The storage stays exactly where
 * the system put it, because the shipped trigger reads it — writing the number
 * to a flag of our own would look identical on the sheet and quietly stop the
 * card working.
 *
 * ## One rule, three doors
 *
 * The printed rule is a single sentence about *when*: you choose once, and after
 * that it changes on a long rest. Three places had to learn it.
 *
 * 1. **The card's button.** Pressing "Clear Stress" is what a player does when
 *    they want the card to do something, so that press becomes the choosing
 *    gesture while the number is unset, and a reminder of the number once it is
 *    set. The press is cancelled either way — see below.
 * 2. **The long rest dialog.** The rule names long rests specifically, and the
 *    system already opens a window at exactly that moment, so the control goes
 *    in it rather than in a dialog of its own stacked on top of it. See
 *    {@link injectRestPicker}.
 * 3. **Everything else**, which is the sheet widget and anything that writes the
 *    same field. Refused while a number is set and no long rest is open. See
 *    {@link registerLock}.
 *
 * The lock is what makes the other two mean anything, and it is deliberately a
 * rule about the *field* rather than about the two doors: a guard that only knew
 * how to stop the paths it had been told about would be re-opened by the next
 * route the system grows.
 *
 * ## Why pressing the card is cancelled rather than adjusted
 *
 * The action is `healing`-typed and carries a `stress` damage part of `1`, which
 * means the shipped button clears a Stress every time it is pressed, for free,
 * with no roll and no condition. That payload is vestigial: the trigger does not
 * use it — it returns its own `{ updates }`, which `runTrigger` hands back to
 * `DualityRoll` as resource updates — and the reward it represents is already
 * being granted by the dialog the trigger opens. The action exists to be a
 * container for the trigger, and its `chatDisplay` card says "Clear Stress"
 * about a Stress that was cleared somewhere else entirely.
 *
 * So the press is stopped at `preUseAction`, before the cost, the card and the
 * effect — and the button is given the job the card actually has no way to do.
 * Turning this feature off restores the shipped behaviour exactly, including the
 * free Stress clear, which is the honest thing for a switch to mean.
 *
 * ## Two readings
 *
 * - **"Between 1 and 12" is inclusive**, and the die is the d12 the card's own
 *   resource declares. Twelve options, not ten.
 * - **The rest window, not the rest**, is what unlocks the number. The rule says
 *   "when you take a long rest", and the system's own answer to "when is that?"
 *   is the downtime dialog being open. Changing it more than once while that
 *   window is up is possible and is left possible: the number is secret from
 *   nobody, and a player who mistypes 8 for 3 during their rest should not have
 *   to wait a session to fix it.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { chooseFromList, showNotice, type ListChoice } from "./feature-prompt.js";

/** Stable id, and the value a homebrew card's `featureId` flag can carry. */
const FEATURE_ID = "strangePatterns";

/** The SRD Item this comes from — matched ahead of the printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.classes.Item.6YsfFjmCGuFYVhT4"],
  names: ["Strange Patterns"],
};

/** The card's own die. Its resource declares `dieFaces: "d12"`; this is that 12. */
const FACES = 12;

/**
 * The key the one die is stored under.
 *
 * `diceStates` is a `TypedObjectField` the system fills by index — its own
 * `#handleResourceDice` writes `acc[index]` over the rolled values — and this
 * card's `resource.max` is `"1"`, so there is exactly one, at `"0"`. Written as
 * a whole-object replacement for the same reason: that is what the system does,
 * and it leaves no second entry behind if a homebrew copy ever declared two.
 */
const DIE_KEY = "0";

/**
 * Update option meaning "this write is the feature's own".
 *
 * Namespaced because the options object travels with the operation and is
 * visible to every other module's hooks. Strictly redundant — every path this
 * file writes on is one the lock would allow anyway — and kept because a guard
 * that can refuse its own author's writes is a guard that will eventually do so.
 */
const BYPASS = `${MODULE_ID}StrangePatterns`;

/** The world switch, read per event so toggling it is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.strangePatternsNumber) === true;
}

/* ------------------------------------------------------------------ *
 * The card and its number
 * ------------------------------------------------------------------ */

/**
 * The Strange Patterns card this actor holds, or null.
 *
 * Characters only, like every other card in this module: an adversary cannot
 * roll Duality, so the trigger this protects could never fire for one.
 */
function patternCard(actor: AnyObject | null | undefined): AnyObject | null {
  if (!actor || actor["type"] !== "character") return null;
  return findGrantingItem(actor, FEATURE_ID, MATCH);
}

/**
 * The card behind this action, or null.
 *
 * Mirrors `gifted-tracker.ts`'s equivalent: the action's own Item has to *be*
 * the card the actor holds, so a homebrew card that merely shares a name with
 * one on a different sheet cannot claim the automation.
 */
function patternCardAction(action: AnyObject | null | undefined): AnyObject | null {
  const actor = action?.["actor"] as AnyObject | undefined;
  const item = action?.["item"] as AnyObject | undefined;
  if (!actor || !item) return null;

  const granting = patternCard(actor);
  return granting && granting["id"] === item["id"] ? granting : null;
}

/**
 * The number on the card, or null when it has never been chosen.
 *
 * Read the same way the SRD trigger reads it — the first `diceStates` entry's
 * `value`, whatever it is keyed under — rather than by looking up {@link DIE_KEY}
 * directly, so a card whose states were written by some other route still
 * answers. A brand-new card carries `diceStates: {}`, which is the null.
 */
function chosenNumber(item: AnyObject | null | undefined): number | null {
  const states = item?.["system"]?.["resource"]?.["diceStates"] as AnyObject | undefined;
  const first = states ? (Object.values(states)[0] as AnyObject | undefined) : undefined;
  const value = Number(first?.["value"]);

  return Number.isInteger(value) && value >= 1 && value <= FACES ? value : null;
}

/**
 * Write the number, replacing whatever was there.
 *
 * `used` is reset to false because it is the sheet's "this die is spent" mark,
 * and a freshly chosen number has not been spent. The trigger ignores it
 * entirely — it reads only `value` — so this is purely about what the card's row
 * draws.
 */
async function writeNumber(item: AnyObject, value: number): Promise<boolean> {
  try {
    await item["update"]({ [NUMBER_PATH]: { [DIE_KEY]: { value, used: false } } }, { [BYPASS]: true });
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Strange Patterns: could not write the number.`, error);
    return false;
  }
}

/** 1 through 12, in reading order. */
function numberOptions(): ListChoice[] {
  return Array.from({ length: FACES }, (_, index) => {
    const value = String(index + 1);
    return { value, label: value };
  });
}

/**
 * Ask for the number, as a dropdown. Returns null for a dialog dismissed.
 *
 * `chooseFromList` rather than `chooseFromRadios` for exactly the reason that
 * one's docblock gives: twelve options whose consequences are identical and
 * whose names say everything about them is a list that is merely long, not a set
 * of outcomes to be weighed against each other.
 */
async function askForNumber(current: number | null): Promise<number | null> {
  const answer = await chooseFromList({
    title: game.i18n.localize("EE.Features.StrangePatterns.Title"),
    intro: game.i18n.localize(
      current === null
        ? "EE.Features.StrangePatterns.ChooseIntro"
        : "EE.Features.StrangePatterns.ChangeIntro",
    ),
    options: numberOptions(),
    ...(current === null ? {} : { initial: String(current) }),
    confirmLabel: game.i18n.localize("EE.Features.StrangePatterns.Confirm"),
    cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
  });

  const value = Number(answer);
  return Number.isInteger(value) && value >= 1 && value <= FACES ? value : null;
}

/**
 * Say what was chosen, in the chat log.
 *
 * Public, because the number is: the GM is the one reading the Duality dice out
 * loud, and a pattern nobody else knows about is one that gets missed on the
 * roll it was supposed to catch. The card itself is silent — its `chatDisplay`
 * press is the one this feature cancels — so without this the choice happens
 * entirely inside one player's dialog.
 */
async function announce(actor: AnyObject, value: number, previous: number | null): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor as never }),
      content: `<p>${escapeHtml(
        previous === null
          ? game.i18n.format("EE.Features.StrangePatterns.Announce", {
              actor: String(actor["name"] ?? ""),
              number: value,
            })
          : game.i18n.format("EE.Features.StrangePatterns.AnnounceChanged", {
              actor: String(actor["name"] ?? ""),
              number: value,
              previous,
            }),
      )}</p>`,
    });
  } catch (error) {
    // The number is already written; losing the announcement must not undo it.
    console.warn(`${LOG_PREFIX} Strange Patterns: could not announce the number.`, error);
  }
}

/**
 * The whole choosing flow, from whichever door it was entered by.
 *
 * Re-reads the number immediately before writing rather than trusting the one
 * the caller rendered its button from: the long rest dialog can sit open across
 * a change made on the card, and announcing "was 4" about a number that is now 9
 * would be a worse lie than saying nothing.
 */
async function chooseNumber(item: AnyObject): Promise<void> {
  const previous = chosenNumber(item);
  const value = await askForNumber(previous);
  if (value === null || value === previous) return;

  if (!(await writeNumber(item, value))) return;
  await announce(item["actor"] as AnyObject, value, previous);
}

/* ------------------------------------------------------------------ *
 * Door 2: the long rest window
 * ------------------------------------------------------------------ */

/**
 * Actors whose **long** rest dialog is open on this client.
 *
 * Tracked here rather than read out of Foundry's application registry so the
 * question "is this character resting?" has one answer with one source, and so
 * the lock does not have to identify a system class by name to ask it. The
 * dialog is opened on the owner's own client (the system's `downtimeMoveQuery`
 * checks `isOwner` before rendering), which is the same client the sheet writes
 * from — so a local set is the right scope, not a shared one.
 */
const resting = new Set<string>();

/** Is this actor's long rest window open here? */
function restOpenFor(actor: AnyObject | null | undefined): boolean {
  const uuid = String(actor?.["uuid"] ?? "");
  return uuid.length > 0 && resting.has(uuid);
}

/**
 * Put the control in the long rest dialog.
 *
 * The system's downtime template ends with a `<fieldset>` of refreshables and
 * then a `<footer>`, so this goes immediately before the footer: last thing on
 * the sheet, in the same shape as the block above it, without displacing the
 * moves that are what the window is actually for.
 *
 * Short rests are skipped — the same dialog class serves both, told apart by
 * `shortrest` — because the rule names long rests and only long rests.
 *
 * Everything here is defensive about the system's markup: a missing footer or a
 * renamed field costs the button and nothing else, and the rest of the dialog is
 * untouched either way.
 */
function injectRestPicker(app: AnyObject, element: HTMLElement): void {
  if (!enabled() || app?.["shortrest"] !== false) return;

  const actor = app["actor"] as AnyObject | undefined;
  const item = patternCard(actor);
  // `isOwner` rather than a user check: the GM opens this window for other
  // people's characters too, and they are exactly as entitled to set the number
  // as the player is.
  if (!item || item["isOwner"] !== true) return;

  const footer = element.querySelector("footer");
  if (!footer) {
    console.warn(`${LOG_PREFIX} Strange Patterns: no footer in the rest dialog — no picker added.`);
    return;
  }

  // A re-render replaces the part's markup wholesale, so this only ever catches
  // a second call against the same DOM.
  element.querySelector(".ee-strange-patterns")?.remove();

  const current = chosenNumber(item);
  const fieldset = document.createElement("fieldset");
  fieldset.className = "ee-strange-patterns";
  fieldset.innerHTML = `
    <legend>${escapeHtml(game.i18n.localize("EE.Features.StrangePatterns.Title"))}</legend>
    <div class="ee-strange-patterns-row">
      <span class="ee-strange-patterns-number">${
        current === null ? "?" : escapeHtml(String(current))
      }</span>
      <span class="ee-strange-patterns-label">${escapeHtml(
        game.i18n.localize(
          current === null
            ? "EE.Features.StrangePatterns.RestUnset"
            : "EE.Features.StrangePatterns.RestSet",
        ),
      )}</span>
      <button type="button" class="ee-strange-patterns-change">${escapeHtml(
        game.i18n.localize(
          current === null
            ? "EE.Features.StrangePatterns.Choose"
            : "EE.Features.StrangePatterns.Change",
        ),
      )}</button>
    </div>`;

  // `type="button"` above matters: the dialog is a `<form>` with
  // `submitOnChange`, and a default-typed button inside it would submit.
  fieldset.querySelector("button")?.addEventListener("click", () => {
    void (async () => {
      await chooseNumber(item);
      // Redraw so the number beside the button is the one that was just chosen.
      // The dialog owns its own state, so asking it to re-render is the only
      // honest way to update this — patching the span would leave the two out of
      // step the moment anything else re-rendered.
      try {
        await app["render"]?.();
      } catch (error) {
        console.warn(`${LOG_PREFIX} Strange Patterns: could not redraw the rest dialog.`, error);
      }
    })();
  });

  footer.parentElement?.insertBefore(fieldset, footer);
}

/* ------------------------------------------------------------------ *
 * Door 3: everything else
 * ------------------------------------------------------------------ */

/** Where the number lives, as the dotted path an update carries it under. */
const NUMBER_PATH = "system.resource.diceStates";

/**
 * Does this update write the chosen *number*?
 *
 * Flattened rather than probed with `getProperty`, because an update can arrive
 * either expanded (`{system: {resource: {diceStates: …}}}`) or with the dotted
 * path as a literal key — the system's own writes use the second form — and only
 * flattening answers both shapes with one test.
 *
 * ## Why `used` is excluded
 *
 * A `diceStates` entry has two fields, and the sheet writes them from different
 * buttons. Clicking the die itself toggles `used`, the little X that means "this
 * one is spent"; only the dialog behind the dice icon writes `value`. This rule
 * is about the number, so a press of the first must go through untouched — being
 * told the number can only change during a long rest, in answer to a click that
 * was not trying to change it, would read as the card being broken.
 *
 * `used` carries no meaning for this card in any case: the SRD trigger reads
 * `value` and nothing else, so the X is decoration a player is free to keep
 * however they like.
 *
 * The two comparisons that are *not* filtered are both whole-object writes: the
 * bare path, which is how the states would be cleared to `{}`, and a write of
 * one entry as a unit, which flattens to a `.value` key of its own.
 */
function touchesNumber(changes: AnyObject): boolean {
  try {
    const keys = Object.keys(foundry.utils.flattenObject(changes)).filter(
      (key) => key === NUMBER_PATH || key.startsWith(`${NUMBER_PATH}.`),
    );

    return keys.some((key) => key === NUMBER_PATH || !key.endsWith(".used"));
  } catch (error) {
    // Never guess "yes" from a broken read: a guard that cannot tell must let
    // the write through rather than block an unrelated edit to the card.
    console.warn(`${LOG_PREFIX} Strange Patterns: could not read the update.`, error);
    return false;
  }
}

/**
 * Refuse a change to the number outside the moments the rule allows.
 *
 * `preUpdateItem` is the choke point in the same sense `deck-limit-guard.ts`'s
 * `preCreateItem` is: the sheet's d12 widget, its reroll button, a macro and any
 * other module all end in an Item update carrying this field, so refusing here
 * covers routes that do not exist yet. It fires on whichever client issued the
 * update, which for a player editing their own card is their own — the same
 * client that knows whether their rest window is open.
 *
 * Like that guard, this is a house rule and not a security boundary: a player
 * with the console open owns the document and can write to it directly. What it
 * stops is the number being changed *by the interface*, which is the only way it
 * would be changed by accident.
 *
 * The GM is exempt outright. Somebody has to be able to fix a number typed
 * wrong three sessions ago, and the alternative — a confirmation dialog on every
 * GM edit — would put a question in front of the one person who cannot be
 * cheating.
 */
function registerLock(): void {
  Hooks.on(
    "preUpdateItem",
    (item: AnyObject, changes: AnyObject, options: AnyObject): boolean | void => {
      try {
        if (!enabled() || options?.[BYPASS] === true || game.user?.isGM === true) return;
        if (!touchesNumber(changes)) return;

        // Cheapest checks first: the flatten above already happened, but
        // `findGrantingItem` walks the sheet, so it is asked last and only about
        // an update that really is writing this field.
        const actor = item?.["parent"] as AnyObject | undefined;
        const granting = patternCard(actor);
        if (!granting || granting["id"] !== item["id"]) return;

        const current = chosenNumber(item);
        if (current === null || restOpenFor(actor)) return;

        ui.notifications?.warn(
          game.i18n.format("EE.Features.StrangePatterns.Locked", { number: current }),
        );
        return false;
      } catch (error) {
        // Never `false` from here: a broken check must let the edit through
        // rather than silently freeze a card nobody can then repair.
        console.warn(`${LOG_PREFIX} Strange Patterns: could not check the update.`, error);
      }
    },
  );
}

/* ------------------------------------------------------------------ *
 * Door 1: the card
 * ------------------------------------------------------------------ */

/**
 * What pressing the card does instead.
 *
 * Three outcomes, and the third is the one worth naming: a player who presses
 * the card mid-session with the number already set gets told what it is and when
 * it can change, rather than a dialog that would let them change it or a button
 * that appears to do nothing. The card is the obvious place to *ask* what your
 * number is, and answering that is a better use of the press than refusing it.
 */
async function pressCard(item: AnyObject): Promise<void> {
  const current = chosenNumber(item);
  if (current === null || restOpenFor(item["actor"] as AnyObject)) {
    await chooseNumber(item);
    return;
  }

  await showNotice({
    title: game.i18n.localize("EE.Features.StrangePatterns.Title"),
    intro: game.i18n.format("EE.Features.StrangePatterns.Reminder", { number: current }),
    dismissLabel: game.i18n.localize("EE.Features.StrangePatterns.Dismiss"),
  });
}

export function registerStrangePatterns(): void {
  // `preUseAction` is synchronous and runs before the cost, the chat card and
  // the action's own effect, so returning `false` here stops all three. The
  // choosing that replaces the press is fired off rather than awaited, for the
  // same reason `deck-limit-guard.ts` fires its dialogs off: there is no way to
  // await an answer and still cancel.
  Hooks.on("daggerheart.preUseAction", (action: AnyObject): boolean | void => {
    try {
      if (!enabled()) return;
      const item = patternCardAction(action);
      if (!item) return;

      void pressCard(item);
      return false;
    } catch (error) {
      // Never `false` from here either: a broken check must let the press
      // through as the card shipped, rather than swallow it.
      console.warn(`${LOG_PREFIX} Strange Patterns: could not take over the card.`, error);
    }
  });

  // Both halves of the rest window's bookkeeping. `render` fires on every
  // re-render — selecting a downtime move re-renders the dialog — so adding to a
  // Set rather than counting is deliberate.
  Hooks.on("renderDhpDowntime", (app: AnyObject, element: HTMLElement) => {
    try {
      if (app?.["shortrest"] !== false) return;
      const uuid = String((app["actor"] as AnyObject | undefined)?.["uuid"] ?? "");
      if (uuid) resting.add(uuid);
      injectRestPicker(app, element);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Strange Patterns: could not add the rest picker.`, error);
    }
  });

  Hooks.on("closeDhpDowntime", (app: AnyObject) => {
    try {
      const uuid = String((app?.["actor"] as AnyObject | undefined)?.["uuid"] ?? "");
      if (uuid) resting.delete(uuid);
    } catch (error) {
      // A uuid left in the set would leave the number editable until reload,
      // which is the safe direction to fail in.
      console.warn(`${LOG_PREFIX} Strange Patterns: could not close out the rest.`, error);
    }
  });

  registerLock();
}
