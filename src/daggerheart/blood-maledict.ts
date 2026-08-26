/**
 * **Blood Maledict** (Blood Hunter class, *Void for Daggerheart*) — "Spend 3 Hope
 * when an adversary succeeds on an attack roll within Close range to make them
 * reroll with disadvantage."
 *
 * The Void ships this as a `feature` Item carrying one action, and that action
 * does exactly one thing: charge 3 Hope. It has no effects and no triggers, so
 * nothing forces the reroll — the player pays the Hope and the GM then has to
 * remember to reroll the adversary's attack by hand, at disadvantage, after the
 * card has already posted and possibly after the damage has been applied.
 *
 * Registered on the `adversaryAttack` window, which runs before the chat card
 * exists and before `TargetField.execute` turns the roll into hits: see
 * `adversary-attack.ts` for why that ordering means the original attack never
 * has to be walked back.
 *
 * ## The two readings of "within Close range"
 *
 * The sentence can be parsed as *the adversary* being within Close range of you,
 * or as *the attack* being made at Close range. This takes the first, which is the
 * standard shape for a reaction — the trigger is something happening near you —
 * and it is the only one that can be checked, since the attack's own range band
 * isn't recorded on the roll. It also means the reaction fires when the adversary
 * hits *someone else* nearby, which is what the rule says: it is conditioned on an
 * adversary succeeding, not on you being the target.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import type { AdversaryAttackContext } from "./adversary-attack.js";
import { registerFeature } from "./feature-registry.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const BLOOD_MALEDICT_SOURCE = "Compendium.the-void-unofficial.classes.Item.gugHbXBWP24CFTJZ";

/**
 * Priority 10: Blood Maledict *replaces* the roll, so it sorts ahead of anything
 * that merely reads the outcome. Reactive features belong at 50+.
 */
const REWRITE_PRIORITY = 10;

export function registerBloodMaledict(): void {
  registerFeature<AdversaryAttackContext>({
    id: "bloodMaledict",
    window: "adversaryAttack",
    priority: REWRITE_PRIORITY,
    optional: true,
    match: {
      compendiumSources: [BLOOD_MALEDICT_SOURCE],
      names: ["Blood Maledict"],
    },
    labelKey: "EE.Features.BloodMaledict.Label",
    hintKey: "EE.Features.BloodMaledict.Hint",
    cost: [{ key: "hope", value: 3 }],

    enabled: () => game.settings.get(MODULE_ID, SETTINGS.bloodMaledictReroll) === true,

    // The window has already established that the attack succeeded; what is left
    // is the printed rule's own two conditions. `attacker.type` is checked here
    // rather than in the window because "adversary" is this card's wording — an
    // environment making an attack roll is not what it reacts to.
    //
    // The third condition is not the card's. Not This Time forces a reroll of the
    // same attack for the same 3 Hope, and a character holding both would be
    // offered two boxes buying one thing; declining once a reroll has been asked
    // for is what stops the second box being charged for.
    when: (context) =>
      !context.rerollRequested &&
      context.attacker["type"] === "adversary" &&
      context.within("close"),

    apply: (context) => context.forceRerollWithDisadvantage(),
  });
}
