/**
 * The single interception of the finished mark list, for every rule that changes
 * what an actor is about to mark.
 *
 * ## The moment this is
 *
 * `Actor#takeDamage` ends by calling `this.modifyResource(updates)`, and that
 * argument is the one place the marks are a number in hand: after resistances,
 * after `convertDamageToThreshold`, after the armor-slot dialog has taken its own
 * point off, and *before* `convertStressDamageToHP` turns an unmarkable Stress
 * into a Hit Point. Every entry is a plain `{ key, value }` — `hitPoints`,
 * `stress`, `armor` — and changing one changes what is written.
 *
 * The method's own hooks are all in the wrong place for that. `preTakeDamage` and
 * `postCalculateDamage` both fire while the value is still raw damage, before
 * thresholds have been applied at all; `postTakeDamage` fires after the sheet has
 * already been written. So this wraps `takeDamage` and, for the length of that
 * one call on that one actor, shadows `modifyResource` with a one-shot that hands
 * the update list to each rule before passing it on.
 *
 * ## Why the shadow is an own property, and one-shot
 *
 * The interception is meant to last for one call on one actor, and shadowing the
 * instance says exactly that — nothing else on the table is affected while it is
 * in place. It restores itself as its first act, so a rule that goes on to call
 * `actor.modifyResource` (to charge a cost of its own) reaches the real method,
 * and a `takeDamage` that writes twice only ever offers the first write.
 *
 * ## One patch, many rules
 *
 * Extracted from `tethered-talisman.ts` when Brave Face became the second
 * consumer, for the reason `damage-landing.ts` sets out at length: two
 * independent wrappers around the same method nest in load order, each shadowing
 * the other's shadow, and leave nowhere that answers "what happens to the marks
 * before they are written".
 *
 * Rules run in registration order on the same array, so a later rule sees what an
 * earlier one did — which is the correct reading when two features both reduce a
 * hit. One that throws is logged and skipped, because the damage has to land
 * either way.
 *
 * ## Rules are allowed to hold the damage open
 *
 * `mark` is awaited, and the rules on it ask somebody a question over a socket.
 * That sounds unacceptable until you notice the system does exactly this, in this
 * method, a few lines earlier: `this.owner.query('armorSlot', …, { timeout:
 * 30000 })` stops the same damage dead while the damaged player chooses whether
 * to spend armor. The precedent is the system's own; {@link DamageMarkingRule.wants}
 * exists so the wait is never even set up for an actor no rule cares about.
 */
import { LOG_PREFIX } from "../constants.js";

/** One rule. */
export interface DamageMarkingRule {
  /** For the console line when this rule throws. */
  id: string;
  /**
   * Cheap pre-check, run *before* the damage is calculated: is this actor one
   * this rule could possibly act on? Answering false for everyone keeps the
   * shadow off the actor entirely, which is the common case for every rule here.
   *
   * It cannot know what will be marked — that number does not exist yet — so
   * `mark` still has to check. Omitted means "always".
   */
  wants?: (actor: AnyObject) => boolean;
  /**
   * The system's own update list, in place, moments before it is written.
   * Entries are `{ key, value }`; a *reversed* resource (Hit Points, Stress,
   * Armor) arrives positive because marking raises it.
   */
  mark: (actor: AnyObject, resources: AnyObject[], isDirect: boolean) => void | Promise<void>;
}

/** Registered rules, in registration order. */
const rules: DamageMarkingRule[] = [];

/**
 * Register a rule. Called during `init` from the feature that owns it, so a
 * feature stays one file.
 */
export function onDamageMarking(rule: DamageMarkingRule): void {
  rules.push(rule);
}

/** Which rules want a say about this actor. A rule that throws asking is skipped. */
function interested(actor: AnyObject): DamageMarkingRule[] {
  return rules.filter((rule) => {
    if (!rule.wants) return true;

    try {
      return rule.wants(actor) === true;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Damage marking: "${rule.id}" failed to answer.`, error);
      return false;
    }
  });
}

/**
 * Shadow this actor's `modifyResource` for the length of one `takeDamage`, and
 * answer with the function that puts it back.
 *
 * Restoring is idempotent, so the one-shot inside and the `finally` outside can
 * both call it.
 */
function interpose(
  actor: AnyObject,
  isDirect: boolean,
  active: readonly DamageMarkingRule[],
): () => void {
  const owned = Object.prototype.hasOwnProperty.call(actor, "modifyResource");
  const previous = actor["modifyResource"];

  const restore = (): void => {
    if (owned) actor["modifyResource"] = previous;
    else delete actor["modifyResource"];
  };

  actor["modifyResource"] = async function (resources: AnyObject[]): Promise<unknown> {
    // Before anything else: these rules answer the damage they were interposed
    // for, and nothing the rest of this call — or a rule of its own — may write.
    restore();

    for (const rule of active) {
      try {
        await rule.mark(actor, resources ?? [], isDirect);
      } catch (error) {
        // The damage lands either way; a broken rule must not eat the hit.
        console.warn(`${LOG_PREFIX} Damage marking: "${rule.id}" failed.`, error);
      }
    }

    // Resolved off the actor again, which is the original method now that the
    // shadow has been removed.
    return actor["modifyResource"](resources);
  };

  return restore;
}

/**
 * Install the patch. Called once during `init`, like every other `register*`.
 *
 * Patched during `init` rather than at `setup`: the system assigns
 * `CONFIG.Actor.documentClass` at script load, before any `init` hook, and
 * nothing can be damaged before the canvas exists. Same reasoning as `reach.ts`.
 */
export function registerDamageMarking(): void {
  const prototype = CONFIG.Actor?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["takeDamage"];

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} Damage marking: no takeDamage to wrap — every rule on it is off.`,
    );
    return;
  }

  prototype!["takeDamage"] = async function (
    this: AnyObject,
    args: unknown,
    isDirect = false,
  ): Promise<unknown> {
    let restore: (() => void) | null = null;

    try {
      const active = interested(this);
      if (active.length > 0) restore = interpose(this, isDirect === true, active);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Damage marking: could not look at this actor.`, error);
    }

    try {
      return await original.call(this, args, isDirect);
    } finally {
      restore?.();
    }
  };
}
