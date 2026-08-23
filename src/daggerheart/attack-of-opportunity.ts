/**
 * **Attack of Opportunity** (Warrior class feature, SRD p.23) — "If an adversary
 * within Melee range attempts to leave that range, make a reaction roll using a
 * trait of your choice against their Difficulty. Choose one effect on a success,
 * or two if you critically succeed: they can't move from where they are; you deal
 * damage to them equal to your primary weapon's damage; you move with them."
 *
 * ## Why the trigger is a button and not the trigger
 *
 * The printed trigger is a movement — an adversary leaving Melee range — and this
 * table does not play that way. Tokens exist, but they are invisible to players
 * and the GM shuffles them about to express positioning rather than to move a
 * creature *in the fiction*. Watching `updateToken` would therefore fire this on
 * housekeeping, which is exactly the wrong failure: a reaction that goes off when
 * nobody reacted is worse than one that has to be pressed.
 *
 * So the card gets a button, and the player presses it when the fiction says to.
 * Everything *after* that is automated, because everything after that is
 * mechanical: the roll, the trait, the comparison against Difficulty, how many
 * effects the result buys, and the damage if damage is one of them.
 *
 * ## What the system already does, once the action exists
 *
 * More than it looks, which is why this file is mostly about *building the right
 * action* rather than about running the rule.
 *
 * - **The reaction roll** is `actionType: "reaction"` on an ordinary action. The
 *   system reads that in four places — no Hope or Fear is gained
 *   (`addDualityResourceUpdates`), no countdown advances (`dualityUpdate`), a
 *   reroll does not settle up either (`DualityRoll#reroll`), and the card is
 *   titled "Reaction Roll" rather than "Duality Roll". Nothing here re-implements
 *   any of that.
 * - **"A trait of your choice"** is the `<select name="trait">` the system's own
 *   roll dialog already renders for any character Duality roll that isn't `lite`
 *   — `D20RollDialog#_prepareContext` fills `abilities` from
 *   `getTraitModifiers()`, and `updateRollConfiguration` writes the answer to
 *   `config.roll.trait`. Declaring `roll.type: "trait"` is most of it; the rest
 *   is {@link prepareRoll}, which forces that dialog open (a world with the
 *   system's roll automation on would otherwise skip the only place the choice
 *   lives) and opens the dropdown on the character's **highest** trait. The
 *   action can only declare a fixed one, and `DHActionRollData#rollTrait` falls
 *   back to `agility` for a feature Item with no `system.attack` to read — the
 *   same wrong answer for everybody. It is still a dropdown; this decides only
 *   where it starts.
 * - **"Against their Difficulty"** is `D20Roll.buildEvaluate`, which scores each
 *   target on `config.roll.difficulty ?? target.difficulty ?? target.evasion`.
 *   An adversary carries `system.difficulty`, so declaring no difficulty on the
 *   action is what makes it read the target's — and a *character* targeted by
 *   mistake falls through to Evasion rather than to nothing.
 * - **Picking the target** is `daggerheart-target-helper`, which raises its picker
 *   from `daggerheart.preUseAction` for any action with `config.hasTarget` and a
 *   non-`self` target type. Declaring `target: { type: "any", amount: 1 }` is what
 *   opts in.
 *
 * `target.type` is deliberately `any` rather than `hostile`, even though the card
 * says *adversary*. `TargetField.isTargetFriendly` reads dispositions
 * (`actorDisposition + targetDisposition === 0`), so a hostile filter quietly
 * offers nobody when the GM's tokens sit at neutral — which, on a battle map that
 * exists only for range, they routinely do. A filter that fails closed would take
 * the feature away in exactly the situation it is for.
 *
 * ## The two questions this file actually answers
 *
 * **Which effects.** Raised after the roll from `daggerheart.postUseAction`, as
 * a `chooseUpTo` with the card's three clauses and `max` of one, or two on a
 * critical. No timeout: the roll has already been made and posted, so nothing is
 * being held back, and expiring the question would throw away a choice the player
 * cannot make again. Only asked on a success — a failed reaction buys nothing,
 * and the chat card already says so.
 *
 * **The damage, if they take it.** "Equal to your primary weapon's damage" is the
 * weapon's own damage step, run with the attack roll skipped: the reaction roll
 * already decided this, and rolling to hit again would be a second chance to miss.
 * `attack.prepareConfig(event, { hasRoll: false })` produces a config the system's
 * own `DHDamageAction` shape already supports (a damage action has no roll field
 * at all), and `workflow.get("damage").execute(config, null, true)` is the same
 * call the chat card's own **Roll Damage** button makes. `force` is set for a
 * reason: without it a world whose damage automation is *never* would silently do
 * nothing, and unlike an attack there is no card here with a damage button to fall
 * back to.
 *
 * The targets are then carried across from the reaction roll and marked hit, which
 * is not a convenience but the rule: the effect is *chosen on a success*, so the
 * blow lands by definition. Applying it is left to `applyDamage` **unforced**, so
 * whether the numbers move on their own or wait for the GM to press Apply stays
 * the world's answer, as it is for every other attack.
 *
 * ## Why the action is derived rather than written to the card
 *
 * Same seam and the same reasoning as `reach.ts`, `companion.ts` and
 * `close-knit.ts`: injected into `item.system.actions` during data preparation,
 * nothing written to the database, so the rule un-applies itself the moment the
 * setting or the module goes away. Its `_id` is fixed so a card pressed twice is
 * the same action, and exactly sixteen alphanumeric characters because that is
 * what `DocumentIdField` accepts.
 *
 * It is registered **before** `registerReach()`, which is the one ordering that
 * matters. These patches nest, so the one installed first runs innermost: putting
 * this one under Reach's means the injected action is already in
 * `system.actions` when Reach walks them, and a Giant Warrior's Attack of
 * Opportunity reaches Very Close like everything else they own. Registered after
 * Reach it would be added too late to be promoted, and the one action on the sheet
 * still printing *Melee* would be the one whose whole trigger is a range.
 *
 * ## What is not automated
 *
 * **The trigger.** See above — this is the deliberate part.
 *
 * **"They can't move" and "you move with them"** are announced and nothing else.
 * Both are statements about the map, and this table's map is the GM's to move;
 * a module dragging tokens on a player's behalf would be worse than a line in
 * chat saying what was chosen.
 *
 * **Range is not checked.** The card says *within Melee range* and the action
 * declares `melee`, which is what the Target Helper's picker marks its rows
 * against — but nothing here refuses a press. At a table whose tokens are
 * positioned by hand and hidden from players, the map is a sketch of the fiction
 * rather than the fiction, and a hard gate would be enforcing the sketch.
 *
 * **A weapon whose damage changes on a Fear result** rolls its base value:
 * `DamageField.getFormulaValue` reads `config.roll.result.duality`, and the config
 * built here has no roll on it because there was no attack roll. Passing the
 * *reaction* roll's result would mean handing the damage card a half-formed roll
 * to render.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { chooseUpTo, type PromptChoice } from "./feature-prompt.js";

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "attackOfOpportunity";

/** For console lines. The printed card name, in the book's capitalisation. */
const LABEL = "Attack of Opportunity";

/** The SRD Item this comes from — matched ahead of the printed name. */
const COMPENDIUM_SOURCE = "Compendium.daggerheart.classes.Item.3hNVqD1c0VIw2Nj5";

/**
 * Fallback identification, lower-cased for comparison. The compendium prints it
 * as "Attack Of Opportunity"; the book does not. Comparing case-insensitively is
 * what lets one constant cover both.
 */
const PRINTED_NAME = "attack of opportunity";

/** Fixed action id. Sixteen alphanumeric characters — see the header. */
const ACTION_ID = "eeAttackOfOpp001";

/** `CONFIG.DH.GENERAL.range.melee.id` — the range the card is about. */
const MELEE = "melee";

/**
 * The card's three clauses, in printed order.
 *
 * Ids rather than indices because two of them are inert and one is not, and the
 * one that isn't has to be recognisable at the point the answer comes back.
 */
const EFFECTS = ["hold", "damage", "follow"] as const;

type EffectId = (typeof EFFECTS)[number];

/** The i18n key naming each clause, in the same order. */
const EFFECT_LABELS: Readonly<Record<EffectId, string>> = {
  hold: "EE.Features.AttackOfOpportunity.EffectHold",
  damage: "EE.Features.AttackOfOpportunity.EffectDamage",
  follow: "EE.Features.AttackOfOpportunity.EffectFollow",
};

/** Is the feature switched on? Read live, so toggling it takes effect at once. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.attackOfOpportunity) === true;
}

/** Trimmed string, however the value arrives. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Is this Item the Attack of Opportunity card?
 *
 * The same three routes as `feature-registry.ts`'s `findGrantingItem`, in the
 * same order — an explicit flag, then the compendium it came from, then the
 * printed name — asked of one Item, because data preparation hands us the Item
 * and scanning its owner on every preparation would be the wrong shape.
 */
function isOpportunityCard(item: AnyObject | null | undefined): boolean {
  if (!item || item["type"] !== "feature") return false;

  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (text(item["_stats"]?.["compendiumSource"]) === COMPENDIUM_SOURCE) return true;

  return text(item["name"]).toLowerCase() === PRINTED_NAME;
}

/**
 * The character holding this card, or null.
 *
 * Only a `character` rolls a Duality reaction and carries a primary weapon, and
 * the check also keeps the button off a copy of the card sitting in a compendium
 * or in the world's item directory.
 */
function characterOf(item: AnyObject): AnyObject | null {
  const actor = item["parent"] as AnyObject | null | undefined;
  return actor && actor["type"] === "character" ? actor : null;
}

/** The system's action model classes, or null if the API has moved. */
function actionClasses(): AnyObject | null {
  return ((game.system?.api?.models?.actions?.actionsTypes as AnyObject | undefined) ??
    null) as AnyObject | null;
}

/**
 * What {@link buildAction} produced last time, per card.
 *
 * Rebuilt only when the Item's system model is — a data model is replaced
 * whenever system data is re-initialized, and an action still parented to the old
 * one would resolve `action.item` to a document nobody else is looking at. Same
 * cache and same reasoning as `close-knit.ts`; there is nothing else for it to
 * depend on, since this is the same button whatever the sheet says.
 */
const cache = new WeakMap<AnyObject, { parent: AnyObject; action: AnyObject | null }>();

/**
 * Build the card's one action.
 *
 * `attack` rather than `effect`, and the type is doing real work: `roll` is only
 * in `DHAttackAction`'s schema, so it is the only shape that can carry "make a
 * reaction roll" at all. With `damage.main: null` the damage half of it stays
 * asleep — `hasDamage` is false, so `DamageField.execute` returns immediately —
 * which is right, because the damage this card deals is the *weapon's*, decided
 * after the roll rather than declared on the action.
 *
 * The action is **named after the card**. `prepareBaseConfig` prefixes the Item's
 * name onto the roll's title unless the two match exactly, so any other name
 * would post "Attack Of Opportunity - Something Else" on every reaction.
 *
 * `chatDisplay: false` keeps the card's full rules text out of the roll card;
 * what goes to chat afterwards is {@link announce}, which says what was actually
 * chosen.
 */
function buildAction(item: AnyObject): AnyObject | null {
  const AttackAction = actionClasses()?.["attack"] as
    | (new (source: AnyObject, options: AnyObject) => AnyObject)
    | undefined;
  if (typeof AttackAction !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: the system's attack action class has moved.`);
    return null;
  }

  const action = new AttackAction(
    {
      _id: ACTION_ID,
      systemPath: "actions",
      baseAction: false,
      chatDisplay: false,
      // The whole point of the card, and four separate behaviours in the system
      // hang off it — see the header.
      actionType: "reaction",
      type: "attack",
      name: text(item["name"]) || game.i18n.localize("EE.Features.AttackOfOpportunity.Action"),
      img: text(item["img"]) || undefined,
      description: game.i18n.localize("EE.Features.AttackOfOpportunity.ActionHint"),
      range: MELEE,
      // `any` rather than `hostile` on purpose — see the header.
      target: { type: "any", amount: 1 },
      // No difficulty declared, so the target's own is what the roll is scored
      // against. `trait: null` opens the dialog's dropdown on the default; the
      // player's answer replaces it.
      roll: { type: "trait", trait: null, useDefault: false },
      // Neither is nullable, so the empty shapes rather than null.
      damage: { main: null, resources: {} },
      effects: [],
    },
    { parent: item["system"] },
  );

  // The system calls this on every action it owns, from
  // `Item#prepareEmbeddedDocuments`. Ours is added *after* that loop has run, so
  // it would otherwise never be prepared at all.
  try {
    action["prepareData"]?.();
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not prepare the action.`, error);
    return null;
  }

  return action;
}

/**
 * Put the action on the card, if it should have one. Called after every
 * preparation of every Item, so the first line is the hot path.
 */
export function injectOpportunityAction(item: AnyObject): void {
  if (!isOpportunityCard(item)) return;

  const actions = item["system"]?.["actions"] as AnyObject | undefined;
  if (typeof actions?.["set"] !== "function") return;

  if (!enabled() || !characterOf(item)) {
    // Un-applying itself, in both directions. Removing here rather than simply
    // not adding is what makes {@link reconcileOpportunityCards} work against
    // documents that are already prepared.
    actions["delete"]?.(ACTION_ID);
    cache.delete(item);
    return;
  }

  const cached = cache.get(item);
  const action = cached && cached.parent === item["system"] ? cached.action : buildAction(item);

  // Cached even when null, which is the "the system moved" case: preparation runs
  // on every actor update, and a build that cannot succeed should warn once
  // rather than once per press.
  cache.set(item, { parent: item["system"] as AnyObject, action });

  if (action) actions["set"](ACTION_ID, action);
}

/**
 * Bring every Attack of Opportunity card in play into line with the current
 * setting.
 *
 * Needed only when the *setting* changes: the action is added as documents are
 * prepared, and nothing re-prepares an already-open sheet on its own. Unlinked
 * token actors are separate documents from anything in `game.actors`, hence the
 * second pass; linked ones are the same object, which is what `seen` skips.
 */
export function reconcileOpportunityCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isOpportunityCard(item)) continue;
      injectOpportunityAction(item);
      changed = true;
      item["render"]?.(false);
    }
    // The character sheet lists the card's actions, so it re-renders whether or
    // not the card's own sheet happens to be open.
    if (changed) actor["render"]?.(false);
  };

  for (const actor of game.actors?.contents ?? []) {
    sweep(actor);
    seen.add(String(actor["uuid"] ?? ""));
  }

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor as AnyObject | null;
    if (!actor || seen.has(String(actor["uuid"] ?? ""))) continue;
    sweep(actor);
  }
}

/** Is this our action? Null for every other action in the world — hence the id first. */
function isOpportunityAction(action: AnyObject | null | undefined): boolean {
  if (String(action?.["_id"] ?? "") !== ACTION_ID) return false;
  if (!enabled()) return false;
  return isOpportunityCard(action?.["item"] as AnyObject | undefined);
}

/* -------------------------------------------------------------------------- */
/*  After the roll                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ask which of the card's clauses the roll bought.
 *
 * `max` is the whole rule: one on a success, two on a critical. The dialog
 * enforces it while the player is choosing rather than trimming the answer
 * afterwards, which is `chooseUpTo`'s job.
 *
 * One Confirm and no decline button. "Take nothing" is not a second decision
 * here — it is this one with no boxes ticked — and a pair of buttons where one is
 * the other's empty case reads as two options when it is one. The empty press is
 * guarded by a confirmation instead of by a disabled button, because the rule
 * does not *force* an effect on you and a control that refuses to be pressed
 * cannot say so. Escape and the window's close button still mean nothing, as they
 * do on every prompt here.
 *
 * Untimed, unlike every other prompt that goes through `waitWithTimeout`: those
 * are raised mid-pipeline with a roll held back, and this one is raised after the
 * roll has been posted. Nothing is waiting on the answer except the player.
 */
async function askEffects(targetName: string, max: number): Promise<EffectId[]> {
  const choices: PromptChoice[] = EFFECTS.map((id) => ({
    id,
    name: game.i18n.localize(EFFECT_LABELS[id]),
  }));

  const picked = await chooseUpTo({
    title: game.i18n.localize("EE.Features.AttackOfOpportunity.Title"),
    intro: game.i18n.format(
      max > 1
        ? "EE.Features.AttackOfOpportunity.IntroTwo"
        : "EE.Features.AttackOfOpportunity.IntroOne",
      { target: targetName },
    ),
    choices,
    max,
    confirmLabel: game.i18n.localize("EE.Features.AttackOfOpportunity.Confirm"),
    // No decline button: "take nothing" is not a second decision here, it is this
    // one with no boxes ticked. The empty press is guarded instead, so it stays
    // possible — the rule does not force an effect on you — but stops being
    // something a stray click can do.
    emptyConfirm: game.i18n.localize("EE.Features.AttackOfOpportunity.ConfirmEmpty"),
    untimed: true,
  });

  // Re-checked against the list this file offered, the way every other prompt
  // here treats an answer.
  return picked.filter((id): id is EffectId => (EFFECTS as readonly string[]).includes(id));
}

/**
 * The attack whose damage "your primary weapon's damage" means.
 *
 * `system.primaryWeapon` is the system's own prepared pointer at the equipped
 * non-secondary weapon. Falling back to the actor's own `system.attack` is not a
 * guess: that is the unarmed strike the system itself switches to when nothing is
 * equipped (`usesUnarmed`), so a Warrior who dropped their sword still deals the
 * damage they would deal by hitting someone.
 */
function primaryAttack(actor: AnyObject): AnyObject | null {
  const weapon = actor["system"]?.["primaryWeapon"] as AnyObject | undefined;
  const attack =
    (weapon?.["system"]?.["attack"] as AnyObject | undefined) ??
    (actor["system"]?.["attack"] as AnyObject | undefined);

  return typeof attack?.["prepareConfig"] === "function" ? attack : null;
}

/**
 * Roll the primary weapon's damage against whoever the reaction was rolled at.
 *
 * Three things are worth knowing about the config this builds:
 *
 * - **`hasRoll: false`** is what turns a weapon attack into a damage roll. The
 *   system's `RollField.prepareConfig` returns early on it, so `config.roll` is
 *   never populated and the workflow's roll step has nothing to do — the same
 *   shape a `damage`-type action has natively.
 * - **`config.effects`** has to be supplied. `DHRoll`'s constructor builds
 *   `options.bonusEffects` from it and `calculateTotalModifiers` then reads that
 *   without guarding, so a missing list is a thrown error rather than a missing
 *   bonus. `use()` fills it in; calling the workflow directly means filling it in
 *   here, from the system's own `getActionRelevantEffects`.
 * - **The targets are carried over and marked hit.** They came from the reaction
 *   roll, which succeeded — that is what bought this effect in the first place.
 *   `applyDamage` is then called *unforced*, so whether the damage lands on its
 *   own or waits for the GM's Apply button is the world's setting, exactly as it
 *   is for an ordinary attack.
 */
async function rollWeaponDamage(
  actor: AnyObject,
  source: AnyObject,
  targets: readonly AnyObject[],
): Promise<void> {
  const attack = primaryAttack(actor);
  if (!attack || attack["hasDamage"] !== true) {
    const said = game.i18n.format("EE.Features.AttackOfOpportunity.NoDamage", {
      actor: String(actor["name"] ?? ""),
    });
    console.warn(`${LOG_PREFIX} ${LABEL}: ${said}`);
    ui.notifications?.warn(said);
    return;
  }

  const config = attack["prepareConfig"](source["event"] ?? null, {
    // The reaction roll already decided this. Rolling to hit again would be a
    // second chance to miss something the rule says has already been hit.
    hasRoll: false,
    evaluate: false,
    // The player asked for the damage; the damage dialog is where they see what
    // they are about to throw.
    dialog: { configure: true },
    skips: { triggers: true },
  }) as AnyObject | false | undefined;

  if (!config) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the weapon declined to build a damage config.`);
    return;
  }

  config["targets"] = targets.map((target) => ({ ...target, hitResult: { success: true } }));

  try {
    const effects = await (
      attack["constructor"] as AnyObject
    )["getActionRelevantEffects"]?.(actor, attack["item"]);
    config["effects"] = Array.isArray(effects) ? effects : [];
  } catch (error) {
    // An empty list is a damage roll without its bonuses; no list at all is a
    // damage roll that throws. See the note above.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not collect the weapon's effects.`, error);
    config["effects"] = [];
  }

  const workflow = attack["workflow"] as AnyObject | undefined;
  await workflow?.["get"]?.("damage")?.["execute"]?.(config, null, true);

  // The dialog was closed rather than rolled. Nothing to apply, and nothing to
  // undo either — the announcement has already said what was chosen.
  if (!config["damage"]) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the damage roll was dismissed.`);
    return;
  }

  await workflow?.["get"]?.("applyDamage")?.["execute"]?.(config);
}

/**
 * Say what was chosen.
 *
 * The two inert clauses are the reason this exists at all: "they can't move" and
 * "you move with them" change nothing any sheet or token will show, so without a
 * line in chat the only record of them is the player's word for it. The damage
 * clause is listed here too and then rolled separately, so the card reads as one
 * decision rather than as a damage roll that appeared from nowhere.
 */
async function announce(
  actor: AnyObject,
  targetName: string,
  chosen: readonly EffectId[],
  critical: boolean,
): Promise<void> {
  try {
    const opening = game.i18n.format(
      critical
        ? "EE.Features.AttackOfOpportunity.AnnounceCritical"
        : "EE.Features.AttackOfOpportunity.Announce",
      { actor: String(actor["name"] ?? ""), target: targetName },
    );

    const clauses = chosen
      .map((id) => `<li>${escapeHtml(game.i18n.localize(EFFECT_LABELS[id]))}</li>`)
      .join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(
        game.i18n.localize("EE.Features.AttackOfOpportunity.Title"),
      )}</strong></p><p>${escapeHtml(opening)}</p><ul>${clauses}</ul>`,
    });
  } catch (error) {
    // The choice stands whether or not it was announced.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the note.`, error);
  }
}

/**
 * The rule proper, from `postUseAction`: read the outcome, ask what it bought,
 * then say so and roll the damage if damage was one of the answers.
 *
 * Not awaited by its caller — the action's own workflow has finished, and the
 * hook is synchronous.
 */
async function resolve(action: AnyObject, config: AnyObject): Promise<void> {
  const actor = action["actor"] as AnyObject | null;
  if (!actor) return;

  const targets = (config["targets"] ?? []) as AnyObject[];
  if (targets.length === 0) {
    // Worth a notification rather than a console line: the player has just made a
    // roll that cannot be scored, and nothing else on screen says why.
    const said = game.i18n.localize("EE.Features.AttackOfOpportunity.NoTarget");
    console.debug(`${LOG_PREFIX} ${LABEL}: ${said}`);
    ui.notifications?.warn(said);
    return;
  }

  const roll = config["roll"] as AnyObject | undefined;
  if (roll?.["success"] !== true) {
    // A failed reaction buys nothing, and the chat card already says so. Silent
    // on purpose — a dialog whose only honest content is "no" is noise.
    console.debug(`${LOG_PREFIX} ${LABEL}: ${actor["name"]}'s reaction missed; nothing to choose.`);
    return;
  }

  const critical = roll["isCritical"] === true;
  const targetName = String(targets[0]?.["name"] ?? "");

  const chosen = await askEffects(targetName, critical ? 2 : 1);
  if (chosen.length === 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no effect chosen.`);
    return;
  }

  await announce(actor, targetName, chosen, critical);
  if (chosen.includes("damage")) await rollWeaponDamage(actor, config, targets);
}

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts`, `companion.ts`
 * and `close-knit.ts` use: the system overrides it to call `prepareData()` on
 * each of an item's actions, so it runs on every preparation of every item and is
 * the last thing to touch `system.actions` before anyone reads it.
 *
 * Fourth file-local copy of this helper. Three was already an extraction
 * candidate; four is a standing one, deliberately not taken while all of them are
 * working, since the extraction would touch the two patches whose *ordering*
 * carries the Companion's range rule.
 */
function patchPreparation(): void {
  const prototype = CONFIG.Item?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["prepareEmbeddedDocuments"];
  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no prepareEmbeddedDocuments to patch — the card stays passive.`,
    );
    return;
  }

  prototype!["prepareEmbeddedDocuments"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      injectOpportunityAction(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not add the card's action.`, error);
    }
    return result;
  };
}

/**
 * The trait this character is best at, or `""` if none can be read.
 *
 * Ties go to whichever comes first in `CONFIG.DH.ACTOR.abilities`, which is the
 * printed order (Agility, Strength, Finesse, Instinct, Presence, Knowledge) — a
 * stable answer rather than whichever the iteration happened to reach first.
 * Falls back to the system's own list if `CONFIG` has moved, so a missing config
 * costs the *preference*, not the roll.
 */
function highestTrait(actor: AnyObject): string {
  const abilities = CONFIG["DH"]?.["ACTOR"]?.["abilities"] as AnyObject | undefined;
  const ids = abilities ? Object.keys(abilities) : [];
  const traits = actor["system"]?.["traits"] as AnyObject | undefined;
  if (ids.length === 0 || !traits) return "";

  let best = "";
  let bestValue = Number.NEGATIVE_INFINITY;

  for (const id of ids) {
    const value = Number(traits[id]?.["value"]);
    // Strictly greater, so the first of equal traits keeps it.
    if (!Number.isFinite(value) || value <= bestValue) continue;
    best = id;
    bestValue = value;
  }

  return best;
}

/**
 * Set the two things about this roll the action itself cannot say.
 *
 * **The dialog is forced open.** "A trait of your choice" has exactly one place
 * it can be chosen — the `<select name="trait">` in the system's roll dialog —
 * and a world with the system's roll automation switched on never opens it:
 * `RollField.prepareConfig` inverts `dialog.configure` when automation is on, so
 * the press would roll without ever asking. Every other roll in such a world is
 * one the player has already decided everything about, and this one is not.
 *
 * **The dropdown opens on the character's best trait.** The action can only
 * declare a fixed trait, and `DHActionRollData#rollTrait` falls back to `agility`
 * for a feature Item with no `system.attack` to read — so the opening value would
 * otherwise be the same one for everybody, and wrong for most of them. A card
 * whose whole point is "a trait of your choice" should open on the choice the
 * player is most likely to make. It stays a dropdown; this only decides where it
 * starts.
 *
 * `preUseAction` is the right seam for both because it fires *after*
 * `prepareConfig` — so after that inversion, and after `config.roll` exists — and
 * before anything reads either value. Both `DHBaseAction.applyKeybindings` and
 * `D20Roll.applyKeybindings` assign `dialog.configure` with `??=`, so a value set
 * here survives all the way to `buildConfigure`.
 */
function prepareRoll(actor: AnyObject | null, config: AnyObject): void {
  const dialog = (config["dialog"] ??= {}) as AnyObject;
  dialog["configure"] = true;

  const roll = config["roll"] as AnyObject | undefined;
  if (!roll || !actor) return;

  const best = highestTrait(actor);
  if (best) roll["trait"] = best;
}

/** Wire the feature up. Called once during `init`, before `registerReach`. */
export function registerAttackOfOpportunity(): void {
  patchPreparation();

  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!isOpportunityAction(action)) return;
      prepareRoll(action["actor"] as AnyObject | null, config);
    } catch (error) {
      // Never abort from here: a failure to prepare the roll costs a trait
      // choice, and returning false would cost the player the press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not open the roll dialog.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!isOpportunityAction(action)) return;
      void resolve(action, config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not resolve the reaction.`, error);
    }
  });
}
