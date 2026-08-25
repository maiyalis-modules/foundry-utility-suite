/**
 * The **duality outcome** window — the point at which a Duality roll's Hope/Fear
 * result can still be rewritten before anything in the system has acted on it.
 *
 * ## Why this window exists where it does
 *
 * `DualityRoll.buildPost` (system 2.7.2) runs four things in a fixed order:
 *
 * 1. `setDiceSoNiceForDualityRoll` — stamps the Hope/Fear 3D dice presets onto
 *    `roll.dice[].options`.
 * 2. `super.buildPost` — fires the system's `postRoll*` hooks, then **creates the
 *    chat message** (which is what makes Dice So Nice animate).
 * 3. `dualityUpdate` — advances Fear countdowns, then queues the GM's +1 Fear (or
 *    the character's +1 Hope) into `config.resourceUpdates`.
 * 4. `handleTriggers` — runs the `dualityRoll` trigger, and the `fearRoll`
 *    trigger *only* when the result is still Fear.
 *
 * Every one of those consumers reads the same field — `config.roll.result.duality`
 * — rather than the roll's own getters. So rewriting that field before step 2
 * means the Fear was never gained, the countdowns never advanced, and any other
 * feature's `fearRoll` trigger never fired at all. Reconciling *after* the fact
 * would have to undo four separate effects and could not un-fire a trigger.
 *
 * The window is installed via `roll-pipeline.ts`, which patches `DHRoll.buildPost`
 * — what `super.buildPost` in step 1's method resolves to. That lands it between
 * steps 1 and 2, which is also what lets the 3D dice be rolled *before* the player
 * is asked: the presets from step 1 are already in place, so a hand-rolled
 * animation is indistinguishable from the automatic one.
 *
 * ## Why the result is flipped by a flag rather than by swapping dice
 *
 * `withHope`/`withFear` are getters that compare the two dice totals, with no
 * setter and no override beyond `guaranteedCritical`. The chat card renders from
 * the *Roll object* (`roll.totalLabel`, `roll.dHope.total` in the system's
 * `roll-part.hbs`), and the Roll is rebuilt from its serialized form on reload —
 * so an override set on the instance would vanish for every other client.
 *
 * Swapping the two dice totals would persist and would even preserve the roll's
 * total, but it would contradict the dice the table just watched land. Instead we
 * persist a marker in `roll.options` (which round-trips through `toJSON`, the same
 * way `options.roll.difficulty` does) and teach the two getters to honour it. The
 * dice keep showing their honest faces; only the interpretation changes, for
 * everyone, permanently. `totalLabel` and `isCritical` follow on their own —
 * the first derives from these getters, and the second is unaffected because a
 * converted roll had unequal dice and still does.
 *
 * ## Who is asked
 *
 * Whoever made the roll. A Duality roll is almost always a player rolling for
 * their own character, so the client holding the pipeline open is already the
 * client whose Stress is being spent — unlike the adversary-attack window, which
 * has to go looking for its answerer (see `feature-ask.ts`).
 */
import { LOG_PREFIX } from "../constants.js";
import { chooseOffers } from "./feature-prompt.js";
import { toPromptOffers } from "./feature-ask.js";
import {
  applyOffer,
  offersFor,
  resourceUpdatesFor,
  type FeatureContextBase,
  type FeatureCost,
} from "./feature-registry.js";
import { registerRollWindow, showDiceEarly } from "./roll-pipeline.js";

/**
 * Key under `roll.options` holding a rewritten result: `1` for Hope, `-1` for
 * Fear. Prefixed because `options` is the system's own object.
 *
 * Deliberately dot-free. Foundry's object helpers (`expandObject`, `mergeObject`)
 * treat a dot in a key as a path, and roll options pass through `mergeObject` on
 * construction — a namespaced `module-id.key` would risk being silently expanded
 * into a nested object and never read back.
 */
const DUALITY_OVERRIDE = "eeDualityOverride";

/** The system's own duality encoding, shared by `config.roll.result.duality`. */
const WITH_HOPE = 1;
const WITH_FEAR = -1;

/** Context handed to every feature registered on this window. */
export interface DualityOutcomeContext extends FeatureContextBase {
  /** The evaluated roll. */
  roll: AnyObject;
  /** The roll config — what the rest of the pipeline reads. */
  config: AnyObject;
  /** `1` Hope, `-1` Fear, `0` critical or indeterminate. */
  duality: number;
  /** Whether the roll is a critical success (matched dice). */
  isCritical: boolean;
  /** The two dice, for the prompt to quote back. */
  hopeTotal: number;
  fearTotal: number;
  /** Rewrite the result. Everything downstream of the window reads the change. */
  setDuality(next: number): void;
}

/**
 * The system's DualityRoll class, or undefined if the system changed shape.
 *
 * `CONFIG.Dice.daggerheart` is preferred over `game.system.api.dice` because the
 * system assigns it at script load, while `game.system.api` is only populated
 * inside the system's own `init` listener — so this stays correct even if hook
 * ordering ever puts us first. Both point at the same class object.
 */
function dualityRollClass(): AnyObject | undefined {
  return (CONFIG["Dice"]?.daggerheart?.DualityRoll ??
    game.system?.api?.dice?.DualityRoll) as AnyObject | undefined;
}

/**
 * Teach `withHope`/`withFear` to honour a persisted override.
 *
 * Installed unconditionally, and independently of whether any feature is turned
 * on: a message from a roll converted last session still has to render as Hope
 * today, on every client, whatever the settings now say.
 */
function patchDualityGetters(DualityRoll: AnyObject): void {
  const prototype = DualityRoll["prototype"] as AnyObject | undefined;
  if (!prototype) return;

  for (const [name, matches] of [
    ["withHope", WITH_HOPE],
    ["withFear", WITH_FEAR],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    const original = descriptor?.get;
    if (typeof original !== "function") {
      console.warn(`${LOG_PREFIX} Duality: no ${name} getter to patch — results won't convert.`);
      continue;
    }

    // A non-configurable getter would make this throw, and a throw here would
    // take the whole module's `init` down with it — so failing to patch degrades
    // to "results never convert" rather than to a broken world.
    try {
      Object.defineProperty(prototype, name, {
        ...descriptor,
        get(this: AnyObject) {
          const override = this["options"]?.[DUALITY_OVERRIDE];
          if (typeof override === "number") return override === matches;
          return original.call(this);
        },
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Duality: could not patch ${name}.`, error);
    }
  }
}

/**
 * Rewrite a Duality roll's Hope/Fear result, everywhere it is read from.
 *
 * Two writes, and both are needed. `config.roll.result.duality` is what the four
 * consumers still ahead of this window read — the countdowns, the Fear or Hope
 * grant, the `dualityRoll` trigger and the `fearRoll` one — so it is the change
 * that actually suppresses them. The marker in `roll.options` is what makes the
 * chat card, a page reload and every other client agree afterwards, through the
 * two getters {@link patchDualityGetters} teaches to honour it.
 *
 * Exported because `witchs-charm.ts` converts a result too, from a window of its
 * own, and a second copy of this would be one more thing to keep in step with the
 * system's `withHope`/`withFear`.
 */
export function setRollDuality(roll: AnyObject, config: AnyObject, next: number): void {
  const result = config["roll"]?.["result"];
  if (!result) return;

  result["duality"] = next;
  result["label"] = game.i18n.localize(
    next === WITH_HOPE ? "DAGGERHEART.GENERAL.hope" : "DAGGERHEART.GENERAL.fear",
  );

  if (roll["options"]) roll["options"][DUALITY_OVERRIDE] = next;
}

/** The actor that made the roll, or null when the roll has no owner. */
function rollActor(roll: AnyObject, config: AnyObject): AnyObject | null {
  // What the system's own `handleTriggers` uses; the uuid is the fallback for
  // paths that never attached the actor to the roll data.
  const parent = roll["data"]?.["parent"];
  if (parent) return parent as AnyObject;

  const uuid = config["source"]?.["actor"];
  return uuid ? fromUuidSync(String(uuid)) : null;
}

/**
 * Build the context, including the two mutations features are allowed to make.
 */
function buildContext(roll: AnyObject, config: AnyObject, actor: AnyObject): DualityOutcomeContext {
  const result = config["roll"]?.["result"] ?? {};

  return {
    actor,
    roll,
    config,
    duality: Number(result["duality"] ?? 0),
    // Read off the roll rather than the config: `roll.isCritical` is the getter
    // the system itself trusts, while `config.roll.isCritical` is only populated
    // on some paths and would read false-but-present on the rest.
    isCritical: roll["isCritical"] === true,
    hopeTotal: Number(config["roll"]?.["hope"]?.["value"] ?? 0),
    fearTotal: Number(config["roll"]?.["fear"]?.["value"] ?? 0),

    setDuality(next: number): void {
      setRollDuality(roll, config, next);
      this.duality = next;
    },

    payCost(costs: readonly FeatureCost[]): void {
      if (costs.length === 0) return;
      const updates = resourceUpdatesFor(actor, costs);

      // Fold into the roll's own pending update so the cost, the suppressed Fear
      // and the gained Hope all land as a single actor write. Every path that
      // builds a duality roll (`Actor#diceRoll` and `DHBaseAction#use`) flushes
      // this map once the roll returns.
      const pending = config["resourceUpdates"];
      if (pending?.addResources) {
        pending.addResources(updates);
        return;
      }

      // No pending map — pay directly rather than silently skip the price.
      console.debug(`${LOG_PREFIX} Duality: no pending resource update; charging directly.`);
      void actor["modifyResource"]?.(updates);
    },
  };
}

/**
 * Offer, ask, apply. Returns once the outcome is settled and the rest of
 * `buildPost` can run against it.
 */
async function runDualityOutcomeWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  // `buildEvaluate` is what populates `roll.result`; an unevaluated roll
  // (`config.evaluate === false`) has no outcome to rewrite yet.
  if (!config?.["roll"]?.["result"]) return;

  const actor = rollActor(roll, config);
  if (!actor) return;

  const context = buildContext(roll, config, actor);
  const offers = offersFor("dualityOutcome", context);
  if (offers.length === 0) return;

  const optional = offers.filter((offer) => offer.feature.optional);
  const automatic = offers.filter((offer) => !offer.feature.optional);

  // Rules that are not a choice apply first and without asking, so the prompt
  // describes the situation the player is actually deciding about.
  for (const offer of automatic) await applyOffer(context, offer);

  if (optional.length === 0) return;

  // Only when something is actually going to be asked: a roll that raises no
  // prompt should keep the system's ordinary timing, dice and all.
  await showDiceEarly(roll, config);

  const chosen = await chooseOffers({
    title: game.i18n.localize("EE.Features.DualityTitle"),
    intro: game.i18n.format("EE.Features.DualityIntro", {
      hope: context.hopeTotal,
      fear: context.fearTotal,
      result: String(config["roll"]?.["result"]?.["label"] ?? ""),
    }),
    offers: toPromptOffers(optional),
  });

  // Re-checked in priority order rather than in the order the dialog returned,
  // so two features that both rewrite the outcome compose predictably.
  for (const offer of optional) {
    if (chosen.has(offer.feature.id)) await applyOffer(context, offer);
  }
}

/**
 * Install the window.
 *
 * The getter patch goes on unconditionally — it is what makes an already-converted
 * roll keep reading as converted — while the window itself only ever does anything
 * when some registered feature says it is interested.
 */
export function registerDualityOutcome(): void {
  const DualityRoll = dualityRollClass();
  if (!DualityRoll) {
    console.warn(`${LOG_PREFIX} Duality: DualityRoll not found — Hope/Fear automation is off.`);
    return;
  }

  patchDualityGetters(DualityRoll);

  registerRollWindow({
    id: "dualityOutcome",
    matches: (roll) => roll instanceof (DualityRoll as unknown as new () => unknown),
    run: async (roll, config) => {
      await runDualityOutcomeWindow(roll, config);
    },
  });
}
