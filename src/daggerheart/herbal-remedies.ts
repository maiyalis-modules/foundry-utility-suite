/**
 * **Herbal Remedies** (Hedge Witch subclass, *Void for Daggerheart*) — "When you
 * or an ally clear one or more Hit Points or Stress as the result of using a
 * consumable, increase the number cleared by one."
 *
 * ## What the Void ships, and why there is nothing to build on the card
 *
 * `type: "feature"`, `actions: {}`, `resource: null` — prose, and rightly so.
 * Unlike every other card in this directory there is no action here that *could*
 * be built: the rule fires on somebody else's button, whichever consumable
 * happens to be drunk, and possibly on somebody else's character. So this file
 * adds nothing to the sheet. It changes one number, in the one place that number
 * is still changeable.
 *
 * ## Where the +1 goes, and why not any of the other four places
 *
 * A healing consumable resolves in stages: the action turns its damage parts into
 * formulas (`DamageField.formatFormulas`), the player may see and edit them in the
 * damage dialog, `DamageRoll.buildEvaluate` rolls them into `config.damage`, and
 * `DamageField.applyDamage` hands the totals to `Actor#takeHealing`. The rule
 * could be applied at any of them; only the first is right.
 *
 * - **`Actor#takeHealing`** is where the words "the number cleared" most literally
 *   live, and `daggerheart.preTakeHealing` hands over a plain `{ key, value }[]`
 *   that would take one line to bump. It is also the point at which
 *   `#parseDamageArgs` has already reduced the payload to those pairs and thrown
 *   away everything about where the healing came from. There is no consumable left
 *   to recognise — the same reason `blighting-strike.ts` could not use
 *   `preTakeDamage` for its halving.
 * - **`applyDamage`** — this module's own `damage-landing.ts` seam — still knows
 *   the source, and is too late: the chat card has been posted. A card that reads
 *   2 over a sheet that moves 3 is the single outcome most certain to be reported
 *   as a bug.
 * - **The evaluated roll** has that problem and a worse one. `Roll#total` is
 *   derived from the terms, so "add one" there means writing to `_total` behind
 *   the roll's back, and the dice the card draws would no longer sum to the number
 *   printed beside them.
 * - **`system.bonuses.healing`** looks like the system's own answer to exactly
 *   this, and is a dead field: declared on the character schema, read nowhere in
 *   the 2.7.2 bundle. `DamageRoll.applyBaseBonus` returns early for anything with
 *   `hasHealing`, and `constructFormula` consults `config.modifiers` only for the
 *   main damage part, never for a resource. Nothing an ActiveEffect can write
 *   reaches a healing formula.
 *
 * So the formula is raised before it is rolled, and everything downstream agrees
 * by construction: the damage dialog offers `1d4 + 1`, the card's dice and its
 * `+1` modifier chip add up to the total printed above them, and `takeHealing`
 * moves that same total. That last part matters more than it looks — a healing
 * consumable declares no target (`target.type: ""`), so `applyDamage` never has
 * anyone to apply to and somebody always reads the number off the card. The
 * reading and the applying have to be the same number, because at most tables the
 * reading *is* the applying.
 *
 * ## Why `formatFormulas` and not `execute`
 *
 * `DamageField.execute` calls `DamageField.formatFormulas.call(this, …)` — once
 * for `damage.main`, once for `damage.resources` — and the array it gets back is
 * freshly built on every call, already merged by `applyTo`, and stored nowhere.
 * Rewriting a string in it is therefore local to one press: nothing is written to
 * the item, the compendium copy is untouched, and switching the setting off makes
 * the very next press behave as it always did. It is also the last point at which
 * the action itself is still `this`, which is how the rule can tell a
 * *consumable's* healing from any other.
 *
 * One patch on one method, like `damage-landing.ts`. If a second rule ever wants
 * to change a formula before it is rolled, this becomes a shared seam the way
 * Ranger's Focus became `damage-landing.ts`; a shared seam with one consumer would
 * be ceremony.
 *
 * ## Who counts as "you or an ally"
 *
 * The consumable's user must be a `character`, and some `character` in this world
 * must have the card. That is the loosest of the available readings and
 * deliberately so, because the tighter ones each break somewhere real: "assigned
 * to a player" and "has a player owner" both fail at a table where the GM runs
 * every sheet, and "on the same scene" fails between sessions, which is when most
 * potions get drunk. Nothing here judges whether two characters are on good terms
 * or in the same room — the same line `close-knit.ts` draws, for the same reason.
 *
 * The check reads *who used the consumable*, not who receives the healing, and it
 * could not do otherwise: a healing consumable declares no target, so at the
 * moment the formula is built there is no recipient to ask about. One is chosen
 * later, by whoever presses Apply Healing with a token targeted.
 *
 * The scan walks every actor's items on each use. That is a handful of times a
 * session against a list a browser searches in microseconds, so it is left
 * uncached: a cache would need invalidating on item creation, deletion, actor
 * import and compendium sync, and being quietly wrong about whether the party has
 * a herbalist is worse than the scan.
 *
 * ## Deliberate silences
 *
 * - **Hope and Armor Slots are untouched.** The card says Hit Points or Stress.
 *   Varik Leaves (2 Hope) and the Armor Stitcher get nothing.
 * - **A consumable that clears both** — none ship, but homebrew can — is raised on
 *   each of the two. "Increase the number cleared by one" does not say which
 *   number when there are two of them, and picking one arbitrarily, or stopping to
 *   ask, would be inventing a rule for a case no printed card presents.
 * - **"Clear *one or more*" is not enforced.** The formula is raised before it is
 *   rolled, so a consumable that would have cleared nothing now clears one. No
 *   shipped consumable can roll zero (`1d4` and its relatives have a floor of 1),
 *   and a full restore — the one shape that really clears "all" rather than a
 *   number — is skipped outright, since the system replaces its formula with `0`
 *   and clears the resource wholesale from the flag instead.
 * - **Nothing is added to the chat card.** The bonus shows as the system's own
 *   `+1` modifier chip beside the dice, because that is what it is. Labelling it
 *   would mean patching the render of every consumable card in the world to hang a
 *   sentence on one of them — and the healing is folded into the *action's*
 *   existing message rather than a message of its own, so there is not even a
 *   document of ours to flag.
 * - **The consumable's own description still says what it printed.** "Clear 1d4
 *   HP" is what the potion is; the extra point is the witch, not the bottle.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.subclasses.Item.pYtLdnmhKmVtxsIM"],
  names: ["Herbal Remedies"],
};

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "herbalRemedies";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Herbal Remedies";

/**
 * The resources the card names, as `CONFIG.DH.GENERAL.healingTypes` ids. Hope,
 * Armor Slots and a weapon's own resource are none of them.
 */
const CLEARED = new Set(["hitPoints", "stress"]);

/** "…increase the number cleared by one." */
const INCREASE = 1;

/** One entry of what `DamageField.formatFormulas` returns. */
interface HealingFormula {
  formula: string;
  applyTo?: string;
  fullRestore?: boolean;
}

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.herbalRemedies) === true;
}

/** Does this actor carry the card? */
function isHerbalist(actor: AnyObject | null | undefined): boolean {
  return !!actor && findGrantingItem(actor, FEATURE_ID, MATCH) !== null;
}

/** Is there a Hedge Witch in this world at all? See the header on "an ally". */
function worldHasHerbalist(): boolean {
  return (game.actors?.contents ?? []).some(
    (actor) => actor["type"] === "character" && isHerbalist(actor),
  );
}

/**
 * "You or an ally." The user's own card is checked first, so the common case —
 * the witch drinking her own potion — never walks the world list.
 */
function benefits(actor: AnyObject | null | undefined): boolean {
  if (!actor || actor["type"] !== "character") return false;
  return isHerbalist(actor) || worldHasHerbalist();
}

/**
 * Raise every Hit Point and Stress formula in the list by one, and answer which
 * ones were raised.
 *
 * Appended rather than folded into the numbers: these are additive expressions
 * built by `DHActionDiceData#getFormula` (`1d4`, `1d4 + 2`,
 * `@system.resources.stress.max`), so ` + 1` parses the same way for all of them
 * and needs to know nothing about the shape it is extending.
 */
function raiseFormulas(formulas: HealingFormula[]): string[] {
  const raised: string[] = [];

  for (const formula of formulas ?? []) {
    if (!CLEARED.has(String(formula?.applyTo ?? ""))) continue;
    // A full restore has no number to increase: the system hands it the formula
    // "0" and clears the resource outright from the `fullRestore` flag instead.
    if (formula.fullRestore === true) continue;
    if (typeof formula.formula !== "string" || formula.formula.length === 0) continue;

    formula.formula = `${formula.formula} + ${INCREASE}`;
    raised.push(String(formula.applyTo));
  }

  return raised;
}

/**
 * Install the patch. Called once during `init`, like every other `register*`.
 *
 * Patched at `setup` for the same reason as `damage-landing.ts`: the class is read
 * off `game.system.api`, which the system only fills inside its own `init`. That
 * is early enough — `execute` looks `formatFormulas` up on the class every time it
 * runs, and it never runs before a card is pressed.
 */
export function registerHerbalRemedies(): void {
  Hooks.once("setup", patchFormatFormulas);
}

function patchFormatFormulas(): void {
  const damageField = game.system?.api?.fields?.ActionFields?.DamageField as AnyObject | undefined;
  const original = damageField?.["formatFormulas"];

  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: no formatFormulas to wrap — the rule is off.`);
    return;
  }

  damageField!["formatFormulas"] = function (
    this: AnyObject,
    damageData: unknown,
    data: unknown,
  ): HealingFormula[] {
    const formulas = original.call(this, damageData, data) as HealingFormula[];

    try {
      if (!enabled()) return formulas;

      // `hasHealing` is the system's own answer to "is this action clearing
      // something rather than dealing damage", and it is what keeps a consumable
      // that *deals* damage — Dripfang Poison, an Arcane Shard — out of this.
      if (!this?.["hasHealing"]) return formulas;
      if (this["item"]?.["type"] !== "consumable") return formulas;

      const actor = this["actor"] as AnyObject | null;
      if (!benefits(actor)) return formulas;

      const raised = raiseFormulas(formulas);
      if (raised.length > 0) {
        console.debug(
          `${LOG_PREFIX} ${LABEL}: +${INCREASE} ${raised.join(", ")} on ` +
            `${String(this["item"]?.["name"] ?? "")} for ${String(actor?.["name"] ?? "")}.`,
        );
      }
    } catch (error) {
      // The potion is drunk either way; a broken rule must not eat the roll.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not raise a consumable's healing.`, error);
    }

    return formulas;
  };
}
