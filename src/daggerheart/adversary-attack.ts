/**
 * The **adversary attack** window — the point at which an adversary's successful
 * attack can still be rewritten, by someone who isn't the one who rolled it.
 *
 * ## What makes this window different from `dualityOutcome`
 *
 * Three things, and each one shapes the code below:
 *
 * 1. **The reacting character is not the roller.** A Duality roll's features
 *    belong to the actor who rolled it, so that window builds one context. Here
 *    the roll belongs to an adversary and the *features* belong to whichever
 *    player characters are standing nearby — so the window enumerates candidates
 *    and builds a context per character.
 * 2. **The client holding the pipeline open is not the client that decides.**
 *    Adversaries are rolled by the GM; the Hope belongs to a player. The question
 *    goes over a socket (`feature-ask.ts`) and the answer comes back before the
 *    chat message is created.
 * 3. **The outcome is changed by replacing the roll**, not by editing a field.
 *    There is no "was this a hit" flag to flip that would survive — the card, the
 *    targets' `hitResult` and the damage all derive from `config.roll.total`. So a
 *    reroll builds a *new* Roll at disadvantage and hands it back to the pipeline,
 *    which posts that one instead. The original never reaches a chat message, so
 *    there is nothing to walk back.
 *
 * ## Where the seam is
 *
 * An adversary rolls a plain `D20Roll` (`Actor#rollClass` returns `DualityRoll`
 * only for `character` and `companion`), and `D20Roll` defines no `buildPost` — so
 * these rolls arrive directly at the `DHRoll.buildPost` patch in
 * `roll-pipeline.ts`. That is *before* the chat card, before `TargetField.execute`
 * turns `config.roll.total` into each target's `hitResult`, and before any damage
 * follows from it. `RollField.order` is 10 and `TargetField.order` is 20, so the
 * whole action workflow after the roll reads whatever this window leaves behind.
 *
 * ## Two deliberate silences
 *
 * The window declines to act, rather than guessing, when:
 *
 * - **The range can't be measured** — no canvas, or either actor untokened. A
 *   reaction that costs 3 Hope must not fire on an assumed distance.
 * - **Success can't be determined** — `config.roll.success` is only populated when
 *   the attack had targets or a set difficulty. A GM who rolls an adversary attack
 *   with nothing targeted and compares against Evasion by eye gets no prompt,
 *   because nothing in the config knows whether it hit.
 */
import { LOG_PREFIX } from "../constants.js";
import { askUser, responderFor, toPromptOffers } from "./feature-ask.js";
import type { PromptHeadline, PromptParty } from "./feature-prompt.js";
import {
  applyOffer,
  offersFor,
  resourceUpdatesFor,
  type FeatureContextBase,
  type FeatureCost,
} from "./feature-registry.js";
import { distanceBetweenActors, withinBand, type RangeBand } from "./range-bands.js";
import { clearEarlyDice, registerRollWindow, rollTypeOf, showDiceEarly } from "./roll-pipeline.js";

/**
 * `CONFIG.DH.GENERAL.rollTypes.attack.id` — the only roll type this window
 * handles. Read through {@link rollTypeOf} rather than off `config.roll.type`,
 * which by `buildPost` has been overwritten with the action's `actionType`.
 */
const ATTACK = "attack";

/** `D20Roll.ADV_MODE.DISADVANTAGE`. On a d20 roll this means `2d20kl`. */
const DISADVANTAGE = -1;

/** Context handed to every feature registered on this window. */
export interface AdversaryAttackContext extends FeatureContextBase {
  /** The evaluated attack roll. */
  roll: AnyObject;
  /** The roll config — what the rest of the action workflow reads. */
  config: AnyObject;
  /**
   * The actor that made the attack. Features check its `type` themselves: the
   * window only knows "a non-Duality attack roll", so a rule that says
   * *adversary* is the feature's to enforce.
   */
  attacker: AnyObject;
  /** Measured distance from the attacker to this actor, in scene units. */
  distance: number;
  /** The attack's total. */
  total: number;
  /** Whether the attack roll was a critical. */
  isCritical: boolean;
  /**
   * The targets it hit, as name and portrait. Taken from `config.targets`, which
   * the system already stamps with `token.name` and `token.actor.img` — so this
   * shows the token's name for an unlinked "Minor Treant #2" rather than the
   * statblock's.
   */
  hits: PromptParty[];
  /** Whether *this* actor is one of the targets it hit. */
  isHitTarget: boolean;
  /**
   * Whether this actor's **Evasion** is the number the attack is being compared
   * against — false when the roll carries a fixed difficulty, or the target entry
   * one of its own, in which case {@link raiseEvasion} would change nothing that
   * decides the hit. A feature that buys an Evasion bonus must check this rather
   * than pay for an effect that cannot land.
   */
  evasionDecides: boolean;
  /** Set once a feature has asked for the reroll; a second one would be wasted. */
  rerollRequested: boolean;
  /**
   * Is the attacker inside `band` of this actor? False when the thresholds can't
   * be read, which keeps the window's "don't guess about range" promise.
   */
  within(band: RangeBand): boolean;
  /**
   * Is the attacker *outside* `band`? Deliberately not `!within(band)`: an
   * unmeasurable range makes both answers false, so a rule phrased "from beyond
   * Melee range" declines rather than firing on a distance nobody established.
   */
  beyond(band: RangeBand): boolean;
  /** Ask for the attack to be rolled again at disadvantage. */
  forceRerollWithDisadvantage(): void;
  /**
   * Add `amount` to this actor's Evasion against this attack, and re-decide who
   * it hit. Ignored when the number is not a positive one.
   */
  raiseEvasion(amount: number): void;
}

/** Is `value` a difficulty actually set, as opposed to null/undefined/absent? */
function isFixedNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** The actor that made the roll, or null when the roll has no owner. */
function rollActor(roll: AnyObject, config: AnyObject): AnyObject | null {
  const parent = roll["data"]?.["parent"];
  if (parent) return parent as AnyObject;

  const uuid = config["source"]?.["actor"];
  return uuid ? fromUuidSync(String(uuid)) : null;
}

/**
 * Every player character with a token on this scene, other than the attacker.
 *
 * Drawn from the canvas rather than from `game.actors` because a character has to
 * be *present* to react, and because the distance check needs a token anyway.
 * Sorted by name so that when two characters could both react, the order they are
 * asked in is the same on every client and from one roll to the next.
 */
function candidateReactors(attacker: AnyObject): AnyObject[] {
  const seen = new Set<string>();
  const actors: AnyObject[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || actor["type"] !== "character") continue;

    const uuid = String(actor["uuid"] ?? "");
    if (!uuid || uuid === attacker["uuid"] || seen.has(uuid)) continue;

    seen.add(uuid);
    actors.push(actor);
  }

  return actors.sort((a, b) => String(a["name"] ?? "").localeCompare(String(b["name"] ?? "")));
}

/** Build the context for one potential reactor. */
function buildContext(
  roll: AnyObject,
  config: AnyObject,
  actor: AnyObject,
  attacker: AnyObject,
  distance: number,
): AdversaryAttackContext {
  const targets = (config["targets"] ?? []) as AnyObject[];
  const hit = targets.filter((target) => target["hit"] === true);
  // The entries for *this* actor, which are the ones an Evasion bonus moves. More
  // than one is possible: two of a character's tokens can both be targeted.
  const mine = targets.filter(
    (target) => String(target["actorId"] ?? "") === String(actor["uuid"] ?? ""),
  );

  return {
    actor,
    roll,
    config,
    attacker,
    distance,
    total: Number(config["roll"]?.["total"] ?? 0),
    isCritical: roll["isCritical"] === true,
    hits: hit.map((target) => ({
      name: String(target["name"] ?? ""),
      img: target["img"] ? String(target["img"]) : undefined,
    })),
    isHitTarget: hit.some((target) => String(target["actorId"] ?? "") === String(actor["uuid"] ?? "")),
    // `D20Roll.buildEvaluate` compares against `config.roll.difficulty ?? target
    // .difficulty ?? target.evasion`, so Evasion only decides when neither of the
    // first two is set. A `character` has no `system.difficulty` at all, which is
    // why the ordinary case passes.
    evasionDecides:
      mine.length > 0 &&
      !isFixedNumber(config["roll"]?.["difficulty"]) &&
      mine.every((target) => !isFixedNumber(target["difficulty"])),
    rerollRequested: false,

    within(band: RangeBand): boolean {
      return withinBand(distance, band) === true;
    },

    beyond(band: RangeBand): boolean {
      return withinBand(distance, band) === false;
    },

    forceRerollWithDisadvantage(): void {
      this.rerollRequested = true;
    },

    raiseEvasion(amount: number): void {
      if (!Number.isFinite(amount) || amount <= 0 || mine.length === 0) return;

      for (const target of mine) {
        target["evasion"] = Number(target["evasion"] ?? 0) + amount;
        // Re-decided exactly as `D20Roll.buildEvaluate` decided it the first
        // time, so the two never disagree.
        const against = config["roll"]?.["difficulty"] ?? target["difficulty"] ?? target["evasion"];
        target["hit"] =
          roll["isCritical"] === true ||
          Number(config["roll"]?.["total"] ?? 0) >= Number(against);
      }

      // The chat card does *not* trust `hit` — `DhRollMessage#_getCurrentTargets`
      // recomputes it from `difficulty || evasion` every time it renders — so the
      // raised Evasion is what makes the miss survive a reload and reach every
      // client. `hit` and `success` are updated for everything still in flight:
      // `TargetField.execute`, `CostField`'s `consumeOnSuccess`, and the rest of
      // this window's own loop.
      if (config["roll"]) {
        config["roll"]["success"] = targets.some((target) => target["hit"] === true);
      }

      // Kept live rather than left as the answer it was at build time. Every
      // feature on this window gates on it, and the window applies its
      // non-optional features *before* it prompts for the optional ones — so a
      // stale `true` here is what would offer a player a Stress to dodge an
      // attack that has already stopped landing on them.
      this.isHitTarget = mine.some((target) => target["hit"] === true);
    },

    async payCost(costs: readonly FeatureCost[]): Promise<void> {
      if (costs.length === 0) return;

      // Not `config.resourceUpdates` — that map belongs to the *attacker*, and
      // folding a player's Hope into it would charge the adversary. Awaited so
      // that a failed write (a client without permission on this actor) aborts
      // the window before the outcome changes, rather than after.
      await actor["modifyResource"]?.(resourceUpdatesFor(actor, costs));
    },
  };
}

/**
 * Build a fresh roll of the same kind at disadvantage and evaluate it.
 *
 * Rebuilding rather than re-rolling the existing dice is what makes disadvantage
 * work: on a d20 roll it is not an extra die to subtract but a second d20 with
 * `kl`, so the formula itself has to change. Feeding the evaluated formula back
 * through the constructor is safe because `D20Roll.createBaseDice` throws away
 * everything except the leading die, and `configureModifiers` then re-derives the
 * bonuses from `config.roll.baseModifiers` and the roll's active effects — so the
 * new roll gets the same modifiers by recomputation, not by string surgery.
 *
 * `config` *is* the roll's `options` (the system's `createRollInstance` passes it
 * straight through), which is why setting `config.roll.advantage` here is what the
 * new instance reads in `applyAdvantage`.
 *
 * Returns the new roll, or null if the system's shape has moved and the pipeline
 * should post the original untouched.
 */
async function rerollWithDisadvantage(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
): Promise<AnyObject | null> {
  const rollClass = roll["constructor"] as AnyObject | undefined;
  if (
    typeof rollClass?.["createRollInstance"] !== "function" ||
    typeof rollClass?.["buildEvaluate"] !== "function"
  ) {
    console.warn(`${LOG_PREFIX} Adversary attack: cannot rebuild this roll — leaving it alone.`);
    return null;
  }

  // The dice the table watched belong to the roll being discarded; the
  // replacement's have never been seen and must animate normally.
  clearEarlyDice(config);

  config["roll"]["advantage"] = DISADVANTAGE;

  const rerolled = rollClass["createRollInstance"](config) as AnyObject;
  // Re-runs the whole evaluation, so `config.roll.total`, `config.roll.success`
  // and every target's `hit` describe the new roll before anything reads them.
  await rollClass["buildEvaluate"](rerolled, config, message);
  return rerolled;
}

/**
 * The line at the top of the prompt, describing what just happened. Names the
 * attacker and who it landed on, but not the total — same reasoning as
 * {@link PromptHeadline.verdict}.
 */
function introFor(context: AdversaryAttackContext): string {
  const data = {
    attacker: String(context.attacker["name"] ?? ""),
    targets: context.hits.map((hit) => hit.name).join(", "),
  };

  return game.i18n.format(
    context.hits.length > 0
      ? "EE.Features.AdversaryAttackIntro"
      : "EE.Features.AdversaryAttackIntroNoTarget",
    data,
  );
}

/**
 * The banner form of the same thing: attacker, verdict, target.
 *
 * Only when the attack hit exactly one target — two portraits cannot honestly
 * depict a strike that landed on three people, and that case falls back to
 * {@link introFor}, whose sentence lists them all. The attacker's portrait comes
 * from the actor rather than its token texture, because a top-down or a bare
 * marker token reads as nothing at all once it is masked into a circle.
 */
function headlineFor(context: AdversaryAttackContext): PromptHeadline | undefined {
  const target = context.hits.length === 1 ? context.hits[0] : undefined;
  if (!target) return undefined;

  const source: PromptParty = {
    name: String(context.attacker["name"] ?? ""),
    img: context.attacker["img"] ? String(context.attacker["img"]) : undefined,
  };

  return {
    source,
    target,
    verdict: game.i18n.localize(
      context.isCritical ? "EE.Features.VerdictCritical" : "EE.Features.VerdictHit",
    ),
  };
}

/**
 * Offer, ask, apply. Returns a replacement roll when someone forced a reroll.
 *
 * Characters are asked **one at a time, stopping at the first acceptance**. Once
 * the attack is being rerolled there is no longer a successful attack to react
 * to, so asking the rest would be offering them a reaction to something that is
 * about to stop having happened — and charging two players 3 Hope each for one
 * reroll would be worse. In the ordinary case only one character holds a
 * reaction, and only one prompt ever appears.
 */
async function runAdversaryAttackWindow(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
): Promise<AnyObject | void> {
  // Only populated when the attack had targets or a set difficulty. Without it
  // nothing here knows whether the attack succeeded — see the header note.
  if (config?.["roll"]?.["success"] !== true) {
    console.debug(`${LOG_PREFIX} Adversary attack: not a successful attack, no reactions offered.`);
    return;
  }

  const attacker = rollActor(roll, config);
  if (!attacker || !canvas.ready) {
    console.debug(`${LOG_PREFIX} Adversary attack: no attacker or no canvas, no reactions offered.`);
    return;
  }

  let dieShown = false;
  let accepted: AdversaryAttackContext | null = null;

  for (const actor of candidateReactors(attacker)) {
    // Null means the range is unmeasurable, which this window treats as "no",
    // never as "probably close enough".
    const distance = distanceBetweenActors(attacker, actor);
    if (distance === null) {
      console.debug(`${LOG_PREFIX} Adversary attack: cannot measure range to ${actor["name"]}.`);
      continue;
    }

    const context = buildContext(roll, config, actor, attacker, distance);
    const offers = offersFor("adversaryAttack", context);
    if (offers.length === 0) {
      console.debug(
        `${LOG_PREFIX} Adversary attack: nothing for ${actor["name"]} to react with at ${distance}.`,
      );
      continue;
    }

    for (const offer of offers.filter((entry) => !entry.feature.optional)) {
      await applyOffer(context, offer);
    }

    // Asked again rather than reused from `offers` above. A non-optional feature
    // — Gifted Tracker's +1 Evasion is the first — may just have changed the very
    // thing the optional ones were judged against, and offering a player a price
    // to alter an attack that no longer lands is worse than offering nothing.
    // Cheap: the registry is a handful of entries and `when` is a predicate.
    const optional = offersFor("adversaryAttack", context).filter(
      (entry) => entry.feature.optional,
    );
    if (optional.length > 0) {
      // Once, before the first prompt of this roll: the player has to see the
      // attack land before being asked to spend anything on changing it.
      if (!dieShown) {
        await showDiceEarly(roll, config);
        dieShown = true;
      }

      const chosen = await askUser(responderFor(actor), {
        title: game.i18n.localize("EE.Features.AdversaryAttackTitle"),
        intro: introFor(context),
        headline: headlineFor(context),
        offers: toPromptOffers(optional),
      });

      // Re-checked against the offers this client built, in priority order — the
      // answer arrived over a socket and is treated as a selection, not a command.
      for (const offer of optional) {
        if (chosen.has(offer.feature.id)) await applyOffer(context, offer);
      }
    }

    if (context.rerollRequested) {
      accepted = context;
      break;
    }

    // A reaction can take the success away — an Evasion bonus that turns the only
    // hit into a miss. Everything this window offers is conditioned on an
    // adversary having *succeeded*, so stop rather than asking the next character
    // to react to an attack that no longer lands. Re-read off the config, which
    // is what `raiseEvasion` updated, rather than trusting the stale context.
    if (config["roll"]?.["success"] !== true) {
      console.debug(`${LOG_PREFIX} Adversary attack: no longer a hit; stopping here.`);
      break;
    }
  }

  if (!accepted) return;
  return (await rerollWithDisadvantage(roll, config, message)) ?? undefined;
}

/**
 * Install the window.
 *
 * Registered after `dualityOutcome`, which costs nothing — the two match disjoint
 * sets of rolls — but keeps the pipeline's handler order reading the way the
 * windows were introduced.
 */
export function registerAdversaryAttack(): void {
  const dice = CONFIG["Dice"]?.daggerheart ?? game.system?.api?.dice;
  const D20Roll = dice?.["D20Roll"] as AnyObject | undefined;
  const DualityRoll = dice?.["DualityRoll"] as AnyObject | undefined;

  if (!D20Roll || !DualityRoll) {
    console.warn(`${LOG_PREFIX} Adversary attack: roll classes not found — reactions are off.`);
    return;
  }

  registerRollWindow({
    id: "adversaryAttack",
    matches: (roll, config) =>
      roll instanceof (D20Roll as unknown as new () => unknown) &&
      // A character's attack is a DualityRoll, which extends D20Roll; that one
      // belongs to the other window.
      !(roll instanceof (DualityRoll as unknown as new () => unknown)) &&
      rollTypeOf(config) === ATTACK,
    run: (roll, config, message) => runAdversaryAttackWindow(roll, config, message),
  });
}
