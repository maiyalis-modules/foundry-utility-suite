/**
 * The single wrapper around `DamageRoll.temporaryModifierBuilder`, for every rule
 * that adds a row to the damage dialog.
 *
 * ## Why this method
 *
 * `config.modifiers` is the system's own answer to "something other than the
 * action's own dice is joining this damage roll". `DHRoll.buildConfigure` fills
 * it by calling this builder, the damage dialog renders one labelled row per
 * entry — a `<select>` when the entry carries `values`, a checkbox when it
 * carries `enabled` — and `DamageRoll#constructFormula` runs each entry's
 * `callback` against the damage part on every rebuild. It is what Bardic Rally
 * and the weapon features (Massive, Powerful, Brutal, Serrated) are built on, so
 * a rule that joins it inherits three things for free:
 *
 * - **A name in front of the player.** A die that simply appeared in the total
 *   would be indistinguishable from a bug; one the dialog labels is the feature
 *   announcing itself, in the place the system already puts such announcements.
 * - **The live formula preview.** The dialog re-derives the formula from
 *   `constructFormula` on every change, so the row and the number agree.
 * - **The critical bonus.** `constructFormula` sums `formulaData.roll.dice`
 *   *after* both modifier passes, so any die a callback pushed is maximised on a
 *   critical along with the rest — exactly as the system does for a Rally die.
 *
 * The callbacks only run for the **main damage part**, and only when it applies
 * to Hit Points: `constructFormula` guards them with
 * `isDamage && applyTo === hitPoints`. A rule that could not act on such a part
 * should decline rather than register a row, or the dialog grows a control that
 * does nothing.
 *
 * ## One patch, many rules
 *
 * Extracted from `slayer.ts` when Face Your Fear became the second consumer —
 * the same rule this codebase applies everywhere else, and for the same reasons
 * `damage-landing.ts` sets out: two independent wrappers around one static nest
 * in load order, warn separately when the system moves it, and leave nowhere that
 * answers "what can join a damage roll". Rules run in registration order; one
 * that throws is logged and skipped, because the damage roll has to happen either
 * way.
 *
 * ## The bet this takes
 *
 * Every call site of `temporaryModifierBuilder` in the system's own source is
 * flagged **"To Remove When Reaction System"**, so the mechanism is scaffolding
 * with a stated end date. That bet was already taken when Slayer Dice were built
 * on it, and the alternative — pushing terms from `daggerheart.preRoll` — buys
 * none of the three things above. Concentrating it here means that when the
 * system does replace the mechanism, there is one wrapper to move rather than one
 * per feature.
 */
import { LOG_PREFIX } from "../constants.js";

/** One rule. `add` is called with the damage config and the fresh modifier map. */
export interface DamageModifierRule {
  /** For the console line when this rule throws. */
  id: string;
  /**
   * Add whatever rows this rule wants. `config` is the damage roll's config —
   * `damageFormula`, `source`, `roll` and the rest — and `modifiers` is the map
   * the builder has just rebuilt, so nothing survives from a previous roll.
   */
  add: (config: AnyObject, modifiers: AnyObject) => void;
}

/** Registered rules, in registration order. */
const rules: DamageModifierRule[] = [];

/**
 * Register a rule. Called during `init` from the feature that owns it, so a
 * feature stays one file.
 */
export function onDamageModifiers(rule: DamageModifierRule): void {
  rules.push(rule);
}

/**
 * Install the patch. Called once during `init`, like every other `register*`.
 *
 * Patched immediately rather than at `setup`: the class is read off `CONFIG.Dice`,
 * which the system assigns during its own `init` — which runs before ours, since
 * a system's scripts load ahead of a module's.
 */
export function registerDamageModifiers(): void {
  const DamageRoll = CONFIG["Dice"]?.["daggerheart"]?.["DamageRoll"] as AnyObject | undefined;
  const original = DamageRoll?.["temporaryModifierBuilder"];

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} Damage modifiers: no temporaryModifierBuilder to wrap — every rule on it is off.`,
    );
    return;
  }

  // After the original rather than instead of it: the system's builder *assigns*
  // `config.modifiers`, so anything added first would be thrown away.
  DamageRoll!["temporaryModifierBuilder"] = function (this: AnyObject, config: AnyObject): unknown {
    const modifiers = original.call(this, config) as AnyObject;

    for (const rule of rules) {
      try {
        rule.add(config, (config["modifiers"] ?? modifiers) as AnyObject);
      } catch (error) {
        // A failure here costs that rule's row, not the damage roll.
        console.warn(`${LOG_PREFIX} Damage modifiers: "${rule.id}" failed.`, error);
      }
    }

    return modifiers;
  };
}
