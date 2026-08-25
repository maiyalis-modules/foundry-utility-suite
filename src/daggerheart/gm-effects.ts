/**
 * Putting a marker ActiveEffect on somebody else's actor, via the GM.
 *
 * ## The gap this fills
 *
 * Core requires OWNER of the parent to create an ActiveEffect
 * (`BaseActiveEffect.#canCreate`), and an adversary belongs to the GM. So a
 * player's client cannot mark an adversary, full stop — and the Daggerheart
 * system does not paper over it: its `EffectsField.applyEffect` calls
 * `ActiveEffect.implementation.create(data, { parent: actor })` directly, so its
 * own "players apply effects" automation raises "lacks permission to create
 * ActiveEffect" and stops. (Contrast `Actor#modifyResource`, which *does* relay
 * through the system's `emitGMUpdate`, which is why a player marking an
 * adversary's Stress works.)
 *
 * This is the missing half: a one-way request that an active GM's client turns
 * into the write.
 *
 * ## Nothing off the socket is trusted
 *
 * The payload is a **description of a mark**, never effect data. The GM's client
 * builds the ActiveEffect itself from a fixed shape — name, image, flag — so the
 * worst a malformed or hostile message can do is put a labelled, changeless
 * marker on an actor, which is a thing that client could do from the token HUD
 * anyway. It can never carry `changes`, `statuses`, a duration or a script. Same
 * principle as `feature-ask.ts`: the wire carries an intent, and the receiving
 * client decides what that intent means.
 *
 * One GM applies it — `isWriter` picks the same single client the Session Log
 * uses — so a table with three GMs logged in gets one effect, not three.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SOCKET_EVENT } from "../constants.js";
import { isWriter } from "../utils/is-writer.js";

/** Socket message discriminators, namespaced by `type` like the rest of the channel. */
const MARK = "gmEffectMark";
const CLEAR = "gmEffectClear";

/**
 * One kind of marker this module knows how to place. Keeping it an enum-ish
 * union rather than a free string is half of why the payload is safe: the GM
 * looks the request up here and refuses anything it does not recognise.
 */
export type MarkKind = "rangersFocus" | "blightingStrike" | "tetheredTalisman";

/** What a mark request carries. Flat, JSON-safe, and entirely descriptive. */
export interface MarkRequest {
  /** Which marker to place. */
  kind: MarkKind;
  /** The actor to mark — an Actor or ActorDelta uuid. */
  actorUuid: string;
  /** Display name of whoever is doing the marking, for the effect's label. */
  sourceName: string;
  /** The marking actor's uuid, so the mark can be found and cleared later. */
  sourceUuid: string;
}

/** The flag key each kind writes, and how it labels and illustrates itself. */
const MARKS: Record<MarkKind, { flag: string; nameKey: string; descriptionKey: string; img: string }> =
  {
    rangersFocus: {
      flag: FLAGS.rangersFocusTarget,
      nameKey: "EE.Features.RangersFocus.TargetEffectName",
      descriptionKey: "EE.Features.RangersFocus.TargetEffectDescription",
      img: "icons/magic/perception/eye-ringed-green.webp",
    },
    blightingStrike: {
      flag: FLAGS.blightingStrikeMark,
      nameKey: "EE.Features.BlightingStrike.MarkName",
      descriptionKey: "EE.Features.BlightingStrike.MarkDescription",
      img: "icons/magic/unholy/strike-beam-blood-red-purple.webp",
    },
    tetheredTalisman: {
      flag: FLAGS.tetheredTalisman,
      nameKey: "EE.Features.TetheredTalisman.EffectName",
      descriptionKey: "EE.Features.TetheredTalisman.EffectDescription",
      // The Void's own art for the card, so the effect and the feature look like
      // the same thing on two different sheets.
      img: "icons/equipment/neck/necklace-simple-carved-arrow.webp",
    },
  };

/** Is `value` a usable, non-empty string? */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validate an arriving payload into a request, or null. */
function readRequest(payload: AnyObject): MarkRequest | null {
  const kind = text(payload["kind"]) as MarkKind;
  if (!(kind in MARKS)) return null;

  const actorUuid = text(payload["actorUuid"]);
  const sourceUuid = text(payload["sourceUuid"]);
  if (!actorUuid || !sourceUuid) return null;

  return { kind, actorUuid, sourceUuid, sourceName: text(payload["sourceName"]) };
}

/** The mark of this kind on this actor, placed by this source, if any. */
function existingMark(actor: AnyObject, kind: MarkKind, sourceUuid: string): AnyObject | null {
  const { flag } = MARKS[kind];

  for (const effect of actor["effects"] ?? []) {
    const mark = effect?.["flags"]?.[MODULE_ID]?.[flag];
    if (mark && String(mark["sourceUuid"] ?? "") === sourceUuid) return effect;
  }

  return null;
}

/** Place the mark. Runs only on the writing GM's client. */
async function applyMark(request: MarkRequest): Promise<void> {
  const actor = fromUuidSync(request.actorUuid) as AnyObject | null;
  if (!actor) {
    console.debug(`${LOG_PREFIX} GM effects: ${request.actorUuid} is not here; nothing marked.`);
    return;
  }

  // Replacing rather than stacking: every mark here means "one source, one
  // subject", so a second request from the same source is a move, not a second
  // marker. Clearing first also keeps a retry after a failed write idempotent.
  await clearMark(request);

  const { nameKey, descriptionKey, img, flag } = MARKS[request.kind];

  await actor["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.format(nameKey, { source: request.sourceName }),
      img,
      description: game.i18n.localize(descriptionKey),
      disabled: false,
      transfer: false,
      type: "base",
      // Never anything mechanical. This is a label the table can see, and the
      // reason the payload can be trusted at all — see the header.
      system: { changes: [] },
      flags: { [MODULE_ID]: { [flag]: { sourceUuid: request.sourceUuid } } },
    },
  ]);
}

/** Take the mark off again. Runs only on the writing GM's client. */
async function clearMark(request: MarkRequest): Promise<void> {
  const actor = fromUuidSync(request.actorUuid) as AnyObject | null;
  if (!actor) return;

  const effect = existingMark(actor, request.kind, request.sourceUuid);
  if (!effect) return;

  await actor["deleteEmbeddedDocuments"]?.("ActiveEffect", [effect["id"]]);
}

/**
 * Ask for a marker to be placed on `request.actorUuid`.
 *
 * Applied directly when this client can already write it — a GM acting for
 * themselves, or a player who happens to own the subject — and sent over the
 * socket otherwise. Fire-and-forget in the remote case: nothing waits on a
 * cosmetic marker, and the caller's own state is not conditional on it.
 */
export async function markActor(request: MarkRequest): Promise<void> {
  try {
    if (canWriteTo(request.actorUuid)) {
      await applyMark(request);
      return;
    }

    game.socket?.emit(SOCKET_EVENT, { type: MARK, request });
  } catch (error) {
    console.warn(`${LOG_PREFIX} GM effects: could not mark ${request.actorUuid}.`, error);
  }
}

/** The reverse. Same routing, same reasoning. */
export async function unmarkActor(request: MarkRequest): Promise<void> {
  try {
    if (canWriteTo(request.actorUuid)) {
      await clearMark(request);
      return;
    }

    game.socket?.emit(SOCKET_EVENT, { type: CLEAR, request });
  } catch (error) {
    console.warn(`${LOG_PREFIX} GM effects: could not unmark ${request.actorUuid}.`, error);
  }
}

/**
 * Can this client create an ActiveEffect on that actor?
 *
 * The same question core asks in `BaseActiveEffect.#canCreate` — OWNER of the
 * parent — asked ahead of time so the ordinary case never touches the socket.
 */
function canWriteTo(actorUuid: string): boolean {
  const actor = fromUuidSync(actorUuid) as AnyObject | null;
  return actor?.["testUserPermission"]?.(game.user, "OWNER") === true;
}

/**
 * Listen for requests. Called once during `init`.
 *
 * Only the writing GM acts, so the effect is created once however many GMs are
 * connected — and on a table with no GM at all, nothing happens, which is the
 * right answer for a marker nobody is there to read.
 */
export function registerGmEffects(): void {
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      const type = payload?.["type"];
      if (type !== MARK && type !== CLEAR) return;
      if (!isWriter()) return;

      const request = readRequest((payload["request"] ?? {}) as AnyObject);
      if (!request) {
        console.warn(`${LOG_PREFIX} GM effects: ignoring an unrecognised mark request.`);
        return;
      }

      void (type === MARK ? applyMark(request) : clearMark(request));
    } catch (error) {
      console.warn(`${LOG_PREFIX} GM effects: could not handle a mark request.`, error);
    }
  });
}
