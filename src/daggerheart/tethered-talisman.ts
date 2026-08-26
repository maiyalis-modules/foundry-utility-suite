/**
 * **Tethered Talisman** (Hedge Witch subclass, *Void for Daggerheart*) — "Once
 * per rest, you can imbue a small item with your protective essence. When the
 * person holding the talisman takes damage, you can expend its magic to reduce
 * the number of Hit Points they mark by one. You can't create a new talisman
 * until the old one has been used."
 *
 * ## What the Void ships
 *
 * One `effect` action, "Tether": `target: { type: "any" }`, `effects: []`,
 * `uses: { max: "1", recovery: "shortRest" }`. So the card already presses,
 * already asks for a target and already spends its once-per-rest use — the
 * system's `UsesField` refuses the second press on its own, and none of that is
 * reimplemented here. What the card cannot do is any of the three things that
 * come after: nothing is imbued (`effects` is empty), nobody is asked when the
 * holder is hit, and nothing stops a second talisman replacing a first silently.
 *
 * No talisman *Item* is created. The rule never says the token is a real object
 * with weight and a slot — "a small item" is fiction, and the mechanical half is
 * entirely "somebody is carrying this, and once, it can be spent". That is an
 * ActiveEffect on the holder: visible on their sheet, visible to the GM, and
 * removable by deleting it, which is also how a table calls the whole thing off.
 *
 * ## Where the reduction goes, and why it is not simply healing them afterwards
 *
 * "Reduce the number of Hit Points they mark by one" is a change to the *marks*,
 * not to the damage. Daggerheart converts damage to marks through thresholds, so
 * shaving a point off the damage is not the same rule at all: 8 damage against a
 * Major of 8 marks 2, and 7 marks 1 — the same subtraction is worth a whole Hit
 * Point at one number and nothing at all at another.
 *
 * So the seam is `Actor#takeDamage`, which is the one place the mark count is a
 * number in hand. Its own hooks are all in the wrong place for this:
 * `preTakeDamage` and `postCalculateDamage` both fire while the value is still
 * raw damage, before `convertDamageToThreshold` has run, and `postTakeDamage`
 * fires after `modifyResource` has already written the sheet. This therefore
 * wraps `takeDamage` and, for the duration of that one call on that one actor,
 * shadows its `modifyResource` with a one-shot that sees the finished update list
 * — the same `{ key: "hitPoints", value }` entry the system is about to apply,
 * after resistances, after thresholds, and after the armor-slot dialog has taken
 * its own point off. The talisman changes that number and hands it on.
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
 * somebody else decides — which sounds unacceptable until you notice the system
 * does exactly this, in this method, three lines earlier: `this.owner.query
 * ('armorSlot', …, { timeout: 30000 })` stops the same damage dead while the
 * damaged player chooses whether to spend armor. The precedent is the system's
 * own, the timeout is `feature-ask.ts`'s, and the wait only ever happens when
 * there is a live talisman on the person who was actually hit.
 *
 * ## Who is asked
 *
 * `responderFor` picks the witch's own player, falling back to whoever is running
 * the roll when nobody who owns her is connected — which at that point is the GM
 * playing her reactions anyway. Deliberately *not* the person taking the damage:
 * the talisman is the witch's magic and spending it is her decision, and it is
 * the only interesting decision in the feature. A player who is about to mark
 * two Hit Points will always say yes.
 *
 * ## Replacing a talisman
 *
 * "You can't create a new talisman until the old one has been used" is enforced
 * as a **warning, not a refusal**. The two constraints in the card already stop
 * the obvious abuse — the use is once per rest, and the old talisman is destroyed
 * by the new one — so what is left is a table's own business: a talisman on
 * somebody who left the party, or handed to the wrong person by a misclick, is a
 * thing the GM should be able to move without deleting effects by hand.
 *
 * The warning is raised from `preUseAction`, which is *before* the use is spent,
 * by cancelling the press and replaying it on a yes — the same cancel-and-replay
 * `rangers-focus.ts` hands to the Target Helper, and for the same reason: a
 * question that has to be answered before the cost is charged cannot be asked
 * from a synchronous hook that has already let the cost through.
 *
 * ## Deliberate silences
 *
 * - **The reduction is never offered for a hit that marks nothing.** No Hit
 *   Points, no number to reduce; the talisman stays unspent and nobody is asked.
 * - **Stress is not Hit Points.** An attack that marks Stress as well leaves the
 *   Stress alone, and one that marks *only* Stress raises no prompt at all.
 * - **Direct damage is included.** It bypasses armor, not talismans; the card
 *   says "takes damage" and means it.
 * - **Nothing is refunded if the talisman is never spent.** It sits on the holder
 *   until it is used or deleted, exactly as printed, and the witch's once-per-rest
 *   use is the system's own bookkeeping either way.
 * - **One talisman per witch, not per holder.** Two Hedge Witches can both tether
 *   the same person, and each spends her own.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { askUser, responderFor } from "./feature-ask.js";
import { confirmChoice, type PromptRequest } from "./feature-prompt.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { markActor, type MarkRequest, unmarkActor } from "./gm-effects.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.subclasses.Item.UeY92YRyTAeTPnam"],
  names: ["Tethered Talisman"],
};

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "tetheredTalisman";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Tethered Talisman";

/**
 * Marks a replayed press as already confirmed, so the warning is asked once.
 *
 * Travels on the event object rather than in `configOptions`, like
 * `rangers-focus.ts`'s `FOCUS_ATTACK`: `prepareBaseConfig` copies `event` onto
 * the config verbatim, where `preUseAction` can read it, and the system never
 * looks at it.
 */
const REPLAY = "eeTetheredTalisman";

/** `CONFIG.DH.GENERAL.healingTypes.hitPoints.id`. The only resource this touches. */
const HIT_POINTS = "hitPoints";

/** "…reduce the number of Hit Points they mark by one." */
const REDUCE = 1;

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

/** The Tethered Talisman card on this actor, or null. */
function talismanCard(actor: AnyObject | null | undefined): AnyObject | null {
  return actor ? findGrantingItem(actor, FEATURE_ID, MATCH) : null;
}

/**
 * Is this the card's own action? The card ships exactly one, so matching the
 * granting Item is enough and no action name has to be hardcoded.
 */
function tetherAction(action: AnyObject): AnyObject | null {
  const card = talismanCard(action?.["actor"] as AnyObject | null);
  if (!card) return null;

  return card["id"] === action["item"]?.["id"] ? card : null;
}

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
 * its ActorDelta, which is not in `game.actors` at all. A talisman on an unlinked
 * token on *another* scene is genuinely not found, and the only consequence is
 * that the replacement warning stays quiet — the press still works, and the old
 * effect can still be spent or deleted.
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
 * Put the talisman on the target, replacing this witch's previous one.
 *
 * Relayed through `gm-effects.ts` rather than written here: the holder is
 * usually somebody else's character, and core requires OWNER of the parent to
 * create an ActiveEffect.
 */
async function tether(action: AnyObject, config: AnyObject): Promise<void> {
  const witch = action["actor"] as AnyObject | null;
  const target = soleTarget(config);
  if (!witch || !target) return;

  const witchUuid = String(witch["uuid"] ?? "");
  const previous = outstandingTalisman(witchUuid);

  // Skipped when it is the same person: `applyMark` clears before it creates, so
  // the re-tether is already a replacement rather than a second effect.
  if (previous && String(previous.holder["uuid"] ?? "") !== target.actorUuid) {
    await unmarkActor(request(String(previous.holder["uuid"] ?? ""), witch));
  }

  await markActor(request(target.actorUuid, witch));
  console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} tethered ${target.name}.`);
}

/**
 * Ask before a second talisman cancels the first, and press the card again on a
 * yes.
 *
 * The original press has already been refused by the time this runs, so nothing
 * has been spent and a "no" costs the witch nothing at all.
 */
async function confirmReplacement(action: AnyObject, previous: Talisman): Promise<void> {
  const accepted = await confirmChoice({
    title: game.i18n.localize("EE.Features.TetheredTalisman.Title"),
    intro: game.i18n.format("EE.Features.TetheredTalisman.ReplaceIntro", {
      holder: String(previous.holder["name"] ?? ""),
    }),
    confirmLabel: game.i18n.localize("EE.Features.TetheredTalisman.ReplaceConfirm"),
    declineLabel: game.i18n.localize("EE.Features.TetheredTalisman.ReplaceDecline"),
  });

  if (!accepted) return;

  await action["use"]?.({ [REPLAY]: true });
}

/* ------------------------------------------------------------------ *
 * Spending
 * ------------------------------------------------------------------ */

/**
 * Put the question on the witch's screen. False for a decline, a dismissal, a
 * timeout, or a client that never answered — every one of which means the damage
 * lands as rolled.
 */
async function askWitch(witch: AnyObject, holder: AnyObject, marking: number): Promise<boolean> {
  const card = talismanCard(witch);

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
        hint: game.i18n.localize("EE.Features.TetheredTalisman.OfferHint"),
        itemName: String(card?.["name"] ?? LABEL),
        img: card?.["img"] ? String(card["img"]) : undefined,
        useLabel: game.i18n.localize("EE.Features.TetheredTalisman.Spend"),
        skipLabel: game.i18n.localize("EE.Features.TetheredTalisman.Keep"),
      },
    ],
  };

  const chosen = await askUser(responderFor(witch), prompt);
  return chosen.has(FEATURE_ID);
}

/**
 * Say the talisman went, in the chat log rather than a notification.
 *
 * The people who need to see it are the witch, the holder and the GM, and the
 * client this runs on is whichever one of them happened to apply the damage.
 * Public, because the reason a Hit Point was not marked belongs beside the attack
 * that would have marked it.
 */
async function announce(witch: AnyObject, holder: AnyObject): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch }),
      content: `<p>${game.i18n.format("EE.Features.TetheredTalisman.Spent", {
        witch: String(witch["name"] ?? ""),
        holder: String(holder["name"] ?? ""),
      })}</p>`,
    });
  } catch (error) {
    // The Hit Point is already unmarked; losing the announcement must not undo it.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the talisman.`, error);
  }
}

/**
 * Offer the talisman against one finished update list, and take a mark off it if
 * the witch says yes.
 *
 * `resources` is the system's own array, moments from being written, so the
 * change is made in place. The sign is read rather than assumed: Hit Points are a
 * *reversed* resource and so arrive positive, but the whole point of reading
 * `isReversed` elsewhere in this module is not to hardcode that.
 */
async function offerTalisman(
  holder: AnyObject,
  effect: AnyObject,
  resources: AnyObject[],
): Promise<void> {
  const entry = (resources ?? []).find((update) => String(update?.["key"] ?? "") === HIT_POINTS);
  const marking = Math.abs(Number(entry?.["value"] ?? 0));

  // No Hit Points, no number to reduce. The talisman is not spent and the witch
  // is not interrupted.
  if (!entry || !Number.isFinite(marking) || marking < REDUCE) return;

  const mark = talismanFlag(effect);
  const witch = fromUuidSync(String(mark?.["sourceUuid"] ?? "")) as AnyObject | null;
  if (!witch) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the witch who made this talisman is gone.`);
    return;
  }

  // Two hits landing at once would otherwise put the same talisman on screen
  // twice and spend it twice.
  const key = String(effect["uuid"] ?? effect["id"] ?? "");
  if (asking.has(key)) return;
  asking.add(key);

  try {
    if (!(await askWitch(witch, holder, marking))) return;

    // Re-read: the question sat on somebody's screen for up to half a minute, and
    // the talisman may have been spent on another hit or deleted from the sheet
    // in the meantime.
    const still = talismanOn(holder);
    if (!still || String(still["id"] ?? "") !== String(effect["id"] ?? "")) {
      console.debug(`${LOG_PREFIX} ${LABEL}: the talisman went while the question was open.`);
      return;
    }

    const value = Number(entry["value"] ?? 0);
    entry["value"] = value > 0 ? value - REDUCE : value + REDUCE;

    await unmarkActor(request(String(holder["uuid"] ?? ""), witch));
    await announce(witch, holder);
  } finally {
    asking.delete(key);
  }
}

/* ------------------------------------------------------------------ *
 * The patch
 * ------------------------------------------------------------------ */

/**
 * Shadow this actor's `modifyResource` for the length of one `takeDamage`, and
 * answer with the function that puts it back.
 *
 * An own property on the instance rather than a patch on the prototype: the
 * interception is meant to last for one call on one actor, and shadowing says
 * exactly that. Restoring is idempotent, so the one-shot inside and the `finally`
 * outside can both call it.
 */
function interpose(holder: AnyObject): (() => void) | null {
  const effect = talismanOn(holder);
  if (!effect) return null;

  const owned = Object.prototype.hasOwnProperty.call(holder, "modifyResource");
  const previous = holder["modifyResource"];

  const restore = (): void => {
    if (owned) holder["modifyResource"] = previous;
    else delete holder["modifyResource"];
  };

  holder["modifyResource"] = async function (resources: AnyObject[]): Promise<unknown> {
    // Before anything else: the talisman answers the damage it was interposed
    // for, and nothing the rest of this call may go on to write.
    restore();

    try {
      await offerTalisman(holder, effect, resources);
    } catch (error) {
      // The damage lands either way; a broken talisman must not eat the hit.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not offer the talisman.`, error);
    }

    // Resolved off the actor again, which is the original method now that the
    // shadow has been removed.
    return holder["modifyResource"](resources);
  };

  return restore;
}

/**
 * Wrap `Actor#takeDamage`.
 *
 * Patched during `init`: the system assigns `CONFIG.Actor.documentClass` at
 * script load, before any `init` hook, and nothing can be damaged before the
 * canvas exists. Same reasoning as `reach.ts`.
 */
function patchTakeDamage(): void {
  const prototype = CONFIG.Actor?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["takeDamage"];

  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: no takeDamage to wrap — the talisman cannot be spent.`);
    return;
  }

  prototype!["takeDamage"] = async function (
    this: AnyObject,
    args: unknown,
    isDirect = false,
  ): Promise<unknown> {
    let restore: (() => void) | null = null;

    try {
      if (enabled()) restore = interpose(this);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not look for a talisman.`, error);
    }

    try {
      return await original.call(this, args, isDirect);
    } finally {
      restore?.();
    }
  };
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Wire the feature up. Called once during `init`. */
export function registerTetheredTalisman(): void {
  patchTakeDamage();

  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): boolean | void => {
    try {
      if (!enabled() || !tetherAction(action)) return;

      // `prepareConfig` has already run by here — `use()` builds the config
      // before it calls this hook — so the target is known while the use is
      // still unspent, which is the only moment refusing it is free.
      if (!soleTarget(config)) {
        ui.notifications?.warn(game.i18n.localize("EE.Features.TetheredTalisman.NoTarget"));
        return false;
      }

      // The replay of a press whose warning has already been answered.
      if (config["event"]?.[REPLAY] === true) return;

      const previous = outstandingTalisman(String(action["actor"]?.["uuid"] ?? ""));
      if (!previous) return;

      // Refused now and asked afterwards: the question cannot be awaited from a
      // synchronous hook, and asking it after the use would be asking after the
      // card had already been spent.
      void confirmReplacement(action, previous).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not offer to replace the talisman.`, error);
      });
      return false;
    } catch (error) {
      // Never `false` from the error path: a failed check must not cost the
      // player their press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not check the card.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!enabled() || !tetherAction(action)) return;

      // Started, not awaited: the hook is synchronous, and the card's own chat
      // message is not waiting on the effect.
      void tether(action, config).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not imbue the talisman.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not imbue the talisman.`, error);
    }
  });
}
