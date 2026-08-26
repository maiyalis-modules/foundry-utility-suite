/**
 * **Slumber** (Codex domain, *Book of Illiat*, SRD p.124) — "Make a Spellcast
 * Roll against a target within Very Close range. On a success, they're *Asleep*
 * until they take damage or the GM spends a **Fear** on their turn to clear this
 * condition."
 *
 * ## What the SRD ships, and what it leaves undone
 *
 * `Compendium.daggerheart.domains.Item.df4iRqQzRntrF6Qw` is one of the grimoires —
 * three printed abilities on one card — and Slumber is the first of them, built
 * as an `attack` action: a Spellcast roll, Very Close range, no damage, and an
 * embedded *Slumber* ActiveEffect that `EffectsField.applyEffects` copies onto
 * every target whose `hitResult.success` is true. The roll, the range and the
 * condition landing are all already automatic, and **nothing here touches any of
 * them**.
 *
 * What the card cannot ship is the sentence that says when the condition *ends*.
 * `duration.type` is `temporary`, which the system's `expireActiveEffects`
 * explicitly skips — temporary and custom durations are filtered out before it
 * deletes anything — so the effect sits on the target until a human removes it.
 * The two clauses that should remove it are printed in the effect's description
 * and enforced nowhere:
 *
 * - **"until they take damage"** — deliberately not automated here. See below.
 * - **"or the GM spends a Fear on their turn to clear this condition"** — the
 *   price this file exists to collect.
 *
 * ## What this adds: one question, at the moment of removal
 *
 * There is no button to press for this rule and no roll to hang it on. The only
 * moment the rule applies is the moment somebody reaches for the effect to take
 * it off — right-click, Delete — and by then the decision has already been made
 * silently. So that is where the question goes: the deletion is **cancelled**,
 * a prompt is raised, and whichever answer comes back is what actually happens.
 *
 * Three answers, because there are genuinely three things a GM reaching for that
 * effect might mean:
 *
 * - **Spend a Fear** — the printed rule. One Fear leaves the pool, the effect
 *   goes, and a line says so in chat.
 * - **Remove anyway** — the *other* printed clause, and the common one. The
 *   target took damage and woke up; no Fear is owed. It also covers every
 *   ordinary reason an effect gets deleted — a mis-click when it was applied, a
 *   scene being cleaned up, a table that resolved it in fiction.
 * - **Leave it** — the mis-click on the delete itself.
 *
 * Dismissing the dialog and letting the countdown expire both mean **leave it**,
 * which is the rule this module applies everywhere: the answer a prompt gives
 * for you is the one that changes nothing. This is also the one prompt in the
 * module that runs a timer *because* it interrupted something rather than
 * followed it — a cancelled delete with an unattended dialog behind it would
 * leave the GM looking at an effect that neither went away nor visibly refused
 * to, so it must not sit open forever. See {@link OneOfRequest.timed}.
 *
 * ## Why the guard is a veto and not a confirmation
 *
 * `preDeleteActiveEffect` is synchronous — a hook cannot await a dialog and then
 * decide — so there is no version of this that asks first and deletes second in
 * one pass. Returning `false` cancels the delete outright; the answer, if it is
 * one that removes the effect, re-issues the deletion with
 * {@link APPROVED} set, which this same hook recognises and lets straight
 * through. Two round trips instead of one, and the second one is the real one.
 *
 * ## Why only a GM is asked
 *
 * `preDelete` hooks fire on the client that *initiated* the deletion, not on
 * every client, so the question is raised wherever the delete was pressed. Fear
 * is a world-scoped setting only a GM can write, and the rule names the GM as the
 * one who spends it — so a non-GM's delete is left alone rather than shown a
 * price they cannot pay or blocked with no way forward. In practice this costs
 * nothing: Slumber is cast *at* a target, and the targets are the GM's
 * adversaries. A player removing an effect from their own sheet gets the same
 * latitude every other sheet edit gets.
 *
 * ## Recognising the effect
 *
 * Four tests, in order, and the first that answers wins:
 *
 * 1. **It must live on an Actor**, not on an Item. The copy the system applies is
 *    created with `parent: actor`; the template it was copied *from* sits on the
 *    Book of Illiat on the caster's sheet. Without this check, editing the card
 *    would raise a prompt about a condition nobody is under.
 * 2. `flags.eryndor-essentials.featureId` — the escape hatch the rest of the
 *    module honours, for a table that has rewritten the card.
 * 3. **The origin's effect id.** `EffectsField.applyEffect` sets
 *    `origin: effect.uuid` on the copy, pointing back at the effect on the
 *    caster's item — and that effect keeps the compendium's own `_id`, so the
 *    origin ends in `.ActiveEffect.gfZTHSgwYSDKsePW` however many hands the card
 *    has passed through. The applied copy's own `_id` is *not* usable: `create`
 *    without `keepId` mints a new one.
 * 4. **The printed name**, the last resort — which is also what makes a
 *    hand-dragged copy work, and that matters, because dragging the effect on by
 *    hand is exactly what a GM does when the roll was made away from the table.
 *
 * ## Deliberate silences
 *
 * - **"until they take damage" is not automated.** It is the other half of the
 *   same sentence and it would be a real convenience, but it is a separate piece
 *   of work — it has to decide what "take damage" means for a target that marked
 *   no Hit Points because of Armor, or was healed and damaged in one application
 *   — and guessing at it would delete a condition the table still considers live.
 *   Until it exists, damage waking the target is what **Remove anyway** is for.
 * - **"on their turn" is not checked.** Daggerheart has no turn order to check it
 *   against outside a countdown the GM is running by hand, and refusing a Fear
 *   spend because the module disagreed about whose turn it was would be inventing
 *   an enforcement the rule does not ask for.
 * - **Nothing re-applies or re-checks the condition.** Landing it is the card's
 *   own job, on the system's own path, and this file never touches that.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { actorOfEffect } from "../utils/actor-of-effect.js";
import { currentFear, setFear, spendFear } from "./fear.js";
import { chooseOne } from "./feature-prompt.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "slumber";

/** Prefix for this feature's console lines. Deliberately the printed name. */
const LABEL = "Slumber";

/** The card the ability is printed on, for the origin test. */
const CARD_SOURCE = "Compendium.daggerheart.domains.Item.df4iRqQzRntrF6Qw";

/**
 * The effect's id on the card, which survives every copy of it.
 *
 * Compendium content is imported with its ids intact, so the *Slumber* effect on
 * a character's Book of Illiat still carries this — and the copy applied to a
 * target points back at it through `origin`.
 */
const CARD_EFFECT_ID = "gfZTHSgwYSDKsePW";

/** The printed name, the last resort for recognising a hand-applied copy. */
const EFFECT_NAME = "Slumber";

/** What the rule costs. One Fear, as printed. */
const PRICE = 1;

/**
 * Marks a deletion this file has already asked about.
 *
 * Read off the delete operation's options, which reach the hook unchanged on the
 * client that issued them — which is the only client this guard runs on.
 */
const APPROVED = "eeSlumberApproved";

/** The three answers, in the order they read. */
const SPEND = "spend";
const REMOVE = "remove";
const KEEP = "keep";

/** Whether the feature is switched on. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.slumberFearGuard) === true;
}

/** Names compared the way the rest of the module compares them. */
function sameName(value: unknown, name: string): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === name.toLowerCase();
}

/** Is this the *Slumber* condition, sitting on somebody? See the header. */
function isSlumber(effect: AnyObject): boolean {
  // The copy on a target is parented to the Actor; the template it came from
  // lives on the card. Only the copy is a condition anybody is under.
  if (effect?.["parent"]?.["documentName"] !== "Actor") return false;

  const flagged = effect["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string") return flagged.trim() === FEATURE_ID;

  const origin = String(effect["origin"] ?? "");
  if (origin.endsWith(`.ActiveEffect.${CARD_EFFECT_ID}`)) return true;
  if (origin.includes(CARD_SOURCE)) return true;

  return sameName(effect["name"], EFFECT_NAME);
}

/**
 * The effect's own description, as text.
 *
 * Parsed rather than assigned to a detached element's `innerHTML`: a document
 * from `DOMParser` is inert, so nothing in the description can load a resource
 * or run on the way to its text. The result is escaped again by the prompt.
 */
function descriptionOf(effect: AnyObject): string {
  const html = String(effect["description"] ?? "");
  if (!html) return "";

  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Is the effect still where we left it? The dialog sat open for up to 30s. */
function stillThere(effect: AnyObject): boolean {
  const uuid = String(effect["uuid"] ?? "");
  return uuid.length > 0 && fromUuidSync(uuid) !== null;
}

/** Delete it, flagged so this file's own guard waves the deletion through. */
async function remove(effect: AnyObject): Promise<void> {
  await effect["delete"]?.({ [APPROVED]: true });
}

/**
 * Ask the GM which of the rule's endings this is, and carry it out.
 *
 * Runs detached from the hook that cancelled the deletion, so nothing is waiting
 * on it. Every path that changes the world re-checks its preconditions first: the
 * question was on screen long enough for the Fear to be spent elsewhere and for
 * the effect itself to be removed by another route.
 */
async function ask(effect: AnyObject): Promise<void> {
  const actor = actorOfEffect(effect);
  const target = String(actor?.["name"] ?? effect["parent"]?.["name"] ?? "");
  const fear = currentFear();

  const options = [
    // Offered only when it can be paid. A button naming a price the pool cannot
    // cover would have to fail after the click, and the shortfall is worth
    // saying up front instead — which is what the intro does.
    ...(fear >= PRICE
      ? [
          {
            id: SPEND,
            label: game.i18n.format("EE.Features.Slumber.Spend", { price: PRICE, fear }),
          },
        ]
      : []),
    { id: REMOVE, label: game.i18n.localize("EE.Features.Slumber.Remove") },
    { id: KEEP, label: game.i18n.localize("EE.Features.Slumber.Keep") },
  ];

  const answer = await chooseOne({
    title: game.i18n.localize("EE.Features.Slumber.Title"),
    intro:
      fear >= PRICE
        ? game.i18n.format("EE.Features.Slumber.Intro", { target })
        : game.i18n.format("EE.Features.Slumber.IntroNoFear", { target }),
    body: descriptionOf(effect),
    options,
    // The delete this replaced has already been cancelled, so an unattended
    // dialog leaves a GM waiting on nothing. See the header.
    timed: true,
  });

  // Dismissal, the countdown and the Leave It button are one answer: the effect
  // stays exactly as it was, which is what the cancelled delete already achieved.
  if (answer !== SPEND && answer !== REMOVE) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the condition on ${target} is left in place.`);
    return;
  }

  if (!stillThere(effect)) {
    ui.notifications?.info(game.i18n.format("EE.Features.Slumber.Gone", { target }));
    return;
  }

  if (answer === REMOVE) {
    await remove(effect);
    console.debug(`${LOG_PREFIX} ${LABEL}: removed from ${target} without spending Fear.`);
    return;
  }

  // Spent before the delete, so a pool that emptied while the question was open
  // cannot buy a removal — and refunded if the delete itself fails, since a Fear
  // that bought nothing must not stay spent.
  if (!(await spendFear(PRICE, LABEL))) {
    ui.notifications?.warn(
      game.i18n.format("EE.Features.Slumber.NoFear", { price: PRICE, fear: currentFear() }),
    );
    return;
  }

  try {
    await remove(effect);
  } catch (error) {
    await setFear(currentFear() + PRICE);
    console.warn(`${LOG_PREFIX} ${LABEL}: the removal failed; the Fear is back.`, error);
    ui.notifications?.error(game.i18n.localize("EE.Features.Slumber.Failed"));
    return;
  }

  // The counter ticks down on every screen either way; this says what bought it.
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: actor ?? undefined }),
    content: `<p>${game.i18n.format("EE.Features.Slumber.Cleared", {
      price: PRICE,
      target,
    })}</p>`,
  });

  console.debug(`${LOG_PREFIX} ${LABEL}: ${PRICE} Fear cleared the condition on ${target}.`);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Wire the feature up. Called once during `init`. */
export function registerSlumber(): void {
  Hooks.on(
    "preDeleteActiveEffect",
    (effect: AnyObject, options: AnyObject): boolean | undefined => {
      try {
        if (!enabled()) return undefined;

        // Our own re-issue, coming back through the same hook. Checked first and
        // cheaply, so the approved path never pays for the rest of the tests.
        if (options?.[APPROVED] === true) return undefined;

        // The price is the GM's Fear and the decision is the GM's; every other
        // client's delete is none of this file's business. See the header.
        if (!game.user?.isGM) return undefined;

        if (!isSlumber(effect)) return undefined;

        // Detached on purpose: a `preDelete` hook is synchronous, so the answer
        // arrives long after this has returned. Nothing is waiting on it — the
        // deletion it would have gated is already cancelled below.
        void ask(effect).catch((error: unknown) => {
          console.warn(`${LOG_PREFIX} ${LABEL}: could not ask about the condition.`, error);
        });

        return false;
      } catch (error) {
        // A guard that throws must not eat a deletion the GM asked for.
        console.warn(`${LOG_PREFIX} ${LABEL}: could not guard the condition.`, error);
        return undefined;
      }
    },
  );
}
