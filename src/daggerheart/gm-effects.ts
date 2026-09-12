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
 * builds the ActiveEffect itself from a fixed shape — name, image, flag, and for
 * the one kind that carries a rule (`hex`) a fixed list of `changes` written in
 * this file — so the worst a malformed or hostile message can do is put one of
 * these known markers on an actor, which is a thing that client could do from
 * the token HUD anyway. Nothing on the wire can add a change, a status, a
 * duration or a script. The one thing a request can *point at* is an `origin`
 * Item, which the fixed changes resolve `ORIGIN.@…` against; it is accepted
 * only when it is an Item embedded in the actor the request names as its
 * source, so a client cannot borrow a bigger tier from somebody else's sheet.
 * Same principle as `feature-ask.ts`: the wire carries an intent, and the
 * receiving client decides what that intent means.
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
export type MarkKind = "rangersFocus" | "blightingStrike" | "tetheredTalisman" | "hex";

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
  /**
   * An Item on the marking actor to set as the effect's `origin`, for a kind
   * whose changes read `ORIGIN.@…`. Optional; checked on arrival, see the header.
   */
  originUuid?: string;
}

/** One change a mark's fixed shape carries, in the system's own field shape. */
interface MarkChange {
  key: string;
  type: "add" | "subtract" | "override";
  value: string;
  priority: null;
  phase: "initial";
}

/** How a kind of mark looks, and what — if anything — it does. */
interface MarkShape {
  flag: string;
  nameKey: string;
  descriptionKey: string;
  img: string;
  /**
   * The rule the mark carries, if any. Fixed here, never from the wire. A shape
   * with changes needs a valid `originUuid` on the request when any change
   * reads `ORIGIN.@…`, or the changes are left off — an unresolvable `ORIGIN`
   * would put a non-number into a subtract.
   */
  changes?: readonly MarkChange[];
  /** `system.duration.type`. Omitted means the system's default (none). */
  durationType?: string;
}

/** The flag key each kind writes, and how it labels and illustrates itself. */
const MARKS: Record<MarkKind, MarkShape> = {
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
  hex: {
    flag: FLAGS.hex,
    nameKey: "EE.Features.Hex.EffectName",
    descriptionKey: "EE.Features.Hex.EffectDescription",
    // The SRD card's own art, so the condition on the adversary and the
    // feature on the witch's sheet read as the same thing.
    img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
    // The SRD card's own effect, change for change: "a penalty to their damage
    // rolls and Difficulty equal to your tier", with the tier read off the
    // origin — the witch's card — by the system's `getChangeValue`.
    changes: [
      {
        key: "system.difficulty",
        type: "subtract",
        value: "ORIGIN.@tier",
        priority: null,
        phase: "initial",
      },
      {
        key: "system.bonuses.damage.physical.bonus",
        type: "subtract",
        value: "ORIGIN.@tier",
        priority: null,
        phase: "initial",
      },
      {
        key: "system.bonuses.damage.magical.bonus",
        type: "subtract",
        value: "ORIGIN.@tier",
        priority: null,
        phase: "initial",
      },
    ],
    // "Temporarily": the system's `temporary` is the one duration its rest and
    // session refreshes leave alone, which is what "no moment named" means.
    durationType: "temporary",
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

  const request: MarkRequest = {
    kind,
    actorUuid,
    sourceUuid,
    sourceName: text(payload["sourceName"]),
  };
  const originUuid = text(payload["originUuid"]);
  if (originUuid) request.originUuid = originUuid;
  return request;
}

/**
 * The `origin` this request may set, or null: an Item embedded in the source
 * actor, and nothing else. See the header on why this is checked here rather
 * than trusted.
 */
function acceptedOrigin(request: MarkRequest): string | null {
  if (!request.originUuid) return null;

  const item = fromUuidSync(request.originUuid) as AnyObject | null;
  if (!item || item["documentName"] !== "Item") return null;
  if (String(item["parent"]?.["uuid"] ?? "") !== request.sourceUuid) return null;

  return request.originUuid;
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

  const { nameKey, descriptionKey, img, flag, changes, durationType } = MARKS[request.kind];

  // Only the changes written in this file, and only when what they read
  // against is there. A kind with no changes is the label it always was.
  const origin = acceptedOrigin(request);
  const needsOrigin = (changes ?? []).some((change) => /origin\.@/i.test(change.value));
  const applied =
    changes && (!needsOrigin || origin) ? changes.map((change) => ({ ...change })) : [];
  if (changes && applied.length === 0) {
    console.warn(
      `${LOG_PREFIX} GM effects: ${request.kind} on ${request.actorUuid} has no usable origin; ` +
        "placing the label without its changes.",
    );
  }

  await actor["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.format(nameKey, { source: request.sourceName }),
      img,
      description: game.i18n.localize(descriptionKey),
      disabled: false,
      transfer: false,
      type: "base",
      ...(origin ? { origin } : {}),
      system: {
        changes: applied,
        ...(durationType ? { duration: { type: durationType, description: "" } } : {}),
      },
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
