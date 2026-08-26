/**
 * The **adversary damage** window — the point at which an adversary's damage roll
 * can still be thrown again, by someone who isn't the one who rolled it.
 *
 * The sibling of `adversary-attack.ts`, and built the same way: the GM rolls, a
 * player character standing nearby holds the reaction, the question crosses the
 * module's socket, and the answer lands before anything is posted or applied.
 * What the two share — enumerating the characters who could react, finding the
 * roller, charging a reactor — lives in `adversary-reaction.ts`. What differs is
 * everything below.
 *
 * ## Where the seam is, and the one thing it gets for free
 *
 * `DamageRoll.buildPost` reaches `DHRoll.buildPost` — the seam `roll-pipeline.ts`
 * patches — through `super`, so a damage roll arrives at the windows like
 * anything else. The two lines it runs *first* are what make this window work:
 *
 * ```js
 * const pool = PoolTerm.fromRolls([config.damage.main, ...resources]);
 * await triggerChatRollFx([Roll.fromTerms([pool])], { whisper, blind });
 * await super.buildPost(roll, config, message);   // <- this window runs here
 * ```
 *
 * So the table has **already watched the dice land**, with the system's own
 * visibility applied, and yet nothing has been posted or applied: the chat card
 * is created — or, for damage rolled off an attack's card, updated — after the
 * super call returns. Every other reaction window in this module has to call
 * `showDiceEarly` to manufacture that ordering. This one must not: it would throw
 * the same dice twice. `not-good-enough.ts` sits at the same seam for the same
 * reason.
 *
 * That free ordering is also the answer to a question this window has to get
 * right and the attack window does not. A player deciding whether to force a
 * reroll of an *attack* needs to know it hit, which the prompt says in words. A
 * player deciding whether to force a reroll of *damage* needs the number — and
 * the number is already on the table in front of them, thrown to exactly the
 * audience the chat card is about to reach. See {@link headlineFor} for what the
 * prompt does with it, and why it is the one prompt in the module that prints a
 * total.
 *
 * ## Rerolling means rerolling `config.damage.main`
 *
 * Not the `roll` the pipeline hands around: for a damage roll that object is a
 * shell, and `DamageRoll.buildEvaluate` puts the dice that matter in
 * `config.damage.main`, which is what the chat card renders and what
 * `DamageField.applyDamage` later reads. So this window returns nothing to the
 * pipeline and rewrites that field in place — the same field, and the same
 * assignment, the system's own `buildEvaluate` makes when it is handed a config
 * that already carries damage.
 *
 * ## Three deliberate silences
 *
 * The window declines to act, rather than guessing, when:
 *
 * - **The roller is a character or a companion.** Their damage is their own; the
 *   only window that looks at it is `notGoodEnough`. Phrased as "not a player's"
 *   rather than "is an adversary" so an *environment* rolling damage still opens
 *   it, the same latitude `i-see-it-coming.ts` keeps on the attack side.
 * - **The roll is healing**, which `DHActorRoll#hasHealing` marks and which has
 *   no `main` at all. Belt and braces, and a Seraph's healing is nobody's damage.
 * - **The range can't be measured** — no canvas, or either actor untokened. A
 *   reaction costing 3 Hope must not fire on an assumed distance.
 */
import { LOG_PREFIX } from "../constants.js";
import { candidateReactors, payCostFor, rollActor } from "./adversary-reaction.js";
import { askUser, responderFor, toPromptOffers } from "./feature-ask.js";
import type { PromptHeadline, PromptParty } from "./feature-prompt.js";
import {
  applyOffer,
  offersFor,
  stillOffered,
  type FeatureContextBase,
  type FeatureCost,
} from "./feature-registry.js";
import { distanceBetweenActors, withinBand, type RangeBand } from "./range-bands.js";
import { registerRollWindow, rollVisibility, showDiceEarly } from "./roll-pipeline.js";

/** Actor types whose damage rolls are their own business. */
const PLAYER_SIDE: readonly string[] = ["character", "companion"];

/** Context handed to every feature registered on this window. */
export interface AdversaryDamageContext extends FeatureContextBase {
  /** The roll object the pipeline is carrying. A shell; see {@link main}. */
  roll: AnyObject;
  /** The roll config — what the chat card and the damage application read. */
  config: AnyObject;
  /**
   * The evaluated damage dice, `config.damage.main`. This is the roll a feature
   * is deciding about, and the one {@link forceReroll} replaces.
   */
  main: AnyObject;
  /**
   * The actor that rolled the damage. The window has already excluded characters
   * and companions; a rule that says *adversary* rather than "not a player's" is
   * the feature's to enforce, as on the attack window.
   */
  attacker: AnyObject;
  /** Measured distance from the roller to this actor, in scene units. */
  distance: number;
  /** The damage total, before any reroll. */
  total: number;
  /** Whether the attack this damage follows was a critical. */
  isCritical: boolean;
  /** Who the damage is aimed at, as name and portrait. */
  targets: PromptParty[];
  /** Whether *this* actor is one of them. */
  isTarget: boolean;
  /**
   * Set once a feature has asked for the reroll. There is only ever one reroll to
   * have, so a feature that forces one gates its `when` on this being false, and
   * the window re-checks each choice against it before charging.
   */
  rerollRequested: boolean;
  /**
   * Is the roller inside `band` of this actor? False when the thresholds can't be
   * read, which keeps the window's "don't guess about range" promise.
   */
  within(band: RangeBand): boolean;
  /**
   * Is the roller *outside* `band`? Deliberately not `!within(band)`: an
   * unmeasurable range makes both answers false, so a rule phrased "from beyond
   * Melee range" declines rather than firing on a distance nobody established.
   */
  beyond(band: RangeBand): boolean;
  /** Ask for the damage dice to be thrown again. */
  forceReroll(): void;
}

/**
 * Can the user we are about to ask actually see what was rolled?
 *
 * The same question `DamageRoll.buildPost` asked the dice animation a moment
 * ago, asked again of one user: a GM's blind roll showed nobody, and a whispered
 * one showed only its recipients. A GM is always a recipient of their own
 * table's rolls, which is what the `isGM` arm is for — `responderFor` falls back
 * to this client when nobody else owns the character.
 *
 * Errs towards *hiding* the number: an unreadable user is treated as unable to
 * see it, because a prompt that withholds a total the player could have had is a
 * smaller failure than one that hands out a total the chat card is about to keep.
 */
function canSee(config: AnyObject, userId: string): boolean {
  try {
    const { whisper, blind } = rollVisibility(config);
    if (game.users?.get(userId)?.isGM === true) return !blind;
    if (blind) return false;
    return whisper === null || whisper.includes(userId);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Adversary damage: could not read who may see the roll.`, error);
    return false;
  }
}

/** The party entries for the damage's targets, from whichever list carries them. */
function targetsOf(config: AnyObject): AnyObject[] {
  const targets = config["targets"];
  return Array.isArray(targets) ? (targets as AnyObject[]) : [];
}

/** Build the context for one potential reactor. */
function buildContext(
  roll: AnyObject,
  config: AnyObject,
  main: AnyObject,
  actor: AnyObject,
  attacker: AnyObject,
  distance: number,
): AdversaryDamageContext {
  const targets = targetsOf(config);
  const uuid = String(actor["uuid"] ?? "");

  return {
    actor,
    roll,
    config,
    main,
    attacker,
    distance,
    total: Number(main["total"] ?? 0),
    // The damage config carries the attack's own `isCritical`, which
    // `DamageField.execute` copies off the message it was rolled from.
    isCritical: config["isCritical"] === true,
    targets: targets.map((target) => ({
      name: String(target["name"] ?? ""),
      img: target["img"] ? String(target["img"]) : undefined,
    })),
    isTarget: targets.some((target) => String(target["actorId"] ?? "") === uuid),
    rerollRequested: false,

    within(band: RangeBand): boolean {
      return withinBand(distance, band) === true;
    },

    beyond(band: RangeBand): boolean {
      return withinBand(distance, band) === false;
    },

    forceReroll(): void {
      this.rerollRequested = true;
    },

    payCost(costs: readonly FeatureCost[]): Promise<void> {
      return payCostFor(actor, costs);
    },
  };
}

/**
 * Throw the damage dice again, in place.
 *
 * `Roll#reroll` is the right tool and cannot be used as it stands, because
 * `config.damage.main` carries a **stale `_formula`**: the system builds it from
 * the printed damage expression and then pushes the modifiers, the critical
 * bonus and any damage multiplier straight onto `terms`, without recompiling the
 * string. `clone()` — which is all `reroll` is — reads that string, so rerolling
 * it untouched would quietly drop everything the modifiers added. Recompiling the
 * string from the terms first is the system's own answer to exactly that —
 * `D20Roll.constructFormula` ends on `resetFormula()` after its own term surgery
 * — so the fix is one line and it is the system's line. `DamageRoll` inherits
 * neither of D20Roll's overrides (it descends from `DHRoll` directly), so both
 * calls here reach core's, which is what makes this safe to say in one line.
 *
 * Deliberately `main` only. The resource formulas on the same action — a Stress
 * the hit also inflicts, a healing part — are not the damage roll, and
 * `not-good-enough.ts` draws the line in the same place for the same reason:
 * `config.damage.main` is the only part the system itself treats as damage. It
 * also means the dice that need re-animating are exactly the ones being replaced.
 *
 * Returns whether the reroll actually happened; a failure leaves the original
 * damage standing, which is the outcome the table already watched.
 */
async function rerollDamage(main: AnyObject, config: AnyObject): Promise<boolean> {
  if (typeof main["reroll"] !== "function" || typeof main["resetFormula"] !== "function") {
    console.warn(`${LOG_PREFIX} Adversary damage: cannot reroll this roll — leaving it alone.`);
    return false;
  }

  try {
    const before = Number(main["total"] ?? 0);

    main["resetFormula"]();
    const fresh = (await main["reroll"]({})) as AnyObject;

    config["damage"]["main"] = fresh;
    // Ours to do, and only ours. The system animates damage from
    // `DamageRoll.buildPost`, which has already run; the message it is about to
    // write carries the shell roll in `rolls`, not these dice, so nothing else
    // will ever throw them. `D20Roll#reroll` has a `liveRoll` option that would
    // do it, and a `DamageRoll` does not inherit it — which is just as well,
    // since it animates to the whole table with no whisper list at all. This
    // goes out with the visibility the system's own first throw used.
    await showDiceEarly(fresh, config);

    console.debug(
      `${LOG_PREFIX} Adversary damage: rerolled ${main["formula"]}; ${before} to ${fresh["total"]}.`,
    );
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Adversary damage: the reroll failed; leaving the roll alone.`, error);
    return false;
  }
}

/**
 * The line at the top of the prompt, describing what just happened.
 */
function introFor(context: AdversaryDamageContext): string {
  const data = {
    attacker: String(context.attacker["name"] ?? ""),
    targets: context.targets.map((target) => target.name).join(", "),
  };

  return game.i18n.format(
    context.targets.length > 0
      ? "EE.Features.AdversaryDamageIntro"
      : "EE.Features.AdversaryDamageIntroNoTarget",
    data,
  );
}

/**
 * The banner form: roller, verdict, target.
 *
 * **This is the one prompt in the module that prints a total**, and the exception
 * is the rule's own reasoning turned around. Elsewhere the number is withheld
 * because what a reacting player decides on is whether the attack landed, and the
 * total changes nothing they can do about it. Here the total *is* the decision —
 * a reroll of 4 damage and a reroll of 19 are opposite choices — and a verdict
 * reading only "Damage" would ask the question without stating it.
 *
 * The other half of that reasoning still holds, so the number is printed only to
 * a player the roll was not hidden from ({@link canSee}). When it was hidden the
 * verdict falls back to the bare word, and the prompt says no more than the dice
 * already did.
 *
 * Only when the damage is aimed at exactly one target: two portraits cannot
 * honestly depict a blow landing on three people, and that case falls back to
 * {@link introFor}, whose sentence lists them all.
 */
function headlineFor(context: AdversaryDamageContext, visible: boolean): PromptHeadline | undefined {
  const target = context.targets.length === 1 ? context.targets[0] : undefined;
  if (!target) return undefined;

  const source: PromptParty = {
    name: String(context.attacker["name"] ?? ""),
    img: context.attacker["img"] ? String(context.attacker["img"]) : undefined,
  };

  return {
    source,
    target,
    verdict: visible
      ? game.i18n.format(
          context.isCritical ? "EE.Features.VerdictCriticalDamage" : "EE.Features.VerdictDamage",
          { total: context.total },
        )
      : game.i18n.localize("EE.Features.VerdictDamageHidden"),
  };
}

/**
 * Offer, ask, apply.
 *
 * Characters are asked **one at a time, stopping at the first acceptance**, for
 * the reason the attack window stops: once the damage is being rerolled there is
 * nothing left to react to, and charging two players 3 Hope each for one reroll
 * would be worse. In the ordinary case only one character holds a reaction, and
 * only one prompt ever appears.
 */
async function runAdversaryDamageWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  // A healing action has no `main` at all — `DHActorRoll#hasHealing` requires the
  // damage to be resources only — so the second check is belt and braces.
  if (config?.["hasHealing"] === true) return;

  const main = config?.["damage"]?.["main"] as AnyObject | undefined;
  if (!main) return;

  const attacker = rollActor(roll, config);
  if (!attacker || PLAYER_SIDE.includes(String(attacker["type"] ?? ""))) return;

  if (!canvas.ready) {
    console.debug(`${LOG_PREFIX} Adversary damage: no canvas, no reactions offered.`);
    return;
  }

  for (const actor of candidateReactors(attacker)) {
    // Null means the range is unmeasurable, which this window treats as "no",
    // never as "probably close enough".
    const distance = distanceBetweenActors(attacker, actor);
    if (distance === null) {
      console.debug(`${LOG_PREFIX} Adversary damage: cannot measure range to ${actor["name"]}.`);
      continue;
    }

    const context = buildContext(roll, config, main, actor, attacker, distance);
    const offers = offersFor("adversaryDamage", context);
    if (offers.length === 0) continue;

    for (const offer of offers.filter((entry) => !entry.feature.optional)) {
      await applyOffer(context, offer);
    }

    // Asked again rather than reused: a non-optional feature may just have
    // changed what the optional ones were judged against.
    const optional = offersFor("adversaryDamage", context).filter(
      (entry) => entry.feature.optional,
    );

    if (optional.length > 0) {
      const responder = responderFor(actor);
      const chosen = await askUser(responder, {
        title: game.i18n.localize("EE.Features.AdversaryDamageTitle"),
        intro: introFor(context),
        headline: headlineFor(context, canSee(config, responder)),
        offers: toPromptOffers(optional),
      });

      // Re-checked against the offers this client built, in priority order — the
      // answer arrived over a socket and is treated as a selection, not a command.
      for (const offer of optional) {
        if (!chosen.has(offer.feature.id)) continue;
        if (!stillOffered(context, offer)) {
          console.debug(
            `${LOG_PREFIX} Adversary damage: "${offer.feature.id}" no longer applies; not charged.`,
          );
          continue;
        }
        await applyOffer(context, offer);
      }
    }

    if (context.rerollRequested) {
      await rerollDamage(main, config);
      return;
    }
  }
}

/**
 * Install the window.
 *
 * Registered beside `notGoodEnough`, the only other window that looks at a damage
 * roll, and **after** it — deliberately. That one rerolls the 1s and 2s of a
 * roll its holder just made; this one throws an adversary's whole roll away. The
 * two never see the same roll (a character's damage is excluded here, and an
 * adversary holds no domain cards), so the order costs nothing today and reads
 * the right way round if that ever stops being true.
 */
export function registerAdversaryDamage(): void {
  registerRollWindow({
    id: "adversaryDamage",
    // The same test `notGoodEnough` makes, and for the same reason: the declared
    // roll type is no use, because `DamageField.execute` spreads the *action's*
    // config into the damage config and `rollTypeOf` reports the attack's
    // `actionType`. So this asks the class directly, and falls back to the one
    // config field only a damage roll carries.
    matches: (roll, config) => {
      const cls = CONFIG["Dice"]?.["daggerheart"]?.["DamageRoll"];
      return typeof cls === "function" ? roll instanceof cls : Boolean(config["damageFormula"]);
    },
    run: (roll, config) => runAdversaryDamageWindow(roll, config),
  });
}
