/**
 * **Face Your Fear** (School of War, the Wizard's subclass — SRD p.25) — "When
 * you succeed with Fear on an attack roll, you deal an extra 1d10 magic damage."
 *
 * Three cards, one rule. The subclass ships the rider twice more, each raising
 * the same number:
 *
 * - **Face Your Fear** (foundation, p.25) — 1d10.
 * - **Fueled by Fear** (specialization, p.25) — "increases to 2d10".
 * - **Have No Fear** (mastery, p.26) — "increases to 3d10".
 *
 * All three are `feature` Items with `actions: {}`, `effects: []` and
 * `resource: null` — printed text and nothing else. Nothing in the system reads
 * them, so as shipped the rider is entirely a thing the table has to remember,
 * on the one roll where the player has just been told they did badly.
 *
 * ## Where the dice go
 *
 * Into `config.modifiers`, through `damage-modifiers.ts` — the mechanism behind
 * the weapon features (Massive, Powerful, Brutal). That file explains the three
 * things it buys; the one that decided it here is the **label**. The Daggerheart
 * damage card renders its own tooltip: a row of dice and a total, with no formula
 * anywhere on it. A d10 that simply appeared in that row would be unattributable,
 * and the module would be adding damage without ever saying so. A modifier entry
 * puts "Face Your Fear" in front of the player in the damage dialog, beside the
 * weapon's own features, which is exactly what it is.
 *
 * It also means the table can drop the rider for one roll by unticking it — the
 * same affordance Massive and Powerful have, and the same one those need for the
 * same reason: a printed rule with no exceptions still meets tables that want one.
 *
 * ## What the extra die is typed as
 *
 * Whatever the attack was. **Not** `magical`, deliberately, and this is the one
 * place the automation is knowingly imprecise.
 *
 * Bonus dice cannot be their own damage part — `Actor#takeDamage` converts the
 * main damage through `convertDamageToThreshold`, which works on the *total*, so
 * a second part would be converted twice and mark the wrong number of Hit Points.
 * (`crimson-rite.ts` sets this out at length; it is the real constraint on the
 * whole class of "an extra Nd… of some other type" features.) So the die joins
 * the attack's own formula and inherits the attack's own types, and the only
 * lever left is whether to add `magical` to the merged part.
 *
 * Crimson Rite adds it, and should: that rule *enchants the weapon*, so typing
 * the weapon's own damage magical is the rule rather than a side effect. This one
 * does not. The magic here is the extra die, not the sword — and because
 * `getResistanceStatus` requires resistance to **all** of a part's types before
 * it counts, adding `magical` would quietly stop a physically-resistant creature
 * halving the *base* weapon damage too, on Fear successes only. A greatstaff that
 * behaves differently against the same troll depending on which Duality die came
 * up higher is a worse lie than a d10 that a rare resistance halves along with
 * everything else.
 *
 * ## Knowing it was a Fear success
 *
 * At the damage roll, from the attack roll's own config. `DamageField.execute`
 * spreads the action workflow's config into the damage config, and
 * `D20Roll.buildEvaluate` has already written `roll.result.duality` and
 * `roll.success` into it — the same two fields the system's own `resultBased`
 * damage reads (`DamageField.getFormulaValue`). Nothing has to be remembered
 * between the two rolls.
 *
 * Reading it *there* rather than at the attack is what makes this compose with
 * the features that rewrite a result:
 *
 * - **Fearless** (Infernis) converts a Fear result to Hope for 2 Stress, and its
 *   window runs long before the damage roll. So taking that offer correctly costs
 *   this rider too — a real decision, and one the player is making with the dice
 *   in front of them.
 * - **Witch's Charm** converts a failure *into* a success with Fear, and by the
 *   same ordering the rider then applies. Both write through
 *   `duality-outcome.ts`'s `setRollDuality`, so the value read here is the settled
 *   one either way.
 *
 * A critical never reaches this: matched dice leave `duality` at `0`, which is
 * neither Hope nor Fear. There is nothing to reconcile.
 *
 * ## Which tier
 *
 * By the highest of the three cards the character has **available**, not the
 * highest they are carrying. Those are different: the system grants all of a
 * subclass's features as Items when the subclass is taken and gates them
 * afterwards on `subclass.system.featureState` (1 foundation, 2 specialization,
 * 3 mastery), which is what hides the unearned ones from the sheet. Finnegan is
 * level 1 and holds all three cards; counting Items would hand a first-level
 * wizard 3d10.
 *
 * The question is asked through `actor.system.isItemAvailable`, the system's own
 * answer, rather than a copy of the rule — it is what `sheetLists` filters on and
 * what decides whether a feature's ActiveEffects transfer, and it already knows
 * about multiclass subclasses, which a reimplementation here would have to learn.
 *
 * ## Deliberate silences
 *
 * - **Nothing is posted to chat.** The rule is not a choice, costs nothing, and
 *   fires on a good fraction of a wizard's attacks; a line every time would be
 *   the loudest thing this module does for the least decision. The damage dialog
 *   names it, which is where a feature that joins a roll belongs.
 * - **A miss adds nothing**, even though the system rolls damage anyway. "When
 *   you succeed" is the whole condition.
 * - **An attack the system never scored adds nothing.** With nothing targeted and
 *   no difficulty set, `buildEvaluate` leaves `roll.success` undefined, and a
 *   rider that fired on an unmeasured attack would inflate a number the GM is
 *   about to adjudicate by hand. Erring toward the printed damage is recoverable;
 *   erring the other way is a silent overcount.
 * - **Damage rolled from the chat card's own button adds nothing.** That path
 *   (`DhpChatMessage#onRollDamage`) rebuilds the config from the message, whose
 *   stored data carries neither the duality result nor the hit — the message's
 *   `roll` is the `DualityRoll` itself, and the spread into the damage config
 *   drops it, being a prototype getter rather than a field. The system's own
 *   `resultBased` damage is broken on exactly that path for exactly that reason,
 *   so a Blighting Strike rolled from the button already rolls its Hope die. Not
 *   worth reconstructing the hit from stored difficulties here; the workflow path
 *   is the one every table's damage automation actually uses.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { attackActionOf, rollingCharacter } from "./attack-action.js";
import { onDamageModifiers } from "./damage-modifiers.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";

/** For console lines. The printed card name, in the book's capitalisation. */
const LABEL = "Face Your Fear";

/**
 * One of the three cards. The registry id doubles as the value of the homebrew
 * `flags.eryndor-essentials.featureId` escape hatch, so a rewritten card can opt
 * into whichever tier it means to be.
 */
interface Tier {
  id: string;
  /** How many dice this card's sentence prints. */
  dice: number;
  match: FeatureMatch;
}

/** The card the rule is written on. Without it there is no rider at all. */
const BASE: Tier = {
  id: "faceYourFear",
  dice: 1,
  match: {
    compendiumSources: ["Compendium.daggerheart.subclasses.Item.D3ffFWSXCza4WGcM"],
    names: ["Face Your Fear"],
  },
};

/** The two that raise its number. Each says "increases to", so the largest wins. */
const UPGRADES: readonly Tier[] = [
  {
    id: "fueledByFear",
    dice: 2,
    match: {
      compendiumSources: ["Compendium.daggerheart.subclasses.Item.hNqLf3zEfKRzSbvq"],
      names: ["Fueled by Fear"],
    },
  },
  {
    id: "haveNoFear",
    dice: 3,
    match: {
      compendiumSources: ["Compendium.daggerheart.subclasses.Item.8TH6h6a36h09mf6d"],
      names: ["Have No Fear"],
    },
  },
];

/** The die all three cards print. */
const DIE = "d10";

/** The key the row is filed under in `config.modifiers`. */
const MODIFIER = "eeFaceYourFear";

/** `config.roll.result.duality` for a roll made with Fear. */
const WITH_FEAR = -1;

/** `CONFIG.DH.GENERAL.healingTypes.hitPoints.id` — the only part modifiers run for. */
const HIT_POINTS = "hitPoints";

/** `CONFIG.DH.ITEM.featureSubTypes.foundation` — the tier a subclass grants at once. */
const FOUNDATION = "foundation";

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.faceYourFearDamage) === true;
}

/** Said once per session, not once per roll, if the system's gate goes missing. */
let warnedAboutAvailability = false;

/**
 * Has this character actually earned this subclass card yet?
 *
 * The system's own answer. Without it the only honest fallback is the printed
 * baseline: the foundation card comes with the subclass, so grant that and refuse
 * to guess at anything above it.
 */
function available(actor: AnyObject, item: AnyObject | null): boolean {
  if (!item) return false;

  const check = actor["system"]?.["isItemAvailable"];
  if (typeof check !== "function") {
    if (!warnedAboutAvailability) {
      warnedAboutAvailability = true;
      console.warn(
        `${LOG_PREFIX} ${LABEL}: no isItemAvailable on this actor — only the foundation card counts.`,
      );
    }
    return String(item["system"]?.["identifier"] ?? "") === FOUNDATION;
  }

  try {
    return check.call(actor["system"], item) === true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not ask whether ${item["name"]} is available.`, error);
    return false;
  }
}

/**
 * How many d10s this character's rider is worth: 0 when they do not have it.
 *
 * The largest available card wins outright rather than accumulating — all three
 * print the same sentence with a different number, and a character who has
 * reached the mastery deals 3d10, not 1 + 2 + 3.
 */
function diceFor(actor: AnyObject): number {
  if (!available(actor, findGrantingItem(actor, BASE.id, BASE.match))) return 0;

  let dice = BASE.dice;
  for (const tier of UPGRADES) {
    if (tier.dice <= dice) continue;
    if (available(actor, findGrantingItem(actor, tier.id, tier.match))) dice = tier.dice;
  }

  return dice;
}

/**
 * Did the attack this damage follows succeed with Fear?
 *
 * Both halves come off `config.roll`, which `DamageField.execute` carried over
 * from the action workflow. `success` is deliberately compared against `true`
 * rather than tested for truthiness: it is left *undefined* on an attack the
 * system never scored, and "not measured" must not read as "hit".
 */
function fearSuccess(config: AnyObject): boolean {
  const roll = config["roll"] as AnyObject | undefined;
  if (!roll) return false;

  return (
    Number(roll["result"]?.["duality"] ?? 0) === WITH_FEAR && roll["success"] === true
  );
}

/**
 * The row the damage dialog renders and `constructFormula` applies.
 *
 * `enabled: true` rather than a `values` dropdown: this is a rider with no
 * number to choose, so it renders as a ticked checkbox exactly like the weapon
 * features it sits beside.
 */
function addFearDice(config: AnyObject, modifiers: AnyObject): void {
  if (!enabled()) return;

  // Cheapest checks first — this runs on every damage roll anyone makes.
  const formula = config["damageFormula"] as AnyObject | undefined;
  if (config["hasHealing"] === true || !formula) return;

  // `constructFormula` only runs modifier callbacks for the main damage part when
  // it applies to Hit Points, so anywhere else the row would be a control that
  // could not do anything.
  if (String(formula["applyTo"] ?? HIT_POINTS) !== HIT_POINTS) return;

  if (!fearSuccess(config)) return;

  const actor = rollingCharacter(config);
  if (!actor) return;

  // Before asking what the action was: this is the check that stops the console
  // line below printing for every character in the world who isn't a War Wizard.
  const count = diceFor(actor);
  if (count < 1) return;

  // "On an attack roll" — a Spellcast counts, since the action is what says
  // whether a roll was an attack. See `attack-action.ts`.
  if (!attackActionOf(actor, config, LABEL)) return;

  modifiers[MODIFIER] = {
    label: "EE.Features.FaceYourFear.DiceLabel",
    enabled: true,
    callback: (part: AnyObject): void => {
      const OperatorTerm = foundry["dice"]?.["terms"]?.["OperatorTerm"];
      if (typeof OperatorTerm !== "function") {
        console.warn(`${LOG_PREFIX} ${LABEL}: cannot build the dice for this damage roll.`);
        return;
      }

      part["roll"]?.["terms"]?.push(
        new OperatorTerm({ operator: "+" }),
        ...Roll.parse(`${count}${DIE}`, (config["data"] ?? {}) as AnyObject),
      );
    },
  };

  console.debug(`${LOG_PREFIX} ${LABEL}: ${actor["name"]} adds ${count}${DIE} to this hit.`);
}

export function registerFaceYourFear(): void {
  onDamageModifiers({ id: "faceYourFear", add: addFearDice });
}
