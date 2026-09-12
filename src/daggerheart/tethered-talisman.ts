/**
 * **Enchanted Talisman** (Hedge Witch subclass — Hope and Fear SRD; previously
 * *Tethered Talisman*, *Void for Daggerheart*) — "Once per rest, you can imbue a
 * small item with your protective essence. Spend any number of Hope to place an
 * equal number of tokens on this card. When the person holding the talisman
 * takes damage, spend a token to reduce the number of Hit Points they mark by
 * one. Clear all tokens from this card when you take a rest."
 *
 * The file, the setting key, the flag and the registry id keep the Void's name,
 * because a stored world setting and a flag already on somebody's sheet cannot
 * be renamed without a migration; everything a player reads says the SRD's.
 *
 * ## The two cards, and what each one can and cannot do
 *
 * The Void's (`Compendium.the-void-unofficial.subclasses.Item.UeY92YRyTAeTPnam`)
 * was a single-use charm: one `effect` action, "Tether", `target: any`,
 * `uses: 1 / shortRest`, `effects: []` — the press, the target and the
 * once-per-rest were the system's, and nothing happened afterwards. The rule was
 * "you can't create a new talisman until the old one has been used".
 *
 * The SRD's (`Compendium.daggerheart.subclasses.Item.4jnGL4ENGs2AR1p1`) is a
 * different rule with a different shape. The talisman now holds *tokens*, bought
 * one per Hope, and each token is one Hit Point off one hit. The card carries the
 * counter itself — `system.resource`: `simple`, no max, `shortRest` recovery,
 * `increasing` — which the system's own rest refresh clears to zero, exactly as
 * the last sentence of the rule says. Its one action, "Spend Hope", is a
 * `healing` action with a scalable Hope cost that heals the card's own resource
 * by `@scale`: press, pick a number, and the Hope goes. What it cannot do is any
 * of the rest. It targets `self`, so nobody is ever named as the holder; it has
 * no `uses`, so "once per rest" is not enforced at all; being `healing`, the
 * tokens only land when somebody presses Apply on the chat card afterwards; and
 * nothing asks anybody when the holder is hit.
 *
 * ## Module wins — the card is reshaped, not added to
 *
 * The native action is replaced at preparation time by one of this module's
 * ({@link buildImbueAction}), the seam `blighting-strike.ts` and `close-knit.ts`
 * use: display-only, nothing written, `reset()` restores the card as it shipped
 * the moment the setting is off. The replacement keeps the native action's
 * **`_id`**, and that is the whole trick: `uses.value` is the one thing the
 * system writes back to source when a button is pressed, and the rest refresh
 * writes `0` there too — both at `system.actions.<id>.uses.value`. Under a
 * native id those writes land on a real entry, so "once per rest" becomes the
 * system's own bookkeeping, shown on the button and cleared by the same refresh
 * that clears the tokens. (Under an id of this module's own they would create a
 * half-formed action in source, which is why a card with no native action, or
 * more than one, is left as it shipped — see {@link nativeAction}.)
 *
 * What the replacement changes: `effect` rather than `healing`, so there is no
 * chat button to forget; `target: any`, so the press names the holder the way the
 * Void's did; `uses: 1 / shortRest`; and the same scalable Hope cost, so the
 * system's own dialog asks how many. The tokens are then written by this module
 * from what the dialog said ({@link imbue}), on the client that pressed — who
 * owns the card.
 *
 * ## What is where
 *
 * - **The tokens are on the witch's card**, in `system.resource.value`, and
 *   nowhere else. That is the SRD's own shape: visible on her Features tab,
 *   editable there when the table rules otherwise, and cleared by Short Rest
 *   without this module lifting a finger. The Void's card has `resource: null`;
 *   it is given the same counter on its first press ({@link TOKENS}).
 * - **The holder is an ActiveEffect on the holder**, flagged with the witch's
 *   uuid, placed through `gm-effects.ts` because the holder is usually somebody
 *   else's character and core requires OWNER to create an effect. It carries no
 *   count — one talisman, one witch, one counter, and the counter is hers. It
 *   goes when the last token is spent, when the witch imbues a new one, or when
 *   somebody deletes it, which is how a table calls the whole thing off. One
 *   left standing after a rest has emptied the card is inert, and is cleared
 *   the first time it would otherwise have asked ({@link offerTalisman}).
 *
 * ## Where the reduction goes, and why it is not simply healing them afterwards
 *
 * "Reduce the number of Hit Points they mark by one" is a change to the *marks*,
 * not to the damage. Daggerheart converts damage to marks through thresholds, so
 * shaving a point off the damage is not the same rule at all: 8 damage against a
 * Major of 8 marks 2, and 7 marks 1 — the same subtraction is worth a whole Hit
 * Point at one number and nothing at all at another.
 *
 * So the seam is the finished update list `Actor#takeDamage` hands to
 * `modifyResource`, which is the one place the mark count is a number in hand —
 * the same `{ key: "hitPoints", value }` entry the system is about to apply,
 * after resistances, after thresholds, and after the armor-slot dialog has taken
 * its own point off. The talisman changes that number and hands it on. Getting
 * there is `damage-marking.ts`'s job, and its header says why the method's own
 * hooks are all in the wrong place for this.
 *
 * The alternative — let the damage land and heal a point back — was rejected for
 * a reason that is not cosmetic. Marking your last Hit Point is a death move; a
 * character taken to zero and then quietly refilled has already had the table's
 * attention and the system's. The reduction has to happen before the write.
 *
 * ## Why it is allowed to hold the damage open
 *
 * The prompt goes to the *witch*, who is usually not the person being hit and is
 * very often not the client applying the damage, so it crosses a socket
 * (`feature-ask.ts`) and it waits. That means `takeDamage` is held open while
 * somebody else decides — see `damage-marking.ts` on why that is the system's own
 * precedent rather than a liberty. The wait only ever happens when there is a
 * live talisman on the person who was actually hit, which is what this feature's
 * `wants` answers.
 *
 * ## Who is asked
 *
 * `responderFor` picks the witch's own player, falling back to whoever is running
 * the roll when nobody who owns her is connected — which at that point is the GM
 * playing her reactions anyway. Deliberately *not* the person taking the damage:
 * the tokens are the witch's Hope and spending one is her decision, and it is
 * the only interesting decision in the feature. A player who is about to mark
 * two Hit Points will always say yes.
 *
 * ## Reading the rule
 *
 * - **"Spend a token to reduce … by one"** is one token per hit. The sentence
 *   spends *a* token for *one* fewer Hit Point; three tokens against one Severe
 *   hit is a reading the card does not offer, and the more generous invention.
 * - **"Spend any number of Hope"** — the system's cost dialog does the asking,
 *   from one up to however many the witch holds. A press with none is refused
 *   by the system before anything is written.
 * - **"Once per rest"** is the action's `uses`, refused by `UsesField` on the
 *   second press and cleared by Short Rest. It is *not* "until the tokens are
 *   gone": a witch who spends all three tokens before the rest waits for the
 *   rest, as printed. A witch who imbues again after one — with a token or two
 *   still on the card because the table skipped the refresh — moves the
 *   talisman to the new holder and keeps the old tokens; the card, not the
 *   holder, is where the count lives, and the rest is what empties it.
 * - **"The person holding the talisman"** is whoever the witch had targeted
 *   when she pressed, herself included. Exactly one; anything else is refused
 *   before the Hope is charged.
 *
 * ## Deliberate silences
 *
 * - **The reduction is never offered for a hit that marks nothing.** No Hit
 *   Points, no number to reduce; nothing is spent and nobody is asked.
 * - **Stress is not Hit Points.** An attack that marks Stress as well leaves the
 *   Stress alone, and one that marks *only* Stress raises no prompt at all.
 * - **Direct damage is included.** It bypasses armor, not talismans; the card
 *   says "takes damage" and means it.
 * - **Nothing is refunded.** Tokens the rest clears were Hope spent on a
 *   talisman that was not needed, exactly as printed.
 * - **One talisman per witch, not per holder.** Two Hedge Witches can both
 *   enchant the same person's pocket-watch, and each spends her own tokens.
 * - **No chat card from the press itself.** `chatDisplay: false`; what goes to
 *   chat is {@link announceImbued}, once the tokens are actually on the card.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { onDamageMarking } from "./damage-marking.js";
import { askUser, responderFor } from "./feature-ask.js";
import type { PromptRequest } from "./feature-prompt.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { markActor, type MarkRequest, unmarkActor } from "./gm-effects.js";

/**
 * The Items this comes from — matched ahead of the printed name. Both homes of
 * the card are listed (see the header); SRD first only because that is the copy
 * in play, since `findGrantingItem` stops at the first hit either way.
 */
const MATCH: FeatureMatch = {
  compendiumSources: [
    "Compendium.daggerheart.subclasses.Item.4jnGL4ENGs2AR1p1",
    "Compendium.the-void-unofficial.subclasses.Item.UeY92YRyTAeTPnam",
  ],
  names: ["Enchanted Talisman", "Tethered Talisman"],
};

/** `MATCH.names`, lower-cased once, for {@link isTalismanCard}. */
const PRINTED_NAMES: ReadonlySet<string> = new Set(
  (MATCH.names ?? []).map((name) => name.toLowerCase()),
);

/**
 * Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape
 * hatch. The Void's name, kept — see the header.
 */
const FEATURE_ID = "tetheredTalisman";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Enchanted Talisman";

/** `CONFIG.DH.GENERAL.healingTypes.hitPoints.id`. The only resource reduced. */
const HIT_POINTS = "hitPoints";

/** The actor resource a token costs, as `CostField` names it. */
const HOPE = "hope";

/** `CONFIG.DH.GENERAL.itemAbilityCosts.resource.id` — the card's own counter. */
const ITEM_RESOURCE = "resource";

/** "…spend a token to reduce the number of Hit Points they mark by one." */
const REDUCE = 1;

/** "Clear all tokens from this card when you take a rest." */
const RECOVERY = "shortRest";

/**
 * The card's counter, in the shape the SRD ships it and the system's rest
 * refresh understands: `increasing` with no max, so it counts tokens up from
 * zero and the refresh puts it back there. Written whole onto a Void card that
 * has none — a partial write into a nullish `SchemaField` is rejected for the
 * fields it does not mention, which `slayer.ts`'s header sets out at length.
 */
const TOKENS: Readonly<Record<string, string>> = {
  type: "simple",
  max: "",
  recovery: RECOVERY,
  progression: "increasing",
  icon: "fa-solid fa-book",
};

/** Talismans whose prompt is already on somebody's screen, by effect uuid. */
const asking = new Set<string>();

/** A talisman found in the world: the effect, and who is carrying it. */
interface Talisman {
  holder: AnyObject;
  effect: AnyObject;
}

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.tetheredTalisman) === true;
}

/** Trimmed string, however the value arrives. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

/** The Enchanted Talisman card on this actor, or null. */
function talismanCard(actor: AnyObject | null | undefined): AnyObject | null {
  return actor ? findGrantingItem(actor, FEATURE_ID, MATCH) : null;
}

/**
 * Is this Item the card?
 *
 * The same three routes as `findGrantingItem`, in the same order — flag, then
 * source, then printed name — asked of an Item rather than of an actor, because
 * {@link reshapeTalismanCard} meets the card during its own preparation, before
 * there is any reason to look for it from the outside.
 */
function isTalismanCard(item: AnyObject | null | undefined): boolean {
  if (!item || item["type"] !== "feature") return false;

  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  const source = text(item["_stats"]?.["compendiumSource"]);
  if (source && (MATCH.compendiumSources ?? []).includes(source)) return true;

  return PRINTED_NAMES.has(text(item["name"]).toLowerCase());
}

/** The tokens on the card right now. A card with no counter yet holds none. */
function tokensOn(card: AnyObject | null): number {
  const value = Number(card?.["system"]?.["resource"]?.["value"] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Whether the card is carrying the counter the system's refresh can clear. */
function hasCounter(card: AnyObject): boolean {
  return Boolean(card["system"]?.["resource"]);
}

/* ------------------------------------------------------------------ *
 * The card's button
 * ------------------------------------------------------------------ */

/**
 * The action this module builds in place of the card's own, per card.
 *
 * Keyed by the Item, and rebuilt when its `system` is re-initialised — which is
 * what an update or a `reset()` does, and what a plain re-preparation does not.
 * That is the right cadence: the one piece of source the action reads is
 * `uses.value`, and the only way that changes is an update.
 */
const cache = new WeakMap<AnyObject, { parent: AnyObject; action: AnyObject | null }>();

function actionClasses(): AnyObject | null {
  return (
    ((game.system?.api?.models?.actions?.actionsTypes as AnyObject | undefined) ?? null) as
      | AnyObject
      | null
  );
}

/**
 * The card's one native action, from *source* — or null when there is not
 * exactly one.
 *
 * Source rather than the prepared collection because by the time this runs the
 * prepared collection may already hold the replacement, and because the value
 * wanted from it (`uses.value`) is the persisted one. Exactly one, for the
 * reason the header gives: the replacement borrows the native `_id` so the
 * system's `uses` writes have somewhere real to land, and with no native action
 * there is nowhere.
 */
function nativeAction(item: AnyObject): AnyObject | null {
  const actions = item["_source"]?.["system"]?.["actions"] as AnyObject | undefined;
  const entries = Object.values(actions ?? {}).filter(
    (action): action is AnyObject => !!action && typeof action === "object",
  );
  return entries.length === 1 ? entries[0]! : null;
}

/**
 * Build the card's button: the native action's `_id` under this module's shape.
 *
 * `effect` rather than the SRD's `healing`, so the press does what the dialog
 * said without a chat button to press afterwards; `target: any`, so the holder
 * is named; `uses: 1 / shortRest`, so "once per rest" is the system's. The Hope
 * cost is the SRD's own — scalable from one, one per step — and it is the
 * system's cost dialog that asks how many.
 *
 * `chatDisplay: false` for the reason `close-knit.ts` gives: the card would
 * otherwise post its own description before the tokens exist. See
 * {@link announceImbued}.
 */
function buildImbueAction(item: AnyObject, native: AnyObject): AnyObject | null {
  const EffectAction = actionClasses()?.["effect"] as
    | (new (source: AnyObject, options: AnyObject) => AnyObject)
    | undefined;
  if (typeof EffectAction !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: the system's effect action class has moved.`);
    return null;
  }

  const spent = Number(native["uses"]?.["value"] ?? 0);

  try {
    const action = new EffectAction(
      {
        _id: String(native["_id"]),
        systemPath: "actions",
        baseAction: false,
        chatDisplay: false,
        actionType: "action",
        type: "effect",
        name: game.i18n.localize("EE.Features.TetheredTalisman.Action"),
        img: text(item["img"]) || undefined,
        description: game.i18n.localize("EE.Features.TetheredTalisman.ActionHint"),
        cost: [
          { key: HOPE, value: 1, scalable: true, step: 1, itemId: null, consumeOnSuccess: false },
        ],
        uses: {
          value: Number.isFinite(spent) && spent > 0 ? spent : 0,
          max: "1",
          recovery: RECOVERY,
          consumeOnSuccess: false,
        },
        effects: [],
        target: { type: "any", amount: null },
        range: "",
      },
      { parent: item["system"] },
    );

    // The system calls this on every action it owns, from
    // `Item#prepareEmbeddedDocuments`. Ours replaces an entry *after* that loop
    // has run, so it would otherwise never be prepared at all.
    action["prepareData"]?.();
    return action;
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not build the card's action.`, error);
    return null;
  }
}

/**
 * Put the card into the shape the rule describes. Called after every
 * preparation of every Item, so the first line is the hot path.
 *
 * Only a `character`'s card: a copy sitting in a compendium or the Items
 * directory has no Hope to spend and nobody to hand a talisman to.
 */
export function reshapeTalismanCard(item: AnyObject): void {
  if (!isTalismanCard(item)) return;
  if (!enabled() || item["actor"]?.["type"] !== "character") return;

  const actions = item["system"]?.["actions"] as AnyObject | undefined;
  if (typeof actions?.["set"] !== "function") return;

  const native = nativeAction(item);
  if (!native) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the card does not ship one action; leaving it as is.`);
    return;
  }

  const cached = cache.get(item);
  const action =
    cached && cached.parent === item["system"] ? cached.action : buildImbueAction(item, native);

  // Cached even when null, which is the "the system moved" case: preparation
  // runs on every actor update, and a build that cannot succeed should warn once
  // rather than once per Hope.
  cache.set(item, { parent: item["system"] as AnyObject, action });

  if (action) actions["set"](String(native["_id"]), action);
}

/**
 * Bring every card in play into line with the current setting.
 *
 * `reset()` rather than `prepareData()`, for the reason `blighting-strike.ts`
 * gives: turning the setting *on* replaces the native action in the prepared
 * collection, and turning it *off* has to put the original back — which only
 * re-initialising the document from `_source` can do. `reset` ends by calling
 * `prepareData` itself, so the reshape re-applies on the way out when the
 * setting is being turned on. Unlinked token actors are separate documents from
 * anything in `game.actors`, hence the second pass.
 */
export function reconcileTalismanCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isTalismanCard(item)) continue;
      cache.delete(item);
      try {
        item["reset"]?.();
      } catch (error) {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not reset the card.`, error);
      }
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
 * Is this the card's button? The card carries exactly one action once reshaped,
 * so matching the granting Item is enough and no action name is hardcoded.
 */
function imbueAction(action: AnyObject): AnyObject | null {
  const card = talismanCard(action?.["actor"] as AnyObject | null);
  if (!card) return null;

  return card["id"] === action["item"]?.["id"] ? card : null;
}

/* ------------------------------------------------------------------ *
 * The talisman on its holder
 * ------------------------------------------------------------------ */

/** The talisman flag on an effect, or null. */
function talismanFlag(effect: AnyObject): AnyObject | null {
  const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.tetheredTalisman];
  return mark && typeof mark === "object" ? (mark as AnyObject) : null;
}

/** The talisman this actor is carrying, whoever made it. */
function talismanOn(actor: AnyObject | null | undefined): AnyObject | null {
  for (const effect of (actor?.["effects"] ?? []) as AnyObject[]) {
    if (talismanFlag(effect)) return effect;
  }

  return null;
}

/**
 * Every actor a talisman could currently be sitting on: the world's own, plus the
 * synthetic actors behind unlinked tokens on the current scene.
 *
 * The second half matters because a talisman handed to an unlinked NPC lives on
 * its ActorDelta, which is not in `game.actors` at all. One on an unlinked token
 * on *another* scene is genuinely not found, and the only consequence is that
 * a re-imbue leaves it standing until that holder is next hit, when
 * {@link offerTalisman} notices the witch's talisman is elsewhere.
 */
function carriers(): AnyObject[] {
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

/** This witch's outstanding talisman, wherever it is. */
function outstandingTalisman(witchUuid: string): Talisman | null {
  if (!witchUuid) return null;

  for (const holder of carriers()) {
    for (const effect of (holder["effects"] ?? []) as AnyObject[]) {
      const mark = talismanFlag(effect);
      if (mark && String(mark["sourceUuid"] ?? "") === witchUuid) return { holder, effect };
    }
  }

  return null;
}

/** The one creature this press is imbuing for, or null. */
function soleTarget(config: AnyObject): { actorUuid: string; name: string } | null {
  const targets = (config["targets"] ?? []) as AnyObject[];
  if (targets.length !== 1) return null;

  const actorUuid = String(targets[0]?.["actorId"] ?? "");
  return actorUuid ? { actorUuid, name: String(targets[0]?.["name"] ?? "") } : null;
}

/** The mark request describing one talisman. */
function request(holderUuid: string, witch: AnyObject): MarkRequest {
  return {
    kind: "tetheredTalisman",
    actorUuid: holderUuid,
    sourceUuid: String(witch["uuid"] ?? ""),
    sourceName: String(witch["name"] ?? ""),
  };
}

/* ------------------------------------------------------------------ *
 * Imbuing
 * ------------------------------------------------------------------ */

/**
 * How many Hope the press spent — the scalable cost's total, as the system's
 * own dialog settled it. Zero when the shape is not what was built.
 */
function hopeSpent(config: AnyObject): number {
  const costs = (config["costs"] ?? []) as AnyObject[];
  const hope = costs.find((cost) => String(cost?.["key"] ?? "") === HOPE);
  const total = Number(hope?.["total"] ?? hope?.["value"] ?? 0);
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
}

/**
 * Put the tokens on the card.
 *
 * Written directly rather than relayed: this runs on the client that pressed
 * the button, which owns the card. A Void card arriving without a counter gets
 * the whole shape, for the reason {@link TOKENS} gives.
 */
async function addTokens(card: AnyObject, count: number): Promise<number> {
  const total = tokensOn(card) + count;

  await card["update"]?.(
    hasCounter(card)
      ? { "system.resource.value": total }
      : { "system.resource": { ...TOKENS, value: total } },
  );

  return total;
}

/** Say who is carrying what, in the chat log. */
async function announceImbued(witch: AnyObject, holder: string, tokens: number): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch as never }),
      content: `<p>${escapeHtml(
        game.i18n.format("EE.Features.TetheredTalisman.Imbued", {
          witch: String(witch["name"] ?? ""),
          holder,
          tokens,
        }),
      )}</p>`,
    });
  } catch (error) {
    // The tokens are on the card and the talisman on its holder; losing the
    // announcement must not undo either.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the talisman.`, error);
  }
}

/**
 * Put the talisman on the target and the tokens on the card, replacing this
 * witch's previous talisman wherever it was.
 *
 * The effect is relayed through `gm-effects.ts` rather than written here: the
 * holder is usually somebody else's character, and core requires OWNER of the
 * parent to create an ActiveEffect.
 */
async function imbue(action: AnyObject, config: AnyObject, card: AnyObject): Promise<void> {
  const witch = action["actor"] as AnyObject | null;
  const target = soleTarget(config);
  if (!witch || !target) return;

  const spent = hopeSpent(config);
  if (spent < 1) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the press spent no Hope; nothing imbued.`);
    return;
  }

  const witchUuid = String(witch["uuid"] ?? "");
  const previous = outstandingTalisman(witchUuid);

  // Skipped when it is the same person: `applyMark` clears before it creates, so
  // the re-imbue is already a replacement rather than a second effect.
  if (previous && String(previous.holder["uuid"] ?? "") !== target.actorUuid) {
    await unmarkActor(request(String(previous.holder["uuid"] ?? ""), witch));
  }

  const tokens = await addTokens(card, spent);
  await markActor(request(target.actorUuid, witch));
  await announceImbued(witch, target.name, tokens);

  console.debug(
    `${LOG_PREFIX} ${LABEL}: ${witch["name"]} enchanted a talisman for ${target.name} ` +
      `(${spent} Hope, ${tokens} token(s)).`,
  );
}

/* ------------------------------------------------------------------ *
 * Spending
 * ------------------------------------------------------------------ */

/**
 * Put the question on the witch's screen. False for a decline, a dismissal, a
 * timeout, or a client that never answered — every one of which means the damage
 * lands as rolled.
 */
async function askWitch(
  witch: AnyObject,
  card: AnyObject,
  holder: AnyObject,
  marking: number,
  tokens: number,
): Promise<boolean> {
  const prompt: PromptRequest = {
    title: game.i18n.localize("EE.Features.TetheredTalisman.Title"),
    intro: game.i18n.format("EE.Features.TetheredTalisman.Intro", {
      holder: String(holder["name"] ?? ""),
      marking,
      reduced: marking - REDUCE,
    }),
    offers: [
      {
        id: FEATURE_ID,
        label: game.i18n.localize("EE.Features.TetheredTalisman.OfferLabel"),
        hint: game.i18n.format(
          tokens > REDUCE
            ? "EE.Features.TetheredTalisman.OfferHintMany"
            : "EE.Features.TetheredTalisman.OfferHintLast",
          { tokens, left: tokens - REDUCE },
        ),
        itemName: String(card["name"] ?? LABEL),
        img: card["img"] ? String(card["img"]) : undefined,
        useLabel: game.i18n.localize("EE.Features.TetheredTalisman.Spend"),
        skipLabel: game.i18n.localize("EE.Features.TetheredTalisman.Keep"),
      },
    ],
  };

  const chosen = await askUser(responderFor(witch), prompt);
  return chosen.has(FEATURE_ID);
}

/**
 * Take one token off the card.
 *
 * Through `modifyResource`'s own item-cost path rather than by updating the
 * card directly, because that path relays through a GM (`emitGMUpdate`) and the
 * client running this is whoever applied the damage — very often not somebody
 * who owns the witch's sheet. `getItemIdCostUpdate` clamps at zero and, with no
 * max on the counter, at nothing else.
 */
async function spendToken(witch: AnyObject, card: AnyObject): Promise<void> {
  await witch["modifyResource"]?.([
    { key: ITEM_RESOURCE, value: -REDUCE, itemId: card["id"], target: card },
  ]);
}

/**
 * Say a token went, in the chat log rather than a notification.
 *
 * The people who need to see it are the witch, the holder and the GM, and the
 * client this runs on is whichever one of them happened to apply the damage.
 * Public, because the reason a Hit Point was not marked belongs beside the attack
 * that would have marked it.
 */
async function announceSpent(witch: AnyObject, holder: AnyObject, left: number): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch as never }),
      content: `<p>${escapeHtml(
        game.i18n.format(
          left > 0 ? "EE.Features.TetheredTalisman.Spent" : "EE.Features.TetheredTalisman.SpentLast",
          {
            witch: String(witch["name"] ?? ""),
            holder: String(holder["name"] ?? ""),
            left,
          },
        ),
      )}</p>`,
    });
  } catch (error) {
    // The Hit Point is already unmarked; losing the announcement must not undo it.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the token.`, error);
  }
}

/**
 * Offer a token against one finished update list, and take a mark off it if the
 * witch says yes.
 *
 * `resources` is the system's own array, moments from being written, so the
 * change is made in place. The sign is read rather than assumed: Hit Points are a
 * *reversed* resource and so arrive positive, but the whole point of reading
 * `isReversed` elsewhere in this module is not to hardcode that.
 *
 * The talisman and the tokens are looked up here rather than captured when the
 * rule said it wanted this actor: those two moments are the armor-slot dialog
 * apart, and the later one is the truer answer.
 */
async function offerTalisman(holder: AnyObject, resources: AnyObject[]): Promise<void> {
  const entry = (resources ?? []).find((update) => String(update?.["key"] ?? "") === HIT_POINTS);
  const marking = Math.abs(Number(entry?.["value"] ?? 0));

  // No Hit Points, no number to reduce. Nothing is spent and the witch is not
  // interrupted.
  if (!entry || !Number.isFinite(marking) || marking < REDUCE) return;

  const effect = talismanOn(holder);
  if (!effect) return;

  const mark = talismanFlag(effect);
  const witch = fromUuidSync(String(mark?.["sourceUuid"] ?? "")) as AnyObject | null;
  if (!witch) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the witch who made this talisman is gone.`);
    return;
  }

  const card = talismanCard(witch);
  const tokens = card ? tokensOn(card) : 0;

  // An empty talisman is an inert one — the rest emptied the card, or the witch
  // has since enchanted something else. Cleared here, the first time it would
  // otherwise have asked, rather than watched for: see the header.
  if (!card || tokens < REDUCE) {
    console.debug(`${LOG_PREFIX} ${LABEL}: ${holder["name"]}'s talisman has no tokens; clearing it.`);
    void unmarkActor(request(String(holder["uuid"] ?? ""), witch)).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not clear the empty talisman.`, error);
    });
    return;
  }

  // Two hits landing at once would otherwise put the same talisman on screen
  // twice and spend the same token twice.
  const key = String(effect["uuid"] ?? effect["id"] ?? "");
  if (asking.has(key)) return;
  asking.add(key);

  try {
    if (!(await askWitch(witch, card, holder, marking, tokens))) return;

    // Re-read: the question sat on somebody's screen for up to half a minute, and
    // the talisman may have been spent on another hit, emptied, or deleted from
    // the sheet in the meantime.
    const still = talismanOn(holder);
    if (!still || String(still["id"] ?? "") !== String(effect["id"] ?? "") || tokensOn(card) < REDUCE) {
      console.debug(`${LOG_PREFIX} ${LABEL}: the talisman went while the question was open.`);
      return;
    }

    const value = Number(entry["value"] ?? 0);
    entry["value"] = value > 0 ? value - REDUCE : value + REDUCE;

    const left = tokensOn(card) - REDUCE;
    await spendToken(witch, card);
    if (left <= 0) await unmarkActor(request(String(holder["uuid"] ?? ""), witch));
    await announceSpent(witch, holder, left);
  } finally {
    asking.delete(key);
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts`, `companion.ts`,
 * `close-knit.ts`, `blighting-strike.ts`, `brave-face.ts` and
 * `attack-of-opportunity.ts` use: the system overrides it to call
 * `prepareData()` on each of an item's actions, so it runs on every preparation
 * of every item and is the last thing to touch `system.actions` before anyone
 * reads it.
 *
 * Seventh file-local copy of this helper — see the note in
 * `attack-of-opportunity.ts` for why the extraction has been deferred.
 */
function patchPreparation(): void {
  const prototype = CONFIG.Item?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["prepareEmbeddedDocuments"];
  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no prepareEmbeddedDocuments to patch — the card stays as it shipped.`,
    );
    return;
  }

  prototype!["prepareEmbeddedDocuments"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      reshapeTalismanCard(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not reshape the card.`, error);
    }
    return result;
  };
}

/** Wire the feature up. Called once during `init`. */
export function registerTetheredTalisman(): void {
  patchPreparation();

  // `wants` keeps the shared seam from interposing on anyone who is not carrying
  // a talisman, which is nearly everyone: the check is one pass over an actor's
  // effects, and answering false costs the damage nothing at all.
  onDamageMarking({
    id: FEATURE_ID,
    wants: (holder) => enabled() && talismanOn(holder) !== null,
    mark: (holder, resources) => offerTalisman(holder, resources),
  });

  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): boolean | void => {
    try {
      if (!enabled() || !imbueAction(action)) return;

      // `prepareConfig` has already run by here — `use()` builds the config
      // before it calls this hook — so the target is known while the Hope is
      // still unspent, which is the only moment refusing it is free.
      if (!soleTarget(config)) {
        ui.notifications?.warn(game.i18n.localize("EE.Features.TetheredTalisman.NoTarget"));
        return false;
      }
    } catch (error) {
      // Never `false` from the error path: a failed check must not cost the
      // player their press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not check the card.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!enabled()) return;
      const card = imbueAction(action);
      if (!card) return;

      // Started, not awaited: the hook is synchronous, and nothing downstream is
      // waiting on the tokens.
      void imbue(action, config, card).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not imbue the talisman.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not imbue the talisman.`, error);
    }
  });
}
