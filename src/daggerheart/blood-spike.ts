/**
 * **Blood Spike** (Blood domain, *Void for Daggerheart*) — "Make a Spellcast Roll
 * against a target within Close range. On a success, spend a Hope to deal d8+2
 * magic damage to the target using your Proficiency, and the target marks a
 * Stress. If you have at least 3 Hit Points marked, the damage die is a d10
 * instead."
 *
 * ## What the Void ships, and what it leaves to the player
 *
 * Three actions on one card: an attack named "Blood Spike d8", an identical one
 * named "Blood Spike d10", and an effect action named "Spend Hope" that charges
 * 1 Hope and does nothing else. Between them they cover the rule, but the player
 * has to apply the two conditions by hand every time — count their marked Hit
 * Points to pick the right button, and remember to press the third one after a
 * hit but not after a miss.
 *
 * Both attack actions already carry the Stress: their `damage.resources.stress`
 * part is a flat `1`, and `DamageField.applyDamage` only applies to targets whose
 * `hitResult.success` is true. So "the target marks a Stress **on a success**" is
 * native, and nothing here has to implement it — which is also why declining the
 * Hope can leave it standing.
 *
 * That leaves exactly two things for this module, and it does them in two places:
 *
 * 1. **Which die.** At the damage roll's `daggerheart.preRoll`, the die the
 *    pressed action declares is swapped for the one the character's marked Hit
 *    Points call for — in *either* direction. This is why the automation attaches
 *    to both attack actions rather than picking one: whichever button is pressed,
 *    the rule decides the die, so the two stop being a choice the player can get
 *    wrong.
 * 2. **Whether the Hope is spent.** That has to be asked after the roll lands and
 *    before the damage is rolled, which is a seam the system's own hooks cannot
 *    provide — every one of them is a synchronous `Hooks.call`. The window in
 *    `roll-pipeline.ts` is async and sits in exactly the right place; see below.
 *
 * ## Why the question is asked from the roll pipeline
 *
 * `DHBaseAction#executeWorkflow` runs its steps in `order`: roll (10), damage
 * (20), target (20), applyDamage (75), … cost (150). `config.roll.success` is
 * populated during the roll step, by `D20Roll.buildEvaluate`. So the only moment
 * at which the answer is *knowable* and the damage has not yet been rolled is
 * inside the roll step — which is precisely where `DHRoll.buildPost` sits, and
 * where `roll-pipeline.ts` already holds a window open for `dualityOutcome`.
 *
 * A Blood Spike cast is a character's Duality roll, so both windows can fire on
 * the same roll (Fearless converting a Fear result, this one asking about the
 * Hope). They compose: the conversion changes the Hope/Fear result, never the
 * total, so the success this window reads is the same either way.
 *
 * ## Why the Hope is folded into `config.resourceUpdates`
 *
 * The same reasoning as `duality-outcome.ts`: the roll is about to queue its own
 * +1 Hope (on a Hope result) into that map, and `DHBaseAction#use` flushes it
 * once when the workflow ends. Paying separately would race that single write —
 * and on a Hope result the two entries correctly cancel to a net zero rather than
 * writing the resource twice.
 *
 * ## Deliberate silences
 *
 * - **A miss raises nothing.** The card's Hope is spent on a success only, and
 *   the damage the system rolls anyway is never applied — that is how every
 *   attack in the system behaves.
 * - **No hit target raises nothing.** `config.roll.success` can be true off a
 *   plain difficulty with nothing targeted, but then there is no one to damage
 *   and no one to mark Stress, so spending a Hope would buy nothing. The die is
 *   still corrected, which is what the card's own "Spend Hope" action is left in
 *   place for: an untargeted cast resolved by hand still gets the right dice.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, FLAGS } from "../constants.js";
import { chooseOffers, type PromptHeadline, type PromptParty } from "./feature-prompt.js";
import { chargeCosts } from "./feature-registry.js";
import { registerRollWindow, rollTypeOf, showDiceEarly } from "./roll-pipeline.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const BLOOD_SPIKE_SOURCE = "Compendium.the-void-unofficial.domains.Item.pg4tkHr8WpfDrs17";

/** Printed name, as the fallback match for a hand-copied card. */
const BLOOD_SPIKE_NAME = "Blood Spike";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "bloodSpike";

/** `CONFIG.DH.GENERAL.rollTypes.spellcast.id` — what the card's attacks roll. */
const SPELLCAST = "spellcast";

/** The resources involved: one paid, one read. */
const HOPE = "hope";
const HIT_POINTS = "hitPoints";

/** What the card charges on a success. */
const HOPE_COST = 1;

/** Marked Hit Points at which the damage die steps up. */
const ESCALATION_MARKS = 3;

/**
 * The two dice the card prints. Both are held here rather than reading the base
 * one off whichever action was pressed: the Void ships a "d8" action *and* a
 * "d10" action, so the action's own die says which button was clicked, not what
 * the rule calls for. Taking the base from the action would leave a d10 press
 * below the threshold rolling a d10 — the exact mistake this exists to remove.
 */
const BASE_DIE = "d8";
const ESCALATED_DIE = "d10";

/**
 * Where the player's answer is parked so the damage roll can read it: `true` if
 * the Hope is being spent, `false` if it isn't. Absent means "this window did not
 * act", which the damage hook treats as "leave the damage alone".
 *
 * Deliberately dot-free, for the same reason as `roll-pipeline.ts`'s markers:
 * Foundry's object helpers treat a dot in a key as a path, and roll options pass
 * through `mergeObject` on construction. It reaches the damage roll because
 * `DamageField.execute` builds its config as `{ dialog: {}, ...config, … }`.
 */
const DECISION = "eeBloodSpikeHope";

/** The `id` of the single offer in the prompt. */
const OFFER_ID = "bloodSpike";

/** One resolved Blood Spike attack: the actor, the card, and the action used. */
interface BloodSpikeUse {
  actor: AnyObject;
  item: AnyObject;
  action: AnyObject;
}

/** Is this the Blood Spike card? Flag first, then compendium, then printed name. */
function isBloodSpike(item: AnyObject | null | undefined): boolean {
  if (!item) return false;

  // The homebrew escape hatch the feature registry uses, honoured here for the
  // same reason: a table that rewrote the card should still get the automation.
  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (String(item["_stats"]?.["compendiumSource"] ?? "") === BLOOD_SPIKE_SOURCE) return true;

  return String(item["name"] ?? "").trim().toLowerCase() === BLOOD_SPIKE_NAME.toLowerCase();
}

/**
 * Resolve a roll config back to the Blood Spike attack that produced it, or null.
 *
 * `config.source` carries the actor's uuid and the *ids* of the item and action,
 * which is what both the attack roll's config and the damage roll's config are
 * stamped with — so one function serves both hooks. Matched on the action's
 * `type` rather than its name: the Void names them "Blood Spike d8" and "Blood
 * Spike d10", and a table that trims the card to a single action should keep
 * working whatever they call it.
 */
function bloodSpikeUse(config: AnyObject | null | undefined): BloodSpikeUse | null {
  const source = config?.["source"];
  const actorUuid = String(source?.["actor"] ?? "");
  if (!actorUuid) return null;

  const actor = fromUuidSync(actorUuid) as AnyObject | null;
  const item = actor?.["items"]?.get?.(String(source?.["item"] ?? "")) as AnyObject | undefined;
  if (!isBloodSpike(item)) return null;

  // `item.system.actions` is the collection `DHBaseAction#item` itself reads back
  // through, so `.get` is the supported way in.
  const action = item?.["system"]?.["actions"]?.get?.(String(source?.["action"] ?? "")) as
    | AnyObject
    | undefined;
  if (!action || String(action["type"] ?? "") !== "attack") return null;

  return { actor: actor as AnyObject, item: item as AnyObject, action };
}

/** How many Hit Points the character has marked. */
function marksOn(actor: AnyObject): number {
  // Hit Points are a *reversed* resource: `value` counts marks used, not left.
  const marked = Number(actor["system"]?.["resources"]?.[HIT_POINTS]?.["value"]);
  return Number.isFinite(marked) ? marked : 0;
}

/** How much Hope the character is holding. */
function hopeOn(actor: AnyObject): number {
  const held = Number(actor["system"]?.["resources"]?.[HOPE]?.["value"]);
  return Number.isFinite(held) ? held : 0;
}

/** The die this cast should roll, whichever of the card's buttons was pressed. */
function dieFor(actor: AnyObject): string {
  return marksOn(actor) >= ESCALATION_MARKS ? ESCALATED_DIE : BASE_DIE;
}

/** Everyone the spellcast roll landed on, as the prompt needs them. */
function hitTargets(config: AnyObject): PromptParty[] {
  const targets = (config["targets"] ?? []) as AnyObject[];
  return targets
    .filter((target) => target["hit"] === true)
    .map((target) => ({
      name: String(target["name"] ?? ""),
      img: target["img"] ? String(target["img"]) : undefined,
    }));
}

/**
 * The banner form of "it hit": caster, verdict, target.
 *
 * Only when exactly one target was hit — two portraits cannot honestly depict a
 * spike that landed on three people, and that case falls back to the prompt's
 * `intro` sentence, which lists them all. Same rule, and same reasoning, as
 * `adversary-attack.ts`.
 */
function headlineFor(actor: AnyObject, hits: PromptParty[], isCritical: boolean): PromptHeadline | undefined {
  const target = hits.length === 1 ? hits[0] : undefined;
  if (!target) return undefined;

  return {
    source: { name: String(actor["name"] ?? ""), img: actor["img"] ? String(actor["img"]) : undefined },
    target,
    verdict: game.i18n.localize(
      isCritical ? "EE.Features.VerdictCritical" : "EE.Features.VerdictHit",
    ),
  };
}

/**
 * Ask whether to spend the Hope, and record the answer for the damage roll.
 *
 * Returns once the answer is settled and the rest of the action workflow can run
 * against it.
 */
async function runBloodSpikeWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  if (game.settings.get(MODULE_ID, SETTINGS.bloodSpikeSpendHope) !== true) return;

  const use = bloodSpikeUse(config);
  if (!use) return;

  // Only populated when the roll had targets or a set difficulty. Without a
  // success there is nothing to spend a Hope on — see the header note.
  if (config["roll"]?.["success"] !== true) return;

  const hits = hitTargets(config);
  if (hits.length === 0) {
    console.debug(`${LOG_PREFIX} Blood Spike: succeeded with no target hit; nothing to offer.`);
    return;
  }

  const { actor, item } = use;

  // Unaffordable is recorded as a decision, not skipped: the spike still lands
  // and still marks the Stress, and the damage has to be held back for it.
  if (hopeOn(actor) < HOPE_COST) {
    config[DECISION] = false;
    ui.notifications?.info(game.i18n.localize("EE.Features.BloodSpike.NoHope"));
    return;
  }

  // The player has to watch the spellcast land before being asked to pay for it.
  await showDiceEarly(roll, config);

  const marked = marksOn(actor);
  const escalated = marked >= ESCALATION_MARKS;
  const chosen = await chooseOffers({
    title: game.i18n.localize("EE.Features.BloodSpike.Title"),
    intro: game.i18n.format("EE.Features.BloodSpike.Intro", {
      targets: hits.map((hit) => hit.name).join(", "),
    }),
    headline: headlineFor(actor, hits, roll["isCritical"] === true),
    offers: [
      {
        id: OFFER_ID,
        label: game.i18n.localize("EE.Features.BloodSpike.Label"),
        hint: game.i18n.format(
          escalated ? "EE.Features.BloodSpike.HintEscalated" : "EE.Features.BloodSpike.Hint",
          { die: dieFor(actor), marks: marked },
        ),
        itemName: String(item["name"] ?? BLOOD_SPIKE_NAME),
        img: item["img"] ? String(item["img"]) : undefined,
      },
    ],
  });

  const spend = chosen.has(OFFER_ID);
  config[DECISION] = spend;
  if (spend) chargeCosts(actor, config, [{ key: HOPE, value: HOPE_COST }]);
}

/**
 * Apply both halves of the rule to the damage roll: the die the marked Hit Points
 * call for, and — when the Hope was declined — no damage at all.
 *
 * `daggerheart.preRoll` fires at the top of `DHRoll.buildConfigure` for every
 * roll, damage rolls included (`DamageRoll` inherits `buildConfigure` and adds no
 * hook suffix of its own), and a damage roll is the one carrying a
 * `damageFormula`. At this point that is still the plain
 * `{ formula, damageTypes, applyTo }` object `DamageField.formatFormulas`
 * produced, before the dialog and before `constructFormula` adds any bonuses —
 * which is what makes both edits safe.
 */
function registerBloodSpikeDamage(): void {
  Hooks.on("daggerheart.preRoll", (config: AnyObject) => {
    try {
      // Cheapest and most selective check first: this hook sees every roll the
      // system makes, and only damage rolls carry a `damageFormula`.
      const formula = config?.["damageFormula"];
      if (!formula) return;

      if (game.settings.get(MODULE_ID, SETTINGS.bloodSpikeSpendHope) !== true) return;

      const use = bloodSpikeUse(config);
      if (!use) return;

      // Declined, or unaffordable. The Stress lives in `resourceFormulas`, which
      // is untouched, so the spike still marks it — `Actor#takeDamage` handles a
      // null `main` and applies the resource updates on their own.
      if (config[DECISION] === false) {
        config["damageFormula"] = null;
        // Nothing left to configure but a flat 1 Stress, so don't make the player
        // dismiss a dialog for it. `applyKeybindings` uses `??=`, so this sticks.
        config["dialog"] ??= {};
        config["dialog"]["configure"] = false;
        return;
      }

      swapDie(use, formula);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Blood Spike: could not adjust the damage roll.`, error);
    }
  });
}

/**
 * Replace the die the pressed action declares with the one the rule calls for.
 *
 * A string edit rather than a rebuilt formula, deliberately: `formatFormulas` has
 * already resolved `@prof` and merged same-typed parts, and re-deriving all of
 * that to change one denomination would be a second implementation of it that
 * could drift. The edit is safe because the formula at this point contains
 * nothing but this action's own damage — bonuses join later, in
 * `constructFormula` — so the action's declared die is the only occurrence of it.
 * The lookahead is what stops a `d1` pattern from eating the `0` of a `d10`.
 */
function swapDie(use: BloodSpikeUse, formula: AnyObject): void {
  const declared = String(use.action["damage"]?.["main"]?.["value"]?.["dice"] ?? "");
  // A `dice` field is one of `CONFIG.DH.GENERAL.diceTypes`; anything else is a
  // shape this doesn't recognise and must not build a pattern out of.
  if (!/^d\d+$/.test(declared)) return;

  const wanted = dieFor(use.actor);
  if (declared === wanted) return;

  const text = String(formula["formula"] ?? "");
  const swapped = text.replace(new RegExp(`${declared}(?![0-9])`, "g"), wanted);
  if (swapped === text) {
    console.debug(`${LOG_PREFIX} Blood Spike: no ${declared} in "${text}"; leaving it alone.`);
    return;
  }

  formula["formula"] = swapped;
  console.debug(`${LOG_PREFIX} Blood Spike: ${declared} → ${wanted} (${swapped}).`);
}

/**
 * Install the window and the damage hook.
 *
 * Registered after `dualityOutcome`, which matters: both windows can fire on the
 * same roll, and the one that *rewrites* the Hope/Fear result should have settled
 * before the one that merely reads whether the roll succeeded.
 */
export function registerBloodSpike(): void {
  registerRollWindow({
    id: "bloodSpike",
    // Cheap and total: `rollTypeOf` reads the type captured at `preRoll`, before
    // the system overwrites it. Everything else is established in `run`.
    matches: (_roll, config) => rollTypeOf(config) === SPELLCAST,
    run: async (roll, config) => {
      await runBloodSpikeWindow(roll, config);
    },
  });

  registerBloodSpikeDamage();
}
