/**
 * **Not This Time** (Wizard, SRD p.25) — "Spend 3 Hope to force an adversary
 * within Far range to reroll an attack or damage roll."
 *
 * `Compendium.daggerheart.classes.Item.h3VE0jhcM5xHKBs4`, a `feature` Item
 * carrying one action, "Spend Hope", of type `effect` with a 3-Hope cost, range
 * `far`, and no effects at all. So the card can be pressed, and pressing it does
 * exactly one thing: takes the Hope. Nothing rerolls. The player pays, and the
 * GM has to remember to throw the dice again by hand — after the chat card has
 * posted, and often after the damage has already been applied.
 *
 * That card is left alone; it stays the manual route, exactly as Blood Maledict's
 * does. What this file adds is the reaction at the moment the rule is written
 * for.
 *
 * ## Two windows, one rule
 *
 * "An attack or damage roll" is two seams, because the system rolls them
 * separately and posts them separately:
 *
 * - the **attack**, on `adversaryAttack` — the same window Blood Maledict uses,
 *   which runs after the d20 is evaluated but before the chat card exists and
 *   before `TargetField.execute` turns the total into each target's `hitResult`;
 * - the **damage**, on `adversaryDamage` — a window built for this card, which
 *   runs after the damage dice have been thrown and animated but before the card
 *   is written and before `DamageField.applyDamage` reads a total.
 *
 * They are two registrations of one feature, sharing an id, a price, a setting
 * and a card. Nothing has to decide which one the player meant: an attack roll
 * and a damage roll arrive at different moments, and each offers itself when it
 * is the one on the table.
 *
 * ## The reroll is plain
 *
 * The card says "reroll", not "reroll with disadvantage" — so the attack half
 * asks for `forceReroll` rather than Blood Maledict's
 * `forceRerollWithDisadvantage`, and the rebuilt roll keeps whatever advantage or
 * disadvantage the adversary already had. Forcing an adversary to roll again is
 * not the same as making the roll worse, and this card only does the first.
 *
 * ## Four readings, and what each one costs if it is wrong
 *
 * - **"Within Far range"** is read as *the adversary being within Far range of
 *   you*, the standard shape for a reaction: the trigger is something happening
 *   near you. The other parse — the attack being made at Far range — is not
 *   checkable, since the roll does not record its own band. Same choice, and the
 *   same reasoning, as Blood Maledict's "within Close range".
 * - **"An adversary"** is enforced here rather than in either window, because it
 *   is this card's wording. An environment that attacks is not what it reacts to.
 *   `i-see-it-coming.ts` says "an attack" and so accepts environments; the
 *   difference between the two cards is the difference between the two lines.
 * - **You need not be the target.** The rule is conditioned on an adversary
 *   rolling, not on you being hit — so this fires when the blow is aimed at
 *   somebody else standing next to you, which is most of what makes it worth 3
 *   Hope.
 * - **The attack half still only opens on a hit**, because the window does: it
 *   declines when `config.roll.success` is not true. Strictly the card would let
 *   you reroll a miss. Nobody would, and the reading errs the safe way — a reroll
 *   of a missed attack can only turn it into a hit.
 *
 * ## Why it declines once a reroll is already asked for
 *
 * A character can hold this and Blood Maledict at once, and on a Close-range hit
 * both would be offered: two boxes on one prompt, buying the same single reroll
 * for 3 Hope each. Both features gate on `rerollRequested`, and both windows
 * re-check every ticked box against the context the ones before it left behind
 * (`stillOffered`), so the second is never charged for.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import type { AdversaryAttackContext } from "./adversary-attack.js";
import type { AdversaryDamageContext } from "./adversary-damage.js";
import { registerFeature, type FeatureCost, type FeatureMatch } from "./feature-registry.js";

/** Stable id. Shared by both registrations: this is one card, not two. */
const FEATURE_ID = "notThisTime";

/** The SRD Item this comes from — matched ahead of the printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.classes.Item.h3VE0jhcM5xHKBs4"],
  names: ["Not This Time"],
};

/** What the card charges, read off its own action's `cost`. */
const COST: readonly FeatureCost[] = [{ key: "hope", value: 3 }];

/**
 * Priority 10: this *replaces* the roll, so it sorts ahead of anything that
 * merely reads the outcome, which starts at 50. Level with Blood Maledict, whose
 * effect is the same kind of thing — and between two features that both stop at
 * the first reroll requested, the tie is decided by registration order and there
 * is nothing for it to decide.
 */
const REWRITE_PRIORITY = 10;

/** The world switch, read per event so toggling it is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.notThisTimeReroll) === true;
}

/** The printed rule's own conditions, over whichever window is asking. */
function triggers(context: AdversaryAttackContext | AdversaryDamageContext): boolean {
  return (
    !context.rerollRequested &&
    context.attacker["type"] === "adversary" &&
    context.within("far")
  );
}

export function registerNotThisTime(): void {
  registerFeature<AdversaryAttackContext>({
    id: FEATURE_ID,
    window: "adversaryAttack",
    priority: REWRITE_PRIORITY,
    optional: true,
    match: MATCH,
    labelKey: "EE.Features.NotThisTime.Label",
    hintKey: "EE.Features.NotThisTime.AttackHint",
    cost: COST,

    enabled,
    when: triggers,
    apply: (context) => context.forceReroll(),
  });

  registerFeature<AdversaryDamageContext>({
    id: FEATURE_ID,
    window: "adversaryDamage",
    priority: REWRITE_PRIORITY,
    optional: true,
    match: MATCH,
    labelKey: "EE.Features.NotThisTime.Label",
    // The only thing that differs between the two registrations, and it has to:
    // the hint is the sentence a player reads while deciding, and "reroll this
    // attack" and "reroll this damage" are different decisions.
    hintKey: "EE.Features.NotThisTime.DamageHint",
    cost: COST,

    enabled,
    when: triggers,
    apply: (context) => context.forceReroll(),
  });
}
