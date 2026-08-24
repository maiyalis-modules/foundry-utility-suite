/**
 * Asking the *right person* — the socket round-trip behind reaction features.
 *
 * ## The problem it exists for
 *
 * `DHRoll.buildPost` runs on the client that made the roll, and for an adversary
 * attack that client is the GM's. But a reaction like Blood Maledict spends a
 * *player's* Hope, and deciding to spend 3 Hope is not the GM's call. So the
 * window has to pause on the GM's client, put the question on someone else's
 * screen, and resume with their answer.
 *
 * Foundry has no request/response over its socket — `emit` is fire-and-forget to
 * every other client — so this adds the thin layer that makes one: a correlation
 * id, a map of promises waiting on it, and a timeout so a client that closed its
 * laptop cannot hold the whole table's roll open forever.
 *
 * ## Who answers
 *
 * The active non-GM owner of the actor, preferring the player who has it assigned
 * as their character. When nobody who owns it is connected, the question falls
 * back to whoever is running the roll — the GM, who is then playing that
 * character's reactions anyway.
 *
 * ## What is trusted
 *
 * Nothing that arrives on the socket is acted on directly. The answer is a list
 * of feature ids, and the *asking* client re-checks each one against the offers
 * it built before applying anything — so a malformed or stale reply can only ever
 * result in fewer features firing, never in an unearned one. The costs are also
 * charged by the asking client, which keeps the whole transaction on one machine:
 * a player disconnecting between "yes" and the reroll cannot leave their Hope
 * spent on nothing.
 */
import { LOG_PREFIX, SOCKET_EVENT } from "../constants.js";
import { chooseOffers, PROMPT_TIMEOUT_MS, type PromptRequest } from "./feature-prompt.js";
import type { FeatureContextBase, FeatureOffer } from "./feature-registry.js";

/** Socket message discriminators. Namespaced by `type` so the channel can carry more later. */
const ASK = "featureAsk";
const ANSWER = "featureAnswer";

/**
 * How much longer the asking client waits than the answering one.
 *
 * The remote dialog closes itself at {@link PROMPT_TIMEOUT_MS}, so in every
 * normal case — including "they ignored it" — the answer arrives on its own. This
 * grace period only decides how long we wait for a client that has stopped
 * responding at all, and it exists so the two timers can't race into a spurious
 * "no answer" for a player who replied on the last second.
 */
const ANSWER_GRACE_MS = 5_000;

/** Requests this client is waiting on, by correlation id. */
const pending = new Map<string, (chosen: string[]) => void>();

/** Correlation ids. Scoped by user id, so two clients can never collide. */
let nextRequest = 0;
function newRequestId(): string {
  nextRequest += 1;
  return `${game.user?.id ?? "?"}-${Date.now()}-${nextRequest}`;
}

/**
 * Localize a set of registry offers into the flat, socket-safe shape the dialog
 * needs. Localization happens *here*, on the asking client, rather than on the
 * answering one — which is a small inaccuracy if two clients run different
 * languages, and the alternative (shipping keys and localizing remotely) breaks
 * the moment a hint needs data interpolated into it.
 */
export function toPromptOffers<C extends FeatureContextBase>(
  offers: readonly FeatureOffer<C>[],
): PromptRequest["offers"] {
  return offers.map((offer) => ({
    id: offer.feature.id,
    label: game.i18n.localize(offer.feature.labelKey),
    hint: offer.feature.hintKey ? game.i18n.localize(offer.feature.hintKey) : undefined,
    itemName: String(offer.item["name"] ?? ""),
    useLabel: offer.feature.useLabelKey
      ? game.i18n.localize(offer.feature.useLabelKey)
      : undefined,
    skipLabel: offer.feature.skipLabelKey
      ? game.i18n.localize(offer.feature.skipLabelKey)
      : undefined,
  }));
}

/**
 * Which user should be asked about `actor`.
 *
 * Returns this client's own id when there is nobody better, which makes
 * {@link askUser} take the local path and skip the socket entirely.
 */
export function responderFor(actor: AnyObject): string {
  const self = game.user?.id ?? "";
  const users = game.users?.contents ?? [];

  const owners = users.filter(
    (user) =>
      user["active"] === true &&
      user["isGM"] !== true &&
      actor["testUserPermission"]?.(user, "OWNER") === true,
  );
  if (owners.length === 0) return self;

  // `character.id` rather than uuid: an unlinked token's actor is a synthetic
  // ActorDelta whose id is still the base actor's, so this matches either way.
  const assigned = owners.find((user) => user["character"]?.["id"] === actor["id"]);
  return String((assigned ?? owners[0])?.["id"] ?? self);
}

/**
 * Put `request` on `userId`'s screen and wait for their answer.
 *
 * Resolves to the feature ids they accepted — empty for a decline, a dismissal, a
 * timeout, or a client that never replied. Every one of those means "let the
 * unmodified outcome through", which is the only safe default for a caller that
 * is holding a roll open.
 */
export async function askUser(userId: string, request: PromptRequest): Promise<Set<string>> {
  if (request.offers.length === 0) return new Set();

  // Our own question: no socket, no timeout bookkeeping, just the dialog.
  if (userId === game.user?.id) return chooseOffers(request);

  const socket = game.socket;
  if (!socket) {
    console.warn(`${LOG_PREFIX} Feature ask: no socket — asking locally instead.`);
    return chooseOffers(request);
  }

  // The asking client's roll is frozen until this comes back — no chat card, no
  // damage — so say whose screen everyone is waiting on. Without it a GM watching
  // nothing happen for half a minute has no way to tell this apart from a bug.
  const waitingOn = game.users?.get(userId)?.["name"];
  if (waitingOn) {
    ui.notifications?.info(
      game.i18n.format("EE.Features.AwaitingReaction", { user: String(waitingOn) }),
    );
  }

  const requestId = newRequestId();
  const answered = new Promise<string[]>((resolve) => {
    pending.set(requestId, resolve);
    setTimeout(() => {
      // `delete` returning true means we are the ones ending this wait, so the
      // late arrival of a real answer can never resolve it twice.
      if (pending.delete(requestId)) {
        console.debug(`${LOG_PREFIX} Feature ask: ${userId} did not answer in time.`);
        resolve([]);
      }
    }, PROMPT_TIMEOUT_MS + ANSWER_GRACE_MS);
  });

  socket.emit(SOCKET_EVENT, { type: ASK, requestId, userId, request });
  return new Set(await answered);
}

/** Show a question that arrived from another client, and send the answer back. */
async function handleAsk(payload: AnyObject): Promise<void> {
  // Every client receives every emit; only the addressee responds.
  if (payload["userId"] !== game.user?.id) return;

  const request = payload["request"] as PromptRequest | undefined;
  if (!Array.isArray(request?.offers)) return;

  const chosen = await chooseOffers(request);
  game.socket?.emit(SOCKET_EVENT, {
    type: ANSWER,
    requestId: payload["requestId"],
    chosen: [...chosen],
  });
}

/** Resolve the promise waiting on an answer, if this client is the one that asked. */
function handleAnswer(payload: AnyObject): void {
  const resolve = pending.get(String(payload["requestId"]));
  if (!resolve) return;

  pending.delete(String(payload["requestId"]));
  const chosen = payload["chosen"];
  resolve(Array.isArray(chosen) ? chosen.map((id) => String(id)) : []);
}

/**
 * Listen for both halves of the exchange. Called once during `init`; requires
 * `"socket": true` in `module.json`, which is already declared.
 */
export function registerFeatureAsk(): void {
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      if (payload?.["type"] === ASK) void handleAsk(payload);
      else if (payload?.["type"] === ANSWER) handleAnswer(payload);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Feature ask: could not handle a socket message.`, error);
    }
  });
}
