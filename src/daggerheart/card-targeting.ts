/**
 * Cards whose action declares a target that it must not actually ask for.
 *
 * ## The problem
 *
 * Several SRD actions carry `target.type: "any"` because of what they *used* to
 * do — drop an ActiveEffect on whoever you had selected. Once this module takes
 * such a card over, that declaration is a lie with two costs: the system treats
 * the press as a targeted action, and `daggerheart-target-helper`'s targeting
 * guard opens a picker before anything else can happen. For Ranger's Focus that
 * put the target question *before* the weapon was known, so there was no range to
 * filter by and the player was asked twice; for Gifted Tracker there is no target
 * at all — you are reading footprints.
 *
 * ## Why a prototype patch rather than a hook
 *
 * `config.hasTarget` is set inside `TargetField.prepareConfig`, which runs during
 * `prepareConfig` — **before** `daggerheart.preUseAction` fires. By the time any
 * listener of ours could clear it, the guard's listener may already have run and
 * opened its picker, and which of the two goes first is decided by module load
 * order, which is not ours to control: both modules register at `init`. So the
 * declaration has to be gone before the hook exists at all.
 *
 * Reading `this.target.type` is also exactly what the guard checks second, so
 * blanking it closes both of its doors.
 *
 * ## One patch, many rules
 *
 * Each feature registers a predicate rather than patching `use` itself. Two
 * independent wrappers around the same method would work, but they would nest in
 * load order, warn separately when the system moves, and leave no single place
 * that answers "what un-targets a card". The blanking is scoped to one call and
 * restored in a `finally`, so nothing is written to the card and an action used
 * any other way is untouched.
 */
import { LOG_PREFIX } from "../constants.js";

/**
 * Does this action's declared target need suppressing?
 *
 * Called on **every** action use, so it must be cheap and must not throw — a rule
 * that does is skipped, and the action proceeds as declared.
 */
export type UntargetedRule = (action: AnyObject) => boolean;

/** Registered rules, in registration order. The first "yes" wins. */
const rules: UntargetedRule[] = [];

/**
 * Register a rule. Called during `init` from the feature that owns it, so a
 * feature stays one file.
 */
export function untargetAction(rule: UntargetedRule): void {
  rules.push(rule);
}

/** Ask every rule. A rule that throws is treated as "no", never as an error. */
function suppressed(action: AnyObject): boolean {
  for (const rule of rules) {
    try {
      if (rule(action)) return true;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Card targeting: a rule failed; leaving the action alone.`, error);
    }
  }

  return false;
}

/**
 * Install the patch. Called once during `init`, like every other `register*`.
 *
 * The patch itself waits for `setup`, because the action class is read off
 * `game.system.api`, which the system only fills inside its own `init`. That is
 * early enough — no action can be used before setup finishes — and it means the
 * rules registered by features during `init` are all in place by the time the
 * first press happens, whatever order the features loaded in.
 */
export function registerCardTargeting(): void {
  Hooks.once("setup", patchActionUse);
}

/** Wrap `DHBaseAction#use` once, for every rule. */
function patchActionUse(): void {
  const actionClass = game.system?.api?.models?.actions?.actionsTypes?.base as
    | AnyObject
    | undefined;
  const original = actionClass?.["prototype"]?.["use"];

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} Card targeting: no action class to patch — cards that declare a target will ask for one.`,
    );
    return;
  }

  actionClass!["prototype"]["use"] = async function (
    this: AnyObject,
    event?: unknown,
    configOptions?: AnyObject,
  ): Promise<unknown> {
    const target = this["target"] as AnyObject | undefined;
    if (!target || !suppressed(this)) {
      return original.call(this, event, configOptions);
    }

    const declared = target["type"];
    try {
      target["type"] = "";
    } catch (error) {
      // A sealed data model would throw here. Losing the tidy ordering is much
      // better than losing the button, so carry on with the action as declared.
      console.warn(`${LOG_PREFIX} Card targeting: could not un-target the action.`, error);
      return original.call(this, event, configOptions);
    }

    try {
      return await original.call(this, event, configOptions);
    } finally {
      target["type"] = declared;
    }
  };
}
