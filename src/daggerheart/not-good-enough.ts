/**
 * **Not Good Enough** (Blade domain, SRD level 1) — "When you roll your damage
 * dice, you can reroll any 1s or 2s."
 *
 * `Compendium.daggerheart.domains.Item.xheQZOIYp0ERQhT9`, a `domainCard` with an
 * empty `actions` object: the system ships it as description only, which for once
 * is the right call. There is no button to press. The card does not fire, it
 * *watches* — every damage roll its holder makes, whether that came from a
 * weapon, a spell or a chat-card button — and a card that triggers on somebody
 * else's action has nothing an action of its own could hook.
 *
 * ## Where this sits, and why the timing works out
 *
 * `DamageRoll.buildPost` is a `super` call away from `DHRoll.buildPost`, which is
 * the seam `roll-pipeline.ts` patches, so a damage roll reaches the windows like
 * any other. What makes this particular feature fit is the two lines
 * `DamageRoll.buildPost` runs *before* that super call:
 *
 * ```js
 * const pool = PoolTerm.fromRolls([config.damage.main, ...resources]);
 * await triggerChatRollFx([Roll.fromTerms([pool])], { whisper, blind });
 * await super.buildPost(roll, config, message);   // <- windows run here
 * ```
 *
 * So by the time this window is asked, the table has already *watched the dice
 * land* — which is exactly the moment the card is written for — and yet nothing
 * has been posted or applied: the chat card is created, or for damage rolled off
 * an attack's card updated, after the super call returns. Every other window in
 * this module has to call `showDiceEarly` to manufacture that ordering; this one
 * gets it for free. It is also why the prompt must **not** roll dice early
 * itself, which would throw the same dice a second time.
 *
 * ## Rerolling in place rather than rebuilding the roll
 *
 * `rebuildRoll` — what Ranger's Focus and Adaptability use — is wrong here. It
 * throws every die away and rolls the formula again, which is what "reroll the
 * attack" means and is the opposite of "reroll any 1s or 2s": the 6 the player is
 * keeping has to survive. So this reaches into the evaluated dice instead, and
 * does it through the system's own `BaseDie#rerollResult` — the same method
 * behind the reroll button the system already puts on every die in a damage chat
 * card. Sharing it buys three things that would otherwise have to be
 * reimplemented and kept in step: the discarded result stays in `results` marked
 * `rerolled`/`active: false`, so the card renders it as replaced rather than
 * losing it; the replacement is spliced back into the die's own order rather than
 * appended; and Daggerheart's combo dice (`c`/`cc`) reroll their partner
 * correctly.
 *
 * ## "Only once" is the system's own bookkeeping, not a counter here
 *
 * `rerollResult` marks the *replacement* `rerolled = true` as well as the result
 * it replaced — which is how the system stops its own chat-card button offering a
 * second reroll of the same die. This file reads that same flag, so "1s and 2s
 * can only be rerolled once" needs no state of its own: a die that came up 2
 * again is already marked, so it is not eligible, and neither this window nor the
 * card's own button can walk back into it. The rule enforces itself, and it
 * enforces itself the same way for both routes into a reroll.
 *
 * ## The two settings, and why one of them is the player's
 *
 * The world switch (`notGoodEnoughReroll`) is the GM's, like every other feature
 * switch. The second one is not: "always reroll" is a preference about being
 * *asked*, and at a table where one player takes the reroll every single time
 * (which is most of them — the card costs nothing to use) and another likes
 * deciding, there is no answer a world setting could give that is right for both.
 * So it is client-scoped, and it is writable from the prompt itself: the moment a
 * player realises they are going to say yes every time is the moment they are
 * looking at the dialog, not the moment they think to open Configure Settings.
 *
 * ## What is not automated
 *
 * - **Resource formulas.** An action that also rolls Stress or healing keeps
 *   those dice as they fell. "Your damage dice" is `config.damage.main`, which is
 *   the only part the system itself treats as damage — `constructFormula` applies
 *   damage bonuses and the critical bonus to that one alone.
 * - **Dice inside a pool.** Nothing the system builds for damage uses one, and a
 *   `PoolTerm`'s total is fixed at evaluation rather than re-derived from its
 *   dice, so rerolling into one would show new faces over an unchanged number.
 *   Declining is the honest answer; see {@link diceTermsOf}.
 * - **Choosing *which* 1s and 2s.** The card says "any", and a 1 or a 2 is worse
 *   than the average of any die that can roll them, so a per-die picker would be
 *   a question with one sensible answer and four clicks.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { rollingCharacter } from "./attack-action.js";
import { confirmWithToggle, type PromptDie } from "./feature-prompt.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { registerRollWindow } from "./roll-pipeline.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "notGoodEnough";

/** Prefix for this feature's console lines. */
const LABEL = "Not Good Enough";

/**
 * How the granting card is recognised — flag, then compendium, then name.
 *
 * `itemTypes` is overridden because this is a `domainCard` rather than the
 * `feature` Item every other entry in the registry matches.
 */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.domains.Item.xheQZOIYp0ERQhT9"],
  names: ["Not Good Enough"],
  itemTypes: ["domainCard"],
};

/** "any 1s or 2s" — the highest face this rerolls. */
const LOW = 2;

/**
 * How deep to follow a term's inner roll. One level is all the system builds — a
 * damage multiplier wraps the whole formula in a `ParentheticalTerm` — and the
 * limit is only so a cycle in somebody else's term cannot hang a damage roll.
 */
const MAX_DEPTH = 4;

/** One damage die that came up low, and where in its term it sits. */
interface LowResult {
  term: AnyObject;
  /** Index into `term.results` — see {@link rerollLow} on why the order matters. */
  index: number;
  /**
   * The result object itself, kept so {@link diceFor} can mark exactly these
   * dice in the prompt by identity rather than by re-deciding the rule a second
   * time and risking the two answers drifting apart.
   */
  result: AnyObject;
  value: number;
}

/**
 * The card, if this character is actually holding it *in their loadout*.
 *
 * A domain card in the vault is inert: the system suppresses every ActiveEffect
 * on one, and `DhActiveEffect#isSuppressed` branches on exactly these two
 * getters. A card whose printed rule this module applies has to go quiet in the
 * same places the system's own version of that rule would.
 */
function heldCard(actor: AnyObject): AnyObject | null {
  const card = findGrantingItem(actor, FEATURE_ID, MATCH);
  if (!card) return null;

  const system = card["system"] as AnyObject | undefined;
  // `isVaultSupressed` is the system's spelling, typo and all.
  if (system?.["isVaultSupressed"] === true || system?.["isDomainTouchedSuppressed"] === true) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the card is not in ${actor["name"]}'s loadout.`);
    return null;
  }

  return card;
}

/**
 * Every die term of `roll` this feature is willing to touch.
 *
 * Walks `terms` by hand rather than using `Roll#dice`, because that getter also
 * reaches into a `PoolTerm` — whose total is fixed when the pool is evaluated and
 * would not follow a rerolled face. Descends only through a term carrying an
 * inner `Roll` (a `ParentheticalTerm`, which is how the system wraps a formula it
 * is about to multiply), and that inner roll *is* re-evaluated afterwards; see
 * {@link recompute}.
 *
 * `rerollResult` is part of the test rather than an assumption. It comes from the
 * system's `BaseDie`, which is installed as `CONFIG.Dice.terms.d`, so every
 * parsed `d6` has it — but a term that somehow does not is skipped rather than
 * rerolled by a second implementation kept here.
 */
function diceTermsOf(roll: AnyObject, depth = 0): AnyObject[] {
  const found: AnyObject[] = [];

  for (const term of (roll["terms"] ?? []) as AnyObject[]) {
    if (Array.isArray(term?.["results"]) && typeof term["rerollResult"] === "function") {
      found.push(term);
      continue;
    }

    const inner = term?.["roll"] as AnyObject | undefined;
    if (depth < MAX_DEPTH && Array.isArray(inner?.["terms"])) {
      found.push(...diceTermsOf(inner as AnyObject, depth + 1));
    }
  }

  return found;
}

/**
 * Which results came up 1 or 2 and still have their reroll.
 *
 * A die of two faces or fewer is skipped: one that cannot beat a 2 has nothing to
 * offer, and rerolling a d2's 1 into a 1 or a 2 is not what the card means.
 */
function lowResultsOf(roll: AnyObject): LowResult[] {
  const found: LowResult[] = [];

  for (const term of diceTermsOf(roll)) {
    const faces = Number(term["faces"]);
    if (!Number.isFinite(faces) || faces <= LOW) continue;

    (term["results"] as AnyObject[]).forEach((result, index) => {
      // `active: false` is a result the roll has already set aside — the half of
      // a reroll that was replaced, or a die dropped by a keep modifier.
      // `rerolled: true` is one whose single reroll is already spent, by this
      // window or by the card's own chat button.
      if (result?.["active"] === false || result?.["rerolled"] === true) return;

      const value = Number(result?.["result"]);
      if (Number.isInteger(value) && value >= 1 && value <= LOW) {
        found.push({ term, index, result: result as AnyObject, value });
      }
    });
  }

  return found;
}

/**
 * Recompute totals from the results, innermost first.
 *
 * `Roll#_evaluate` skips terms that are already evaluated and re-reads their
 * `total`, and `DiceTerm#total` sums the *active* results every time it is asked
 * — so a die whose results changed reports the new figure with no further help. A
 * `ParentheticalTerm` does not: its `total` is its inner roll's cached `_total`,
 * which is why the inner roll is evaluated first and why this is recursive rather
 * than one call.
 */
async function recompute(roll: AnyObject, depth = 0): Promise<void> {
  if (depth < MAX_DEPTH) {
    for (const term of (roll["terms"] ?? []) as AnyObject[]) {
      const inner = term?.["roll"] as AnyObject | undefined;
      if (Array.isArray(inner?.["terms"])) await recompute(inner as AnyObject, depth + 1);
    }
  }

  await roll["_evaluate"]?.();
}

/**
 * Who is going to see the damage this roll produces.
 *
 * Mirrors the first three lines of `DamageRoll.buildPost` field for field, so the
 * replacement dice animate for exactly the people the original dice animated for
 * a moment earlier — including the case where a GM rolled damage privately onto
 * an already-whispered card.
 */
function visibilityFor(config: AnyObject): { whisper: string[] | null; blind: boolean } {
  try {
    const messageId = config["source"]?.["message"];
    const message = messageId
      ? (ui["chat"]?.["collection"]?.get?.(String(messageId)) as AnyObject | undefined)
      : undefined;
    const applied = message ?? ChatMessage.applyMode({}, String(config["rollMode"] ?? "public"));

    const whisper = Array.isArray(applied?.["whisper"]) ? applied["whisper"].map(String) : [];
    return { whisper: whisper.length > 0 ? whisper : null, blind: applied?.["blind"] === true };
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not read the roll's visibility.`, error);
    return { whisper: null, blind: false };
  }
}

/**
 * Throw the replacement dice on the table.
 *
 * Without this the figures on the card would simply differ from the ones everyone
 * just watched land, with nothing to say why. The stand-in roll is the shape the
 * system uses for the same job in `ChatDamageData#rerollDamageDie` — a bare
 * object with `dice` on it, since a `Die` built from results is not `_evaluated`
 * and `Roll.fromTerms` would refuse it — carrying each original term's `options`
 * so a die keeps whatever appearance Dice So Nice gave it the first time.
 *
 * Best-effort throughout: a table without Dice So Nice, or an animation that
 * fails, must not cost the player a reroll they have already asked for.
 */
async function animate(fresh: Map<AnyObject, AnyObject[]>, config: AnyObject): Promise<void> {
  const dice3d = game["dice3d"];
  if (typeof dice3d?.showForRoll !== "function") return;

  try {
    const Die = foundry["dice"]?.["terms"]?.["Die"];
    if (typeof Die !== "function") return;

    const dice = [...fresh].map(
      ([term, results]) =>
        new Die({
          faces: Number(term["faces"]),
          number: results.length,
          results,
          options: term["options"] ?? {},
        }),
    );

    const { whisper, blind } = visibilityFor(config);
    const stand = { _evaluated: true, dice, options: { appearance: {} } };
    await dice3d.showForRoll(stand, game.user, true, whisper, blind);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not animate the rerolled dice.`, error);
  }
}

/**
 * Reroll every low result, recompute the totals, and show the new dice.
 *
 * **Descending index order, within a term, is load-bearing.** `rerollResult`
 * splices the replacement in *before* the result it replaced, so the array grows
 * by one and everything at or after that index shifts right. Rerolling the last
 * low result of a term first leaves every earlier index still pointing at what it
 * pointed at when the list was taken.
 *
 * Returns how many were actually rerolled.
 */
async function rerollLow(
  roll: AnyObject,
  low: readonly LowResult[],
  config: AnyObject,
): Promise<number> {
  const byTerm = new Map<AnyObject, number[]>();
  for (const entry of low) {
    const indices = byTerm.get(entry.term) ?? [];
    indices.push(entry.index);
    byTerm.set(entry.term, indices);
  }

  const fresh = new Map<AnyObject, AnyObject[]>();

  for (const [term, indices] of byTerm) {
    for (const index of [...indices].sort((a, b) => b - a)) {
      const result = (await term["rerollResult"](index)) as AnyObject | null | undefined;
      if (!result) continue;
      // Prepended rather than appended: the indices were walked backwards, and
      // the dice should animate in the order they sit on the card.
      fresh.set(term, [result, ...(fresh.get(term) ?? [])]);
    }
  }

  const rerolled = [...fresh.values()].reduce((count, results) => count + results.length, 0);
  if (rerolled === 0) return 0;

  await recompute(roll);
  await animate(fresh, config);

  return rerolled;
}

/**
 * The dice as they fell, for the strip in the prompt.
 *
 * The rerollable ones are marked by *identity* against the list already
 * collected, not by re-testing the face value: "1 or 2" and "and its reroll is
 * unspent" are two conditions, and a die shown in the marked colour that the
 * reroll then skips would be the one lie this dialog could tell.
 *
 * Discarded results are left out, matching what the chat card renders — a die
 * dropped by a keep modifier is not part of the damage the player is weighing.
 */
function diceFor(roll: AnyObject, low: readonly LowResult[]): PromptDie[] {
  const marked = new Set(low.map((entry) => entry.result));
  const dice: PromptDie[] = [];

  for (const term of diceTermsOf(roll)) {
    const faces = Number(term["faces"]);
    for (const result of term["results"] as AnyObject[]) {
      if (result?.["active"] === false) continue;
      dice.push({
        value: Number(result?.["result"] ?? 0),
        faces: Number.isFinite(faces) ? faces : 0,
        marked: marked.has(result),
      });
    }
  }

  return dice;
}

/** Ask, unless the player has already said "always". Returns whether to reroll. */
async function askOrRemember(roll: AnyObject, low: readonly LowResult[]): Promise<boolean> {
  if (game.settings.get(MODULE_ID, SETTINGS.notGoodEnoughAlwaysReroll) === true) {
    console.debug(`${LOG_PREFIX} ${LABEL}: rerolling ${low.length} without asking.`);
    return true;
  }

  const answer = await confirmWithToggle({
    title: game.i18n.localize("EE.Features.NotGoodEnough.Title"),
    // One sentence whatever the count: the dice below it say which and how many,
    // in the colour, which is a thing the reader can see rather than count.
    intro: game.i18n.localize("EE.Features.NotGoodEnough.Intro"),
    dice: diceFor(roll, low),
    confirmLabel: game.i18n.localize("EE.Features.NotGoodEnough.Confirm"),
    declineLabel: game.i18n.localize("EE.Features.NotGoodEnough.Decline"),
    // No hint under the box: the notification below says where the preference
    // went, which is the part a player who ticked it by accident needs, and a
    // standing explanation of a one-line label is just more to read every time.
    toggle: {
      label: game.i18n.localize("EE.Features.NotGoodEnough.Always"),
      locksDecline: true,
    },
  });

  if (!answer.confirmed) return false;

  if (answer.toggled) {
    try {
      await game.settings.set(MODULE_ID, SETTINGS.notGoodEnoughAlwaysReroll, true);
      // Said out loud, because it is the one answer here that outlives the roll:
      // a player who ticked the box by accident has to be told where it went.
      ui.notifications?.info(game.i18n.localize("EE.Features.NotGoodEnough.Remembered"));
    } catch (error) {
      // The reroll has been asked for and is about to happen either way; failing
      // to remember it is worth a console line, not a cancelled reroll.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not save the "always" preference.`, error);
    }
  }

  return true;
}

/** The window itself: offer the reroll, and apply it before anything reads a total. */
async function runNotGoodEnoughWindow(config: AnyObject): Promise<void> {
  if (game.settings.get(MODULE_ID, SETTINGS.notGoodEnoughReroll) !== true) return;

  // A healing action has no `main` at all — `DHActorRoll#hasHealing` requires the
  // damage to be resources only — so this is belt and braces. But "your damage
  // dice" should never reach a Seraph's healing roll on the strength of a shape
  // check alone.
  if (config["hasHealing"] === true) return;

  const main = config["damage"]?.["main"] as AnyObject | undefined;
  if (!main) return;

  // Silent gate: almost every damage roll in the world is nothing to do with
  // this. Past here every exit says why.
  const holder = rollingCharacter(config);
  if (!holder || !heldCard(holder)) return;

  const low = lowResultsOf(main);
  if (low.length === 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: nothing came up 1 or 2; nothing offered.`);
    return;
  }

  if (!(await askOrRemember(main, low))) {
    console.debug(`${LOG_PREFIX} ${LABEL}: ${holder["name"]} kept the roll.`);
    return;
  }

  const before = Number(main["total"] ?? 0);
  const rerolled = await rerollLow(main, low, config);
  if (rerolled === 0) {
    console.warn(`${LOG_PREFIX} ${LABEL}: no die could be rerolled; leaving the roll alone.`);
    return;
  }

  console.debug(
    `${LOG_PREFIX} ${LABEL}: rerolled ${rerolled} for ${holder["name"]}; ${before} to ${main["total"]}.`,
  );
}

/**
 * Install the window.
 *
 * Registered after the others, and it makes no difference: this is the only
 * window that looks at a damage roll, and every other one declines anything that
 * is not a Duality or an attack. It runs on the client that rolled the damage,
 * which is the player whose card it is — or the GM, when the GM presses the
 * damage button on somebody's chat card, in which case the GM is asked and the
 * GM's own "always" preference applies. That is the same client every other
 * prompt in this module follows.
 */
export function registerNotGoodEnough(): void {
  registerRollWindow({
    id: "notGoodEnough",
    // Cheap and total. The declared roll type is no use here — `DamageField
    // .execute` spreads the *action's* config into the damage config, so
    // `rollTypeOf` reports the attack's `actionType` rather than anything about
    // damage — so this asks the class directly, and falls back to the one config
    // field only a damage roll carries.
    matches: (roll, config) => {
      const cls = CONFIG["Dice"]?.["daggerheart"]?.["DamageRoll"];
      return typeof cls === "function" ? roll instanceof cls : Boolean(config["damageFormula"]);
    },
    run: async (_roll, config) => {
      await runNotGoodEnoughWindow(config);
    },
  });
}
