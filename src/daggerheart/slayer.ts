/**
 * **Slayer** (Call of the Slayer, Warrior subclass foundation) — "You gain a pool
 * of dice called Slayer Dice. On a roll with Hope, you can place a d6 on this
 * card instead of gaining a Hope, adding the die to the pool. You can store a
 * number of Slayer Dice equal to your Proficiency. When you make an attack roll
 * or damage roll, you can spend any number of these Slayer Dice, rolling them and
 * adding their result to the roll. At the end of each session, clear any unspent
 * Slayer Dice on this card and gain a Hope per die cleared."
 *
 * `Compendium.daggerheart.subclasses.Item.1hF5KGKQc2VKT5O8`, a `feature` Item the
 * SRD ships as description only — no action, no resource, no automation. Three
 * separate rules live on it, and each one attaches somewhere different:
 *
 * ## 1. Where the pool lives
 *
 * On the card, in the system's own `system.resource` — a `simple` resource with a
 * numeric `max`, an `increasing` progression and a `session` recovery. That is
 * not decoration: it is what puts a counter with a number box on the card's row
 * in the character sheet's Features tab (`item-resource.hbs`), so "place a d6 on
 * this card" is a thing the player can see and, if the table ever needs to fix it
 * by hand, edit. It is also what makes the system's own end-of-session refresh
 * clear the pool, which is the second half of the rule's last sentence.
 *
 * `max` is written as a **literal number** rather than `@prof`. The formula
 * would be the obvious choice, and it is what the two places in the system that
 * reset a resource use — but `item-resource.hbs` resolves the same field through
 * `itemAbleRollParse(max, item.actor, item)`, which, because the third argument
 * is an Item, resolves against the *item's* roll data rather than the actor's.
 * `@prof` is an actor field, so the max on the sheet's number box would silently
 * come out empty. {@link reconcileSlayerCards} keeps the literal in step with a
 * level-up instead, and every rule in this file reads the live proficiency rather
 * than the stored figure regardless.
 *
 * The configuration is **written** to the card rather than derived during data
 * preparation, which is what the other card features in this module do. The
 * reason is a sharp edge in Foundry's schema updates: `resource` is a nullable
 * `SchemaField` with a `required` member (`progression`), and
 * `SchemaField#_updateDiff` validates a nullish field's first write *whole* — so
 * `item.update({"system.resource.value": 1})` against a card that has never held
 * a resource is rejected for the fields it does not mention. A derived object
 * would render the sheet's number box over exactly that condition, and the first
 * player to type into it would get a failed update and no explanation. Writing
 * the complete object once removes the condition instead of tiptoeing around it.
 * {@link writePool} therefore always writes the whole object.
 *
 * ## 2. Taking the die instead of the Hope
 *
 * A registry feature on the `dualityOutcome` window, which is the seam that runs
 * after a Duality roll is evaluated and *before* `dualityUpdate` queues the Hope
 * — see `duality-outcome.ts`. Two things follow from that placement:
 *
 * - The question rides in the same prompt as every other optional feature on that
 *   roll, rather than being a second dialog of its own.
 * - The Hope is declined by folding a `-1` into the roll's own pending resource
 *   update, which the system's `+1` then nets against. One actor write, no race,
 *   and no moment where the player holds a Hope they said they did not want.
 *
 * Because that netting is only correct when the system really is about to grant a
 * Hope, {@link hopeGain} re-checks every condition `addDualityResourceUpdates`
 * checks before the offer is made. Getting that wrong would not fail loudly — it
 * would quietly *take* a Hope.
 *
 * ## 3. Spending them
 *
 * Two dialogs, and the system meets us more than half way in both:
 *
 * - **Damage.** `DamageRoll.temporaryModifierBuilder` builds `config.modifiers`,
 *   which the damage dialog renders as a labelled `<select>` per entry and
 *   `constructFormula` applies through each entry's `callback`. This is the
 *   mechanism behind Bardic Rally and the weapon features, and it fits Slayer
 *   Dice exactly, so the damage half needs no UI of its own at all. The wrapper
 *   around that builder lives in `damage-modifiers.ts`; it was this file's until
 *   Face Your Fear became the second rule wanting a row.
 * - **Attack.** The D20 dialog has no such mechanism — only the free-text
 *   situational bonus, which belongs to the player. So one row is injected into
 *   its Modifiers fieldset on `renderD20RollDialog`, in the same shape as the
 *   trait dropdown beside it, and `D20Roll#applyBaseBonus` is wrapped to turn the
 *   chosen count into an `Nd6` modifier. Going through `applyBaseBonus` rather
 *   than pushing terms directly buys the live formula preview (the dialog
 *   re-derives it on every change) and a labelled entry in the roll's attribution.
 *
 * Both are only *chosen* in the dialog. The dice are not deducted until the roll
 * actually reaches `buildPost`, so a cancelled dialog costs nothing.
 *
 * ## What is not automated
 *
 * - **Critical damage maximises the Slayer dice too.** `constructFormula` adds
 *   the critical bonus from `formulaData.roll.dice` after every modifier callback
 *   has run, so any die added to a damage roll is counted — the system does the
 *   same for a Bardic Rally die. There is no seam that would add dice after that
 *   sum without reimplementing the whole step.
 * - **A Fear result converted to Hope by another feature** does not offer the
 *   die. `offersFor` builds the whole prompt before any of it applies, so
 *   Fearless's rewrite lands after Slayer has already been asked whether it is
 *   interested. It is one prompt or correct composition, and one prompt is worth
 *   more at the table than a card interaction neither Frayne nor most Warriors
 *   can even reach.
 * - **Which dice were spent on what.** They are rolled into the total like any
 *   other bonus dice; the card tracks a count, not identities.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isWriter } from "../utils/is-writer.js";
import { rollingCharacter } from "./attack-action.js";
import { onDamageModifiers } from "./damage-modifiers.js";
import type { DualityOutcomeContext } from "./duality-outcome.js";
import { findGrantingItem, registerFeature, type FeatureMatch } from "./feature-registry.js";
import { registerRollWindow } from "./roll-pipeline.js";

/** Registry id, and the value the `flags.eryndor-essentials.featureId` escape hatch matches. */
const FEATURE_ID = "slayer";

/** Prefix for this feature's console lines. */
const LABEL = "Slayer";

/** How the granting card is recognised — flag, then compendium, then name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.subclasses.Item.1hF5KGKQc2VKT5O8"],
  names: ["Slayer"],
  itemTypes: ["feature"],
};

/** "place a **d6** on this card". */
const DIE = "d6";

/**
 * Where the attack dialog parks the number of dice the player has chosen, and
 * where {@link commitSpend} records that it has already taken them.
 *
 * On `config` rather than on `config.roll`, which `buildEvaluate` replaces
 * wholesale, and deliberately dot-free: roll options pass through `mergeObject`
 * on construction, which would expand a `module-id.key` into a nested object and
 * never read it back. Same reasoning as `roll-pipeline.ts`'s own markers.
 */
const SPEND = "eeSlayerDice";
const SPENT = "eeSlayerSpent";

/**
 * The key this feature's entry takes in `config.modifiers` — the damage dialog's
 * own list. Its `value` is the count the player picked, and `eeSpent` is the
 * matching "already taken" marker.
 */
const MODIFIER = "eeSlayerDice";

/** The world switch. Checked per event, so toggling it is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.slayerDice) === true;
}

/* -------------------------------------------------------------------------- */
/*  The pool                                                                   */
/* -------------------------------------------------------------------------- */

/** The Slayer card this character holds, or null. */
function slayerCard(actor: AnyObject | null | undefined): AnyObject | null {
  if (!actor || actor["type"] !== "character") return null;
  return findGrantingItem(actor, FEATURE_ID, MATCH);
}

/**
 * How many dice this character can store — their Proficiency, read live.
 *
 * Never the stored `resource.max`: that is a display figure kept in step by
 * {@link reconcileSlayerCards}, and a card whose sweep has not run yet since a
 * level-up would otherwise cap the pool at last level's number.
 */
function poolMax(actor: AnyObject): number {
  const proficiency = Number(actor["system"]?.["proficiency"]);
  return Number.isFinite(proficiency) ? Math.max(0, Math.trunc(proficiency)) : 0;
}

/** How many dice are on the card right now. */
function poolValue(item: AnyObject): number {
  const value = Number(item["system"]?.["resource"]?.["value"]);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * The resource configuration the card should carry, minus the count itself.
 *
 * `increasing` + `session` is what tells the system's own refresh to zero this
 * at the end of a session; {@link clearAtSessionEnd} runs first and hands out the
 * Hope, so by the time the system's sweep reaches the card there is nothing left
 * to clear. Keeping both is deliberate — the card describes itself correctly to
 * anything else that reads it, and the two are idempotent in either order.
 */
function resourceShape(max: number): Record<string, string> {
  return {
    type: "simple",
    max: String(max),
    recovery: "session",
    progression: "increasing",
    icon: "fa-solid fa-dice-d6",
  };
}

/**
 * Set the number of dice on the card, clamped into range.
 *
 * Always writes the resource *whole* — see the note at the top of this file on
 * why a partial write into a nullish `SchemaField` is the one shape to avoid, and
 * why writing it all keeps the stored `max` in step with a level-up for free.
 */
async function writePool(item: AnyObject, actor: AnyObject, value: number): Promise<void> {
  const max = poolMax(actor);
  const next = Math.max(0, Math.min(Math.trunc(value), max));
  await item["update"]?.({ "system.resource": { ...resourceShape(max), value: next } });
}

/**
 * Give every Slayer card in the world the resource that shows it on the sheet,
 * and bring its stored `max` back in line with the holder's Proficiency.
 *
 * Called at `ready` and when the setting changes. Writes, so exactly one client
 * does it — {@link isWriter} picks the active GM, the same way every other gated
 * write in this module does.
 *
 * Switching the feature **off** deliberately leaves the counter alone. The dice
 * on it are the player's; turning the automation off should stop the module
 * acting on them, not confiscate them.
 */
export async function reconcileSlayerCards(): Promise<void> {
  if (!isWriter() || !enabled()) return;

  for (const actor of game.actors?.contents ?? []) {
    try {
      const card = slayerCard(actor);
      if (!card) continue;

      const wanted = resourceShape(poolMax(actor));
      const resource = card["system"]?.["resource"] as AnyObject | null | undefined;
      const current = resource
        ? Object.entries(wanted).every(([key, value]) => String(resource[key] ?? "") === value)
        : false;
      if (current) continue;

      await writePool(card, actor, poolValue(card));
      console.debug(`${LOG_PREFIX} ${LABEL}: set up the dice pool on ${actor["name"]}'s card.`);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not set up ${actor["name"]}'s card.`, error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Taking the die instead of the Hope                                         */
/* -------------------------------------------------------------------------- */

/** Whether the world is letting the system hand out Hope and Fear at all. */
function hopeFearAutomationOn(): boolean {
  try {
    const key = CONFIG["DH"]?.["SETTINGS"]?.["gameSettings"]?.["Automation"];
    const id = String(CONFIG["DH"]?.["id"] ?? "daggerheart");
    if (typeof key !== "string") return false;

    // `shouldUseHopeFearAutomation` is called by `addDualityResourceUpdates`
    // with its default `{ gmAsPlayer: true }`, which makes the branch resolve to
    // the players' switch for every user, GM included.
    const automation = game.settings.get(id, key) as AnyObject | undefined;
    return automation?.["hopeFear"]?.["players"] === true;
  } catch (error) {
    // Declining is the safe answer: the offer's whole premise is that a Hope is
    // about to arrive, and taking one back that never came is worse than not
    // offering the die.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not read the Hope/Fear automation setting.`, error);
    return false;
  }
}

/** The Hope one outcome is worth, in the system's own terms. */
function hopeFor(result: AnyObject | undefined): number {
  return result?.["isCritical"] === true || result?.["result"]?.["duality"] === 1 ? 1 : 0;
}

/**
 * How many Hope the system is about to hand this actor for this roll.
 *
 * Mirrors `DualityRoll.addDualityResourceUpdates` condition for condition,
 * because the offer *nets against* what that method queues. Every gate it has is
 * a case where the Hope never arrives — automation off, a reaction roll, an
 * action that skips resources, a downed character — and declining a Hope that was
 * never granted would leave the player a die up and a Hope down.
 *
 * The rerolled branch is the system's own delta arithmetic: a reroll that turned
 * a Fear result into a Hope one grants the difference, and a reroll that kept the
 * same result grants nothing to decline.
 */
function hopeGain(config: AnyObject, actor: AnyObject): number {
  if (!config["source"]?.["actor"]) return 0;
  if (!hopeFearAutomationOn()) return 0;
  if (config["actionType"] === "reaction") return 0;
  if (config["skips"]?.["resources"] === true) return 0;

  const statuses = actor["statuses"] as { has?(id: string): boolean } | undefined;
  if (["dead", "defeated", "unconscious"].some((id) => statuses?.has?.(id) === true)) return 0;

  const roll = config["roll"] as AnyObject | undefined;
  const rerolled = config["rerolledRoll"] as AnyObject | undefined;
  if (rerolled) {
    if (roll?.["result"]?.["duality"] === rerolled["result"]?.["duality"]) return 0;
    return hopeFor(roll) - hopeFor(rerolled);
  }

  return hopeFor(roll);
}

/**
 * Register the offer.
 *
 * **Priority 60** — reactive rather than rewriting. Fearless sits at 10 because
 * it changes what the result *is*; this only reads it.
 *
 * **No `cost`.** The registry's `canAfford` would read a `hope` cost as "the
 * actor must already hold one", and a character at 0 Hope rolling with Hope is
 * exactly the character most likely to want the die. The Hope is declined inside
 * {@link AutomatedFeature.apply} instead, through the same `payCost` the registry
 * would have used — which is the roll's own pending update, so the system's `+1`
 * and this `-1` land as one write that nets to nothing.
 */
function registerGain(): void {
  registerFeature<DualityOutcomeContext>({
    id: FEATURE_ID,
    window: "dualityOutcome",
    priority: 60,
    optional: true,
    match: MATCH,
    labelKey: "EE.Features.Slayer.Label",
    hintKey: "EE.Features.Slayer.Hint",
    // Both buttons take something here, which the generic "use it" / "leave the
    // roll alone" pair gets wrong: declining is not leaving the roll alone, it is
    // taking the Hope. Naming the two outcomes is the whole decision.
    useLabelKey: "EE.Features.Slayer.TakeDie",
    skipLabelKey: "EE.Features.Slayer.TakeHope",

    enabled,

    when: (context, item) => {
      const max = poolMax(context.actor);
      // "You can store a number of Slayer Dice equal to your Proficiency" — a
      // full card has nowhere to put the die, so the question is not asked.
      if (max <= 0 || poolValue(item) >= max) return false;
      return hopeGain(context.config, context.actor) === 1;
    },

    apply: async (context, item) => {
      const held = poolValue(item) + 1;

      context.payCost([{ key: "hope", value: 1 }]);
      await writePool(item, context.actor, held);

      console.debug(
        `${LOG_PREFIX} ${LABEL}: ${context.actor["name"]} took a die instead of the Hope (${held}).`,
      );
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Spending — the attack dialog                                               */
/* -------------------------------------------------------------------------- */

/** The roll types the card calls an attack roll. */
const ATTACK_ROLLS = new Set(["attack", "spellcast"]);

/** How many dice the attack half of a config is holding, as a whole number. */
function attackSpend(config: AnyObject | null | undefined): number {
  const count = Number(config?.[SPEND]);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * Turn a chosen count into a modifier on the roll.
 *
 * `applyBaseBonus` is the list `configureModifiers` rebuilds from scratch on
 * every `constructFormula` — which the dialog calls on every render — so nothing
 * accumulates and the formula preview follows the dropdown. `addModifiers` hands
 * each entry to `formatModifier`, which parses a non-numeric value as a formula,
 * so `"2d6"` arrives as real dice rather than a flat number.
 *
 * Patched on `D20Roll` rather than `DualityRoll`: the latter's own override calls
 * `super.applyBaseBonus()`, so one patch covers both, and a Slayer card on an
 * adversary is not a thing that exists.
 */
function patchAttackModifier(): void {
  const D20Roll = CONFIG["Dice"]?.["daggerheart"]?.["D20Roll"] as AnyObject | undefined;
  const prototype = D20Roll?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["applyBaseBonus"];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: no applyBaseBonus to patch — dice can't be spent on rolls.`);
    return;
  }

  prototype!["applyBaseBonus"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const modifiers = original.apply(this, args);

    try {
      const count = attackSpend(this["options"] as AnyObject | undefined);
      if (count > 0 && Array.isArray(modifiers)) {
        modifiers.push({
          label: game.i18n.localize("EE.Features.Slayer.DiceLabel"),
          value: `${count}${DIE}`,
        });
      }
    } catch (error) {
      // A failure here costs the bonus, not the roll.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not add the dice to the roll.`, error);
    }

    return modifiers;
  };
}

/** The `<span>` + `<select>` pair, in the same shape as the trait row beside it. */
function attackRow(available: number, chosen: number): string {
  const options = [];
  for (let count = 0; count <= available; count += 1) {
    const selected = count === chosen ? " selected" : "";
    // Blank rather than "0", matching the `blank=""` entry every other dropdown
    // in this fieldset opens on — and "0 dice" is a number nobody picked.
    options.push(`<option value="${count}"${selected}>${count === 0 ? "" : count}</option>`);
  }

  return (
    `<span>${escapeHtml(game.i18n.localize("EE.Features.Slayer.DiceLabel"))}</span>` +
    `<select data-ee-slayer name="${SPEND}">${options.join("")}</select>`
  );
}

/**
 * Put the row on the dialog, if this roll is one the card applies to.
 *
 * The dialog re-renders on every form change (`submitOnChange`), which replaces
 * the part's markup — so this runs again each time and reads the count back off
 * `config`, the one object that survives a render.
 *
 * The `change` listener is on the `<select>` itself, which is inside the
 * application's `<form>`. The event reaches this listener at the target before it
 * bubbles to the form's own submit-on-change handler, so `config` already carries
 * the new count by the time the system re-derives the formula preview from it.
 * The field's own name is never read by the system: `updateRollConfiguration`
 * expands the form data and looks only at keys it knows.
 */
function injectAttackRow(app: AnyObject, element: HTMLElement): void {
  if (!enabled()) return;

  const config = app["config"] as AnyObject | false | undefined;
  if (!config || typeof config !== "object") return;
  if (!ATTACK_ROLLS.has(String(config["roll"]?.["type"] ?? ""))) return;

  const actor = app["actor"] as AnyObject | null | undefined;
  const card = slayerCard(actor);
  if (!card || !actor) return;

  const available = Math.min(poolValue(card), poolMax(actor));
  if (available < 1) return;

  // Belt and braces: the dialog holds a count across renders, and a pool that
  // shrank underneath it must not offer dice that are no longer there.
  const chosen = Math.min(attackSpend(config), available);
  config[SPEND] = chosen;

  if (element.querySelector("[data-ee-slayer]")) return;

  const container = element.querySelector(".modifier-container");
  if (!container) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no modifier fieldset on this dialog; nothing offered.`);
    return;
  }

  container.insertAdjacentHTML("beforeend", attackRow(available, chosen));

  const select = container.querySelector<HTMLSelectElement>("[data-ee-slayer]");
  select?.addEventListener("change", () => {
    const count = Number(select.value);
    config[SPEND] = Number.isInteger(count) && count > 0 ? Math.min(count, available) : 0;
  });
}

/* -------------------------------------------------------------------------- */
/*  Spending — the damage dialog                                               */
/* -------------------------------------------------------------------------- */

/** How many dice the damage half of a config is holding, as a whole number. */
function damageSpend(config: AnyObject | null | undefined): number {
  const count = Number(config?.["modifiers"]?.[MODIFIER]?.["value"]);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * Add the entry the damage dialog renders and `constructFormula` applies.
 *
 * The shape is the system's own: `values` makes it a dropdown, and `callback` is
 * run against the damage part once the player has picked something (an entry with
 * a falsy `value` is skipped, which is what makes "no dice" the default).
 *
 * `beforeCrit` is left off, matching the weapon features rather than Bardic Rally
 * — though it changes nothing about the critical bonus either way, since
 * `constructFormula` sums the dice for it after *both* modifier passes have run.
 */
function addDamageModifier(config: AnyObject): void {
  if (!enabled()) return;

  // "adding their result to the roll" means the damage, and `constructFormula`
  // only runs the callbacks for the main damage part in any case — so on a
  // healing action, or one that rolls resources alone, the dropdown would be a
  // control that could not do anything.
  if (config["hasHealing"] === true || !config["damageFormula"]) return;

  const actor = config["data"]?.["parent"] as AnyObject | undefined;
  const card = slayerCard(actor);
  if (!card || !actor) return;

  const modifiers = config["modifiers"] as AnyObject | undefined;
  if (!modifiers) return;

  const available = Math.min(poolValue(card), poolMax(actor));
  if (available < 1) return;

  const values = [];
  for (let count = 1; count <= available; count += 1) values.push({ value: String(count), label: String(count) });

  modifiers[MODIFIER] = {
    label: "EE.Features.Slayer.DiceLabel",
    values,
    value: null,
    callback: (part: AnyObject): void => {
      const count = damageSpend(config);
      if (count < 1) return;

      const OperatorTerm = foundry["dice"]?.["terms"]?.["OperatorTerm"];
      if (typeof OperatorTerm !== "function") {
        console.warn(`${LOG_PREFIX} ${LABEL}: cannot build the dice for this damage roll.`);
        return;
      }

      part["roll"]?.["terms"]?.push(
        new OperatorTerm({ operator: "+" }),
        ...Roll.parse(`${count}${DIE}`, (config["data"] ?? {}) as AnyObject),
      );
    },
  };
}


/* -------------------------------------------------------------------------- */
/*  Taking the dice off the card                                               */
/* -------------------------------------------------------------------------- */

/**
 * Deduct whatever this roll spent, once the roll is real.
 *
 * At `buildPost` rather than in either dialog, because that is the first moment
 * the roll has definitely happened — a dialog the player cancelled never gets
 * here, and neither does one they closed with the window control.
 *
 * The two halves are marked independently, and that matters: `DamageField.execute`
 * spreads the *action's* config into the damage config, so an attack's chosen
 * count travels to the damage roll that follows it. Its "already taken" marker
 * travels with it, which is what stops the same dice being deducted twice.
 *
 * The count itself is never cleared. `DualityRoll#reroll` rebuilds the roll from
 * its options, and a reroll of a roll these dice were spent on should still be
 * carrying them.
 */
async function commitSpend(config: AnyObject): Promise<void> {
  const actor = rollingCharacter(config);
  const card = slayerCard(actor);
  if (!card || !actor) return;

  const attack = config[SPENT] === true ? 0 : attackSpend(config);
  const modifier = config["modifiers"]?.[MODIFIER] as AnyObject | undefined;
  const damage = modifier?.["eeSpent"] === true ? 0 : damageSpend(config);

  const spent = Math.min(attack + damage, poolValue(card));
  if (spent < 1) return;

  // Marked only once the card has actually changed: a write that failed should
  // leave the dice where they are rather than record a deduction that never
  // happened.
  await writePool(card, actor, poolValue(card) - spent);
  if (attack > 0) config[SPENT] = true;
  if (damage > 0 && modifier) modifier["eeSpent"] = true;

  console.debug(
    `${LOG_PREFIX} ${LABEL}: ${actor["name"]} spent ${spent} on this roll; ${poolValue(card)} left.`,
  );
}

/* -------------------------------------------------------------------------- */
/*  End of session                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Clear every card and hand out the Hope.
 *
 * Runs *before* the system's own refresh, so the count is still there to be paid
 * for. The refresh then finds the pools already at zero and its own reset is a
 * no-op — see {@link resourceShape} on why the card keeps declaring `session`
 * recovery anyway.
 *
 * `game.actors` only. A character is a linked actor, and an unlinked token copy
 * of one is a different character's sheet in every way that matters here.
 */
async function clearAtSessionEnd(): Promise<void> {
  if (!enabled() || !game.user?.isGM) return;

  const lines: string[] = [];

  for (const actor of game.actors?.contents ?? []) {
    try {
      const card = slayerCard(actor);
      if (!card) continue;

      const held = poolValue(card);
      if (held < 1) continue;

      await writePool(card, actor, 0);
      await actor["modifyResource"]?.([{ key: "hope", value: held, enabled: true }]);

      lines.push(
        game.i18n.format("EE.Features.Slayer.Cleared", {
          actor: String(actor["name"] ?? ""),
          count: String(held),
        }),
      );
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not clear ${actor["name"]}'s dice.`, error);
    }
  }

  if (lines.length === 0) return;

  try {
    await ChatMessage.create({
      content:
        `<p><strong>${escapeHtml(
          game.i18n.localize("EE.Features.Slayer.SessionTitle"),
        )}</strong></p>` +
        `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    });
  } catch (error) {
    // The Hope has already been handed out; the note is the part that failed.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the end-of-session note.`, error);
  }
}

/**
 * Hook the GM's end-of-session sweep.
 *
 * The system has no "end session" event — the only thing that ends one
 * mechanically is the **Daggerheart** sidebar tab's refresh button with *Session*
 * ticked, which calls the unexported `RefreshFeatures`. What *is* reachable is
 * the class behind that tab (`CONFIG.ui.daggerheartMenu`) and the click handler
 * it names in `DEFAULT_OPTIONS.actions`, which ApplicationV2 copies into an
 * instance's options at construction. Wrapping it before the sidebar is built —
 * `init` is comfortably before that — puts this in front of the refresh without
 * touching how the GM ends a session.
 *
 * Anything but Session is passed straight through: a short rest does not clear
 * Slayer Dice.
 */
function patchSessionRefresh(): void {
  const actions = (CONFIG["ui"]?.["daggerheartMenu"]?.["DEFAULT_OPTIONS"]?.["actions"] ??
    undefined) as AnyObject | undefined;
  const original = actions?.["refreshActors"];
  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no session refresh to hook — dice won't convert to Hope on their own.`,
    );
    return;
  }

  actions!["refreshActors"] = async function (this: AnyObject, ...args: unknown[]): Promise<unknown> {
    try {
      if (this?.["refreshSelections"]?.["session"]?.["selected"] === true) await clearAtSessionEnd();
    } catch (error) {
      // The GM asked for a refresh; a failure of ours must not swallow it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not convert the dice to Hope.`, error);
    }

    return original.apply(this, args);
  };
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Install all four halves.
 *
 * Called from `init`, before `installRollPipeline` — the deduction is a roll
 * window, and the pipeline runs the windows in registration order. Its place in
 * that order costs nothing: it changes no roll and reads nothing another window
 * writes, it only takes the dice off the card.
 */
export function registerSlayer(): void {
  registerGain();
  onDamageModifiers({ id: FEATURE_ID, add: (config) => addDamageModifier(config) });
  patchAttackModifier();
  patchSessionRefresh();

  Hooks.on("renderD20RollDialog", (app: AnyObject, element: HTMLElement) => {
    try {
      injectAttackRow(app, element);
    } catch (error) {
      // A failure here costs the offer, not the roll dialog.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not offer the dice on this roll.`, error);
    }
  });

  registerRollWindow({
    id: "slayerSpend",
    matches: (_roll, config) => attackSpend(config) > 0 || damageSpend(config) > 0,
    run: async (_roll, config) => {
      await commitSpend(config);
    },
  });
}
