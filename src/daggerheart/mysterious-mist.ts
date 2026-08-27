/**
 * **Mysterious Mist** (Codex domain, the *Book of Tyfar*) — "Make a Spellcast
 * Roll (13) to cast a temporary thick fog that gathers in a stationary area
 * within Very Close range. The fog heavily obscures this area and everything in
 * it."
 *
 * ## What the card already does, and the one thing it can't
 *
 * `Compendium.daggerheart.domains.Item.1VXzwRbvbBj5bd5V` carries three actions,
 * and this is the third. As an `attack` action with `roll.difficulty: 13`, no
 * damage and no effects, the whole first sentence is already automatic: press the
 * card, roll Spellcast against 13, read the result off the chat card. Nothing
 * here touches any of it.
 *
 * The second sentence is where it stops. The card's description ends with
 *
 * ```
 * @Template[type:emanation|range:vc]
 * ```
 *
 * — the system's own answer, and a *grid* answer: drop a measured emanation on
 * the canvas and read who is standing inside it. That is the correct
 * implementation for a table playing on a battlemap and it is worth nothing to a
 * table playing in the theatre of the mind, where "a stationary area within Very
 * Close range" has no coordinates to measure into. There is no fallback behind
 * it, so on such a table the fog is a sentence in the chat log.
 *
 * ## The reframing
 *
 * On a map the mist is a **region**, and the question is *is this token inside
 * it?* Without a map that question is unanswerable — and it is also the wrong
 * question, because what the table is actually tracking is a **roster**: who is
 * in the fog right now. That is a decision about the fiction, and the software's
 * job is to ask it rather than to compute it.
 *
 * So on a successful cast the GM — not the casting player, who does not decide
 * where an area lands or who is standing in it — is shown every token on the
 * scene and picks the ones the fog swallowed. Each gets the Hidden condition.
 *
 * ## Why the GM, and how the question gets to them
 *
 * `daggerheart.postUseAction` fires on the *casting* client, which is usually the
 * player's. The judgement belongs to the GM, and so does the write: the fog will
 * mostly land on adversaries, and core requires OWNER of the parent to create an
 * ActiveEffect (`BaseActiveEffect.#canCreate`), which no player has on an
 * adversary.
 *
 * Both problems have the same answer. The casting client sends one small message
 * — *this actor, on this scene, succeeded* — and the designated GM's client
 * (`isWriter`, the same single-writer pick the Session Log and `gm-effects.ts`
 * use) raises the dialog and does the writing. Nothing off the socket is acted on
 * directly: the payload names a caster and a scene, both of which are resolved
 * and validated locally, and every other decision — that the effect is Hidden,
 * what it is called, how long it lasts — is made from the fixed shape below. The
 * worst a malformed message can do is open a dialog the GM can dismiss.
 *
 * When the caster *is* the writing GM the socket is skipped entirely, the same
 * short-circuit `markActor` takes. When no GM is connected at all, nothing
 * happens — which is the right answer for a question only a GM can answer.
 *
 * ## Why the effect is written here rather than through `gm-effects.ts`
 *
 * That file relays a *marker*, and its header makes a promise worth keeping: the
 * payload is a description of a label, and the effect it builds "can never carry
 * `changes`, `statuses`, a duration or a script". This one is a `statuses` effect
 * — that is its entire point — so routing it through there would mean widening
 * that contract for one caller and weakening the reason every other caller is
 * safe.
 *
 * It costs nothing to keep them apart, because the dialog already runs on the
 * GM's client. A GM has OWNER on every token on the scene by definition, so the
 * write is local and needs no relay at all.
 *
 * ## What the effect is, and what it isn't
 *
 * `statuses: ["hidden"]` — the system's own condition, so it shows on the token
 * as the condition icon a GM could have clicked on themselves, and reads on the
 * sheet as the condition it is. What makes it worth more than that click is
 * {@link file://./hidden-condition.ts}, which is what turns Hidden from a sticker
 * into disadvantage on the dice. Without that file this one is a faster way to
 * apply a label; with it, the fog does what the card says it does.
 *
 * `duration.type: "temporary"`, matching the card's own word. That is not a timer
 * and is not meant to be one: `expireActiveEffects` explicitly filters `temporary`
 * out of everything it sweeps, which is the system stating that a temporary thing
 * ends when the table says so. So nothing here ever removes the fog — no scene
 * hook, no combat hook, no countdown. The GM clicks the icon off, which is one
 * click and always available.
 *
 * ## Three deliberate silences
 *
 * - **The previous fog is not dispersed on a recast.** Unlike Telepathy, this card
 *   nowhere says there may only be one, and nothing here models "the fog" as an
 *   object that could be replaced. Two casts obscure two groups. A creature
 *   already in a fog from this caster is simply not given a second copy.
 * - **An empty answer changes nothing.** `chooseUpTo` cannot tell a deliberate
 *   empty confirm from a dismissal or a timeout, and of the two readings the safe
 *   one is "leave it alone" — this module does not destroy state on a
 *   non-answer. The `emptyConfirm` guard is there so an empty press is at least a
 *   deliberate one.
 * - **Range is not measured.** "Within Very Close range" is checked by the person
 *   the dialog is asking. Measuring it would be re-introducing exactly the grid
 *   assumption the card's own `@Template` already makes and this file exists to
 *   route around.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS, SOCKET_EVENT } from "../constants.js";
import { isWriter } from "../utils/is-writer.js";
import { chooseUpTo, type PromptChoice } from "./feature-prompt.js";

/** The homebrew escape hatch, matched ahead of the compendium source. */
const FEATURE_ID = "mysteriousMist";

/** For log lines, matching the rest of the module. */
const LABEL = "Mysterious Mist";

/** The SRD card this comes from. */
const CARD_SOURCE = "Compendium.daggerheart.domains.Item.1VXzwRbvbBj5bd5V";

/** The card's own name, the last resort when a table has re-imported it. */
const CARD_NAME = "Book of Tyfar";

/** The action's id on the SRD card, and its printed name. */
const ACTION_ID = "WQ9XzpbtXl4SmVet";
const ACTION_NAME = "Mysterious Mist";

/** The Daggerheart condition id the fog applies. */
const HIDDEN = "hidden";

/** The card's own art for the action, so the icon and the card match. */
const MIST_IMG = "icons/magic/air/fog-gas-smoke-dense-gray.webp";

/**
 * The card's word for how long it lasts. A Daggerheart duration the system
 * deliberately never expires — see the header.
 */
const DURATION = "temporary";

/** Socket message discriminator, namespaced by `type` like the rest of the channel. */
const RAISE = "mysteriousMistRaise";

/** What the casting client tells the GM's client. Flat, JSON-safe, descriptive. */
interface MistRequest {
  /** The caster, so the fog can say whose it is. */
  casterUuid: string;
  /** Their display name, for the dialog's opening sentence. */
  casterName: string;
  /** The scene the cast happened on, so the GM is asked about the right tokens. */
  sceneId: string;
}

/** Whether the table wants this automated at all. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.mysteriousMistFog) === true;
}

/** Is `value` a usable, non-empty string? */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Case-insensitive name comparison, the way the rest of the module does it. */
function sameName(value: unknown, name: string): boolean {
  return text(value).toLowerCase() === name.toLowerCase();
}

/** Is this Item the *Book of Tyfar*? */
function isBookOfTyfar(item: AnyObject | null | undefined): boolean {
  if (!item) return false;

  // The homebrew escape hatch the feature registry uses, honoured here for the
  // same reason: a table that rewrote the card should still get the automation.
  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (text(item["_stats"]?.["compendiumSource"]) === CARD_SOURCE) return true;

  return sameName(item["name"], CARD_NAME);
}

/**
 * Is this the fog, rather than one of the card's other two actions?
 *
 * The card carries *two* `attack` actions, so type alone will not separate them —
 * but their shapes do, and the shapes survive a rename in a way the names do not.
 * Wild Flame deals damage and sets no difficulty; the fog deals none and sets 13.
 * The id and the printed name are checked first for the ordinary case and the
 * shape test carries the re-imported one.
 */
function isTheFog(action: AnyObject): boolean {
  if (text(action["type"]) !== "attack") return false;
  if (text(action["_id"]) === ACTION_ID) return true;
  if (sameName(action["name"], ACTION_NAME)) return true;

  const noDamage = !action["damage"]?.["main"];
  const hasDifficulty = Number.isFinite(Number(action["roll"]?.["difficulty"]));
  return noDamage && hasDifficulty;
}

/* ------------------------------------------------------------------ *
 * The fog itself
 * ------------------------------------------------------------------ */

/** Is this creature already in a fog cast by this caster? */
function alreadyMisted(actor: AnyObject, casterUuid: string): boolean {
  for (const effect of (actor["effects"] ?? []) as Iterable<AnyObject>) {
    const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.mysteriousMist];
    if (mark && text(mark["sourceUuid"]) === casterUuid) return true;
  }

  return false;
}

/**
 * Put the fog on one creature.
 *
 * Runs only on the writing GM's client, which owns every token on the scene, so
 * this is an ordinary local create with no relay behind it.
 */
async function obscure(actor: AnyObject, request: MistRequest): Promise<void> {
  await actor["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.localize("EE.Features.MysteriousMist.EffectName"),
      img: MIST_IMG,
      description: game.i18n.format("EE.Features.MysteriousMist.EffectDescription", {
        caster: request.casterName,
      }),
      disabled: false,
      transfer: false,
      type: "base",
      // The whole point: the system's own condition, so the token shows the icon
      // a GM would otherwise have clicked, and `hidden-condition.ts` finds it.
      statuses: [HIDDEN],
      // No `changes`. Hidden is a property of the rolls made against a creature,
      // not a number on its sheet — the same reason `FLAGS.hex` carries none.
      system: { changes: [], duration: { type: DURATION, description: "" } },
      flags: { [MODULE_ID]: { [FLAGS.mysteriousMist]: { sourceUuid: request.casterUuid } } },
    },
  ]);
}

/**
 * Every token on the scene, as something the dialog can render.
 *
 * Tokens rather than actors: two goblins in the fog are two answers, and an
 * unlinked token's actor is the ActorDelta that keeps them apart. Named by the
 * *token*, so "Minor Treant #2" reads as itself rather than as its statblock.
 */
function tokensOn(scene: AnyObject, request: MistRequest): PromptChoice[] {
  const choices: PromptChoice[] = [];
  const already = game.i18n.localize("EE.Features.MysteriousMist.AlreadyIn");

  for (const token of (scene["tokens"] ?? []) as Iterable<AnyObject>) {
    const actor = token?.["actor"] as AnyObject | null;
    const uuid = text(actor?.["uuid"]);
    if (!actor || !uuid) continue;

    choices.push({
      id: uuid,
      name: text(token["name"]) || text(actor["name"]),
      img: text(actor["img"]),
      // Shown rather than filtered out: the GM should be able to see the whole
      // scene in one list, including the parts of it that are already fogged.
      ...(alreadyMisted(actor, request.casterUuid) ? { detail: already } : {}),
    });
  }

  return choices;
}

/**
 * Ask the GM who the fog swallowed, and obscure them.
 *
 * Untimed: the cast has already resolved and its chat card has already posted, so
 * nothing anywhere is being held open while the GM decides. Expiring this would
 * only throw away an answer that cannot be given again.
 */
async function askAndObscure(request: MistRequest): Promise<void> {
  const scene =
    ((game.scenes?.get(request.sceneId) ?? null) as AnyObject | null) ??
    (canvas?.scene as AnyObject | null);

  if (!scene) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no scene to ask about; nothing obscured.`);
    return;
  }

  const choices = tokensOn(scene, request);
  if (choices.length === 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no tokens on ${text(scene["name"])}.`);
    return;
  }

  const picked = await chooseUpTo({
    title: game.i18n.localize("EE.Features.MysteriousMist.Title"),
    intro: game.i18n.format("EE.Features.MysteriousMist.Intro", {
      caster: request.casterName,
    }),
    choices,
    // No cap. "Everything in it" is however much of the scene the GM says the
    // fog reached, and the rule sets no number to enforce.
    max: choices.length,
    confirmLabel: game.i18n.localize("EE.Features.MysteriousMist.Confirm"),
    emptyConfirm: game.i18n.localize("EE.Features.MysteriousMist.EmptyConfirm"),
    untimed: true,
  });

  for (const uuid of picked) {
    const actor = fromUuidSync(uuid) as AnyObject | null;
    if (!actor) continue;
    // Re-checked here as well as in the list: the dialog may have been open a
    // while, and a second copy of the fog would be two icons meaning one thing.
    if (alreadyMisted(actor, request.casterUuid)) continue;

    await obscure(actor, request);
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Validate an arriving payload into a request, or null. */
function readRequest(payload: AnyObject): MistRequest | null {
  const casterUuid = text(payload["casterUuid"]);
  const sceneId = text(payload["sceneId"]);
  if (!casterUuid) return null;

  // The caster has to be somebody this client can see, or the fog has nobody to
  // belong to and the dialog has nothing to say.
  const caster = fromUuidSync(casterUuid) as AnyObject | null;
  if (!caster) return null;

  return {
    casterUuid,
    sceneId,
    // Read off the resolved actor rather than trusted from the wire — the name
    // goes into a dialog and into an effect's description.
    casterName: text(caster["name"]) || text(payload["casterName"]),
  };
}

/**
 * Route the question to whoever should answer it.
 *
 * Fire-and-forget in the remote case, like `markActor`: nothing on the casting
 * client is conditional on the fog, and the cast has already finished resolving.
 */
function requestMist(request: MistRequest): void {
  if (isWriter()) {
    void askAndObscure(request).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not raise the fog.`, error);
    });
    return;
  }

  if (!game.users?.activeGM) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no GM connected; nobody to ask.`);
    return;
  }

  game.socket?.emit(SOCKET_EVENT, { type: RAISE, request });
}

/** Decide whether this cast was the fog, and if so ask about it. */
function considerCast(action: AnyObject, config: AnyObject): void {
  if (!enabled()) return;

  // Silent gate: almost every action in the world is nothing to do with this
  // card. Past here every exit says why.
  if (!isTheFog(action)) return;
  if (!isBookOfTyfar(action["item"] as AnyObject | undefined)) return;

  // The card sets a difficulty of 13, so success is always knowable here — but
  // read the same way `vicious-entangle.ts` reads it, because a table that
  // cleared the difficulty would otherwise get a fog on a failed cast.
  if (config["roll"]?.["success"] !== true) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the cast did not succeed.`);
    return;
  }

  const caster = action["actor"] as AnyObject | undefined;
  const casterUuid = text(caster?.["uuid"]);
  if (!casterUuid) return;

  requestMist({
    casterUuid,
    casterName: text(caster?.["name"]),
    sceneId: text(canvas?.scene?.["id"]),
  });
}

/** Wire the card up. Called once during `init`. */
export function registerMysteriousMist(): void {
  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      considerCast(action, config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not consider the cast.`, error);
    }
  });

  // Only the writing GM acts, so one dialog opens however many GMs are connected.
  game.socket?.on(SOCKET_EVENT, (payload: AnyObject) => {
    try {
      if (payload?.["type"] !== RAISE) return;
      if (!isWriter() || !enabled()) return;

      const request = readRequest((payload["request"] ?? {}) as AnyObject);
      if (!request) {
        console.warn(`${LOG_PREFIX} ${LABEL}: ignoring an unrecognised fog request.`);
        return;
      }

      void askAndObscure(request).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not raise the fog.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not handle a fog request.`, error);
    }
  });
}
