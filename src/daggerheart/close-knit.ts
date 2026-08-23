/**
 * **Close-Knit** (Hearthborne community, *Void for Daggerheart*) — "Once per long
 * rest, you can spend any number of Hope to give an ally the same number of Hope."
 *
 * ## What the Void ships, and why "just add an action" doesn't finish it
 *
 * Nothing: `featureForm: "passive"`, `resource: null`, `actions: {}`. Pressing
 * the card posts its own text.
 *
 * That is a little surprising, because two of the card's three clauses *are*
 * expressible in the system's action schema, and the SRD uses both. "Spend any
 * number of Hope" is a **scalable cost** — `{ key: "hope", value: 1, scalable:
 * true, step: 1 }` — which `CostField.calcCosts` turns into a slider capped at
 * what the character is holding (`maxStep = floor((max - value) / step)`), shown
 * by the configuration dialog that `requireConfigurationDialog` raises for any
 * costed action with no roll. "Once per long rest" is `uses: { max: "1",
 * recovery: "longRest" }`, exactly as the Warrior's Weapon Specialist card
 * declares its Slayer Dice reroll.
 *
 * The third clause is the one the schema cannot say. Every way the system has of
 * moving a resource onto *somebody else* goes through a `healing` action, which
 * means declaring a target, targeting a token on the canvas, and passing through
 * `DamageField.execute`'s damage-roll dialog on the way to
 * `applyDamage`. That is a lot of apparatus for "hand a friend two Hope", and it
 * fails outright for an ally who has no token on the current scene — which at
 * this table is most of the time. So the Void's author left the card as prose,
 * and that is a defensible place to stop.
 *
 * ## What this does instead
 *
 * One derived action on the card, and a pair of prompts behind it: who is
 * receiving, and how much. The Hope moves by `Actor#modifyResource`, which is the
 * system's own resource path and relays through `emitGMUpdate` — so a player can
 * add Hope to another player's character without owning it, the same way a player
 * can already mark an adversary's Stress. (It needs a GM connected, like every
 * other write a player cannot make for themselves.)
 *
 * Nothing is charged until both questions are answered. That is the whole reason
 * the cost is asked here rather than declared on the action: the system's cost
 * step runs before `postUseAction`, so a native scalable cost would take the Hope
 * and *then* ask who gets it, leaving a refund to write for every way a player can
 * close a dialog. Two prompts and one transfer has no half-state to undo.
 *
 * ## Why the action is derived rather than written to the card
 *
 * Same reasoning and the same seam as `companion.ts` and `reach.ts`: it is
 * injected into `item.system.actions` during data preparation, nothing is written
 * to the database, and the rule un-applies itself. Turn the setting off or
 * uninstall the module and the next preparation leaves the card passive again.
 * Its `_id` is fixed rather than random so that an action pressed twice is the
 * same action, and it is exactly sixteen alphanumeric characters because that is
 * what `DocumentIdField` accepts — an action that fails validation is an action
 * the collection quietly refuses.
 *
 * ## Why the rest limit is an ActiveEffect rather than the action's own `uses`
 *
 * `uses` would be the native answer, and it is unavailable *precisely because*
 * the action is derived. `UsesField.execute` records a use with
 * `action.update({ "uses.value": n })`, which resolves to
 * `item.update({ "system.actions.<id>": … })` — a database write, to a key the
 * card's source does not have, describing an action that only exists while this
 * module is installed. The system's own long-rest reset (`RefreshFeatures`) would
 * write to the same place. Both would leave a fragment of a half-action on the
 * card forever.
 *
 * So the marker is an ActiveEffect with `system.duration.type = "longRest"`,
 * which is the mechanism `crimson-rite.ts` already leans on: `expireActiveEffects`
 * runs on every rest and `refreshIsAllowed` lets a `longRest` duration expire only
 * on a long one. It is an ordinary effect on the sheet, so a GM restoring a use is
 * a right-click and a delete rather than a support question.
 *
 * That machinery is the system's, and a world can switch it off
 * (`autoExpireActiveEffects`), which here would mean a card that never comes back
 * — a worse failure than Crimson Rite's, where the same setting only means a rite
 * that never ends. Hence the warning at activation, and the effect's description
 * saying out loud how to clear it by hand.
 *
 * ## What is not automated
 *
 * **Who counts as an ally.** The list is every other character the table can see —
 * the ones assigned to a player, plus any character standing on the current scene
 * — and the player picks from it. Nothing here judges whether the two are on good
 * terms, or in the same room.
 *
 * **Hope that has nowhere to go.** `modifyResource` clamps to the recipient's
 * maximum, so giving 3 to an ally with room for 1 hands over 1 and spends all 3.
 * That is the printed rule read strictly, and it is the reading the system's own
 * clamp already enforces everywhere else. The recipient's headroom is shown while
 * choosing, and the overspill is said out loud afterwards, so nobody discovers it
 * by recounting tokens.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { chooseFromList, chooseOne, type PromptOption } from "./feature-prompt.js";

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "closeKnit";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Close-Knit";

/** The Void Item this comes from — matched ahead of the printed name. */
const COMPENDIUM_SOURCE = "Compendium.the-void-unofficial.communities.Item.lTJoENAJIjB8zgB7";

/** Fallback identification when the card came from somewhere else. */
const PRINTED_NAME = "close-knit";

/** Fixed action id. Sixteen alphanumeric characters — see the header. */
const ACTION_ID = "eeCloseKnitGive1";

/** The resource this card moves, both ways. */
const HOPE = "hope";

/** `CONFIG.DH.EFFECTS.activeEffectDurations.longRest.id` — the card's own wording. */
const UNTIL_LONG_REST = "longRest";

/** The system's world-level automation settings, which own effect expiry. */
const DH_ID = "daggerheart";
const DH_AUTOMATION = "Automation";

/**
 * Characters part-way through sharing, by actor uuid.
 *
 * Two prompts stand between pressing the card and the Hope moving, and the card
 * stays pressable throughout. Without this, a double press asks twice and — since
 * the "spent" marker is not written until the end — would happily spend twice.
 */
const inFlight = new Set<string>();

/** Is the feature switched on? Read live, so toggling it takes effect at once. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.closeKnitShareHope) === true;
}

/** Trimmed string, however the value arrives. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Is this Item the Close-Knit card?
 *
 * The same three routes as `feature-registry.ts`'s `findGrantingItem`, in the
 * same order — an explicit flag, then the compendium it came from, then the
 * printed name — asked of one Item, for the same reason `companion.ts` asks it
 * that way: data preparation hands us the Item, and scanning its owner on every
 * preparation would be the wrong shape entirely.
 */
function isCloseKnitCard(item: AnyObject | null | undefined): boolean {
  if (!item || item["type"] !== "feature") return false;

  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (text(item["_stats"]?.["compendiumSource"]) === COMPENDIUM_SOURCE) return true;

  return text(item["name"]).toLowerCase() === PRINTED_NAME;
}

/**
 * The character holding this card, or null.
 *
 * Only a `character` has Hope to spend, which also keeps the action off a copy of
 * the card sitting in a compendium or in the world's item directory.
 */
function characterOf(item: AnyObject): AnyObject | null {
  const actor = item["parent"] as AnyObject | null | undefined;
  return actor && actor["type"] === "character" ? actor : null;
}

/** The system's action model classes, or null if the API has moved. */
function actionClasses(): AnyObject | null {
  return (
    ((game.system?.api?.models?.actions?.actionsTypes as AnyObject | undefined) ?? null) as
      | AnyObject
      | null
  );
}

/**
 * What {@link buildAction} produced last time, per card.
 *
 * Rebuilt only when the Item's system model is — a data model is replaced
 * whenever system data is re-initialized, and an action still parented to the old
 * one would resolve `action.item` to a document nobody else is looking at. There
 * is nothing else for it to depend on: unlike the Companion's actions, this one
 * is the same button whatever the sheet says.
 */
const cache = new WeakMap<AnyObject, { parent: AnyObject; action: AnyObject | null }>();

/**
 * Build the card's one action.
 *
 * `effect` rather than `base`, and not for cosmetics: `base` is a real entry in
 * `actionsTypes` but has no entry in `CONFIG.DH.ACTIONS.actionTypes`, so the
 * icon and tag the sheet looks up for it are undefined. `effect` is the type the
 * SRD itself uses for exactly this shape — Adaptability's "Mark Stress", No
 * Mercy's "Spend Hope", Weapon Specialist's "Reroll" — a button that costs
 * something and leaves the rest to the table. With no effects attached and no
 * target declared it does nothing on its own: `EffectsField.execute` returns
 * early on `!config.hasEffect`, and `TargetField#prepareConfig` returns early on
 * a null target type.
 *
 * `chatDisplay: false` because the card would otherwise post its own description
 * before the questions are even asked; what goes to chat is {@link announce},
 * once the Hope has actually moved.
 */
function buildAction(item: AnyObject): AnyObject | null {
  const EffectAction = actionClasses()?.["effect"] as
    | (new (source: AnyObject, options: AnyObject) => AnyObject)
    | undefined;
  if (typeof EffectAction !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: the system's effect action class has moved.`);
    return null;
  }

  const action = new EffectAction(
    {
      _id: ACTION_ID,
      systemPath: "actions",
      baseAction: false,
      chatDisplay: false,
      actionType: "action",
      type: "effect",
      name: game.i18n.localize("EE.Features.CloseKnit.Action"),
      img: text(item["img"]) || undefined,
      description: game.i18n.localize("EE.Features.CloseKnit.ActionHint"),
      // Neither is nullable, so the empty shapes rather than null. See
      // `companion.ts` for the same fallback and the same reason.
      effects: [],
      target: { type: null, amount: null },
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
export function injectCloseKnitAction(item: AnyObject): void {
  if (!isCloseKnitCard(item)) return;

  const actions = item["system"]?.["actions"] as AnyObject | undefined;
  if (typeof actions?.["set"] !== "function") return;

  if (!enabled() || !characterOf(item)) {
    // Un-applying itself, in both directions. Removing here rather than simply
    // not adding is what makes {@link reconcileCloseKnitCards} work against
    // documents that are already prepared.
    actions["delete"]?.(ACTION_ID);
    cache.delete(item);
    return;
  }

  const cached = cache.get(item);
  const action =
    cached && cached.parent === item["system"] ? cached.action : buildAction(item);

  // Cached even when null, which is the "the system moved" case: preparation runs
  // on every actor update, and a build that cannot succeed should warn once
  // rather than once per Hope.
  cache.set(item, { parent: item["system"] as AnyObject, action });

  if (action) actions["set"](ACTION_ID, action);
}

/**
 * Bring every Close-Knit card in play into line with the current setting.
 *
 * Needed only when the *setting* changes: the action is added as documents are
 * prepared, and nothing re-prepares an already-open sheet on its own. Unlinked
 * token actors are separate documents from anything in `game.actors`, hence the
 * second pass; linked ones are the same object, which is what `seen` skips.
 */
export function reconcileCloseKnitCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isCloseKnitCard(item)) continue;
      injectCloseKnitAction(item);
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
function isCloseKnitAction(action: AnyObject | null | undefined): boolean {
  if (String(action?.["_id"] ?? "") !== ACTION_ID) return false;
  if (!enabled()) return false;
  return isCloseKnitCard(action?.["item"] as AnyObject | undefined);
}

/** The "already used this rest" marker on this actor, if any. */
function spentMark(actor: AnyObject): AnyObject | null {
  for (const effect of actor["effects"] ?? []) {
    if (effect?.["flags"]?.[MODULE_ID]?.[FLAGS.closeKnit]) return effect;
  }
  return null;
}

/** A resource's current figure and its ceiling, as prepared. */
function resource(actor: AnyObject | null | undefined): { value: number; max: number } {
  const held = actor?.["system"]?.["resources"]?.[HOPE];
  const value = Number(held?.["value"]);
  const max = Number(held?.["max"]);
  return {
    value: Number.isFinite(value) ? value : 0,
    // Hope's ceiling is the world's `maxHope` homebrew setting, adjusted for
    // scars and bonuses, and it is always a number by the time data preparation
    // has run. A non-number here means something upstream is unprepared, and
    // reporting no headroom is the honest answer rather than an invented one.
    max: Number.isFinite(max) ? max : 0,
  };
}

/**
 * Every other character the table could hand Hope to.
 *
 * Assigned characters first, because that is the party; then anything standing on
 * the current scene, which catches a guest character nobody is playing. Falling
 * back to the whole actor directory only when both come up empty — a world with
 * no assignments and an empty scene should still be able to use the card, but a
 * world with a party should not have to scroll past three seasons of retired
 * ones.
 */
function allies(actor: AnyObject): AnyObject[] {
  const self = String(actor["uuid"] ?? "");
  const found = new Map<string, AnyObject>();

  const consider = (candidate: AnyObject | null | undefined): void => {
    if (!candidate || candidate["type"] !== "character") return;

    const uuid = String(candidate["uuid"] ?? "");
    if (!uuid || uuid === self || found.has(uuid)) return;

    // No Hope resource, nothing to receive. Guards against an actor whose data
    // has not been prepared as well as against a homebrew character type.
    if (!candidate["system"]?.["resources"]?.[HOPE]) return;

    found.set(uuid, candidate);
  };

  for (const user of game.users?.contents ?? []) consider(user["character"] as AnyObject | null);
  for (const token of canvas.tokens?.placeables ?? []) consider(token.actor as AnyObject | null);

  if (found.size === 0) {
    for (const candidate of game.actors?.contents ?? []) consider(candidate);
  }

  return [...found.values()].sort((a, b) =>
    String(a["name"] ?? "").localeCompare(String(b["name"] ?? "")),
  );
}

/** Ask which ally receives. Rows, so their name comes with their Hope beside it. */
async function askAlly(actor: AnyObject, choices: AnyObject[]): Promise<AnyObject | null> {
  const hopeLabel = game.i18n.localize("EE.Features.CloseKnit.HopeLabel");

  const options: PromptOption[] = choices.map((ally) => {
    const held = resource(ally);
    return {
      id: String(ally["uuid"] ?? ""),
      label: String(ally["name"] ?? ""),
      img: String(ally["img"] ?? ""),
      stat: { label: hopeLabel, value: `${held.value}/${held.max}` },
    };
  });

  const answer = await chooseOne({
    title: game.i18n.localize("EE.Features.CloseKnit.Title"),
    intro: game.i18n.format("EE.Features.CloseKnit.AllyIntro", {
      hope: resource(actor).value,
    }),
    options,
  });

  return choices.find((ally) => String(ally["uuid"] ?? "") === answer) ?? null;
}

/**
 * Ask how much. One entry per Hope the character actually holds, so the question
 * cannot be answered with Hope they haven't got.
 *
 * A dropdown rather than {@link chooseOne}'s row of buttons: the entries differ
 * only by a number, and six identically-shaped buttons read as a wall rather than
 * as a choice. It opens on the ally's headroom — the largest amount that would
 * not be wasted — because that is the answer most of the time, while leaving
 * every other one a scroll away.
 *
 * Deliberately *not* capped at what the ally can hold: the card says "any number",
 * and spending more than lands is the player's call to make. The recipient's
 * headroom is in the sentence above the field, and {@link announce} says what
 * spilled.
 */
async function askAmount(available: number, ally: AnyObject): Promise<number> {
  const held = resource(ally);
  const headroom = Math.min(available, Math.max(1, held.max - held.value));

  const answer = await chooseFromList({
    title: game.i18n.localize("EE.Features.CloseKnit.Title"),
    intro: game.i18n.format("EE.Features.CloseKnit.AmountIntro", {
      ally: String(ally["name"] ?? ""),
      hope: held.value,
      max: held.max,
    }),
    options: Array.from({ length: available }, (_unused, index) => ({
      value: String(index + 1),
      label: game.i18n.format("EE.Features.CloseKnit.Amount", { count: index + 1 }),
    })),
    initial: String(headroom),
    confirmLabel: game.i18n.localize("EE.Features.CloseKnit.Confirm"),
    cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
  });

  const amount = Number(answer);
  return Number.isInteger(amount) && amount > 0 && amount <= available ? amount : 0;
}

/**
 * Write the "already used this rest" marker.
 *
 * Carries what it was spent on as well as the fact of it, so a table arguing
 * about the round can read the answer off the effect rather than off chat — and
 * so a marker built by hand, without the flag, is left entirely alone.
 */
async function markSpent(
  actor: AnyObject,
  item: AnyObject,
  ally: AnyObject,
  amount: number,
): Promise<void> {
  await actor["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.localize("EE.Features.CloseKnit.SpentEffectName"),
      img: text(item["img"]) || undefined,
      // The card it came from, so the effect is traceable on the sheet.
      origin: String(item["uuid"] ?? ""),
      description: game.i18n.localize("EE.Features.CloseKnit.SpentEffectDescription"),
      disabled: false,
      // Created straight onto the actor, so there is nothing for it to transfer
      // *from*.
      transfer: false,
      type: "base",
      system: {
        duration: { type: UNTIL_LONG_REST },
        // Never anything mechanical. This effect is a record, not a modifier.
        changes: [],
      },
      flags: {
        [MODULE_ID]: {
          [FLAGS.closeKnit]: {
            allyUuid: String(ally["uuid"] ?? ""),
            allyName: String(ally["name"] ?? ""),
            amount,
          },
        },
      },
    },
  ]);
}

/**
 * Say what happened, publicly.
 *
 * Hope moving between two sheets is the sort of thing that gets recounted later,
 * and it is the one change here that nobody watching either character's sheet can
 * attribute on their own. The overspill line only appears when there was some.
 */
async function announce(
  actor: AnyObject,
  ally: AnyObject,
  amount: number,
  wasted: number,
): Promise<void> {
  try {
    const said = game.i18n.format("EE.Features.CloseKnit.Announce", {
      actor: String(actor["name"] ?? ""),
      ally: String(ally["name"] ?? ""),
      count: amount,
    });

    const spilled =
      wasted > 0
        ? ` ${game.i18n.format("EE.Features.CloseKnit.Wasted", {
            count: wasted,
            ally: String(ally["name"] ?? ""),
          })}`
        : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>${escapeHtml(`${said}${spilled}`)}</em></p>`,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the note.`, error);
  }
}

/**
 * The rest limit is enforced by the *system*, not by this module, and the system
 * lets a world turn that off. Worth a line when it is off, because the symptom
 * otherwise is a card that works once and then never again.
 */
function warnIfExpiryDisabled(): void {
  try {
    const automation = game.settings?.get(DH_ID, DH_AUTOMATION) as AnyObject | undefined;
    if (automation?.["autoExpireActiveEffects"] === false) {
      console.warn(
        `${LOG_PREFIX} ${LABEL}: the system's "auto expire active effects" automation ` +
          `is off, so the once-per-long-rest marker will not clear on its own. ` +
          `Delete the "${game.i18n.localize("EE.Features.CloseKnit.SpentEffectName")}" ` +
          `effect from the sheet to hand the use back.`,
      );
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not read the system's expiry setting.`, error);
  }
}

/**
 * Everything that has to be true before the card is worth pressing.
 *
 * Asked from `preUseAction`, where saying no is free — the workflow has not run
 * and nothing has been spent — and asked again inside {@link share}, because two
 * prompts stand between the two moments and any of these can change while a
 * dialog is open.
 */
function refusal(actor: AnyObject | null | undefined): string | null {
  if (!actor) return "EE.Features.CloseKnit.NoActor";
  if (spentMark(actor)) return "EE.Features.CloseKnit.Spent";
  if (resource(actor).value < 1) return "EE.Features.CloseKnit.NoHope";
  if (allies(actor).length === 0) return "EE.Features.CloseKnit.NoAlly";
  // `emitAsGM` sends *every* non-GM resource change over the socket, including a
  // character's changes to their own sheet, so with nobody there to receive it
  // neither half of the transfer would land — while the marker and the chat line,
  // which this client writes itself, would. Refusing up front is the only way to
  // keep the two ends of that from disagreeing.
  if (game.user?.isGM !== true && !game.users?.activeGM) return "EE.Features.CloseKnit.NoGM";
  return null;
}

/** Say why the card did nothing. Never silently — see `adaptability.ts`. */
function decline(actor: AnyObject | null | undefined, key: string): void {
  const said = game.i18n.format(key, { actor: String(actor?.["name"] ?? "") });
  console.debug(`${LOG_PREFIX} ${LABEL}: ${said}`);
  ui.notifications?.warn(said);
}

/**
 * The rule proper: ask who, ask how much, then move the Hope and mark the card
 * spent.
 *
 * Started from `postUseAction` and not awaited — nothing downstream of that hook
 * depends on it, and the action's own workflow has already finished doing nothing.
 */
async function share(action: AnyObject): Promise<void> {
  const actor = action["actor"] as AnyObject | null;
  const item = action["item"] as AnyObject | null;
  if (!actor || !item) return;

  const key = String(actor["uuid"] ?? "");
  if (inFlight.has(key)) {
    console.debug(`${LOG_PREFIX} ${LABEL}: ${actor["name"]} is already sharing; ignoring.`);
    return;
  }
  inFlight.add(key);

  try {
    const choices = allies(actor);
    const ally = await askAlly(actor, choices);
    if (!ally) {
      console.debug(`${LOG_PREFIX} ${LABEL}: nobody chosen; nothing spent.`);
      return;
    }

    // Re-read rather than reuse: a Duality roll resolving elsewhere can hand this
    // character a Hope, or take one, while the first prompt is open.
    const available = resource(actor).value;
    if (available < 1) {
      decline(actor, "EE.Features.CloseKnit.NoHope");
      return;
    }

    const headroom = Math.max(0, resource(ally).max - resource(ally).value);
    const amount = await askAmount(available, ally);
    if (amount < 1) {
      console.debug(`${LOG_PREFIX} ${LABEL}: no amount chosen; nothing spent.`);
      return;
    }

    // Last gate, and the one that matters: everything above took time, and this
    // is the moment before anything is written.
    const refused = refusal(actor);
    if (refused) {
      decline(actor, refused);
      return;
    }
    if (resource(actor).value < amount) {
      decline(actor, "EE.Features.CloseKnit.NoHope");
      return;
    }

    // The giver first. Both go through `modifyResource`, which clamps into range
    // and relays through the system's GM socket — see the header.
    await actor["modifyResource"]?.([{ key: HOPE, value: -amount }]);
    await ally["modifyResource"]?.([{ key: HOPE, value: amount }]);

    await markSpent(actor, item, ally, amount);
    await announce(actor, ally, amount, Math.max(0, amount - headroom));
    warnIfExpiryDisabled();
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not share the Hope.`, error);
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts` and
 * `companion.ts` use: the system overrides it to call `prepareData()` on each of
 * an item's actions, so it runs on every preparation of every item and is the
 * last thing to touch `system.actions` before anyone reads it.
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
      injectCloseKnitAction(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not add the card's action.`, error);
    }
    return result;
  };
}

/** Wire the feature up. Called once during `init`. */
export function registerCloseKnit(): void {
  patchPreparation();

  Hooks.on("daggerheart.preUseAction", (action: AnyObject): boolean | void => {
    try {
      if (!isCloseKnitAction(action)) return;

      const actor = action["actor"] as AnyObject | null;
      const key = String(actor?.["uuid"] ?? "");
      if (key && inFlight.has(key)) {
        // A second press while the prompts are open. Console only: a double-click
        // does not deserve a notification, and the dialog already on screen is the
        // feedback that matters.
        console.debug(`${LOG_PREFIX} ${LABEL}: ${actor?.["name"]} is already sharing; ignoring.`);
        return false;
      }

      const refused = refusal(actor);
      if (!refused) return;

      // Returning false here cancels the action outright, which is exactly right
      // when there is nothing it could do: no Hope, nobody to give it to, or the
      // card is already spent for this rest.
      decline(actor, refused);
      return false;
    } catch (error) {
      // Never `false` from the error path: a failure to check must not cost the
      // player their press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not check the card.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject): void => {
    try {
      if (!isCloseKnitAction(action)) return;
      void share(action);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not start sharing.`, error);
    }
  });
}
