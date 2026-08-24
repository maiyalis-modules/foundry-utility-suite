/**
 * Relay Daggerheart action effects through the active GM when the acting player
 * does not own the target.
 *
 * Daggerheart's `EffectsField.applyEffect` copies an effect embedded in the
 * action's Item onto each hit target. Core requires OWNER of that target, so the
 * copy fails for the ordinary player -> adversary case. This wrapper leaves
 * owned targets alone and asks the writing GM to perform only that copy.
 *
 * The socket never carries ActiveEffect data. It carries the UUID of the source
 * effect, which the GM resolves again, plus the target UUID. The GM also checks
 * that the requesting user owns the actor containing the source Item. That is
 * intentionally narrower than relaying arbitrary `preCreateActiveEffect` calls,
 * which would turn the module socket into a general privileged document writer.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, SOCKET_EVENT } from "../constants.js";
import { isWriter } from "../utils/is-writer.js";

const REQUEST = "gmActionEffectRequest";
const RESULT = "gmActionEffectResult";
const RESPONSE_TIMEOUT_MS = 10_000;
const MAX_COMPLETED_REQUESTS = 200;

type ResultCode = "ok" | "disabled" | "invalid" | "unauthorized" | "failed";

interface RelayRequest {
  requestId: string;
  userId: string;
  effectUuid: string;
  targetActorUuid: string;
}

interface RelayResult {
  ok: boolean;
  code: ResultCode;
}

/** The unwrapped Daggerheart method, retained for local and GM-side application. */
let originalApplyEffect: ((effect: AnyObject, actor: AnyObject) => Promise<unknown>) | null = null;
let effectsField: AnyObject | null = null;
let nextRequest = 0;

/** Requests this client is waiting for, keyed by their correlation id. */
const pending = new Map<string, (result: RelayResult) => void>();

/** Completed work on the writing GM, so a duplicate delivery cannot apply twice. */
const completed = new Map<string, Promise<RelayResult>>();

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.relayActionEffects) === true;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRequest(payload: AnyObject): RelayRequest | null {
  const requestId = text(payload["requestId"]);
  const userId = text(payload["userId"]);
  const effectUuid = text(payload["effectUuid"]);
  const targetActorUuid = text(payload["targetActorUuid"]);
  if (!requestId || !userId || !effectUuid || !targetActorUuid) return null;
  return { requestId, userId, effectUuid, targetActorUuid };
}

function newRequestId(): string {
  nextRequest += 1;
  return `${game.user?.id ?? "?"}-${Date.now()}-${nextRequest}`;
}

function canWrite(actor: AnyObject): boolean {
  return actor?.["testUserPermission"]?.(game.user, "OWNER") === true;
}

/**
 * The actor above an Item-embedded effect. An effect that is not embedded in an
 * Item is not a Daggerheart action effect and is deliberately not relayable.
 */
function sourceActorOf(effect: AnyObject): AnyObject | null {
  if (effect?.["documentName"] !== "ActiveEffect") return null;
  const item = effect?.["parent"];
  if (item?.["documentName"] !== "Item") return null;
  const actor = item["parent"];
  return actor?.["testUserPermission"] ? actor : null;
}

function notifyFailure(code: ResultCode): void {
  const key =
    code === "disabled"
      ? "EE.ActionEffectRelay.Disabled"
      : code === "unauthorized"
        ? "EE.ActionEffectRelay.Unauthorized"
        : code === "invalid"
          ? "EE.ActionEffectRelay.Invalid"
          : "EE.ActionEffectRelay.Failed";
  ui.notifications?.error(game.i18n.localize(key));
}

/** Ask the active GM to apply one source effect to one target and await its result. */
async function relay(effect: AnyObject, actor: AnyObject): Promise<void> {
  const effectUuid = text(effect?.["uuid"]);
  const targetActorUuid = text(actor?.["uuid"]);
  const userId = text(game.user?.id);
  if (!effectUuid || !targetActorUuid || !userId) {
    notifyFailure("invalid");
    return;
  }

  if (!game.users?.activeGM || !game.socket) {
    ui.notifications?.error(game.i18n.localize("EE.ActionEffectRelay.NoGM"));
    return;
  }

  const requestId = newRequestId();
  const answered = new Promise<RelayResult>((resolve) => {
    pending.set(requestId, resolve);
    setTimeout(() => {
      if (!pending.delete(requestId)) return;
      resolve({ ok: false, code: "failed" });
    }, RESPONSE_TIMEOUT_MS);
  });

  game.socket.emit(SOCKET_EVENT, {
    type: REQUEST,
    requestId,
    userId,
    effectUuid,
    targetActorUuid,
  });

  const result = await answered;
  if (!result.ok) notifyFailure(result.code);
}

/** Resolve and validate a request, then let Daggerheart perform its normal copy. */
async function applyRequest(request: RelayRequest): Promise<RelayResult> {
  if (!enabled()) return { ok: false, code: "disabled" };
  if (!originalApplyEffect || !effectsField) return { ok: false, code: "failed" };

  const user = game.users?.get(request.userId);
  if (!user || user["active"] !== true || user["isGM"] === true) {
    return { ok: false, code: "unauthorized" };
  }

  const [effect, target] = await Promise.all([
    fromUuid(request.effectUuid, { strict: false }),
    fromUuid(request.targetActorUuid, { strict: false }),
  ]);
  if (!effect || !target) return { ok: false, code: "invalid" };
  if (target["documentName"] !== "Actor") return { ok: false, code: "invalid" };
  const sourceActor = sourceActorOf(effect);
  if (!sourceActor) return { ok: false, code: "invalid" };

  // The request must come from a user who owns the action's actor, and it must
  // actually be needed. Owned targets stay on the initiating client's normal
  // path and cannot be used to bounce redundant writes through the GM.
  if (sourceActor["testUserPermission"]?.(user, "OWNER") !== true) {
    return { ok: false, code: "unauthorized" };
  }
  if (target["testUserPermission"]?.(user, "OWNER") === true) {
    return { ok: false, code: "invalid" };
  }

  try {
    await originalApplyEffect.call(effectsField, effect, target);
    return { ok: true, code: "ok" };
  } catch (error) {
    console.warn(`${LOG_PREFIX} Action effect relay: GM application failed.`, error);
    return { ok: false, code: "failed" };
  }
}

function remember(request: RelayRequest): Promise<RelayResult> {
  const prior = completed.get(request.requestId);
  if (prior) return prior;

  const result = applyRequest(request);
  completed.set(request.requestId, result);
  if (completed.size > MAX_COMPLETED_REQUESTS) {
    const oldest = completed.keys().next().value as string | undefined;
    if (oldest) completed.delete(oldest);
  }
  return result;
}

async function handleRequest(payload: AnyObject): Promise<void> {
  if (!isWriter()) return;
  const request = readRequest(payload);
  if (!request) return;

  const result = await remember(request);
  game.socket?.emit(SOCKET_EVENT, {
    type: RESULT,
    requestId: request.requestId,
    userId: request.userId,
    result,
  });
}

function handleResult(payload: AnyObject): void {
  if (payload["userId"] !== game.user?.id) return;
  const requestId = text(payload["requestId"]);
  const resolve = pending.get(requestId);
  if (!resolve) return;

  const result = payload["result"] as RelayResult | undefined;
  const code = text(result?.code) as ResultCode;
  pending.delete(requestId);
  resolve(
    result?.ok === true && code === "ok"
      ? { ok: true, code: "ok" }
      : { ok: false, code: ["disabled", "invalid", "unauthorized", "failed"].includes(code) ? code : "failed" },
  );
}

/** Install the wrapper once the system has finished publishing its API. */
function installWrapper(): void {
  const field = game.system.api?.fields?.ActionFields?.EffectsField ?? null;
  const current = field?.["applyEffect"];
  if (typeof current !== "function") {
    console.warn(`${LOG_PREFIX} Action effect relay: Daggerheart EffectsField.applyEffect is unavailable.`);
    return;
  }

  effectsField = field;
  originalApplyEffect = current;
  field["applyEffect"] = async function (effect: AnyObject, actor: AnyObject): Promise<unknown> {
    if (!enabled() || game.user?.isGM || canWrite(actor)) {
      return originalApplyEffect?.call(this, effect, actor);
    }
    return relay(effect, actor);
  };
}

/** Register the socket exchange now and defer the system patch until `setup`. */
export function registerGmActionEffects(): void {
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      if (payload?.["type"] === REQUEST) void handleRequest(payload);
      else if (payload?.["type"] === RESULT) handleResult(payload);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Action effect relay: could not handle a socket message.`, error);
    }
  });

  // The system fills `game.system.api` during its own init work. Setup is the
  // first lifecycle point at which the public EffectsField seam is guaranteed.
  Hooks.once("setup", installWrapper);
}
