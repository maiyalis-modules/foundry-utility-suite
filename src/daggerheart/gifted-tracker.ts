/**
 * **Gifted Tracker** (Sage domain, SRD) — "When you're tracking a specific
 * creature or group of creatures based on signs of their passage, you can spend
 * any number of Hope and ask the GM that many questions from the following list…
 * When you encounter creatures you've tracked in this way, gain a +1 bonus to
 * your Evasion against them."
 *
 * ## What the SRD ships, and why it is wrong
 *
 * One `effect` action carrying a scalable Hope cost — that part is right, and is
 * left alone — plus an ActiveEffect whose `system.changes` is a flat
 * `system.evasion +1`, applied through `EffectsField` to whoever is **targeted**.
 *
 * Both halves of that miss the rule. The card's `target.type` is `"any"`, so
 * using it means selecting somebody; the only sensible thing to select is
 * yourself, since the bonus is yours. And once applied it is a *permanent,
 * unconditional* +1 Evasion against the entire world, where the card grants it
 * only "against them" and only once you encounter them. Press the button twice
 * and you have +2 against everything, forever.
 *
 * There is no way to write that rule as an ActiveEffect. "+1 against these
 * particular creatures" is not a property of the character; it is a property of
 * one attack, and it can only be applied at the moment an attack is resolved
 * against them. So the change is suppressed here and recreated as a conditional
 * one — see {@link registerTrackerEvasion}.
 *
 * ## The flow
 *
 * 1. **Press the card.** `target.type` is blanked for the duration of the press
 *    (`card-targeting.ts`), so nothing asks who you are tracking footprints *at*.
 * 2. **Spend the Hope.** Entirely the system's own scalable cost dialog. The
 *    number chosen is read back afterwards, because it is also the number of
 *    questions the rule buys.
 * 3. **Describe the quarry.** A free-text prompt on the player's own client —
 *    "large clawed prints, three sets, heading north" — because at this point in
 *    the fiction the player does not know what they are following. That is the
 *    whole point of the questions.
 * 4. **The GM names it.** The description crosses to the GM, who picks the actual
 *    creatures from a searchable list spanning the scene, the world directory and
 *    every Actor compendium. This is the one step that cannot be automated: only
 *    the GM knows what left those tracks.
 * 5. **The tracking is recorded** as an ActiveEffect on the ranger, carrying the
 *    quarry in its flag. Using the card again **replaces** it; deleting it by
 *    hand is how a tracking ends any other way.
 *
 * ## Why "ends when you stop tracking" is only half automated
 *
 * The card never says what ends it. Losing the trail, giving up, the creature
 * dying — all of those are the table's judgement, and there is no event in
 * Foundry that honestly stands for any of them. Hanging it on a rest, a scene
 * change or a distance would be inventing a rule the card does not have. So the
 * effect is left on the sheet to be deleted, which is the same "you decide when
 * this is over" that Ranger's Focus and Crimson Rite use.
 *
 * The one moment the system *can* be certain is a ranger starting on a fresh set
 * of tracks, which is exactly what pressing the card means. So that — and only
 * that — ends the previous tracking. See {@link endTracking}.
 *
 * ## Why the GM writes the record, and why nothing comes back
 *
 * The request is one-way, exactly like `gm-effects.ts`. The GM's client already
 * has permission to write to a player's actor, so having it place the effect
 * itself avoids a second socket hop and a reply the player's client would have to
 * re-validate. A table with no GM connected gets nothing — which is the right
 * answer for a card whose entire text is "ask the GM".
 *
 * As there, **nothing off the socket is trusted**: the payload is a description
 * of a request, the receiving client decides what it means, and the free text a
 * player wrote is escaped everywhere it is rendered.
 *
 * ## How a creature is recognised again
 *
 * By a set of keys rather than one identity, because the thing the GM picked and
 * the thing that later attacks you are rarely the same document: the GM points at
 * a compendium statblock, and what walks onto the scene is an unlinked token
 * whose actor is an ActorDelta. So {@link identityKeys} collects the uuid, the
 * `_stats.compendiumSource`, and the name — of both the attacking actor and the
 * world actor behind it — and a match on any one of them counts. Same
 * flag-then-compendium-then-name philosophy as `FeatureMatch`, and the name is
 * last for the same reason: it is the only thing that catches a statblock somebody
 * typed in by hand, and the only one that can over-match.
 *
 * ## The one gap
 *
 * The bonus is applied in the `adversaryAttack` window, which handles the plain
 * `D20Roll` an adversary makes. A tracked creature built as a `character` rolls
 * Duality instead, and that window never sees it — so tracking another party's
 * player character records the quarry but does not apply the +1. Adversaries,
 * which is what anyone tracks, are covered.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS, SOCKET_EVENT } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isWriter } from "../utils/is-writer.js";
import type { AdversaryAttackContext } from "./adversary-attack.js";
import { chooseActors, type ActorChoice } from "./actor-picker.js";
import { untargetAction } from "./card-targeting.js";
import { askText } from "./feature-prompt.js";
import { findGrantingItem, registerFeature, type FeatureMatch } from "./feature-registry.js";
import { rollVisibility } from "./roll-pipeline.js";

/** Registry id, and the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "giftedTracker";

/** How the card is recognised — flag, then compendium, then printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.domains.Item.VZ2b4zfRzV73XTuT"],
  names: ["Gifted Tracker"],
  // Not the registry's default of `feature`: this one is held as a domain card.
  itemTypes: ["domainCard"],
};

/** Prefix for this feature's console lines. */
const LABEL = "Gifted Tracker";

/** Socket discriminator, namespaced by `type` like the rest of the channel. */
const TRACK = "giftedTrackerRequest";

/** What the card grants against the quarry. Not scalable — the card says +1. */
const EVASION_BONUS = 1;

/**
 * What the GM can name as quarry.
 *
 * Wider than "adversary" because tables build their NPCs differently, and a
 * creature worth tracking might be a `character` sheet somebody made for it.
 * See the header for what that costs.
 */
const QUARRY_TYPES = ["adversary", "npc", "character", "companion"] as const;

/** Cap on the player's description. It crosses a socket and lands on a screen. */
const DESCRIPTION_LIMIT = 300;

/** Ceiling on a reported Hope spend, in case the number arrives malformed. */
const HOPE_LIMIT = 99;

/** How many quarry names the effect's own label lists before it gives up. */
const NAMES_IN_LABEL = 2;

/** The card's own artwork, so the record looks like where it came from. */
const EFFECT_IMG = "icons/magic/nature/stealth-hide-eyes-green.webp";

/**
 * Priority 20: this *rewrites the outcome* — it can turn a hit into a miss — so
 * it belongs in the rewriter band ahead of anything that merely reacts, which
 * starts at 50. Shared with I See It Coming, which is the neighbour it is most
 * like; the two are additive and their order between themselves does not matter,
 * because each re-decides the hit from the Evasion the other left behind.
 */
const REWRITE_PRIORITY = 20;

/** One creature a ranger is tracking, as recorded on the effect. */
interface Quarry {
  /** Actor or compendium-entry uuid, whichever the GM picked. */
  uuid: string;
  name: string;
  img?: string;
}

/** The payload of one tracking effect's flag. */
interface Tracking {
  /** What the player said they were following. Free text, always escaped. */
  description: string;
  /** How much Hope bought it, which is also how many questions were asked. */
  hope: number;
  quarry: Quarry[];
}

/** What crosses the socket, player to GM. Flat, JSON-safe, entirely descriptive. */
interface TrackRequest {
  rangerUuid: string;
  rangerName: string;
  description: string;
  hope: number;
}

/** The setting gate. Checked per event, so toggling the feature is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.giftedTrackerEvasion) === true;
}

/** Is `value` a usable, non-empty string? */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The Gifted Tracker card behind this action, or null.
 *
 * Mirrors `rangers-focus.ts`'s equivalent: the action's own Item has to *be* the
 * card the actor holds, so a homebrew card that merely shares a name with one on
 * a different sheet cannot claim the automation.
 */
function trackerCardAction(action: AnyObject | null | undefined): AnyObject | null {
  const actor = action?.["actor"] as AnyObject | undefined;
  const item = action?.["item"] as AnyObject | undefined;
  if (!actor || !item || actor["type"] !== "character") return null;

  const granting = findGrantingItem(actor, FEATURE_ID, MATCH);
  return granting && granting["id"] === item["id"] ? granting : null;
}

/**
 * How much Hope this press actually cost.
 *
 * `CostField.calcCosts` writes `total = value + scale * step` onto each cost, so
 * for a scalable cost the player's answer to the system's own dialog is already
 * here by the time `postUseAction` runs. Falls back to the printed `value`, which
 * is what a cost that never went through the dialog carries.
 */
function hopeSpent(config: AnyObject): number {
  const costs = (config["costs"] ?? []) as AnyObject[];
  const hope = costs.find((cost) => String(cost["key"] ?? "") === "hope" && cost["enabled"] !== false);

  const spent = Number(hope?.["total"] ?? hope?.["value"] ?? 0);
  return Number.isFinite(spent) && spent > 0 ? Math.min(Math.floor(spent), HOPE_LIMIT) : 0;
}

/** Every tracking currently recorded on this actor, newest last. */
function trackingEffectsOn(actor: AnyObject): AnyObject[] {
  const found: AnyObject[] = [];

  for (const effect of (actor["effects"] ?? []) as Iterable<AnyObject>) {
    const record = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.giftedTracker] as Tracking | undefined;
    if (Array.isArray(record?.quarry) && record.quarry.length > 0) found.push(effect);
  }

  return found;
}

/**
 * The trackings themselves.
 *
 * Written as a list even though {@link recordTracking} keeps exactly one: an
 * effect somebody built by hand, or one left behind by a delete that failed
 * halfway, should still be read rather than ignored — and a matcher that handles
 * "any of these" costs nothing over one that handles "the one".
 */
function trackingsOn(actor: AnyObject): Tracking[] {
  return trackingEffectsOn(actor).map(
    (effect) => effect["flags"][MODULE_ID][FLAGS.giftedTracker] as Tracking,
  );
}

/**
 * Every string that could identify `actor` as something the GM pointed at.
 *
 * Both the actor as it stands and the world actor behind it, because an unlinked
 * token's actor is an ActorDelta: its uuid names a scene and a token, its name is
 * the token's ("Minor Treant (2)"), and only the base actor carries the identity
 * the GM actually picked. See the header.
 */
function identityKeys(actor: AnyObject): Set<string> {
  const keys = new Set<string>();

  const base =
    actor["isToken"] === true
      ? ((game.actors?.get(String(actor["id"] ?? "")) as AnyObject | undefined) ?? actor)
      : actor;

  for (const candidate of base === actor ? [actor] : [actor, base]) {
    const uuid = text(candidate["uuid"]);
    if (uuid) keys.add(uuid);

    const source = text(candidate["_stats"]?.["compendiumSource"]);
    if (source) keys.add(source);

    const name = text(candidate["name"]).toLowerCase();
    // Namespaced so a creature named after a uuid cannot collide with one.
    if (name) keys.add(`name:${name}`);
  }

  return keys;
}

/** The keys one recorded quarry answers to. */
function quarryKeys(quarry: Quarry): string[] {
  const keys = [text(quarry.uuid)];

  const name = text(quarry.name).toLowerCase();
  if (name) keys.push(`name:${name}`);

  return keys.filter((key) => key.length > 0);
}

/** Has `hunter` tracked `creature`? */
function isQuarry(hunter: AnyObject, creature: AnyObject): boolean {
  const trackings = trackingsOn(hunter);
  if (trackings.length === 0) return false;

  const identity = identityKeys(creature);
  return trackings.some((tracking) =>
    tracking.quarry.some((quarry) => quarryKeys(quarry).some((key) => identity.has(key))),
  );
}

/** Who should see a record of what a ranger is tracking: the GMs and its owners. */
function confidants(ranger: AnyObject): string[] {
  return (game.users?.contents ?? [])
    .filter(
      (user) =>
        (user as AnyObject)["isGM"] === true ||
        ranger["testUserPermission"]?.(user, "OWNER") === true,
    )
    .map((user) => String((user as AnyObject)["id"] ?? ""));
}

/** "Minor Treant, Young Dryad and 2 more" — the effect's own label. */
function summarize(quarry: Quarry[]): string {
  const names = quarry.map((entry) => entry.name).filter((name) => name.length > 0);
  if (names.length <= NAMES_IN_LABEL) return names.join(", ");

  return game.i18n.format("EE.Features.GiftedTracker.AndMore", {
    names: names.slice(0, NAMES_IN_LABEL).join(", "),
    count: names.length - NAMES_IN_LABEL,
  });
}

/* -------------------------------------------------------------------------- */
/*  Using the card                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The card's two hooks.
 *
 * `preUseAction` runs **before** the cost, so it is where the SRD's unconditional
 * ActiveEffect is stopped: `EffectsField.execute` opens with
 * `if (!config.hasEffect) return`, and `config` is the object `executeWorkflow`
 * is about to run on. Blanking the card's target (see {@link registerGiftedTracker})
 * would incidentally stop it too — `applyEffects` does nothing with no targets —
 * but relying on that would make a *display* decision load-bearing for a
 * mechanical one, and the two are changed in different places for different
 * reasons. Suppressed for the GM as well, so the button does the same thing
 * whoever presses it.
 *
 * `postUseAction` runs **after** `use()` flushes `resourceUpdates`, so by then the
 * Hope is spent and how much of it is knowable. Both hooks are synchronous, and a
 * listener returning `false` cancels the action — which is a hazard in the second,
 * where every path must return `undefined`.
 */
function registerTrackerCard(): void {
  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): boolean | void => {
    try {
      if (!enabled() || !trackerCardAction(action)) return;
      config["hasEffect"] = false;
    } catch (error) {
      // Never `false` from here: a broken check must let the action through
      // rather than silently swallow the player's button press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not take over the card's action.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject) => {
    try {
      if (!enabled() || !trackerCardAction(action)) return;

      // Started, not awaited: the hook is synchronous, and nothing after it
      // depends on the tracking. The `void` also guarantees this listener returns
      // `undefined` rather than a Promise, which would cancel the action.
      void beginTracking(action["actor"] as AnyObject, hopeSpent(config));
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not start the tracking.`, error);
    }
  });
}

/**
 * Ask the player what they are following, and put it in front of the GM.
 *
 * The description is the player's, not the GM's, because at this point in the
 * fiction the character knows only what the ground shows them. Naming the
 * creature here would answer the very questions the Hope was spent to ask.
 */
async function beginTracking(ranger: AnyObject, hope: number): Promise<void> {
  try {
    if (!ranger) return;

    const description = await askText({
      title: game.i18n.localize("EE.Features.GiftedTracker.Title"),
      intro: game.i18n.format("EE.Features.GiftedTracker.Describe", { hope }),
      placeholder: game.i18n.localize("EE.Features.GiftedTracker.DescribePlaceholder"),
      confirmLabel: game.i18n.localize("EE.Features.GiftedTracker.Ask"),
      cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
      maxLength: DESCRIPTION_LIMIT,
    });

    if (!description) {
      // The Hope has gone by now — `use()` flushed the resource updates before the
      // hook that got us here — so say so rather than failing quietly.
      ui.notifications?.warn(game.i18n.localize("EE.Features.GiftedTracker.NoDescription"));
      return;
    }

    await requestTracking({
      rangerUuid: String(ranger["uuid"] ?? ""),
      rangerName: String(ranger["name"] ?? ""),
      description,
      hope,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not ask what is being tracked.`, error);
  }
}

/**
 * Put the request on a GM's screen.
 *
 * Handled locally when this client is the one that would handle it anyway — a GM
 * pressing the card themselves — and sent over the socket otherwise.
 * Fire-and-forget: the player's client has nothing left to do, and the record is
 * written at the other end.
 */
async function requestTracking(request: TrackRequest): Promise<void> {
  if (isWriter()) {
    await runTrackerPicker(request);
    return;
  }

  if (!game.socket) {
    console.warn(`${LOG_PREFIX} ${LABEL}: no socket — the GM cannot be asked.`);
    return;
  }

  ui.notifications?.info(game.i18n.localize("EE.Features.GiftedTracker.Sent"));
  game.socket.emit(SOCKET_EVENT, { type: TRACK, request });
}

/** Validate an arriving payload into a request, or null. */
function readRequest(payload: AnyObject): TrackRequest | null {
  const rangerUuid = text(payload["rangerUuid"]);
  const description = text(payload["description"]).slice(0, DESCRIPTION_LIMIT);
  if (!rangerUuid || !description) return null;

  const hope = Number(payload["hope"]);

  return {
    rangerUuid,
    rangerName: text(payload["rangerName"]),
    description,
    hope: Number.isFinite(hope) ? Math.min(Math.max(Math.floor(hope), 0), HOPE_LIMIT) : 0,
  };
}

/**
 * The GM's half: name the creatures, then record them. Runs only on the writing
 * GM's client, so a table with three GMs logged in gets one dialog.
 */
async function runTrackerPicker(request: TrackRequest): Promise<void> {
  const ranger = (await fromUuid(request.rangerUuid)) as AnyObject | null;
  if (!ranger) {
    console.debug(`${LOG_PREFIX} ${LABEL}: ${request.rangerUuid} is not here; nothing recorded.`);
    return;
  }

  const chosen = await chooseActors({
    title: game.i18n.localize("EE.Features.GiftedTracker.Title"),
    intro: game.i18n.format("EE.Features.GiftedTracker.GmIntro", {
      name: request.rangerName || String(ranger["name"] ?? ""),
      hope: request.hope,
    }),
    note: request.description,
    confirmLabel: game.i18n.localize("EE.Features.GiftedTracker.Confirm"),
    cancelLabel: game.i18n.localize("EE.Features.PromptCancel"),
    types: QUARRY_TYPES,
  });

  if (chosen.length === 0) {
    // A GM who backs out has decided the tracks lead nowhere mechanical. That is
    // a legitimate answer, so it is reported rather than retried.
    ui.notifications?.info(game.i18n.localize("EE.Features.GiftedTracker.NothingRecorded"));
    return;
  }

  await recordTracking(ranger, request, chosen);
}

/**
 * Write the tracking onto the ranger, as an ActiveEffect carrying the quarry.
 *
 * ## Why the effect *is* the record
 *
 * Rather than a flag on the actor with an effect beside it for show. The table
 * needs to see that the tracking exists, the ranger needs a way to end it, and
 * both of those are what an ActiveEffect already is — deleting it from the sheet
 * is the "or you stop tracking them" the card never spells out. Storing the
 * quarry anywhere else would let the two drift apart.
 *
 * It carries **no `changes`**. The +1 is conditional, and a change here would be
 * the very always-on bonus this feature exists to replace.
 *
 * ## One tracking at a time
 *
 * Using the card again **ends the previous tracking**, so a ranger holds exactly
 * one of these. Most of "until you stop tracking them" is a conversation the
 * table has and then settles by deleting the effect — there is no trigger to
 * hang it on, and inventing one (a rest, a scene change, a distance) would be
 * inventing rules. Starting on a fresh set of tracks is the one moment the
 * system can be certain the old ones have been left behind, so it is the one
 * that is automated.
 *
 * Replacement happens **only when a new tracking is actually recorded**. A GM who
 * backs out of the picker has decided these tracks lead nowhere mechanical, and a
 * cancel must not have the side effect of destroying what the ranger was already
 * following. Clearing first also makes a retry after a half-failed write
 * idempotent, which is the same order `gm-effects.ts` uses.
 */
async function recordTracking(
  ranger: AnyObject,
  request: TrackRequest,
  chosen: ActorChoice[],
): Promise<void> {
  const quarry: Quarry[] = chosen.map((choice) => ({
    uuid: choice.uuid,
    name: choice.name,
    img: choice.img,
  }));

  const tracking: Tracking = { description: request.description, hope: request.hope, quarry };
  const names = quarry.map((entry) => entry.name).join(", ");
  const replaced = await endTracking(ranger);

  try {
    await ranger["createEmbeddedDocuments"]?.("ActiveEffect", [
      {
        name: game.i18n.format("EE.Features.GiftedTracker.EffectName", {
          quarry: summarize(quarry),
        }),
        img: EFFECT_IMG,
        description: `<p>${escapeHtml(
          game.i18n.format("EE.Features.GiftedTracker.EffectDescription", { names }),
        )}</p><blockquote>${escapeHtml(request.description)}</blockquote>`,
        disabled: false,
        transfer: false,
        type: "base",
        system: { changes: [] },
        flags: { [MODULE_ID]: { [FLAGS.giftedTracker]: tracking } },
      },
    ]);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not record the tracking.`, error);
    return;
  }

  await announceTracking(ranger, request, names, replaced);
}

/**
 * Delete every tracking this ranger is holding. Returns what was being tracked,
 * as a readable list, or an empty string when there was nothing.
 *
 * Deliberately not exported and not hooked to anything else: the *only* thing
 * that ends a tracking automatically is starting a new one. Everything else —
 * losing the trail, giving up, the creature dying — is the table's call, made by
 * deleting the effect from the sheet, and there is no event in Foundry that
 * honestly stands for any of them.
 *
 * A failed delete is logged and swallowed rather than aborting the new record. A
 * ranger briefly holding two trackings is a cosmetic problem the GM can fix by
 * hand; a ranger who paid Hope and got nothing is not.
 */
async function endTracking(ranger: AnyObject): Promise<string> {
  const effects = trackingEffectsOn(ranger);
  if (effects.length === 0) return "";

  const names = effects
    .flatMap((effect) =>
      ((effect["flags"][MODULE_ID][FLAGS.giftedTracker] as Tracking).quarry ?? []).map(
        (entry) => entry.name,
      ),
    )
    .filter((name) => name.length > 0)
    .join(", ");

  try {
    await ranger["deleteEmbeddedDocuments"]?.(
      "ActiveEffect",
      effects.map((effect) => String(effect["id"] ?? "")),
    );
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not end the previous tracking.`, error);
    return "";
  }

  return names;
}

/**
 * Post the record to chat.
 *
 * **Whispered to the GM and the ranger's owners**, not to the table. The quarry
 * is a list of statblock names the GM has just chosen, which is a straightforward
 * spoiler for everyone who has not met them yet — while the ranger themselves has
 * legitimately just been told the answers, having paid for them.
 *
 * Says what was dropped as well as what was taken up, when the new tracking
 * replaced one. Losing an Evasion bonus you were counting on is exactly the kind
 * of quiet change that should not be discovered three rolls later.
 */
async function announceTracking(
  ranger: AnyObject,
  request: TrackRequest,
  names: string,
  replaced: string,
): Promise<void> {
  const ended = replaced
    ? `<p><em>${escapeHtml(
        game.i18n.format("EE.Features.GiftedTracker.Replaced", { names: replaced }),
      )}</em></p>`
    : "";

  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: ranger }),
      content: `<p><strong>${escapeHtml(
        game.i18n.localize("EE.Features.GiftedTracker.Title"),
      )}</strong></p><p>${escapeHtml(
        game.i18n.format("EE.Features.GiftedTracker.Announced", {
          name: request.rangerName || String(ranger["name"] ?? ""),
          hope: request.hope,
          names,
        }),
      )}</p><blockquote>${escapeHtml(request.description)}</blockquote>${ended}`,
      whisper: confidants(ranger),
    });
  } catch (error) {
    // The tracking is recorded either way; losing the announcement must not cost
    // the player the effect they paid for.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the tracking.`, error);
  }
}

/** Listen for requests from players. Called once during `init`. */
function registerTrackerSocket(): void {
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      if (payload?.["type"] !== TRACK) return;
      if (!enabled() || !isWriter()) return;

      const request = readRequest((payload["request"] ?? {}) as AnyObject);
      if (!request) {
        console.warn(`${LOG_PREFIX} ${LABEL}: ignoring an unrecognised tracking request.`);
        return;
      }

      void runTrackerPicker(request);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not handle a tracking request.`, error);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  The bonus                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Say that the bonus is why the attack missed.
 *
 * **Only when it changed the outcome.** A passive that silently moves a defence
 * number needs to explain itself at the moment it matters, and needs to stay
 * quiet the rest of the time — a tracked creature that hits for 18 against
 * Evasion 12 would still have hit at 13, and announcing that on every swing would
 * bury the one message that counts. The same judgement `evasionDecides` makes
 * elsewhere in this window: do not spend the table's attention on a change that
 * changed nothing.
 *
 * Whispered exactly as far as the attack itself will be. This runs on whichever
 * client rolled the attack — the GM's, for an adversary — so a blind or private
 * roll must not have its outcome explained to a table that cannot see it.
 */
async function announceBonus(context: AdversaryAttackContext, before: number): Promise<void> {
  try {
    const { whisper, blind } = rollVisibility(context.config);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: context.actor }),
      content: `<p>${escapeHtml(
        game.i18n.format("EE.Features.GiftedTracker.Evaded", {
          name: String(context.actor["name"] ?? ""),
          attacker: String(context.attacker["name"] ?? ""),
          before,
          after: before + EVASION_BONUS,
        }),
      )}</p>`,
      ...(whisper ? { whisper } : {}),
      blind,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not post the Evasion bonus.`, error);
  }
}

/**
 * "When you encounter creatures you've tracked in this way, gain a +1 bonus to
 * your Evasion against them."
 *
 * Non-optional: the rule is not a choice and costs nothing, so it applies without
 * asking. The window's own loop runs every non-optional offer before it prompts
 * for anything else, which also means a reaction like I See It Coming is decided
 * against the Evasion this has already raised.
 *
 * The gates are the same three I See It Coming uses, and for the same reasons:
 * the attack has to be landing on this character (`isHitTarget` — +1 against an
 * attack that already missed buys nothing), Evasion has to be the number in play
 * (`evasionDecides` — an attack against a fixed difficulty is not looking at it),
 * and the rule's own condition has to hold.
 */
function registerTrackerEvasion(): void {
  registerFeature<AdversaryAttackContext>({
    id: FEATURE_ID,
    window: "adversaryAttack",
    priority: REWRITE_PRIORITY,
    optional: false,
    match: MATCH,
    labelKey: "EE.Features.GiftedTracker.Label",
    hintKey: "EE.Features.GiftedTracker.Hint",

    enabled,

    when: (context) =>
      context.isHitTarget && context.evasionDecides && isQuarry(context.actor, context.attacker),

    apply: async (context) => {
      // Read before the change so the announcement can print both halves of it.
      const before = Number(context.actor["system"]?.["evasion"] ?? 0);

      context.raiseEvasion(EVASION_BONUS);
      // `raiseEvasion` re-decides the hit and refreshes `isHitTarget`, so this
      // reads the outcome as it stands *after* the bonus, not before it.
      if (!context.isHitTarget) await announceBonus(context, before);
    },
  });
}

/**
 * Install the card, the socket listener and the bonus.
 *
 * The un-targeting rule is registered here rather than patched here: the shared
 * patch in `card-targeting.ts` installs itself at `setup`, and this only has to
 * say which actions it applies to.
 */
export function registerGiftedTracker(): void {
  registerTrackerCard();
  registerTrackerSocket();
  registerTrackerEvasion();

  // "You're tracking a creature based on signs of their passage" — there is
  // nothing present to target, and the card's `target.type: "any"` is left over
  // from the effect this feature replaces.
  untargetAction((action) => enabled() && trackerCardAction(action) !== null);
}
