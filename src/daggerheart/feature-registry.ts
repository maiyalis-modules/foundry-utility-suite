/**
 * The feature-automation registry — the one place that knows which Daggerheart
 * features this module automates.
 *
 * ## Why a registry rather than a hook per feature
 *
 * Daggerheart is full of features phrased "when X happens, you *can* pay Y to
 * change the outcome". Automating them one at a time runs into three walls, and
 * all three are structural rather than a matter of taste:
 *
 * - **The system's interception points are synchronous.** Every one it offers is
 *   a `Hooks.call`, so a listener cannot `await` a player's answer. Anything with
 *   a choice has to be driven from a wrapped `async` method instead — see
 *   `duality-outcome.ts`.
 * - **Nothing arbitrates between listeners.** Foundry fires hooks in
 *   registration order across the whole install, so two features reacting to the
 *   same event have no defined precedence. Fearless rewriting a Fear result has
 *   to happen *before* anything that reacts to a Fear result, and independent
 *   listeners cannot express that. {@link AutomatedFeature.priority} can.
 * - **One prompt per feature is unusable at the table.** A mid-level character
 *   with three Fear-reactive features would get three dialogs in an arbitrary
 *   order. Collecting the eligible ones first means a single prompt.
 *
 * So the flow is inverted: an interception point ("window") asks
 * {@link offersFor} who is interested, prompts once, and applies the answers in
 * priority order. Adding a feature is a registry entry; adding a *kind* of
 * feature is a new window.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID } from "../constants.js";

/**
 * The interception points features can attach to. One string per wrapped stage
 * of the system's roll/action pipeline; new stages get added here as they are
 * opened up, and a feature naming an unopened window simply never fires.
 */
export type FeatureWindow = "dualityOutcome" | "adversaryAttack";

/**
 * A resource price, in the same shape the system's own `CostField` produces.
 *
 * `value` is always the *printed* magnitude ("mark 2 Stress" is `2`); which
 * direction that moves the stored number is decided by the resource, not by the
 * caller — see {@link resourceUpdatesFor}.
 */
export interface FeatureCost {
  /** A key under `actor.system.resources` — "stress", "hope", "hitPoints". */
  key: string;
  /** How much of it the feature costs. Positive. */
  value: number;
}

/**
 * How to recognise the Item that grants a feature.
 *
 * Three ways, tried in order, because no single one is sufficient: a hand-set
 * flag (the escape hatch for homebrew), the compendium the Item was dragged from
 * (robust — survives renaming, and a copy of an SRD feature still matches), then
 * the printed name (the only thing that catches a feature typed in by hand).
 */
export interface FeatureMatch {
  /** `_stats.compendiumSource` values that identify this feature. */
  compendiumSources?: readonly string[];
  /** Printed names, compared case-insensitively after trimming. */
  names?: readonly string[];
  /** Item types to consider. Defaults to `["feature"]`. */
  itemTypes?: readonly string[];
}

/** What every window's context provides, whatever else it carries. */
export interface FeatureContextBase {
  /** The actor the feature belongs to. */
  actor: AnyObject;
  /**
   * Charge a feature's price. The *window* owns how — the duality window folds
   * costs into the roll's own pending resource update so the whole roll lands as
   * one actor write, rather than paying separately and racing it, while a window
   * whose feature belongs to someone other than the roller has to write to that
   * actor directly, and await it before the outcome changes.
   */
  payCost(costs: readonly FeatureCost[]): void | Promise<void>;
}

/**
 * One automated feature. Deliberately data with two small functions on it: the
 * point of the registry is that the second feature of a kind costs a few lines,
 * not a new interception.
 */
export interface AutomatedFeature<C extends FeatureContextBase = FeatureContextBase> {
  /** Stable id, used in logs and as the prompt's checkbox value. */
  id: string;
  /** Which interception point this attaches to. */
  window: FeatureWindow;
  /**
   * Application order within a window, lowest first. Features that *rewrite an
   * outcome* must sort before features that *react to* one, or the reactors read
   * a result that is about to change.
   */
  priority: number;
  /**
   * Whether the player gets a say. Optional features are collected into one
   * prompt; non-optional ones apply silently, because the rule is not a choice.
   */
  optional: boolean;
  /** How to find the granting Item on the actor. */
  match: FeatureMatch;
  /** i18n key for the prompt's label. */
  labelKey: string;
  /** i18n key for the explanatory line under it. */
  hintKey?: string;
  /**
   * i18n keys naming the two outcomes, for a feature where "use it" / "leave the
   * roll alone" is a worse description than saying what each button gets you —
   * Slayer's "Gain a Slayer Die" against "Gain a Hope", where *both* buttons take
   * something and neither is the null answer.
   *
   * Honoured only when this feature is the sole offer on the prompt; see
   * {@link PromptOffer.useLabel}. Set them anyway — a feature cannot know in
   * advance whether it will be alone on the roll.
   */
  useLabelKey?: string;
  skipLabelKey?: string;
  /** What using it costs. An offer is withheld when the actor cannot pay. */
  cost?: readonly FeatureCost[];
  /** The setting gate. Checked per event, so toggling a feature is live. */
  enabled(): boolean;
  /** Does this event actually trigger the feature? */
  when(context: C, item: AnyObject): boolean;
  /**
   * Change the outcome. Runs only after any cost has been charged.
   *
   * May be async, and is awaited: a feature whose effect is "roll a d4 and add
   * it" has to evaluate a Roll, which the window must not race — every caller is
   * mid-pipeline holding the result back precisely so the change lands first.
   */
  apply(context: C, item: AnyObject): void | Promise<void>;
}

/** One eligible feature, paired with the Item that granted it. */
export interface FeatureOffer<C extends FeatureContextBase = FeatureContextBase> {
  feature: AutomatedFeature<C>;
  item: AnyObject;
}

/** Everything registered, in no particular order — {@link offersFor} sorts. */
const registry: AutomatedFeature<FeatureContextBase>[] = [];

/**
 * Add a feature. Called once per feature during `init`, from its own module, so
 * that a feature is one file and one line in `module.ts`.
 */
export function registerFeature<C extends FeatureContextBase>(feature: AutomatedFeature<C>): void {
  registry.push(feature as unknown as AutomatedFeature<FeatureContextBase>);
}

/** Case-insensitive, whitespace-tolerant name comparison. */
function sameName(a: unknown, b: string): boolean {
  return String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Find the Item on `actor` that grants `feature`, or null.
 *
 * Re-derived per event rather than cached: walking an actor's items is trivial
 * next to a dice roll, and a cache would need invalidating on every item create,
 * delete and rename to stay honest — the same reasoning as `reach.ts`.
 *
 * Exported because a feature with a window of its own (Hold Them Off, Ranger's
 * Focus) still has to answer the same question, and a second implementation of
 * the flag-then-compendium-then-name order would be one more thing to keep in
 * step with this one.
 */
export function findGrantingItem(
  actor: AnyObject,
  id: string,
  match: FeatureMatch,
): AnyObject | null {
  const types = match.itemTypes ?? ["feature"];

  for (const item of actor["items"] ?? []) {
    if (!types.includes(String(item?.["type"] ?? ""))) continue;

    // The escape hatch first: a flag naming *this* feature's id always wins,
    // which is how a homebrew rewrite of an SRD card opts into the automation.
    const flagged = item?.["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
    if (typeof flagged === "string" && flagged.trim() === id) return item;

    const source = String(item?.["_stats"]?.["compendiumSource"] ?? "");
    if (source && match.compendiumSources?.includes(source)) return item;

    if (match.names?.some((name) => sameName(item?.["name"], name))) return item;
  }

  return null;
}

/**
 * Can the actor pay this price?
 *
 * Daggerheart has two kinds of resource and they move in opposite directions. A
 * *reversed* resource (Stress, Hit Points, Armor) counts marks used, so paying it
 * raises the stored value toward `max`; a normal one (Hope) counts what you hold,
 * so paying it lowers the value toward zero. `system.resources.<key>` carries
 * `isReversed`, prepared from `CONFIG.DH.RESOURCE`, and the system's own
 * `CostField` branches on exactly this — so we match it rather than hardcoding a
 * direction per resource.
 *
 * Partial payment is never allowed: the system clamps a resource into range on
 * write, so a character with 5 of 6 Stress asked to mark 2 would silently mark
 * only 1 and still get the benefit.
 *
 * Exported for the same reason as {@link findGrantingItem}: a feature that owns
 * its own interception point still has to withhold an offer nobody can pay for,
 * and a second copy of the reversed-resource rule would be one more thing to
 * keep in step with the system.
 */
export function canAfford(actor: AnyObject, costs: readonly FeatureCost[]): boolean {
  for (const cost of costs) {
    const resource = actor["system"]?.resources?.[cost.key];
    if (!resource) return false;

    const value = Number(resource.value ?? 0);
    if (resource.isReversed) {
      const max = Number(resource.max);
      // A reversed resource with no ceiling cannot be overfilled, so it is
      // always payable.
      if (!Number.isFinite(max)) continue;
      if (value + cost.value > max) return false;
    } else if (value < cost.value) {
      return false;
    }
  }

  return true;
}

/**
 * Turn costs into the resource updates the system applies, mirroring the sign
 * convention in its `CostField`: a reversed resource is charged by adding
 * (marking Stress raises the number), everything else by subtracting.
 */
export function resourceUpdatesFor(
  actor: AnyObject,
  costs: readonly FeatureCost[],
): { key: string; value: number; enabled: boolean }[] {
  return costs.map((cost) => {
    const reversed = actor["system"]?.resources?.[cost.key]?.isReversed === true;
    return { key: cost.key, value: reversed ? cost.value : -cost.value, enabled: true };
  });
}

/**
 * Charge `costs` to the actor **who made this roll**, through the roll's own
 * pending resource update where there is one.
 *
 * `config.resourceUpdates` is a `ResourceUpdateMap` bound to the rolling actor,
 * which `DHBaseAction#use` flushes exactly once when the workflow ends. Folding
 * into it rather than writing separately matters for more than tidiness: a
 * Duality roll is about to queue its own +1 Hope into the same map, and two
 * writes would race — where one merged write correctly nets the two against each
 * other. `addResources` merges by key and sums, so it is safe to call after the
 * roll has already put something there.
 *
 * Only for a cost the **roller** pays. A feature whose price falls on someone
 * else — a reaction to an adversary's attack — must call `modifyResource` on that
 * actor directly, since this map would charge the adversary; see
 * `adversary-attack.ts`.
 *
 * The direct-write fallback exists because not every path that reaches a roll
 * builds the map, and skipping the price silently would be the one failure a
 * player could not see.
 */
export function chargeCosts(
  actor: AnyObject,
  config: AnyObject,
  costs: readonly FeatureCost[],
): void {
  if (costs.length === 0) return;

  const updates = resourceUpdatesFor(actor, costs);
  const pending = config["resourceUpdates"];
  if (pending?.addResources) {
    pending.addResources(updates);
    return;
  }

  console.debug(`${LOG_PREFIX} Features: no pending resource update; charging directly.`);
  void actor["modifyResource"]?.(updates);
}

/**
 * Every feature that wants to act on this event, in application order.
 *
 * A feature has to clear four gates to be offered: its setting is on, the actor
 * actually holds the granting Item, the event matches, and the price is payable.
 * A `when` that throws disqualifies that feature only — one broken predicate must
 * not cost the others their turn, nor take the roll down with it.
 */
export function offersFor<C extends FeatureContextBase>(
  window: FeatureWindow,
  context: C,
): FeatureOffer<C>[] {
  const offers: FeatureOffer<C>[] = [];

  for (const entry of registry) {
    const feature = entry as unknown as AutomatedFeature<C>;
    if (feature.window !== window) continue;

    try {
      if (!feature.enabled()) continue;

      const item = findGrantingItem(context.actor, feature.id, feature.match);
      if (!item) continue;
      if (!feature.when(context, item)) continue;
      if (!canAfford(context.actor, feature.cost ?? [])) continue;

      offers.push({ feature, item });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Feature "${entry.id}" failed while being offered.`, error);
    }
  }

  return offers.sort((a, b) => a.feature.priority - b.feature.priority);
}

/**
 * Charge for and apply one offer. Cost first: {@link canAfford} has already said
 * the actor can pay, and applying without charging is the failure that matters.
 */
export async function applyOffer<C extends FeatureContextBase>(
  context: C,
  offer: FeatureOffer<C>,
): Promise<void> {
  await context.payCost(offer.feature.cost ?? []);
  await offer.feature.apply(context, offer.item);
}
