/**
 * **Witch's Charm** (Witch class, *Void for Daggerheart*) — "When you or an ally
 * within Far range rolls a failure on an action roll, you can spend 3 Hope to
 * change it into a success with Fear instead."
 *
 * `Compendium.the-void-unofficial.classes.Item.uBQT6rw7mFJubv7e`, a `feature`
 * Item carrying one `effect` action, "Spend Hope". That action does exactly one
 * thing: charge 3 Hope. Its `effects` list is empty, so nothing is converted —
 * and it cannot be, because by the time anyone could press it the roll it is
 * about is already on the table. The card takes the price and leaves the table to
 * rewrite the result by hand, which means walking back the Hope the roller has
 * already been given, handing the GM the Fear they have not, and re-deciding a
 * hit the chat card has already printed as a miss.
 *
 * ## Its own window rather than a registry entry
 *
 * The registry (`feature-registry.ts`) finds a feature on `context.actor` — the
 * actor the window is about. This card belongs to somebody who is *watching* the
 * roll, and there is no second feature in the game so far that reacts to an
 * ally's failed action roll. So this is one card's rule with a window of its own,
 * the same shape as `blood-spike.ts` and `hold-them-off.ts`, rather than a new
 * `FeatureWindow` with one occupant.
 *
 * ## Where the window sits
 *
 * The same seam as `duality-outcome.ts`, and for the same reasons: installed on
 * `DHRoll.buildPost`, which is what `DualityRoll.buildPost` reaches through
 * `super` *before* it creates the chat message, advances the Fear countdowns,
 * queues the Hope or the Fear, and runs the `dualityRoll` and `fearRoll`
 * triggers. Converting the result here means the roller was never given the Hope
 * and the GM's Fear is granted on the way past, rather than four separate things
 * being undone afterwards — one of which (a trigger that has already fired)
 * cannot be undone at all.
 *
 * Registered immediately after `registerDualityOutcome`, in the same band: both
 * *rewrite an outcome*, and both have to settle before anything that merely reads
 * one. Blood Spike in particular asks whether the cast hit, and asking it before
 * this window would be asking about a miss that is about to stop being one.
 *
 * ## Why the success is written onto the number, not onto a flag
 *
 * `config.roll.success` is the field the roll card renders from — it is
 * `roll.options.roll.success`, because the system passes the config straight into
 * the Roll as its `options` — so setting it is what takes the miss styling off
 * the difficulty badge, and it persists into the message.
 *
 * Targets are the harder half. `target.hit` is not trusted by anything: both
 * `TargetField.execute` and the chat message's own `_getCurrentTargets`
 * **re-derive** the hit from `difficulty || evasion` against the roll total,
 * every time they run and on every render. So the number the comparison uses is
 * the thing that has to move, exactly as `i-see-it-coming.ts` raises a target's
 * Evasion to make an attack miss — only downward. Setting it to the roll's own
 * total is the smallest change that makes the comparison agree, and it is
 * invisible: the target card prints Hit or Miss, never the number behind it.
 *
 * ## The Fear half
 *
 * Delegated to `duality-outcome.ts`'s {@link setRollDuality}, which is where the
 * persisted override and the two patched getters already live. Writing a second
 * copy of that mechanism here would be a second thing to keep in step with the
 * system's `withHope`/`withFear`. A roll that already failed *with* Fear is left
 * alone rather than overridden to the value it already has.
 *
 * ## Who is asked
 *
 * Every character who is holding the card, can pay for it and is close enough —
 * the roller first, since "you" is the one clause that needs no measuring, then
 * everyone else on the scene in name order so the sequence is the same on every
 * client. One at a time, **stopping at the first acceptance**: only one charm can
 * turn one failure into one success, and two players paying 3 Hope each for it
 * would be worse than a second prompt nobody wanted. In the ordinary case exactly
 * one character holds the card and exactly one prompt appears.
 *
 * The question goes to that character's own player through `feature-ask.ts`,
 * falling back to whoever is running the roll when nobody who owns them is
 * connected — so a witch watching another player's roll is asked on their own
 * screen, and the roll waits on it.
 *
 * The 3 Hope is charged with `Actor#modifyResource` on the witch directly rather
 * than through the roll's own `config.resourceUpdates`, because that map belongs
 * to the *roller* and would charge the wrong character in every case but the
 * self-cast. Both are deltas, so the two compose without racing even when they
 * are the same person.
 *
 * ## What is not automated
 *
 * - **A roll nobody scored.** `D20Roll.buildEvaluate` only fills in
 *   `config.roll.success` when the roll had a difficulty entered or a target with
 *   a number to beat. A GM holding the difficulty in their head leaves the field
 *   absent, and a module that guessed "absent means failed" would put a prompt on
 *   a witch's screen after every unscored trait roll at the table. Those keep the
 *   card's own button as the manual fallback, which is untouched.
 * - **Range that cannot be measured.** No canvas, no token for one of them, or
 *   unreadable thresholds all mean no prompt, never "probably close enough" —
 *   `range-bands.ts`'s standing promise, and the same answer `blood-maledict.ts`
 *   gives. The witch's own roll is exempt, having nothing to measure.
 * - **Reaction rolls.** A reaction roll is not an action roll: the system says so
 *   itself by withholding Hope and Fear from one, and this reads the same
 *   `actionType` it does.
 * - **Which targets a multi-target roll now hits.** All of them. The window only
 *   opens when the roll read as a failure, and a roll with targets is only a
 *   failure when it missed *every* one — so "change it into a success" has no
 *   subset left to be careful about.
 * - **Whether the roller is an ally.** Every other character is one. Nothing here
 *   judges who is on good terms with whom.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { setRollDuality } from "./duality-outcome.js";
import { askUser, responderFor } from "./feature-ask.js";
import type { PromptHeadline, PromptRequest } from "./feature-prompt.js";
import {
  canAfford,
  findGrantingItem,
  resourceUpdatesFor,
  type FeatureCost,
  type FeatureMatch,
} from "./feature-registry.js";
import { distanceBetweenActors, withinBand, type RangeBand } from "./range-bands.js";
import { registerRollWindow, showDiceEarly } from "./roll-pipeline.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "witchsCharm";

/** Prefix for this feature's console lines. */
const LABEL = "Witch's Charm";

/** How the granting card is recognised — flag, then compendium, then name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.classes.Item.uBQT6rw7mFJubv7e"],
  names: ["Witch's Charm"],
};

/** The printed price, in the shape `feature-registry.ts` reads. */
const COST: readonly FeatureCost[] = [{ key: "hope", value: 3 }];

/** "an ally within Far range". */
const BAND: RangeBand = "far";

/** The system's duality encoding, as it appears in `config.roll.result.duality`. */
const WITH_FEAR = -1;

/** The system's own name for a roll made in response to something else. */
const REACTION = "reaction";

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.witchsCharm) === true;
}

/**
 * The system's DualityRoll class, or undefined if the system changed shape.
 * `CONFIG.Dice.daggerheart` for the same reason as `duality-outcome.ts`: it is
 * assigned at script load, while `game.system.api` waits for the system's `init`.
 */
function dualityRollClass(): AnyObject | undefined {
  return (CONFIG["Dice"]?.daggerheart?.DualityRoll ??
    game.system?.api?.dice?.DualityRoll) as AnyObject | undefined;
}

/** The actor that made the roll, or null when the roll has no owner. */
function rollActor(roll: AnyObject, config: AnyObject): AnyObject | null {
  const parent = roll["data"]?.["parent"];
  if (parent) return parent as AnyObject;

  const uuid = config["source"]?.["actor"];
  return uuid ? fromUuidSync(String(uuid)) : null;
}

/** Is `value` a number actually set, as opposed to null/undefined/absent? */
function isFixedNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Was this roll compared against anything at all?
 *
 * `config.roll.success` reads `false` in two very different situations: the roll
 * was measured and fell short, and the roll had targets that carry no number to
 * beat. Only the first is a failure. Without this check a spellcast aimed at a
 * scenery token would read as a failure the charm could be spent on.
 */
function scored(config: AnyObject): boolean {
  if (isFixedNumber(config["roll"]?.["difficulty"])) return true;

  return ((config["targets"] ?? []) as AnyObject[]).some(
    (target) => isFixedNumber(target["difficulty"]) || isFixedNumber(target["evasion"]),
  );
}

function sameActor(a: AnyObject, b: AnyObject): boolean {
  return String(a["uuid"] ?? "") === String(b["uuid"] ?? "");
}

/**
 * Everyone who might be holding the charm, in the order they are asked.
 *
 * The roller comes first: "you" is the clause with nothing to measure, and they
 * are already looking at the result. Everyone else is drawn from the canvas
 * rather than from `game.actors`, because a character has to be *present* to be
 * within Far range of anything and the distance check needs their token anyway.
 * Sorted by name so two witches are asked in the same order on every client and
 * from one roll to the next.
 */
function candidateWitches(roller: AnyObject): AnyObject[] {
  const seen = new Set<string>();
  const others: AnyObject[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor as AnyObject | null;
    if (!actor || actor["type"] !== "character") continue;

    const uuid = String(actor["uuid"] ?? "");
    if (!uuid || uuid === String(roller["uuid"] ?? "") || seen.has(uuid)) continue;

    seen.add(uuid);
    others.push(actor);
  }

  others.sort((a, b) => String(a["name"] ?? "").localeCompare(String(b["name"] ?? "")));
  return [roller, ...others];
}

/**
 * Is `witch` close enough to react to `roller`'s roll?
 *
 * Deliberately `=== true`: an unmeasurable distance answers null, and this treats
 * that as no.
 */
function inRange(roller: AnyObject, witch: AnyObject): boolean {
  if (sameActor(roller, witch)) return true;
  return withinBand(distanceBetweenActors(roller, witch), BAND) === true;
}

/** The names of whatever the roll was aimed at, for the prompt to quote back. */
function targetNames(config: AnyObject): string[] {
  return ((config["targets"] ?? []) as AnyObject[])
    .map((target) => String(target["name"] ?? "").trim())
    .filter((name) => name.length > 0);
}

/**
 * The banner form of the event, when it fits one: the roller on the left, the
 * one thing they missed on the right.
 *
 * Only for a single target — two portraits cannot honestly depict a roll that
 * fell short against three people, and that case falls back to the intro
 * sentence, which lists them all. No number accompanies the verdict, for the same
 * reason the adversary-attack window withholds one: whether it failed is the
 * whole of what the witch is deciding on, and the total is a figure the chat card
 * may be about to whisper.
 */
function headlineFor(roller: AnyObject, config: AnyObject): PromptHeadline | undefined {
  const targets = (config["targets"] ?? []) as AnyObject[];
  const only = targets.length === 1 ? targets[0] : undefined;
  if (!only) return undefined;

  return {
    source: {
      name: String(roller["name"] ?? ""),
      img: roller["img"] ? String(roller["img"]) : undefined,
    },
    target: {
      name: String(only["name"] ?? ""),
      img: only["img"] ? String(only["img"]) : undefined,
    },
    verdict: game.i18n.localize("EE.Features.VerdictMiss"),
  };
}

/** Put the question on the witch's screen. Resolves to whether they said yes. */
async function ask(roller: AnyObject, config: AnyObject, witch: AnyObject): Promise<boolean> {
  const names = targetNames(config);
  const card = findGrantingItem(witch, FEATURE_ID, MATCH);
  const who = String(roller["name"] ?? "");

  const request: PromptRequest = {
    title: game.i18n.localize("EE.Features.WitchsCharm.Title"),
    intro:
      names.length > 0
        ? game.i18n.format("EE.Features.WitchsCharm.IntroTarget", {
            roller: who,
            targets: names.join(", "),
          })
        : game.i18n.format("EE.Features.WitchsCharm.Intro", { roller: who }),
    headline: headlineFor(roller, config),
    offers: [
      {
        id: FEATURE_ID,
        label: game.i18n.localize("EE.Features.WitchsCharm.Label"),
        hint: game.i18n.format(
          sameActor(roller, witch)
            ? "EE.Features.WitchsCharm.HintSelf"
            : "EE.Features.WitchsCharm.Hint",
          { roller: who },
        ),
        itemName: String(card?.["name"] ?? LABEL),
        img: card?.["img"] ? String(card["img"]) : undefined,
        useLabel: game.i18n.localize("EE.Features.WitchsCharm.Spend"),
        skipLabel: game.i18n.localize("EE.Features.WitchsCharm.Keep"),
      },
    ],
  };

  // Re-checked as a selection rather than obeyed as a command: the answer came
  // back over a socket, and the only id this client will act on is its own.
  const chosen = await askUser(responderFor(witch), request);
  return chosen.has(FEATURE_ID);
}

/**
 * Make the roll read as a success everywhere the system asks the question.
 *
 * See the note at the top of this file on why the target's number moves rather
 * than only its `hit` flag. A total of zero or less cannot be written into a
 * field the system reads with `||`, so such a roll keeps the flag alone — it
 * still hits everything in flight, and only a page reload would disagree.
 */
function forceSuccess(config: AnyObject): void {
  const total = Number(config["roll"]?.["total"] ?? 0);

  for (const target of (config["targets"] ?? []) as AnyObject[]) {
    if (Number.isFinite(total) && total >= 1) target["difficulty"] = total;
    target["hit"] = true;
  }

  if (config["roll"]) config["roll"]["success"] = true;
}

/**
 * Say what the Hope bought, as the witch.
 *
 * Failure is swallowed: the Hope is already spent and the roll already rewritten,
 * and losing the announcement must not cost the player either.
 */
async function announce(witch: AnyObject, roller: AnyObject): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch }),
      content: `<p>${game.i18n.format("EE.Features.WitchsCharm.Spent", {
        witch: String(witch["name"] ?? ""),
        roller: String(roller["name"] ?? ""),
      })}</p>`,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the charm.`, error);
  }
}

/** Charge the witch, rewrite the roll, announce it. */
async function spend(
  roll: AnyObject,
  config: AnyObject,
  roller: AnyObject,
  witch: AnyObject,
): Promise<void> {
  // Awaited, so a write this client is not allowed to make aborts before the
  // outcome changes rather than after — the same order `adversary-attack.ts`
  // charges a reacting player in.
  await witch["modifyResource"]?.(resourceUpdatesFor(witch, COST));

  // "...into a success with Fear instead". The Fear half first, so that
  // everything downstream of this window reads one settled result.
  if (Number(config["roll"]?.["result"]?.["duality"] ?? 0) !== WITH_FEAR) {
    setRollDuality(roll, config, WITH_FEAR);
  }

  forceSuccess(config);
  await announce(witch, roller);

  console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} rescued ${roller["name"]}'s roll.`);
}

/** Offer, ask, apply. Returns once the outcome is settled. */
async function runWitchsCharmWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  if (!enabled()) return;

  // Only an outright failure, and only one the system actually measured.
  if (config?.["roll"]?.["success"] !== false || !scored(config)) return;

  // `D20Roll.buildEvaluate` copies `config.actionType` over `config.roll.type`,
  // so by here either says the same thing; the config's own field is the one the
  // system set rather than the one it derived.
  if (String(config["actionType"] ?? "") === REACTION) return;

  const roller = rollActor(roll, config);
  if (!roller) return;

  let diceShown = false;

  for (const witch of candidateWitches(roller)) {
    if (!findGrantingItem(witch, FEATURE_ID, MATCH)) continue;
    if (!canAfford(witch, COST)) continue;
    if (!inRange(roller, witch)) {
      console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} is not within ${BAND} range.`);
      continue;
    }

    // Once, before the first prompt: nobody is asked to spend 3 Hope on a result
    // they have not watched arrive.
    if (!diceShown) {
      await showDiceEarly(roll, config);
      diceShown = true;
    }

    if (!(await ask(roller, config, witch))) continue;

    await spend(roll, config, roller, witch);
    return;
  }
}

/**
 * Install the window.
 *
 * Registered after `registerDualityOutcome` and before every window that only
 * *reads* a result — see the note at the top of this file on the ordering.
 */
export function registerWitchsCharm(): void {
  const DualityRoll = dualityRollClass();
  if (!DualityRoll) {
    console.warn(`${LOG_PREFIX} ${LABEL}: DualityRoll not found — the charm is off.`);
    return;
  }

  registerRollWindow({
    id: FEATURE_ID,
    // Cheap and total: an action roll is a character's Duality roll, and
    // everything narrower is established in `run`.
    matches: (roll) => roll instanceof (DualityRoll as unknown as new () => unknown),
    run: async (roll, config) => {
      await runWitchsCharmWindow(roll, config);
    },
  });
}
