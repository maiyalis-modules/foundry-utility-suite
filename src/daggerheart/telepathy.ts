/**
 * **Telepathy** (Codex domain, *Book of Illiat*, SRD p.124) — "Spend a Hope to
 * open a line of mental communication with one target you can see. This
 * connection lasts until your next rest or you cast Telepathy again."
 *
 * ## What the SRD ships, and what it leaves undone
 *
 * Telepathy is the third ability on the grimoire
 * `Compendium.daggerheart.domains.Item.df4iRqQzRntrF6Qw`, built as an `effect`
 * action: one Hope, `target.type: "any"` with `amount: 1`, no roll, and an
 * embedded *Telepathy* ActiveEffect. All of that already works, and **nothing
 * here touches any of it**:
 *
 * - **"one target you can see"** needs no help. The action's `range` is blank,
 *   and blank is the one range {@link withinActionRange} deliberately refuses to
 *   guess about — so nothing in this module or the system narrows the choice
 *   below "a token you can put a reticle on", which is the reading the table
 *   asked for.
 * - **The buff lands on its own.** `EffectsField.execute` filters targets with
 *   `!config.hasRoll || t.hitResult?.success`, and an `effect` action has no
 *   roll — so every chosen target is kept and `applyEffect` copies the effect
 *   across. This is the same "no roll, so nothing to filter on" rule the damage
 *   path had to be taught by hand; the effects path already knew it.
 *
 * What the card cannot express is the second sentence. Both of its clauses end
 * the connection and neither is enforced anywhere.
 *
 * ## Why "until your next rest" does not work by itself
 *
 * The shipped effect carries `system.duration.type: "shortRest"`, which looks
 * like it should be enough — the system has `expireActiveEffects`, and rests
 * call it. But it is called as `expireActiveEffects(this.actor, …)` from the
 * downtime application: it only ever sweeps the effects of **the actor who
 * rested**. The Telepathy effect is on the *target*. So the rest that the rule
 * names — the caster's — looks straight past it, and the target, who is usually
 * an adversary, never takes a downtime at all. The connection outlives the
 * campaign.
 *
 * The fix is not to re-implement rest detection. It is to give the caster's rest
 * something of its own to find: a companion effect on the **caster**, carrying
 * the same duration the card's effect carries, which the system's own sweep
 * deletes on exactly the rests the system counts as rests. This file then
 * follows that deletion across to the target. Every question about what a rest
 * is stays the system's to answer, including whenever it changes its mind.
 *
 * ## Why the record lives on the caster
 *
 * The same reason it does for **Ranger's Focus**, and it is worth stating twice.
 * The connection is one caster to one creature, so *something* has to remember
 * which creature — and the caster is the only end of the line that is reliably
 * writable, present, and singular. An adversary can be a dozen tokens of one
 * actor, can be deleted with the scene, and cannot be written to by the player
 * who cast the spell.
 *
 * So the companion effect is the authoritative record, and it is deliberately
 * more than bookkeeping: it is named for who is on the other end, so a glance at
 * the caster's sheet answers "who am I linked to?" — which is a question the
 * printed card leaves the table to track on paper.
 *
 * It carries no `changes`. Telepathy has no mechanical effect to apply; it is a
 * fact about the fiction, and both ends of it are labels.
 *
 * ## The link, and how the two ends find each other
 *
 * One flag, {@link FLAGS.telepathy}, on the companion only. It names the target
 * actor and the id of the applied copy sitting on them, so each end can reach
 * the other with a direct lookup and no sweep of the world's actors.
 *
 * The applied copy is left **completely unstamped**. That is not laziness: the
 * copy is created by the system on whichever client cast the spell, and stamping
 * it would mean a write to an actor that client very likely cannot write to. Its
 * `origin` already points back at the effect on the caster's own card, which is
 * enough to find the caster, and the caster's companion is enough to confirm the
 * copy is the one it names. Nothing else is needed from it.
 *
 * ## Ending the link
 *
 * Three ways in, one way out — deleting the companion — and the file makes every
 * route arrive there:
 *
 * - **"until your next rest"** — the system's own `expireActiveEffects` deletes
 *   the companion, and this file removes the copy from the target.
 * - **"or you cast Telepathy again"** — a new copy landing anywhere ends the
 *   previous connection first, wherever it was, before recording the new one.
 * - **By hand, from either sheet.** Deleting the copy off the target clears the
 *   companion too, so the caster's sheet never claims a connection that is no
 *   longer there.
 *
 * Every deletion this file issues is marked {@link HANDLED}, which is how the
 * other end's hook knows not to chase it back again.
 *
 * ## Deliberate silences
 *
 * - **Nothing applies, re-applies or re-checks the effect.** Landing it is the
 *   card's own job on the system's own path, exactly as with *Slumber*.
 * - **Line of sight is not tested.** "One target you can see" is a fiction
 *   question the table answers when it picks the token, and Foundry's own vision
 *   already stops a player targeting what they cannot see. Adding a second,
 *   stricter test would refuse casts the GM had already allowed.
 * - **Nothing is spoken across the link.** Whispering is what Foundry's chat is
 *   for, and a module that intercepted it would be guessing at which of the
 *   table's messages were meant to be private.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { actorOfEffect } from "../utils/actor-of-effect.js";
import { isWriter } from "../utils/is-writer.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "telepathy";

/** Prefix for this feature's console lines. Deliberately the printed name. */
const LABEL = "Telepathy";

/** The card the ability is printed on, for the origin test. */
const CARD_SOURCE = "Compendium.daggerheart.domains.Item.df4iRqQzRntrF6Qw";

/**
 * The effect's id on the card, which survives every copy of it.
 *
 * Compendium content is imported with its ids intact, so the *Telepathy* effect
 * on a character's Book of Illiat still carries this — and the copy applied to a
 * target points back at it through `origin`.
 */
const CARD_EFFECT_ID = "zAEaETYSOE2fmcyB";

/** The printed name, the last resort for recognising a hand-applied copy. */
const EFFECT_NAME = "Telepathy";

/** The duration to fall back on if the card's own effect has none set. */
const DEFAULT_DURATION = "shortRest";

/**
 * Marks a deletion this file issued itself.
 *
 * Read off the delete operation's options, which reach the hook unchanged on the
 * client that issued them — and this file only ever deletes from one client. It
 * is what stops the two ends of a link chasing each other in a circle.
 */
const HANDLED = "eeTelepathyHandled";

/** What the companion effect remembers about the creature on the other end. */
interface TelepathyLink {
  /** Actor (or ActorDelta) uuid of the creature the caster is linked to. */
  targetUuid: string;
  /** Their name when the link opened, for the companion's label. */
  targetName: string;
  /** The id of the applied copy on them, so it can be found and removed. */
  effectId: string;
}

/** Whether the feature is switched on. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.telepathyLink) === true;
}

/** Names compared the way the rest of the module compares them. */
function sameName(value: unknown, name: string): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === name.toLowerCase();
}

/** The link an effect records, if it is one of our companions. */
function linkOf(effect: AnyObject | null | undefined): TelepathyLink | null {
  const link = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.telepathy];
  if (!link || typeof link !== "object") return null;

  const targetUuid = String(link["targetUuid"] ?? "");
  const effectId = String(link["effectId"] ?? "");
  if (!targetUuid || !effectId) return null;

  return { targetUuid, effectId, targetName: String(link["targetName"] ?? "") };
}

/**
 * Is this a *Telepathy* connection sitting on somebody?
 *
 * The same four tests, in the same order, that `slumber.ts` uses on its own
 * condition — with one extra first: a companion is named *Telepathy* too, and
 * would otherwise match itself.
 */
function isAppliedCopy(effect: AnyObject): boolean {
  // The copy on a target is parented to the Actor; the template it came from
  // lives on the card, and is nobody's open line.
  if (effect?.["parent"]?.["documentName"] !== "Actor") return false;

  // Our own record, which is not a connection but a note about one.
  if (linkOf(effect)) return false;

  const flagged = effect["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string") return flagged.trim() === FEATURE_ID;

  const origin = String(effect["origin"] ?? "");
  if (origin.endsWith(`.ActiveEffect.${CARD_EFFECT_ID}`)) return true;
  if (origin.includes(CARD_SOURCE) && sameName(effect["name"], EFFECT_NAME)) return true;

  return sameName(effect["name"], EFFECT_NAME);
}

/**
 * Who cast it, read back out of the copy's `origin`.
 *
 * `EffectsField.applyEffect` sets `origin: effect.uuid` on the copy, pointing at
 * the effect on the caster's own item — so resolving it and walking up gives the
 * caster. A copy dragged on by hand has no such origin, and gets `null`: the
 * connection still exists on the target's sheet, it simply isn't one this file
 * has any record of, and inventing a caster for it would be worse than leaving
 * it alone.
 */
function casterOf(effect: AnyObject): AnyObject | null {
  const origin = String(effect["origin"] ?? "");
  if (!origin) return null;

  try {
    const source = fromUuidSync(origin) as AnyObject | null;
    return actorOfEffect(source);
  } catch {
    return null;
  }
}

/** How long the card says the connection lasts, asked of the card itself. */
function durationOf(effect: AnyObject): string {
  const origin = String(effect["origin"] ?? "");
  if (!origin) return DEFAULT_DURATION;

  try {
    const source = fromUuidSync(origin) as AnyObject | null;
    const type = source?.["system"]?.["duration"]?.["type"];
    return typeof type === "string" && type ? type : DEFAULT_DURATION;
  } catch {
    return DEFAULT_DURATION;
  }
}

/** The caster's record of their open line, if they have one. */
function companionOn(caster: AnyObject): AnyObject | null {
  for (const effect of caster["effects"] ?? []) {
    if (linkOf(effect)) return effect;
  }

  return null;
}

/** Delete something, marked so the hook at the other end lets it pass. */
async function remove(document: AnyObject | null | undefined): Promise<void> {
  await document?.["delete"]?.({ [HANDLED]: true });
}

/**
 * Close whatever line this caster currently has open.
 *
 * Both ends, in that order: the copy on the far end first, so that a failure
 * partway through leaves the caster's record still pointing at something real
 * rather than a connection nobody is on the other side of.
 */
async function endLink(caster: AnyObject): Promise<void> {
  const companion = companionOn(caster);
  if (!companion) return;

  const link = linkOf(companion);

  if (link) {
    // The target may be gone — a deleted token, an unloaded scene, a copy
    // already removed by hand. All of those mean the same thing here: there is
    // nothing left to close, only a record to tidy away.
    const target = fromUuidSync(link.targetUuid) as AnyObject | null;
    const existing = target?.["effects"]?.get?.(link.effectId) as AnyObject | null;
    if (existing) await remove(existing);
  }

  await remove(companion);

  console.debug(`${LOG_PREFIX} ${LABEL}: ${caster["name"]}'s line is closed.`);
}

/**
 * Record a newly opened line on the caster, replacing any earlier one.
 *
 * The companion's duration is copied off the card rather than hardcoded, so a
 * table that has rewritten the effect to last a *long* rest gets a record that
 * expires when the card says it should — and the system, not this file, remains
 * the thing that decides what a rest is.
 */
async function beginLink(caster: AnyObject, copy: AnyObject, target: AnyObject): Promise<void> {
  await endLink(caster);

  const link: TelepathyLink = {
    targetUuid: String(target["uuid"] ?? ""),
    targetName: String(target["name"] ?? ""),
    effectId: String(copy["id"] ?? ""),
  };

  if (!link.targetUuid || !link.effectId) return;

  await caster["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.format("EE.Features.Telepathy.EffectName", { target: link.targetName }),
      img: String(copy["img"] ?? ""),
      // The card's own effect, so the record is traceable back to what opened it.
      origin: String(copy["origin"] ?? ""),
      description: game.i18n.format("EE.Features.Telepathy.EffectDescription", {
        target: link.targetName,
      }),
      disabled: false,
      // Created straight onto the actor: there is no item for it to transfer from.
      transfer: false,
      type: "base",
      // No `changes`, on purpose. See the header.
      system: { changes: [], duration: { type: durationOf(copy), description: "" } },
      flags: { [MODULE_ID]: { [FLAGS.telepathy]: link } },
    },
  ]);

  console.debug(`${LOG_PREFIX} ${LABEL}: ${caster["name"]} is linked to ${link.targetName}.`);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * Wire the feature up. Called once during `init`.
 *
 * Both hooks fire on every connected client, and every write here is to an actor
 * a player may well not own — so exactly one client acts, the same designated GM
 * that `gm-effects.ts` uses. On a table with no GM connected nothing is
 * recorded, which is the right answer for bookkeeping nobody is there to keep.
 */
export function registerTelepathy(): void {
  Hooks.on("createActiveEffect", (effect: AnyObject): void => {
    try {
      if (!enabled() || !isWriter()) return;
      if (!isAppliedCopy(effect)) return;

      const caster = casterOf(effect);
      const target = actorOfEffect(effect);
      if (!caster || !target) return;

      void beginLink(caster, effect, target).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not record the new line.`, error);
      });
    } catch (error) {
      // Bookkeeping that throws must not disturb an effect the table applied.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not follow a new connection.`, error);
    }
  });

  Hooks.on("deleteActiveEffect", (effect: AnyObject, options: AnyObject): void => {
    try {
      if (!enabled() || !isWriter()) return;

      // Our own half of a closure, coming back around. Checked first and
      // cheaply, so the ordinary path never pays for the rest of the tests.
      if (options?.[HANDLED] === true) return;

      const actor = actorOfEffect(effect);
      if (!actor) return;

      // The caster's record went — a rest expired it, or somebody deleted it.
      // Either way the line is closed, and the far end has to be told.
      const link = linkOf(effect);
      if (link) {
        const target = fromUuidSync(link.targetUuid) as AnyObject | null;
        const copy = target?.["effects"]?.get?.(link.effectId) as AnyObject | null;
        void remove(copy).catch((error: unknown) => {
          console.warn(`${LOG_PREFIX} ${LABEL}: could not close the far end.`, error);
        });
        return;
      }

      // The far end went instead. Clear the caster's record, but only if it is
      // this connection it was recording — a caster whose line has since moved
      // on must not have their current one closed by an old one being tidied up.
      if (!isAppliedCopy(effect)) return;

      const caster = casterOf(effect);
      if (!caster) return;

      const companion = companionOn(caster);
      if (linkOf(companion)?.effectId !== String(effect["id"] ?? "")) return;

      void remove(companion).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not clear the caster's record.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not follow a closing connection.`, error);
    }
  });
}
