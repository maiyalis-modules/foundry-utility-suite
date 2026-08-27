/**
 * The single wrapper around `DamageField.applyDamage`, for every rule that fires
 * when damage actually lands.
 *
 * ## Why this method
 *
 * It is the one moment damage is really dealt. The action workflow calls it at
 * order 75, and the chat card's *Apply* button calls the very same entry
 * (`workflow.get('applyDamage')`), so one wrapper covers both the automated and
 * the by-hand route — and a table with apply-automation switched off never sees a
 * rule fire for damage nobody took.
 *
 * ## Two phases, because rules want different moments
 *
 * - `before` runs with the damage still in hand and can **change** it.
 *   `config.damage` at this point is the rolled packet, and the system's own
 *   `damageOnSave` scaling mutates it in exactly the same place, so this is a
 *   supported thing to do rather than a trick.
 * - `after` runs once the system has applied, for a rule that reacts to damage
 *   having been dealt rather than altering it.
 *
 * Both are told whether the system is going to apply anything at all, using the
 * system's own answer rather than a copy of the rule: `applyDamage` returns
 * without doing anything when apply-automation is off and nothing forced it.
 *
 * ## One patch, many rules
 *
 * Extracted from `rangers-focus.ts` when Blighting Strike became the second
 * consumer, for the reason `card-targeting.ts` sets out at length: two
 * independent wrappers around the same method nest in load order, warn separately
 * when the system moves, and leave nowhere that answers "what happens when damage
 * lands". Rules run in registration order; one that throws is logged and skipped,
 * because the damage has to land either way.
 *
 * ## The one rule that lives in the wrapper itself
 *
 * Everything above is a callback reacting to the call. {@link unrolledTargets}
 * is different in kind: it changes an *argument* before the system sees it,
 * which no registered rule can do, and it is why this file reads a setting at
 * all. Its own note says what it is for.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/**
 * One rule. `applying` is false when the system is about to no-op — apply
 * automation is off and nothing forced this call — which every rule should treat
 * as "no damage was dealt".
 */
export interface DamageLandingRule {
  /** For the console line when this rule throws. */
  id: string;
  /** Before the system applies. May change `config.damage`. */
  before?: (config: AnyObject, targets: AnyObject[] | null, applying: boolean) => void | Promise<void>;
  /** After the system has applied. */
  after?: (config: AnyObject, targets: AnyObject[] | null, applying: boolean) => void | Promise<void>;
}

/** Registered rules, in registration order. */
const rules: DamageLandingRule[] = [];

/**
 * Register a rule. Called during `init` from the feature that owns it, so a
 * feature stays one file.
 */
export function onDamageLanding(rule: DamageLandingRule): void {
  rules.push(rule);
}

/**
 * Who this damage is actually landing on.
 *
 * The same default `applyDamage` itself applies, so a rule and the system can
 * never disagree about who was damaged.
 */
export function damagedTargets(config: AnyObject, targets: AnyObject[] | null): AnyObject[] {
  return (
    targets ??
    ((config["targets"] ?? []) as AnyObject[]).filter(
      (target) => target["hitResult"]?.["success"] === true,
    )
  );
}

async function run(
  phase: "before" | "after",
  config: AnyObject,
  targets: AnyObject[] | null,
  applying: boolean,
): Promise<void> {
  for (const rule of rules) {
    const step = rule[phase];
    if (!step) continue;
    try {
      await step(config, targets, applying);
    } catch (error) {
      // The damage lands either way; a broken rule must not take the whole
      // application down with it.
      console.warn(`${LOG_PREFIX} Damage landing: "${rule.id}" failed.`, error);
    }
  }
}

/**
 * Install the patch. Called once during `init`, like every other `register*`.
 *
 * Patched at `setup` rather than `init`: the class is read off `game.system.api`,
 * which the system only fills inside its own `init`. That is early enough —
 * `Action#defineWorkflow` binds `applyDamage` lazily, the first time an action's
 * `workflow` is *used*, which is never before a roll.
 */
export function registerDamageLanding(): void {
  Hooks.once("setup", patchApplyDamage);
}

/**
 * Who an action with no attack roll should apply its damage to.
 *
 * `DamageField.applyDamage` opens by working out who to hit:
 *
 * ```js
 * targets ??= config.targets.filter(target => target.hitResult?.success);
 * if (!config.damage || !targets?.length || …) return;
 * ```
 *
 * That filter assumes an attack roll happened. A `damage` action has none —
 * "shoot magical projectiles that strike a target of your choice" is not rolled
 * against anything — so its targets carry no `hitResult`, the list empties, and
 * the system returns before applying anything. The damage is rolled and posted
 * and then nothing reaches anybody until a human presses *Deal Damage*.
 *
 * **There is no miss to respect**, and that is the whole argument. The filter
 * exists to skip targets an attack failed to hit; an action that never rolled
 * cannot have failed to hit. So when nothing measured a hit at all, the chosen
 * targets are passed through and the system applies to them.
 *
 * Four things keep it narrow:
 *
 * - **An explicit `targets` argument is never overridden.** The chat card's
 *   *Deal Damage* button passes `system.currentHitTargets` along with `force`,
 *   so that route is untouched and cannot double-apply.
 * - **`config.hasRoll` decides.** Anything with an attack roll keeps the
 *   system's filter, misses included.
 * - **`force` is not passed on.** The system's own apply-automation switch still
 *   gates the call, so a table that applies damage by hand keeps doing so.
 *
 * Healing rides the same method and is deliberately included: a healing action
 * with no roll has exactly the same gap, for exactly the same reason.
 *
 * **A `hitResult` is not evidence of a hit**, and an earlier version of this that
 * backed out when it saw one never fired at all. `TargetField.execute` runs at
 * order 20 — after the damage roll, before this — and stamps every target
 * unconditionally:
 *
 * ```js
 * const hitSuccessfull = (!config.roll || !toHitNumber) ? false : (…);
 * target.hitResult = { success: hitSuccessfull };
 * ```
 *
 * With no roll that is `{ success: false }` on everyone, so the field is always
 * present and always false, and `config.hasRoll` is the only honest question.
 *
 * The system agrees, in the one place it already had to decide this. The chat
 * card's *Deal Damage* button applies to `currentHitTargets`, which opens
 * `if (!this.hasRoll || …) return this._getCurrentTargets();` — every target,
 * unfiltered, precisely because there was no roll to filter on. That is why the
 * button has always worked on these cards while automation did nothing. This
 * puts the same rule on the automated path rather than inventing one.
 */
function unrolledTargets(config: AnyObject, targets: AnyObject[] | null): AnyObject[] | null {
  if (targets !== null) return targets;
  if (game.settings.get(MODULE_ID, SETTINGS.noRollDamageApply) !== true) return targets;
  if (config["hasRoll"]) return targets;

  const chosen = config["targets"];
  if (!Array.isArray(chosen) || chosen.length === 0) return targets;

  return chosen as AnyObject[];
}

function patchApplyDamage(): void {
  const damageField = game.system?.api?.fields?.ActionFields?.DamageField as AnyObject | undefined;
  const original = damageField?.["applyDamage"];

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} Damage landing: no applyDamage to wrap — every rule on it is off.`,
    );
    return;
  }

  damageField!["applyDamage"] = async function (
    this: AnyObject,
    config: AnyObject,
    targets: AnyObject[] | null = null,
    force = false,
  ): Promise<unknown> {
    const applying = force === true || damageField!["getApplyAutomation"]?.() === true;

    let chosen = targets;
    try {
      chosen = unrolledTargets(config, targets);
    } catch (error) {
      // The damage lands either way; a broken setting read must not eat it.
      console.warn(`${LOG_PREFIX} Damage landing: could not choose the targets.`, error);
    }

    await run("before", config, chosen, applying);
    const result = await original.call(this, config, chosen, force);
    await run("after", config, chosen, applying);

    return result;
  };
}
