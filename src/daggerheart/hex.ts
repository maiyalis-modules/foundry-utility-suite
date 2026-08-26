/**
 * **Hex** (Witch class, *Void for Daggerheart*) — "When a creature causes you or
 * an ally within Close range to mark any number of Hit Points, you can **mark a
 * Stress** to *Hex* them. Action and damage rolls against a *Hexed* creature gain
 * a bonus equal to your tier. This condition lasts until the GM spends a number
 * of Fear equal to your Spellcast trait to remove it or you *Hex* another
 * creature. Otherwise, remove it when the scene ends."
 *
 * ## What the Void ships
 *
 * One `effect` action, "Mark Stress": `cost: [{ key: "stress", value: 1 }]`,
 * `target: { type: "any" }`, and one embedded ActiveEffect named "Hex" whose
 * `system.changes` is **empty**. So the card charges the Stress correctly and
 * places a label correctly, and then the label does nothing — which is not an
 * oversight on the Void's part but the same wall `gifted-tracker.ts` documents at
 * length: *"a bonus to rolls made against this creature"* is not a property of
 * any character, so no ActiveEffect on anybody can express it. It is a property
 * of one roll, and it can only be applied while that roll is being built.
 *
 * The card is therefore left completely alone, button and effect both. What is
 * added is the three things it cannot do: noticing the trigger, applying the
 * bonus, and ending the condition.
 *
 * ## The trigger: two seams, because neither half knows the other's answer
 *
 * "Causes you or an ally to mark any number of Hit Points" needs two facts that
 * live in different places, and no single hook has both.
 *
 * *How many Hit Points were marked* is only knowable after `Actor#takeDamage` has
 * run resistances, thresholds and the armour-slot dialog — 9 damage against a
 * Major of 10 marks one Hit Point, and the same 9 against an armoured character
 * who spends a slot may mark none. The system's `daggerheart.postTakeDamage`
 * fires with the finished update list, which is exactly the number the rule asks
 * about. (This is the shallow end of the seam `tethered-talisman.ts` works in;
 * that one has to get in *before* the write, so it shadows `modifyResource`,
 * while this only has to read what happened.)
 *
 * *Which creature caused it* is not in that hook at all — `takeDamage` is told
 * about damage, never about who threw it. That fact lives one level up, in the
 * action config `DamageField.applyDamage` is holding (`config.source.actor`). So
 * a `before` rule on the shared `damage-landing.ts` wrapper writes down who is
 * about to hurt whom, and the `postTakeDamage` handler reads it back. Entries are
 * consumed on use and swept after a minute, which is generous on purpose: the
 * armour-slot dialog between the two seams has a thirty-second timeout of its
 * own.
 *
 * Damage nobody applied is deliberately not covered. A GM typing a Hit Point onto
 * a sheet by hand has caused a mark with no attacker attached to it, and
 * inventing one would be worse than staying quiet.
 *
 * ## The bonus: two more seams, because the system builds the two rolls
 * differently
 *
 * Both are the system's own extension points, and neither writes anything to a
 * sheet — the bonus is recomputed from the hex every time a roll is built, so
 * lifting the hex un-applies it with nothing to reconcile.
 *
 * - **Action rolls** — `daggerheart.preRoll`, pushing onto
 *   `config.roll.baseModifiers`. `D20Roll.applyBaseBonus` deep-clones that array
 *   as the first thing it does, and `DualityRoll` inherits it, so one hook covers
 *   an adversary's d20 and a character's Duality roll alike. It has to be
 *   `preRoll` and not `postRollConfiguration`: `D20Roll`'s **constructor** calls
 *   `constructFormula`, so by the time the later hook fires the formula is built.
 *   The modifier is labelled, which means it shows in the roll dialog and in the
 *   card's breakdown rather than arriving as an unexplained number.
 * - **Damage rolls** — `DamageRoll.temporaryModifierBuilder`, wrapped. That is
 *   the system's bucket for a per-roll bonus that is *not* an ActiveEffect: it is
 *   where Rally dice, Massive, Brutal and Serrated live. Entries render in the
 *   damage dialog's own **Modifiers** fieldset as a labelled checkbox, ticked,
 *   which is worth more than tidiness — on a swing that catches a hexed creature
 *   and an unhexed one the system rolls damage once for both, and the player can
 *   untick it. Wrapping is necessary rather than preferred: the builder ends with
 *   `config.modifiers = mods`, replacing the object wholesale, so anything added
 *   from `preRoll` would be thrown away a few lines later. The wrapper itself is
 *   `damage-modifiers.ts`'s, alongside Slayer Dice and Face Your Fear; this file
 *   only registers the rule.
 *
 * `config.roll` tells the two rolls apart. `RollField.prepareConfig` builds it
 * with a formula and no total; `buildEvaluate` replaces it with the finished
 * result, total and all. So a config whose `roll.total` is a number is an
 * *evaluated* roll being carried into the damage step, and the action-roll hook
 * leaves it alone.
 *
 * ## Where the hex lives
 *
 * On the hexed creature, as the ActiveEffect `gm-effects.ts` places, flagged
 * {@link FLAGS.hex} with the witch's uuid. The effect **is** the record — there
 * is no second copy anywhere, for the reason `gifted-tracker.ts` gives: two
 * places to look eventually disagree. Its presence is what the bonus reads, its
 * absence is what lets another be cast, and deleting it from the sheet is how a
 * table calls the condition off.
 *
 * This is `tethered-talisman.ts`'s shape rather than `rangers-focus.ts`'s, and
 * the difference is the point. The Focus record has to sit on the ranger because
 * the bonus belongs to the ranger. Here the bonus belongs to the *creature* and
 * every roll in the party reads it, so the creature is where it goes. Keyed by
 * witch rather than by creature, so two Witches can hex the same adversary and
 * each contributes her own tier.
 *
 * ## Ending it
 *
 * - **"…or you Hex another creature"** is automatic: casting again lifts the
 *   previous hex first, found by the same world scan `tethered-talisman.ts`
 *   uses — `game.actors` plus the current scene's unlinked token actors.
 * - **"…until the GM spends a number of Fear equal to your Spellcast trait"** is
 *   a button on the announcement card, drawn for the GM only. The price is read
 *   live off the witch when it is pressed rather than stored when the hex was
 *   cast, because the rule names the trait, not the number it happened to have
 *   that evening. Refused, with the shortfall named, when there is not enough
 *   Fear.
 * - **"Otherwise, remove it when the scene ends"** is deliberately **not**
 *   automated. A Daggerheart scene is a fiction boundary, not a canvas one and
 *   not a combat: hanging the removal on `canvasReady` or on the end of an
 *   encounter would be inventing a rule, and would silently lift a hex the table
 *   still considers live. The effect's own description says when to remove it,
 *   and removing it is one click — the same judgement `gifted-tracker.ts` makes
 *   about "until you stop tracking them".
 *
 * ## Who is asked
 *
 * Every character who holds the card, is within Close range of whoever was hurt,
 * and can mark a Stress — the hurt character first, since "you" is the clause
 * with nothing to measure. One at a time, and unlike `witchs-charm.ts` the first
 * yes does **not** settle it: two Witches each have their own Stress to spend and
 * their own hex to place, and the rule gives neither of them precedence. In
 * practice one person holds the card and one prompt appears.
 *
 * A single attack that hurts three party members reaches this three times. Each
 * witch is asked once per damage application, not once per casualty.
 *
 * ## Deliberate silences
 *
 * - **Damage that marks no Hit Points raises nothing**, including a hit that
 *   marks only Stress. The rule says Hit Points and means it.
 * - **Nobody can hex their own doing.** A creature that hurt itself, and a witch
 *   asked about damage she caused, are both skipped.
 * - **Range is measured on the canvas.** A scene where the witch or the person
 *   hurt has no token raises no prompt rather than guessing.
 * - **Reaction rolls gain nothing.** They are not action rolls — the same line
 *   `witchs-charm.ts` draws, and the same one the system draws when it withholds
 *   Hope and Fear from them. Damage is not filtered this way: "damage rolls
 *   against a Hexed creature" is unqualified.
 * - **Healing never gains the bonus**, however it is delivered.
 * - **One damage roll serves every target it hit.** A swing that catches a hexed
 *   creature and an unhexed one adds the bonus once, to both — which is the
 *   system's own arithmetic, and is why the modifier is left tickable.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { damagedTargets, onDamageLanding } from "./damage-landing.js";
import { onDamageModifiers } from "./damage-modifiers.js";
import { askUser, responderFor } from "./feature-ask.js";
import type { PromptHeadline, PromptRequest } from "./feature-prompt.js";
import {
  canAfford,
  findGrantingItem,
  resourceUpdatesFor,
  type FeatureCost,
  type FeatureMatch,
} from "./feature-registry.js";
import { markActor, unmarkActor, type MarkRequest } from "./gm-effects.js";
import { distanceBetweenActors, withinBand, type RangeBand } from "./range-bands.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "hex";

/** Prefix for this feature's console lines. Deliberately the printed card name. */
const LABEL = "Hex";

/** How the granting card is recognised — flag, then compendium, then name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.classes.Item.4iy45CFDxqDrb5QN"],
  names: ["Hex"],
};

/** The printed price, in the shape `feature-registry.ts` reads. */
const COST: readonly FeatureCost[] = [{ key: "stress", value: 1 }];

/** "…you or an ally within Close range". */
const BAND: RangeBand = "close";

/** `CONFIG.DH.GENERAL.healingTypes.hitPoints.id`. The only resource this watches. */
const HIT_POINTS = "hitPoints";

/** The system's own name for a roll made in response to something else. */
const REACTION = "reaction";

/** The system id, and the world setting its Fear counter lives in. */
const DH_ID = "daggerheart";
const FEAR_KEY = "ResourcesFear";

/** The key this feature's damage modifier occupies in `config.modifiers`. */
const MODIFIER_KEY = "eeHex";

/** Marks a roll modifier as ours, so re-configuring a roll cannot double it. */
const MODIFIER_TAG = "eeHex";

/**
 * How long an attribution is worth keeping.
 *
 * Generous on purpose: `Actor#takeDamage` can sit for thirty seconds inside the
 * armour-slot query between the two seams, and an attribution that expired in the
 * meantime would lose the attacker for a mark that really did happen.
 */
const ATTRIBUTION_MS = 60_000;

/** One damage application, remembered between the two seams. */
interface Blame {
  /** Uuid of the actor that dealt it. */
  attacker: string;
  /** Identifies the one application, so a witch is asked once for it. */
  event: string;
  /** When it was written down, for the sweep. */
  at: number;
}

/** Who is about to hurt whom, keyed on the actor uuid about to be hurt. */
const blame = new Map<string, Blame>();

/** `event|witchUuid` pairs already put on somebody's screen, and when. */
const asked = new Map<string, number>();

/** Distinguishes two damage applications that land in the same millisecond. */
let applications = 0;

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.hexCondition) === true;
}

/* ------------------------------------------------------------------ *
 * Reading a hex
 * ------------------------------------------------------------------ */

/** The hex flag on an effect, or null. */
function hexFlag(effect: AnyObject): AnyObject | null {
  const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.hex];
  return mark && typeof mark === "object" ? (mark as AnyObject) : null;
}

/** Every witch currently hexing this creature, by uuid, in effect order. */
function witchesHexing(actor: AnyObject | null | undefined): string[] {
  const found: string[] = [];

  for (const effect of (actor?.["effects"] ?? []) as AnyObject[]) {
    const uuid = String(hexFlag(effect)?.["sourceUuid"] ?? "");
    if (uuid && !found.includes(uuid)) found.push(uuid);
  }

  return found;
}

/**
 * Every actor a hex could currently be sitting on: the world's own, plus the
 * synthetic actors behind unlinked tokens on the current scene.
 *
 * The second half is the usual case here rather than the exotic one — an
 * adversary on the board is very often an unlinked token, whose effects live on
 * its ActorDelta and not in `game.actors` at all. A hex on an unlinked token on
 * *another* scene is genuinely not found, and the only consequence is that the
 * old label is left behind when a new hex is cast; the bonus it stood for ends
 * either way, because the new hex is this witch's record from then on.
 */
function bearers(): AnyObject[] {
  const found: AnyObject[] = [];
  const seen = new Set<string>();

  for (const actor of [
    ...((game.actors?.contents ?? []) as AnyObject[]),
    ...((canvas.tokens?.placeables ?? []) as AnyObject[]).map((token) => token["actor"]),
  ]) {
    const uuid = String(actor?.["uuid"] ?? "");
    if (!actor || !uuid || seen.has(uuid)) continue;

    seen.add(uuid);
    found.push(actor);
  }

  return found;
}

/** The creature this witch currently has hexed, wherever it is. */
function currentlyHexed(witchUuid: string): AnyObject | null {
  if (!witchUuid) return null;

  for (const bearer of bearers()) {
    if (witchesHexing(bearer).includes(witchUuid)) return bearer;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * The bonus
 * ------------------------------------------------------------------ */

/** One labelled modifier, tagged so re-configuring a roll cannot double it. */
interface HexBonus {
  label: string;
  value: number;
  [MODIFIER_TAG]: true;
}

/**
 * What the hexes on this roll's targets are worth, one entry per witch.
 *
 * Deduplicated by witch rather than by target: one witch's hex is one bonus even
 * if a roll somehow reaches her quarry twice. The tier is read live off her
 * sheet, so a level-up applies to a hex already standing.
 */
function hexBonuses(config: AnyObject): HexBonus[] {
  const bonuses: HexBonus[] = [];
  const counted = new Set<string>();

  for (const target of (config["targets"] ?? []) as AnyObject[]) {
    const actorUuid = String(target?.["actorId"] ?? "");
    if (!actorUuid) continue;

    for (const witchUuid of witchesHexing(fromUuidSync(actorUuid))) {
      if (counted.has(witchUuid)) continue;
      counted.add(witchUuid);

      const witch = fromUuidSync(witchUuid) as AnyObject | null;
      const tier = Number(witch?.["system"]?.["tier"] ?? 0);
      if (!Number.isFinite(tier) || tier < 1) continue;

      bonuses.push({
        label: game.i18n.format("EE.Features.Hex.Modifier", {
          witch: String(witch?.["name"] ?? ""),
        }),
        value: tier,
        [MODIFIER_TAG]: true,
      });
    }
  }

  return bonuses;
}

/**
 * Add the bonus to an action roll that is still being configured.
 *
 * Ours are stripped before they are re-added, so a roll rebuilt or re-configured
 * — the reroll paths in `roll-pipeline.ts`, a dialog opened a second time — ends
 * up with one of each rather than two.
 */
function addActionBonus(config: AnyObject): void {
  const roll = config["roll"] as AnyObject | undefined;

  // An evaluated roll: `buildEvaluate` has replaced the config's roll data with
  // the finished result, so this is the damage step carrying the attack's total
  // along with it, not a roll waiting to be built.
  if (!roll || Number.isFinite(roll["total"])) return;

  // "Action rolls." A reaction is not one, which is the same line the system
  // draws when it withholds Hope and Fear from them.
  if (String(config["actionType"] ?? "") === REACTION) return;

  const bonuses = hexBonuses(config);
  const existing = (
    Array.isArray(roll["baseModifiers"]) ? roll["baseModifiers"] : []
  ) as AnyObject[];
  const kept = existing.filter((modifier) => modifier?.[MODIFIER_TAG] !== true);

  if (bonuses.length === 0 && kept.length === existing.length) return;

  roll["baseModifiers"] = [...kept, ...bonuses];
}

/**
 * Add the bonus to a damage roll, as one entry in the system's own Modifiers
 * fieldset.
 *
 * Several hexes collapse into a single tickable entry: the damage is rolled once
 * however many creatures it is aimed at, so offering three checkboxes for one
 * number would suggest a choice the roll cannot express.
 */
function addDamageModifier(config: AnyObject, modifiers: AnyObject): void {
  // Healing is delivered through the same field and the same formula slot. The
  // card says damage.
  if (config["hasHealing"] === true) return;

  const bonuses = hexBonuses(config);
  if (bonuses.length === 0) return;

  const total = bonuses.reduce((sum, bonus) => sum + bonus.value, 0);

  modifiers[MODIFIER_KEY] = {
    label: bonuses.map((bonus) => bonus.label).join(", "),
    enabled: true,
    // The system's own idiom, from its Rally dice: an operator term and the
    // parsed number, appended to the part being built. Deliberately not
    // `beforeCrit` — a flat number is untouched by the critical bonus either
    // way, since that adds the maximum of the roll's *dice*.
    callback: (part: AnyObject): void => {
      part["roll"]["terms"].push(
        new foundry.dice.terms.OperatorTerm({ operator: "+" }),
        ...Roll.parse(String(total)),
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * Casting
 * ------------------------------------------------------------------ */

function sameActor(a: AnyObject | null | undefined, b: AnyObject | null | undefined): boolean {
  const left = String(a?.["uuid"] ?? "");
  return left.length > 0 && left === String(b?.["uuid"] ?? "");
}

/** The mark request describing one hex. */
function request(creatureUuid: string, witch: AnyObject): MarkRequest {
  return {
    kind: "hex",
    actorUuid: creatureUuid,
    sourceUuid: String(witch["uuid"] ?? ""),
    sourceName: String(witch["name"] ?? ""),
  };
}

/**
 * Everyone who might be holding the card, in the order they are asked.
 *
 * Whoever was hurt comes first when they are a character themselves: "you" is the
 * clause with nothing to measure, and they are already looking at their own
 * sheet. Everyone else is drawn from the canvas rather than from `game.actors`,
 * because a character has to be *present* to be within Close range of anything
 * and the distance check needs their token in any case. Sorted by name so two
 * Witches are asked in the same order on every client and from one hit to the
 * next.
 */
function candidateWitches(hurt: AnyObject): AnyObject[] {
  const seen = new Set<string>();
  const others: AnyObject[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor as AnyObject | null;
    if (!actor || actor["type"] !== "character") continue;

    const uuid = String(actor["uuid"] ?? "");
    if (!uuid || uuid === String(hurt["uuid"] ?? "") || seen.has(uuid)) continue;

    seen.add(uuid);
    others.push(actor);
  }

  others.sort((a, b) => String(a["name"] ?? "").localeCompare(String(b["name"] ?? "")));

  return hurt["type"] === "character" ? [hurt, ...others] : others;
}

/**
 * Is `witch` close enough to react to what happened to `hurt`?
 *
 * Deliberately `=== true`: an unmeasurable distance answers null, and this treats
 * that as no.
 */
function inRange(hurt: AnyObject, witch: AnyObject): boolean {
  if (sameActor(hurt, witch)) return true;
  return withinBand(distanceBetweenActors(hurt, witch), BAND) === true;
}

/**
 * The banner form of the event: the creature that did it on the left, whoever it
 * happened to on the right.
 *
 * The verdict carries the number here, unlike the attack windows, because "any
 * number of Hit Points" is the trigger — the witch is entitled to know how bad it
 * was before spending her Stress on it, and it is her ally's sheet, not a figure
 * the GM is withholding.
 */
function headlineFor(attacker: AnyObject, hurt: AnyObject, marks: number): PromptHeadline {
  return {
    source: {
      name: String(attacker["name"] ?? ""),
      img: attacker["img"] ? String(attacker["img"]) : undefined,
    },
    target: {
      name: String(hurt["name"] ?? ""),
      img: hurt["img"] ? String(hurt["img"]) : undefined,
    },
    verdict: game.i18n.format("EE.Features.Hex.Verdict", { marks }),
  };
}

/** Put the question on the witch's screen. Resolves to whether she said yes. */
async function ask(
  witch: AnyObject,
  hurt: AnyObject,
  attacker: AnyObject,
  marks: number,
): Promise<boolean> {
  const card = findGrantingItem(witch, FEATURE_ID, MATCH);
  const standing = currentlyHexed(String(witch["uuid"] ?? ""));

  // Named in the hint rather than raised as a separate confirmation: nothing has
  // been spent yet, so the whole choice fits in one question.
  const replacing =
    standing && !sameActor(standing, attacker)
      ? game.i18n.format("EE.Features.Hex.HintReplace", {
          previous: String(standing["name"] ?? ""),
        })
      : "";

  const prompt: PromptRequest = {
    title: game.i18n.localize("EE.Features.Hex.Title"),
    intro: game.i18n.format(
      sameActor(hurt, witch) ? "EE.Features.Hex.IntroSelf" : "EE.Features.Hex.Intro",
      { attacker: String(attacker["name"] ?? ""), hurt: String(hurt["name"] ?? ""), marks },
    ),
    headline: headlineFor(attacker, hurt, marks),
    offers: [
      {
        id: FEATURE_ID,
        label: game.i18n.localize("EE.Features.Hex.Label"),
        hint:
          game.i18n.format("EE.Features.Hex.Hint", {
            attacker: String(attacker["name"] ?? ""),
            tier: Number(witch["system"]?.["tier"] ?? 0),
          }) + replacing,
        itemName: String(card?.["name"] ?? LABEL),
        img: card?.["img"] ? String(card["img"]) : undefined,
        useLabel: game.i18n.localize("EE.Features.Hex.Cast"),
        skipLabel: game.i18n.localize("EE.Features.Hex.Decline"),
      },
    ],
  };

  const chosen = await askUser(responderFor(witch), prompt);
  return chosen.has(FEATURE_ID);
}

/**
 * Say the hex was cast, and give the GM the way to lift it.
 *
 * Public: the bonus applies to everyone's rolls, so everyone needs to know it is
 * there. The button underneath is drawn on the GM's client only — see
 * {@link decorate}.
 */
async function announce(
  witch: AnyObject,
  creature: AnyObject,
  replaced: AnyObject | null,
): Promise<void> {
  const record = {
    witchUuid: String(witch["uuid"] ?? ""),
    witchName: String(witch["name"] ?? ""),
    creatureUuid: String(creature["uuid"] ?? ""),
    creatureName: String(creature["name"] ?? ""),
  };

  const replacedLine =
    replaced && !sameActor(replaced, creature)
      ? `<p>${game.i18n.format("EE.Features.Hex.AnnounceReplaced", {
          previous: String(replaced["name"] ?? ""),
        })}</p>`
      : "";

  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch }),
      content:
        `<p>${game.i18n.format("EE.Features.Hex.Announce", {
          witch: record.witchName,
          creature: record.creatureName,
        })}</p>` + replacedLine,
      flags: { [MODULE_ID]: { [FLAGS.hexCard]: record } },
    });
  } catch (error) {
    // The hex is already placed; losing the announcement must not undo it.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the hex.`, error);
  }
}

/** Mark the Stress, move the hex, and say so. */
async function cast(witch: AnyObject, creature: AnyObject): Promise<void> {
  await witch["modifyResource"]?.(resourceUpdatesFor(witch, COST));

  const previous = currentlyHexed(String(witch["uuid"] ?? ""));

  // Skipped when it is the same creature: `applyMark` clears before it creates,
  // so re-hexing the same quarry is already a replacement rather than a second
  // effect.
  if (previous && !sameActor(previous, creature)) {
    await unmarkActor(request(String(previous["uuid"] ?? ""), witch));
  }

  await markActor(request(String(creature["uuid"] ?? ""), witch));
  await announce(witch, creature, previous);

  console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} hexed ${creature["name"]}.`);
}

/* ------------------------------------------------------------------ *
 * The trigger
 * ------------------------------------------------------------------ */

/** Drop attributions and questions nobody came back for. */
function sweep(now: number): void {
  for (const [key, entry] of blame) if (now - entry.at > ATTRIBUTION_MS) blame.delete(key);
  for (const [key, at] of asked) if (now - at > ATTRIBUTION_MS) asked.delete(key);
}

/**
 * Write down who is about to hurt whom.
 *
 * Runs on the client applying the damage, which is the same client
 * `postTakeDamage` will fire on — the map never crosses a socket and never
 * outlives the application it describes.
 */
function rememberAttacker(config: AnyObject, targets: AnyObject[] | null, applying: boolean): void {
  if (!enabled() || !applying) return;
  if (config["hasHealing"] === true) return;

  const attacker = String(config["source"]?.["actor"] ?? "");
  if (!attacker) return;

  const now = Date.now();
  sweep(now);

  applications += 1;
  const event = `${now}-${applications}`;

  for (const target of damagedTargets(config, targets)) {
    const uuid = String(target?.["actorId"] ?? "");
    if (uuid) blame.set(uuid, { attacker, event, at: now });
  }
}

/** How many Hit Points this update list marked, or zero. */
function marksHitPoints(updates: unknown): number {
  if (!Array.isArray(updates)) return 0;

  const entry = (updates as AnyObject[]).find(
    (update) => String(update?.["key"] ?? "") === HIT_POINTS,
  );

  // Read as a magnitude rather than a sign: Hit Points are a *reversed* resource
  // and so arrive positive, but nothing here should hardcode that.
  const marks = Math.abs(Number(entry?.["value"] ?? 0));
  return Number.isFinite(marks) ? marks : 0;
}

/**
 * Offer the hex to everyone entitled to cast it.
 *
 * Sequential rather than concurrent, and it does *not* stop at the first yes:
 * each witch spends her own Stress and places her own hex, and the rule gives
 * neither of two precedence over the other.
 */
async function considerHex(hurt: AnyObject, updates: unknown): Promise<void> {
  if (!enabled()) return;

  const marks = marksHitPoints(updates);
  if (marks < 1) return;

  const hurtUuid = String(hurt["uuid"] ?? "");
  const entry = blame.get(hurtUuid);
  if (!entry) {
    console.debug(`${LOG_PREFIX} ${LABEL}: nothing on record for what hurt ${hurt["name"]}.`);
    return;
  }

  blame.delete(hurtUuid);

  const attacker = fromUuidSync(entry.attacker) as AnyObject | null;
  if (!attacker) return;

  // Damage a creature did to itself has no third party to hex.
  if (sameActor(attacker, hurt)) return;

  for (const witch of candidateWitches(hurt)) {
    // "When a creature causes…" — not when you do it yourself.
    if (sameActor(witch, attacker)) continue;
    if (!findGrantingItem(witch, FEATURE_ID, MATCH)) continue;
    if (!canAfford(witch, COST)) continue;

    if (!inRange(hurt, witch)) {
      console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} is not within ${BAND} range.`);
      continue;
    }

    // Claimed before the question is sent, and synchronously: an attack that
    // hurt three people reaches this three times, concurrently, and a witch has
    // to be asked about it once.
    const key = `${entry.event}|${String(witch["uuid"] ?? "")}`;
    if (asked.has(key)) continue;
    asked.set(key, Date.now());

    if (!(await ask(witch, hurt, attacker, marks))) continue;

    // Re-read: the question sat on somebody's screen for up to half a minute,
    // and the Stress may have gone somewhere else in the meantime.
    if (!canAfford(witch, COST)) {
      console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} can no longer mark the Stress.`);
      continue;
    }

    await cast(witch, attacker);
  }
}

/* ------------------------------------------------------------------ *
 * Lifting it
 * ------------------------------------------------------------------ */

/** The name of the system setting holding the GM's Fear. */
function fearSetting(): string {
  return String(CONFIG["DH"]?.SETTINGS?.gameSettings?.Resources?.Fear ?? FEAR_KEY);
}

/** The GM's Fear counter, as the system stores it. */
function currentFear(): number {
  return Number(game.settings.get(DH_ID, fearSetting()) ?? 0);
}

/**
 * Set it.
 *
 * Written straight to the setting rather than through `Actor#modifyResource`:
 * that route wants an actor it has no use for here, and this only ever runs on a
 * GM's client, which is the only client allowed to write a world-scoped setting
 * at all. The system's own `onChange` re-renders its Fear display.
 */
async function setFear(value: number): Promise<void> {
  await game.settings.set(DH_ID, fearSetting(), Math.max(0, value));
}

/**
 * What lifting this witch's hex costs.
 *
 * Read live rather than stored with the hex: "a number of Fear equal to your
 * Spellcast trait" names the trait, not the number it had when the hex was cast.
 */
function priceToLift(witch: AnyObject | null): number {
  const price = Number(witch?.["system"]?.["spellcastModifier"] ?? 0);
  return Number.isFinite(price) && price > 0 ? Math.floor(price) : 0;
}

/** The record on one of our announcement cards, or null. */
function cardRecord(message: AnyObject): AnyObject | null {
  const record = message?.["flags"]?.[MODULE_ID]?.[FLAGS.hexCard];
  return record && typeof record === "object" ? (record as AnyObject) : null;
}

/** Spend the Fear and lift the hex. Runs on the GM's client only. */
async function lift(record: AnyObject): Promise<void> {
  const witch = fromUuidSync(String(record["witchUuid"] ?? "")) as AnyObject | null;
  const creature = fromUuidSync(String(record["creatureUuid"] ?? "")) as AnyObject | null;

  if (!witch || !creature) {
    ui.notifications?.warn(game.i18n.localize("EE.Features.Hex.LiftGone"));
    return;
  }

  // The card can outlive the hex by a whole session: it may have moved to
  // another creature, or been deleted from this one's sheet.
  if (!witchesHexing(creature).includes(String(witch["uuid"] ?? ""))) {
    ui.notifications?.info(
      game.i18n.format("EE.Features.Hex.LiftAlready", {
        creature: String(creature["name"] ?? ""),
      }),
    );
    return;
  }

  const price = priceToLift(witch);
  if (price < 1) {
    ui.notifications?.warn(
      game.i18n.format("EE.Features.Hex.LiftNoTrait", { witch: String(witch["name"] ?? "") }),
    );
    return;
  }

  const fear = currentFear();
  if (fear < price) {
    ui.notifications?.warn(game.i18n.format("EE.Features.Hex.LiftNoFear", { price, fear }));
    return;
  }

  await setFear(fear - price);
  await unmarkActor(request(String(creature["uuid"] ?? ""), witch));

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: creature }),
    content: `<p>${game.i18n.format("EE.Features.Hex.Lifted", {
      creature: String(creature["name"] ?? ""),
      witch: String(witch["name"] ?? ""),
      price,
    })}</p>`,
  });

  console.debug(`${LOG_PREFIX} ${LABEL}: ${price} Fear lifted the hex on ${creature["name"]}.`);
}

/** Marks a card already decorated, so a re-render adds one button and not two. */
const DECORATED = "eeHexDecorated";

/**
 * Hang the GM's control under one of our announcement cards.
 *
 * GM only: the price is the GM's Fear and the decision is the GM's. Appended to
 * the message content rather than anchored to a particular element — this card is
 * ours, two paragraphs of our own words, so there is no system template underneath
 * it to move.
 */
function decorate(message: AnyObject, html: HTMLElement): void {
  if (!game.user?.isGM || !enabled()) return;

  const record = cardRecord(message);
  if (!record) return;

  const host = html.querySelector<HTMLElement>(".message-content") ?? html;
  if (host.dataset[DECORATED]) return;
  host.dataset[DECORATED] = "1";

  const witch = fromUuidSync(String(record["witchUuid"] ?? "")) as AnyObject | null;
  const price = priceToLift(witch);

  // No Spellcast trait, no price the rule can name — and a button that cannot
  // say what it costs is worse than no button.
  if (price < 1) return;

  const row = document.createElement("div");
  row.className = "ee-hex";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ee-hex-button";
  button.dataset["tooltip"] = game.i18n.localize("EE.Features.Hex.LiftTooltip");

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-skull";
  icon.toggleAttribute("inert", true);

  // `textContent`, not markup: the label is ours, but building it as HTML would
  // invite the next person to interpolate a creature's name into it.
  button.append(
    icon,
    document.createTextNode(game.i18n.format("EE.Features.Hex.LiftButton", { price })),
  );

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    button.disabled = true;
    void lift(record)
      .catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not lift the hex.`, error);
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  row.append(button);
  host.append(row);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Wire the feature up. Called once during `init`. */
export function registerHex(): void {
  // The damage bonus rides `config.modifiers` — the list the damage dialog
  // renders and `constructFormula` applies. The wrapper around the builder that
  // fills it is `damage-modifiers.ts`'s; see there for why it is a wrapper and
  // not a hook.
  onDamageModifiers({
    id: FEATURE_ID,
    add: (config, modifiers) => {
      if (enabled()) addDamageModifier(config, modifiers);
    },
  });

  // The first half of the trigger: who is about to hurt whom. Registered here so
  // the feature stays one file; the wrapper itself is `damage-landing.ts`'s.
  onDamageLanding({
    id: FEATURE_ID,
    before: (config, targets, applying) => {
      rememberAttacker(config, targets, applying);
    },
  });

  // The second half: how many Hit Points were really marked, once the system has
  // finished deciding. Never returns `false` — that would cancel the damage.
  Hooks.on("daggerheart.postTakeDamage", (actor: AnyObject, updates: unknown): void => {
    try {
      void considerHex(actor, updates).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not offer the hex.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not offer the hex.`, error);
    }
  });

  // The bonus on an action roll. Must not return `false`: that cancels the roll.
  Hooks.on("daggerheart.preRoll", (config: AnyObject): void => {
    try {
      if (enabled()) addActionBonus(config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not add the roll bonus.`, error);
    }
  });

  Hooks.on("renderChatMessageHTML", (message: AnyObject, html: HTMLElement) => {
    try {
      decorate(message, html);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not decorate a hex card.`, error);
    }
  });
}
