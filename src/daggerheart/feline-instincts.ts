/**
 * **Feline Instincts** (Katari ancestry, SRD p.30) — "When you make an Agility
 * Roll, you can **spend 2 Hope** to reroll your Hope Die."
 *
 * ## What the system ships
 *
 * The same shape Adaptability arrives in: a `feature` Item carrying one action —
 * "Spend Hope", type `effect`, cost 2 Hope, no effects and no triggers. Pressing
 * it takes the Hope and stops. Nothing rerolls anything, so the table throws a
 * d12 by hand and then has to work out what the roll now totals, what its
 * Hope/Fear result is, and whether it hit after all.
 *
 * ## Why one die and not the whole roll
 *
 * This is the difference between this card and `adaptability.ts`, and it is why
 * this could not be a few more lines in that file. Adaptability rerolls *the
 * roll*, which the system already knows how to do: build a fresh roll from the
 * same resolved formula and evaluate it (`rebuildRoll`). Feline Instincts
 * rerolls **one die of an existing roll** and keeps the other, which the system
 * has no path for at all — a Fear Die showing 9 stays a 9, and what the player
 * is buying is a second look at the Hope Die alone.
 *
 * So the die is thrown again in place, exactly the way core's own `r` modifier
 * does it: mark the standing result `rerolled`, deactivate it, push a new one
 * (`Die#reroll`, `client/dice/terms/die.mjs`). `DiceTerm#total` sums only the
 * *active* results, so the term reports the new face while the old one stays on
 * the card struck through — which is how the system's own `rerolled.rerolls`
 * field and its chat template already expect a rerolled die to look.
 *
 * Two things then have to be put back by hand, because nothing re-evaluates:
 *
 * - `Roll#total` is cached in `_total` at evaluation and does not recompute from
 *   the terms. Core's own `Roll.fromTerms` refreshes it with `_evaluateTotal()`,
 *   so that is what this does.
 * - `config.roll` is the plain-object *record* of the outcome that the chat card,
 *   the Hope/Fear update, `TargetField.execute` and every damage part read
 *   instead of the Roll object. {@link refreshRollSnapshot} rewrites it the way
 *   the system's own `buildEvaluate` chain would have.
 *
 * ## Where it runs, and why that is before the message
 *
 * At the pipeline seam (`roll-pipeline.ts`) — after the dice are evaluated,
 * before `buildPost` has posted anything or handed out Hope and Fear. That
 * matters more here than for a card that only spends a resource: the Hope Die
 * *is* the Hope/Fear result, so rerolling it afterwards would mean unwinding a
 * Fear the GM had already gained, countdowns that had already advanced, and
 * `fearRoll` triggers that had already fired — see the header of
 * `duality-outcome.ts`. Doing it here means none of that ever happened.
 *
 * Registered before the duality window for the same reason Adaptability is: "do
 * you want to convert this Fear?" should be asked about the dice the player is
 * keeping, not about a Hope Die they are one prompt away from throwing away.
 *
 * ## What counts as an Agility Roll
 *
 * `config.roll.trait === "agility"`. That is the field the system itself fills
 * in for both kinds of Agility Roll — a trait check made from the sheet
 * (`Actor#rollTrait`) and an action that rolls a trait (`RollField.prepareConfig`
 * by way of `DHActionRollData#rollTrait`), which is what makes an attack with a
 * Finesse-and-Agility weapon count. It also catches a Spellcast Roll for a class
 * whose spellcast trait is Agility, which is the reading the system's own field
 * supports and the one this follows.
 *
 * ## What is not automated
 *
 * **Whether you failed.** The printed card has no failure condition — any
 * Agility Roll may be rerolled — but raising a prompt on every one of them is
 * the "unusable at the table" failure the registry header warns about, so the
 * offer is made only on a roll the system actually scored as a miss. A roll
 * whose difficulty lives in the GM's head leaves `config.roll.success` undefined
 * and asks nothing; unlike Adaptability there is no chat-card control behind it.
 *
 * **How many times.** The card sets no limit, so a rerolled Hope Die that still
 * misses may be bought again while the Hope lasts — the loop in {@link runWindow},
 * which re-scores the roll each time round.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { confirmChoice } from "./feature-prompt.js";
import {
  chargeCosts,
  findGrantingItem,
  type FeatureCost,
  type FeatureMatch,
} from "./feature-registry.js";
import {
  refreshRollSnapshot,
  registerRollWindow,
  showDiceEarly,
  showRerolledDie,
} from "./roll-pipeline.js";

/** Registry id, so a homebrew rewrite can opt in with the usual flag. */
const FEATURE_ID = "felineInstincts";
const LABEL = "Feline Instincts";

/** How the granting Item is recognised — see {@link FeatureMatch}. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.ancestries.Item.lNgbbYnCKgrdvA85"],
  names: ["Feline Instincts"],
};

/** The printed price: spend 2 Hope. */
const HOPE = "hope";
const HOPE_COST = 2;
const COST: readonly FeatureCost[] = [{ key: HOPE, value: HOPE_COST }];

/** The one trait this card cares about, as the system spells it. */
const AGILITY = "agility";

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.felineInstinctsReroll) === true;
}

/**
 * Say why the prompt was withheld, at `console.debug`.
 *
 * The same reasoning as `adaptability.ts`: a prompt that never appears is
 * otherwise indistinguishable from a feature that is switched off, and "I rolled
 * Agility and nothing happened" is the report this will actually receive.
 */
function decline(reason: string, detail?: unknown): void {
  console.debug(`${LOG_PREFIX} ${LABEL}: no reroll offered — ${reason}`, detail ?? "");
}

/** The character that made the roll, or null. */
function rollActor(roll: AnyObject): AnyObject | null {
  const uuid = roll["options"]?.["source"]?.["actor"];
  if (!uuid) return null;

  const actor = fromUuidSync(String(uuid)) as AnyObject | null;
  return actor?.["type"] === "character" ? actor : null;
}

/**
 * How much Hope this character can actually spend right now.
 *
 * Not `canAfford`, and the difference matters for this card in particular. A
 * Duality roll's own costs — a Hope per Experience, most of all — are queued into
 * `config.resourceUpdates` and flushed once, when the whole action workflow ends.
 * Until then `actor.system.resources.hope.value` still reads what it did *before*
 * the roll, so a character who started with 3 Hope and spent 1 on an Experience
 * would be sold a 2-Hope reroll they cannot pay for. `Actor#modifyResource`
 * clamps a resource into range on write, so the shortfall would be silent: the
 * player would get the reroll and keep a Hope they had already spent.
 *
 * `ResourceUpdateMap` extends `Map` and is keyed by resource, so the pending
 * delta is simply readable. A `clear` entry sets the resource to zero rather than
 * adjusting it, which leaves nothing to spend.
 */
function hopeAvailable(actor: AnyObject, config: AnyObject): number {
  const resource = actor["system"]?.["resources"]?.[HOPE];
  if (!resource) return 0;

  const pending = config["resourceUpdates"]?.get?.(HOPE) as AnyObject | undefined;
  if (pending?.["clear"] === true) return 0;

  return Number(resource["value"] ?? 0) + Number(pending?.["value"] ?? 0);
}

/**
 * Throw the Hope Die again, in place, and put the roll's cached total back.
 *
 * Everything is checked before anything is mutated. The player has already paid
 * by the time this runs, and a half-rerolled roll — a discarded result with no
 * replacement, or a new face behind a stale total — is far worse at the table
 * than a reroll that declined to happen.
 *
 * Returns whether the die actually moved.
 */
async function rerollHopeDie(roll: AnyObject): Promise<boolean> {
  const hope = roll["dHope"] as AnyObject | undefined;
  const results = hope?.["results"] as AnyObject[] | undefined;
  const throwDie = hope?.["roll"] as ((options?: AnyObject) => Promise<unknown>) | undefined;
  const evaluateTotal = roll["_evaluateTotal"] as (() => number) | undefined;

  if (!hope || !Array.isArray(results) || typeof throwDie !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: this roll has no Hope Die to reroll.`);
    return false;
  }
  if (typeof evaluateTotal !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: cannot recompute the roll's total — leaving it alone.`);
    return false;
  }

  // `active` is what `DiceTerm#total` sums. A die bought a second time already
  // has one inactive result behind it; the active one is what to replace.
  const standing = results.find((result) => result["active"] !== false);
  if (!standing) {
    console.warn(`${LOG_PREFIX} ${LABEL}: the Hope Die has no standing result.`);
    return false;
  }

  // Precisely what core's `Die#reroll` does to one result, without the modifier
  // parsing that would have to go looking for it by value.
  standing["rerolled"] = true;
  standing["active"] = false;
  await throwDie.call(hope, { reroll: true });

  // `Roll#total` reads a value cached at evaluation, and the terms have moved
  // under it. `Roll.fromTerms` refreshes it the same way.
  roll["_total"] = evaluateTotal.call(roll);
  return true;
}

/**
 * The prompt, for an Agility roll the system scored as a failure.
 *
 * The dice are shown first, for the reason every reroll window shows them: what
 * the Hope Die is currently reading is the whole basis on which the player is
 * deciding whether to spend two Hope looking at it again.
 */
async function runWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  if (!enabled()) return;

  // Silent, unlike every gate below it: this one declines on most of the rolls
  // made at the table and says nothing anybody needs to read.
  if (config["roll"]?.["trait"] !== AGILITY) return;

  // One line per Agility roll, at Verbose. Deliberate: without it, "the window
  // declined" and "the window never ran" look identical from the console.
  console.debug(`${LOG_PREFIX} ${LABEL}: considering an Agility roll.`, {
    success: config["roll"]?.["success"],
  });

  const actor = rollActor(roll);
  if (!actor) return decline("no character behind the roll", roll["options"]?.["source"]);
  // Only the roller's own client asks, and only it pays: a Duality roll is made
  // on the client of whoever owns the character.
  if (!actor["isOwner"]) return decline("you do not own", actor["name"]);
  if (!findGrantingItem(actor, FEATURE_ID, MATCH)) {
    return decline(`${String(actor["name"] ?? "")} has no Feline Instincts feature`);
  }

  // Loops because the card sets no limit: a rerolled Hope Die that still misses
  // may be bought again. Every exit is a real stop — it hit, the Hope ran out,
  // the player said no, or the die would not move — so this cannot spin.
  for (let bought = 0; ; bought += 1) {
    // A critical is a success in Daggerheart whatever the difficulty was, and it
    // is also the one result rerolling the Hope Die could only spoil.
    if (roll["isCritical"] === true) {
      decline("the roll was a critical success");
      break;
    }

    // Only a failure the system actually scored. `undefined` — the roll whose
    // difficulty is the GM's to say out loud — deliberately raises nothing:
    // asking anyway would mean a modal on every Agility roll ever made.
    if (config["roll"]?.["success"] !== false) {
      decline("the system did not score this roll as a failure", {
        success: config["roll"]?.["success"],
        difficulty: config["roll"]?.["difficulty"],
        targets: ((config["targets"] ?? []) as AnyObject[]).length,
        bought,
      });
      break;
    }

    // The flat price each time round, *not* a cumulative one: `chargeCosts` has
    // already put the previous reroll's 2 Hope into the pending map, and
    // `hopeAvailable` reads that map — so the earlier spends are subtracted
    // here already. (Adaptability's loop does check cumulatively, because
    // `canAfford` ignores the pending map and would otherwise resell the same
    // Stress. Same problem, opposite arithmetic; don't copy one into the other.)
    if (hopeAvailable(actor, config) < HOPE_COST) {
      console.debug(`${LOG_PREFIX} ${LABEL}: not enough Hope left; not offering again.`);
      break;
    }

    // Whether the table actually watched this throw decides who animates the
    // next one: us, or the chat message. False means Dice So Nice is absent or
    // declined, in which case the message would not animate either.
    const watched = await showDiceEarly(roll, config);

    const rerolling = await confirmChoice({
      title: game.i18n.localize("EE.Features.FelineInstincts.Title"),
      intro: game.i18n.format("EE.Features.FelineInstincts.Intro", {
        total: Number(roll["total"] ?? 0),
        hope: Number((roll["dHope"] as AnyObject | undefined)?.["total"] ?? 0),
        fear: Number((roll["dFear"] as AnyObject | undefined)?.["total"] ?? 0),
      }),
      confirmLabel: game.i18n.localize("EE.Features.FelineInstincts.Confirm"),
      declineLabel: game.i18n.localize("EE.Features.FelineInstincts.Decline"),
    });

    if (!rerolling) break;

    // The die first, the price second — the opposite order from Adaptability,
    // and for a reason that only applies here. There the price is an awaited
    // `modifyResource` whose failure must abort the reroll. Here it is an entry
    // in the roll's own pending map, flushed when the workflow ends, so nothing
    // can fail between the two — and `rerollHopeDie` declines rather than throws
    // when the system's shape has moved, which would otherwise leave the player
    // charged 2 Hope for a die that never left the table.
    if (!(await rerollHopeDie(roll))) break;

    // Folded into the roll's own pending update rather than written separately:
    // this roll is about to queue its own Hope or Fear into the same map, and
    // two separate writes would race where one merged write nets them.
    chargeCosts(actor, config, COST);

    // The record the rest of `buildPost` reads — the total, the Hope/Fear
    // result, each target's hit and whether the roll succeeded — rather than the
    // Roll object all of it was derived from.
    refreshRollSnapshot(roll);
    // `D20Roll.buildEvaluate` sets this from the same field, and `CostField`
    // runs later in the action workflow than the roll does (order 150 against
    // 10), so the message has to describe the outcome those costs will actually
    // be charged against.
    config["successConsumed"] = config["roll"]?.["success"];

    // Deliberately *not* `clearEarlyDice`. Letting the chat message animate the
    // roll again would throw the whole pair a second time — Dice So Nice groups
    // a term's rerolled results into an earlier throw than the ones replacing
    // them, so the table would watch the original Hope and Fear land on their
    // old faces and only then see the new die. The message stays suppressed and
    // the one die that actually moved is animated on its own. The next turn of
    // this loop leaves it that way: `showDiceEarly` is idempotent, so it reports
    // the dice as shown without throwing them again.
    if (watched) await showRerolledDie(roll["dHope"] as AnyObject, config);
  }
}

/**
 * Install the window.
 *
 * No chat-card half, unlike Adaptability. This rewrites the Hope/Fear result
 * itself, and doing that to a posted card would mean reconciling the Fear the GM
 * has already gained — which `DualityRoll#reroll` does do, but only as part of
 * rerolling the whole roll, which is not this card's rule.
 */
export function registerFelineInstincts(): void {
  const DualityRoll = CONFIG["Dice"]?.daggerheart?.DualityRoll as
    | (new () => unknown)
    | undefined;

  if (!DualityRoll) {
    console.warn(`${LOG_PREFIX} ${LABEL}: DualityRoll not found — the prompt is off.`);
    return;
  }

  registerRollWindow({
    id: FEATURE_ID,
    matches: (roll) => roll instanceof DualityRoll,
    run: async (roll, config) => {
      await runWindow(roll, config);
    },
  });
}
