/**
 * **Companion** — the Beastbound ranger's animal companion, made pressable.
 *
 * The subclass's foundation feature reads "You have an animal companion of your
 * choice… Take the Ranger Companion sheet", and that sheet's rule is the one
 * that matters in play:
 *
 * > Make a Spellcast Roll to connect with your companion and command them to
 * > take action. Spend a Hope to add an applicable Companion Experience to the
 * > roll. On a success with Hope, if your next action builds on their success,
 * > you gain advantage on the roll.
 *
 * ## What the system ships, and what is missing from it
 *
 * The Companion card itself is `featureForm: "passive"` with `actions: {}` — no
 * button, no roll; clicking it posts its description. The rule above lives on the
 * *companion's* sheet instead, split across two buttons that each get half of it
 * right:
 *
 * - The companion sheet's **action roll** does it properly: it calls
 *   `partner.diceRoll` with the partner's spellcast trait and `companionRoll:
 *   true`, so the ranger rolls and the dialog offers the *companion's*
 *   Experiences at a Hope each. It just has nowhere to point — no target, no
 *   damage, no attack.
 * - The companion's **attack** is rolled by the companion (`DhpActor#rollClass`
 *   returns `DualityRoll` for `character`/`companion`) with the partner's
 *   spellcast modifier pasted on as a flat "Bonus to Hit". The number matches a
 *   Spellcast Roll, but nothing else does: the Hope and Fear land on an actor
 *   with no Hope resource, none of the ranger's own roll bonuses apply, and the
 *   Experiences on offer are charged against a partner the cost step has to go
 *   looking for.
 *
 * So the pieces exist and are wired to the wrong actors. This puts both on the
 * card the player actually thinks of as "my companion", as two ordinary actions.
 *
 * ## The ranger rolls; the companion reaches
 *
 * Both actions are built **on the ranger** — parented to the Companion feature
 * Item, exactly where an SRD card's own actions live. That single decision buys
 * the whole rule:
 *
 * - `roll.type: "spellcast"` makes `DHActionRollData#rollTrait` return
 *   `spellcastModifierTrait.key` (Agility for a Ranger), so it *is* a Spellcast
 *   Roll rather than a number that happens to match one.
 * - `action.actor` is the ranger, so `config.resourceUpdates` is the ranger's:
 *   Hope and Fear from the Duality roll, and the Hope an Experience costs, all
 *   land where they belong, and every bonus on the ranger's sheet applies.
 * - `config.data` becomes the ranger's roll data, whose `companion` is the
 *   companion Actor — which is all the roll dialog needs to list the companion's
 *   Experiences once {@link markCompanionRoll} sets `companionRoll`.
 *
 * The one thing that decision costs is **where the attack starts**. A companion
 * standing across the room reaches what it is next to, not what its partner is
 * next to, and `daggerheart-target-helper` measures from the acting actor's
 * token. That is why this file is the first caller of that module's
 * `registerRangeOrigin` (see `integrations/target-helper-survey.ts`): the ranger
 * still rolls, and the range is still measured from the companion. Without the
 * Target Helper installed nothing gates range at all — for anyone, on any action
 * — so the fallback is the system's own behaviour rather than a wrong answer.
 *
 * ## Why the actions are derived rather than written to the card
 *
 * They are injected into `item.system.actions` during data preparation, the same
 * hook point and the same reasoning as `reach.ts`: nothing is written to the
 * database, so the rule un-applies itself. Turn the setting off, delete the
 * companion, or uninstall the module and the next preparation leaves the card
 * passive again, with no migration and nothing to clean up.
 *
 * Injecting into that collection rather than patching `actionsList` is what makes
 * everything downstream native and is not optional cosmetics — the system looks
 * an action back up by id through `item.system.actionsList` in two places that
 * both matter here: the roll dialog's constructor, and the chat message's
 * `actionItem` (which is how a card's damage button finds what it is rolling
 * damage for). An action the collection doesn't contain is an action those two
 * cannot find.
 *
 * Their `_id`s are fixed rather than random for the same reason: a chat card from
 * last session still resolves.
 *
 * ## What is not automated
 *
 * "On a success with Hope, if your next action builds on their success, you gain
 * advantage" — the condition is a judgement about the *next* action, which
 * nothing here can see. A success with Hope posts a line saying the advantage is
 * available; taking it is the table's call. Granting it automatically would be
 * wrong more often than right, and silently attaching advantage to whatever the
 * ranger rolled next would be worse than either.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { registerRangeOrigin } from "../integrations/target-helper-survey.js";
import { escapeHtml } from "../utils/escape-html.js";

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "companion";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Companion";

/** The SRD Companion feature — the Beastbound subclass's foundation card. */
const COMPENDIUM_SOURCE = "Compendium.daggerheart.subclasses.Item.MBFXxIEwc0Dl4kJg";

/** Fallback identification when the card came from somewhere else. */
const PRINTED_NAME = "companion";

/**
 * Fixed action ids. Sixteen alphanumeric characters, because that is what
 * `DocumentIdField` accepts and an action that fails validation is an action the
 * collection quietly refuses.
 */
const ATTACK_ID = "eeCompanionAtk01";
const COMMAND_ID = "eeCompanionCmd01";

/** `CONFIG.DH.GENERAL.rollTypes.spellcast.id` — what makes this a Spellcast Roll. */
const SPELLCAST = "spellcast";

/** `config.roll.result.duality` for a roll made with Hope. */
const WITH_HOPE = 1;

/** Is the feature switched on? Read live, so toggling it takes effect at once. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.companionCommands) === true;
}

/** Trimmed string, however the value arrives. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Is this Item the Companion card?
 *
 * The same three routes as `feature-registry.ts`'s {@link findGrantingItem}, in
 * the same order — an explicit flag, then the compendium it came from, then the
 * printed name — but asked of one Item rather than searched for across an actor,
 * because data preparation hands us the Item and scanning its owner on every
 * preparation would be the wrong shape entirely.
 */
function isCompanionCard(item: AnyObject | null | undefined): boolean {
  if (!item || item["type"] !== "feature") return false;

  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (text(item["_stats"]?.["compendiumSource"]) === COMPENDIUM_SOURCE) return true;

  return text(item["name"]).toLowerCase() === PRINTED_NAME;
}

/**
 * The companion bound to this card's owner, or null.
 *
 * `system.companion` is a `ForeignDocumentUUIDField`, so it is already the Actor
 * document rather than a uuid to resolve — the same value the system's own
 * `companionLevelup` path reads. Only a `character` can hold one, which also
 * keeps this from firing on a copy of the card sitting in a compendium.
 */
function companionOf(item: AnyObject): AnyObject | null {
  const actor = item["parent"] as AnyObject | null | undefined;
  if (!actor || actor["type"] !== "character") return null;

  const companion = actor["system"]?.["companion"] as AnyObject | null | undefined;
  return companion && companion["type"] === "companion" ? companion : null;
}

/**
 * The companion's attack action, as plain source data.
 *
 * `toObject()` rather than the derived model: everything copied here is either
 * literal (`range`, `target`) or a formula resolved later against whoever is
 * rolling (`@prof` in the damage), and the source is the version that survives
 * being handed to a fresh action's constructor.
 */
function companionAttackSource(companion: AnyObject): AnyObject | null {
  const attack = companion["system"]?.["attack"] as AnyObject | undefined;
  try {
    return (attack?.["toObject"]?.() as AnyObject | undefined) ?? null;
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not read ${companion["name"]}'s attack.`, error);
    return null;
  }
}

/**
 * A cheap fingerprint of everything the built actions depend on.
 *
 * Data preparation runs constantly — every actor update re-prepares every item —
 * and building two `DataModel`s each time would be real work for no change.
 * Comparing this string first means the actions are rebuilt when the GM edits the
 * companion's attack or the ranger is bound to a different animal, and not
 * otherwise.
 */
function signatureOf(companion: AnyObject, attack: AnyObject | null): string {
  return [
    String(companion["uuid"] ?? ""),
    String(companion["name"] ?? ""),
    String(companion["img"] ?? ""),
    JSON.stringify(attack ?? null),
  ].join("|");
}

/** What {@link buildActions} produced last time, per card. */
interface CachedActions {
  signature: string;
  /**
   * The `system` model the actions were parented to. A data model is rebuilt
   * whenever the Item's system data is re-initialized, and an action still
   * pointing at the old one would resolve `action.item` to a document nobody
   * else is looking at.
   */
  parent: AnyObject;
  actions: AnyObject[];
  /**
   * The range each action was built with, re-asserted on every pass.
   *
   * `reach.ts` rewrites the derived `range` of every action an actor can use, and
   * these are now actions the ranger can use — so a Giant Beastbound's companion
   * would have its Melee bite promoted to Very Close because its *partner* has
   * long arms. That contradicts the point of this feature: the attack is measured
   * from the companion's token precisely because that is where it comes from.
   *
   * Re-asserting rather than teaching Reach an exception, because the two patches
   * share one seam and ours wraps theirs — so ours runs last on every preparation,
   * and the answer is the same on the first pass as on the hundredth.
   */
  ranges: string[];
}

const cache = new WeakMap<AnyObject, CachedActions>();

/** The system's action model classes, or null if the API has moved. */
function actionClasses(): AnyObject | null {
  return (
    ((game.system?.api?.models?.actions?.actionsTypes as AnyObject | undefined) ?? null) as
      | AnyObject
      | null
  );
}

/**
 * Build the two actions for one card.
 *
 * Both are `attack` actions, which is not a fudge for the second one: an attack
 * action with no damage and no declared target *is* the system's plain roll —
 * `hasDamage` tests `damage.main`, and `TargetField#prepareConfig` returns early
 * on a null `target.type` without ever setting `hasTarget`. There is no bare
 * "roll" action type to use instead, and this leaves the Command roll going
 * through the identical, well-trodden workflow as the attack.
 */
function buildActions(item: AnyObject, companion: AnyObject): AnyObject[] {
  const classes = actionClasses();
  const AttackAction = classes?.["attack"] as
    | (new (source: AnyObject, options: AnyObject) => AnyObject)
    | undefined;
  if (typeof AttackAction !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: the system's attack action class has moved.`);
    return [];
  }

  const attack = companionAttackSource(companion);
  // Escaped because it is being substituted into an HTMLField that the system
  // enriches and renders — unlike the chat note below, whose whole string is
  // escaped in one go.
  const name = escapeHtml(String(companion["name"] ?? ""));
  const built: AnyObject[] = [];

  /** Shared between the two so they differ only where they mean to. */
  const common = {
    systemPath: "actions",
    baseAction: false,
    chatDisplay: true,
    actionType: "action",
    type: "attack",
    roll: {
      // The whole rule in one field: `rollTrait` reads the *character's*
      // spellcast trait for this type, so the ranger's Agility is what rolls.
      type: SPELLCAST,
      // Left off deliberately. `useDefault` would make `DHAttackAction#prepareData`
      // overwrite both the trait and the roll type from the parent item's own
      // attack — which the Companion card does not have, but a homebrew card
      // carrying the flag might.
      useDefault: false,
    },
  };

  if (attack) {
    built.push(
      new AttackAction(
        {
          ...common,
          _id: ATTACK_ID,
          name: text(attack["name"]) || game.i18n.localize("EE.Features.Companion.Attack"),
          img: text(attack["img"]) || String(companion["img"] ?? ""),
          description: game.i18n.format("EE.Features.Companion.AttackHint", { companion: name }),
          // Falling back to the *empty* shapes rather than to `null`: `range` is
          // a blank-allowing StringField and both of the others are SchemaFields,
          // none of them nullable, so a null here would be a validation error
          // rather than an absence.
          range: text(attack["range"]),
          target: (attack["target"] as AnyObject) ?? { type: null, amount: null },
          damage: (attack["damage"] as AnyObject) ?? { main: null, resources: {} },
        },
        { parent: item["system"] },
      ),
    );
  }

  built.push(
    new AttackAction(
      {
        ...common,
        _id: COMMAND_ID,
        name: game.i18n.localize("EE.Features.Companion.Command"),
        img: String(companion["img"] ?? ""),
        description: game.i18n.format("EE.Features.Companion.CommandHint", { companion: name }),
        // No target and no damage: the GM sets a difficulty and adjudicates what
        // the companion managed. See the note above about why this is still an
        // `attack` action.
        target: { type: null, amount: null },
        damage: { main: null, resources: {} },
      },
      { parent: item["system"] },
    ),
  );

  for (const action of built) {
    // The system calls this on every action it owns, from
    // `Item#prepareEmbeddedDocuments`. Ours are added *after* that loop has run,
    // so they would otherwise never be prepared at all.
    try {
      action["prepareData"]?.();
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not prepare an action.`, error);
    }
  }

  return built;
}

/**
 * Put the actions on the card, if it should have them. Called after every
 * preparation of every Item, so the first two lines are the hot path.
 */
export function injectCompanionActions(item: AnyObject): void {
  if (!isCompanionCard(item)) return;

  const actions = item["system"]?.["actions"] as AnyObject | undefined;
  if (typeof actions?.["set"] !== "function") return;

  const companion = enabled() ? companionOf(item) : null;
  if (!companion) {
    // Un-applying itself, in both directions: a ranger who loses their companion
    // — or a table that switches the feature off — gets a passive card back
    // rather than two buttons pointing at nothing. Removing here rather than
    // simply not adding is what makes {@link reconcileCompanionCards} work
    // against documents that are already prepared.
    actions["delete"]?.(ATTACK_ID);
    actions["delete"]?.(COMMAND_ID);
    cache.delete(item);
    return;
  }

  const signature = signatureOf(companion, companionAttackSource(companion));
  const cached = cache.get(item);
  const fresh =
    cached && cached.signature === signature && cached.parent === item["system"]
      ? null
      : buildActions(item, companion);

  const built = fresh ?? cached!.actions;
  const ranges =
    fresh === null
      ? cached!.ranges
      : fresh.map((action) => String(action["range"] ?? ""));

  // Cached even when empty, which is the "the system moved" case: preparation
  // runs on every actor update, and a build that can't succeed should warn once
  // rather than once per hit point.
  cache.set(item, { signature, parent: item["system"] as AnyObject, actions: built, ranges });

  built.forEach((action, index) => {
    // See `CachedActions.ranges`: whatever else has been done to this action
    // since the last preparation, its range is the companion's.
    action["range"] = ranges[index];
    actions["set"](String(action["_id"] ?? ""), action);
  });
}

/**
 * Bring every Companion card in play into line with the current setting.
 *
 * Needed only when the *setting* changes: the actions are added as documents are
 * prepared, and nothing re-prepares an already-open sheet on its own. Unlinked
 * token actors are separate documents from anything in `game.actors`, hence the
 * second pass; linked ones are the same object, which is what `seen` skips.
 */
export function reconcileCompanionCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isCompanionCard(item)) continue;
      injectCompanionActions(item);
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

/**
 * Is this one of ours, and if so which? Null for every other action in the world,
 * which is the overwhelmingly common answer — hence the id check first.
 */
function companionAction(action: AnyObject | null | undefined): "attack" | "command" | null {
  const id = String(action?.["_id"] ?? "");
  if (id !== ATTACK_ID && id !== COMMAND_ID) return null;
  if (!enabled() || !isCompanionCard(action?.["item"] as AnyObject | undefined)) return null;
  return id === ATTACK_ID ? "attack" : "command";
}

/**
 * A placed token for the companion on the current scene, or null.
 *
 * `getActiveTokens()` is the system's and core's own answer to "where is this
 * actor", and it already restricts itself to the viewed scene. The first token
 * wins when there are somehow several — a companion is one creature, and picking
 * arbitrarily is better than refusing to measure.
 */
function companionToken(companion: AnyObject): Token | null {
  try {
    const tokens = (companion["getActiveTokens"]?.() ?? []) as Token[];
    return tokens[0] ?? null;
  } catch (error) {
    console.debug(`${LOG_PREFIX} ${LABEL}: could not locate ${companion["name"]}'s token.`, error);
    return null;
  }
}

/**
 * Tell the roll dialog this is a companion roll.
 *
 * Set on `preUseAction` rather than baked into the action because it is a
 * property of the *roll config*, and `RollField#prepareConfig` replaces
 * `config.roll` wholesale during `prepareConfig` — anything written before that
 * is gone. `preUseAction` fires immediately afterwards and before the workflow,
 * which is the first and only moment this can be set.
 *
 * That one flag is the whole Experience half of the rule: the dialog reads
 * `config.data.companion` (the ranger's roll data resolves it to the companion
 * Actor) for the list, and adds a 1 Hope cost per Experience picked — charged
 * against the ranger, because the ranger is the acting actor.
 */
function markCompanionRoll(action: AnyObject, config: AnyObject): void {
  try {
    if (!companionAction(action)) return;
    const roll = config["roll"] as AnyObject | undefined;
    if (roll) roll["companionRoll"] = true;
  } catch (error) {
    // Never `false` from here: this hook's return cancels the action, and a
    // failure to offer Experiences must not cost the player their press.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not mark the roll as a companion roll.`, error);
  }
}

/**
 * Say so when the roll came up with Hope — the standing advantage the card
 * grants, which nothing can decide on the player's behalf. See the header.
 *
 * Posted publicly rather than whispered: whether the ranger's next action
 * "builds on their success" is a question for the GM, and a reminder only the
 * player can see is a reminder the GM has to be told about anyway.
 */
async function announceHope(action: AnyObject, config: AnyObject): Promise<void> {
  const roll = config["roll"] as AnyObject | undefined;
  if (roll?.["result"]?.["duality"] !== WITH_HOPE) return;
  // An attack that missed is not a success. A Command roll usually has no
  // difficulty to compare against, and the system leaves `success` undefined
  // there rather than false — so only an explicit `false` stands the reminder
  // down, and the GM judges the rest.
  if (roll?.["success"] === false) return;

  const actor = action["actor"] as AnyObject | undefined;
  const companion = companionOf(action["item"] as AnyObject);
  if (!actor || !companion) return;

  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>${escapeHtml(
        game.i18n.format("EE.Features.Companion.HopeReminder", {
          companion: String(companion["name"] ?? ""),
        }),
      )}</em></p>`,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the success-with-Hope note.`, error);
  }
}

/**
 * Where the companion's attack is measured from.
 *
 * Answers only for the attack — the Command roll targets nothing, so it is never
 * asked — and only when the companion is actually on the scene. Declining hands
 * the Target Helper back to its ordinary rule of measuring from the acting
 * actor's token, which for a companion nobody has placed is the honest answer.
 */
function rangeOrigin(action: AnyObject): Token | null {
  if (companionAction(action) !== "attack") return null;

  const companion = companionOf(action["item"] as AnyObject);
  return companion ? companionToken(companion) : null;
}

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts` uses: the
 * system overrides it to call `prepareData()` on each of an item's actions, so it
 * runs on every preparation of every item and is the last thing to touch
 * `system.actions` before anyone reads it.
 */
function patchPreparation(): void {
  const prototype = CONFIG.Item?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["prepareEmbeddedDocuments"];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: no prepareEmbeddedDocuments to patch — the card stays passive.`);
    return;
  }

  prototype!["prepareEmbeddedDocuments"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      injectCompanionActions(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not add the companion's actions.`, error);
    }
    return result;
  };
}

/** Wire the feature up. Called once during `init`. */
export function registerCompanion(): void {
  patchPreparation();

  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): void => {
    markCompanionRoll(action, config);
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!companionAction(action)) return;
      void announceHope(action, config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not read the roll's result.`, error);
    }
  });

  // Waits for `ready` because the Target Helper publishes its API during `init`
  // and module load order is not ours to choose. Nothing can be rolled before
  // then, so there is nothing to miss.
  Hooks.once("ready", () => {
    registerRangeOrigin((action) => (enabled() ? rangeOrigin(action) : null));
  });
}
