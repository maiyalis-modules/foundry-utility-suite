/**
 * **Brave Face** (Warborne community, *Void for Daggerheart*) — "Once per
 * session, when an attack would cause you to mark a Stress, you can spend a Hope
 * instead."
 *
 * ## What the Void ships
 *
 * `Compendium.the-void-unofficial.communities.Item.KrqCfjp4E1r10XQr`, a `feature`
 * Item that is description and nothing else: no action, no resource, no effect.
 * There is nothing to press, which is correct — the rule has no moment a player
 * could press it *at*. It fires inside somebody else's attack, between the damage
 * being worked out and the sheet being written, and the only honest automation is
 * one that gets in there and asks.
 *
 * ## Where it gets in
 *
 * `damage-marking.ts` — the finished update list on its way to `modifyResource`,
 * where the Stress this attack is about to mark is a `{ key: "stress", value }`
 * entry that can still be taken out. Three things follow from that being the
 * seam, and each one is the reason it is not somewhere easier:
 *
 * - **The Stress is never marked at all.** Not marked and then cleared. The
 *   difference is not cosmetic: the system converts an unmarkable Stress into a
 *   Hit Point (`Actor#convertStressDamageToHP`), and that conversion happens
 *   *inside* `modifyResource` — after this rule has had its say. So a character
 *   with every Stress box already filled is exactly the character Brave Face
 *   saves, which is what the rule is for, and no other seam can do it. Marking
 *   and refunding would take the Hit Point and hand back the Stress.
 * - **The number is the final one.** After resistances, after thresholds, after
 *   the armor-slot dialog. Nothing this rule sees can still change.
 * - **It costs the attack a pause.** The question goes to the damaged player,
 *   who is usually not the client applying the damage, so it crosses a socket and
 *   waits. See `damage-marking.ts` on why that is the system's own precedent.
 *
 * ## Where the once-per-session lives
 *
 * On the card, in the system's own `system.resource` — `max: 1`, `increasing`,
 * `session` recovery. Slayer's reasoning, and all of it applies here: it puts a
 * counter on the card's row in the Features tab, so "once per session" is a thing
 * the player can *see* and, if the table rules otherwise, edit; and it is what
 * makes the system's own end-of-session refresh clear the use, so no part of the
 * reset is this module's to get wrong.
 *
 * {@link reconcileBraveFaceCards} writes the resource whole, at `ready`, from the
 * one client `isWriter` picks — whole because a partial write into a nullish
 * `SchemaField` is rejected for the fields it does not mention, which
 * `slayer.ts`'s header sets out at length.
 *
 * The use is *spent* through `modifyResource`'s own item-cost path rather than by
 * updating the card directly, because that path relays through a GM
 * (`emitGMUpdate`) and the client applying the damage is not always somebody who
 * owns the card — an ally's area attack catching Finnegan is applied by the
 * ally's player, who may not update his sheet.
 *
 * ## Reading the rule
 *
 * - **"an attack"** is read as *an action's damage landing on you*, recorded on
 *   the shared `applyDamage` wrapper (`damage-landing.ts`) the same way
 *   `hex.ts` records who hurt whom. It is deliberately not narrowed to actions
 *   that made an attack roll: an environment's damage is an attack to everyone at
 *   the table, and narrowing would fail silently — the offer simply would not
 *   appear, and nobody would know why. The cost of the wide reading is an offer
 *   the player can decline.
 * - **"a Stress"** is one. An attack that marks two leaves one of them marked and
 *   swaps the other. Printed adversary attacks mark exactly one, so this is a rule
 *   for a case that mostly does not arise, and taking the whole lot for a single
 *   Hope would be the more generous invention.
 * - **"you can spend a Hope instead"** is charged only once the answer is yes,
 *   and re-checked after it: the question can sit on a screen for half a minute,
 *   and the Hope may have gone on something else in the meantime.
 *
 * ## Deliberate silences
 *
 * - **Nothing else can trigger it.** Stress marked by pressing your own card,
 *   typed into the sheet by the GM, or applied by a macro that never went through
 *   `applyDamage` raises no prompt. Only a landing attack does.
 * - **Stress you chose to spend is not Stress an attack caused.** A character
 *   with a stress-for-damage rule who spends two Stress in the armor-slot dialog
 *   has them merged into the very same update entry by `takeDamage` itself, and
 *   by then the two are indistinguishable. Hence {@link Attack.stress}: the swap
 *   can never take more than the attack brought with it, and a hit whose Stress
 *   is entirely the player's own raises no prompt at all.
 * - **Healing is not an attack.** An action that restores Stress is skipped
 *   before anything else is read.
 * - **"Mark all your Stress" is not "a Stress".** An effect that clears the whole
 *   track (`fullRestore`) is left alone: swapping one Hope for it is not the rule,
 *   and the arithmetic of a `clear` entry is not a count at all.
 * - **The use is not refunded** if the Hope turns out to have been wasted, and it
 *   is not consumed when the player declines. The card holds the truth either way.
 * - **The GM is not asked.** The Stress is the damaged player's to take and the
 *   Hope is theirs to spend; there is no third party with an interest, which is
 *   what makes this the one reaction in the module that goes to the person being
 *   hit rather than to somebody watching.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isWriter } from "../utils/is-writer.js";
import { onDamageMarking } from "./damage-marking.js";
import { damagedTargets, onDamageLanding } from "./damage-landing.js";
import { askUser, responderFor } from "./feature-ask.js";
import type { PromptHeadline, PromptRequest } from "./feature-prompt.js";
import {
  canAfford,
  findGrantingItem,
  resourceUpdatesFor,
  type FeatureCost,
  type FeatureMatch,
} from "./feature-registry.js";

/** Registry id, for the homebrew `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "braveFace";

/** For console lines. Deliberately the printed card name. */
const LABEL = "Brave Face";

/** The Void Item this comes from — matched ahead of the printed name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.the-void-unofficial.communities.Item.KrqCfjp4E1r10XQr"],
  names: ["Brave Face"],
};

/** "…you can spend a Hope instead." */
const COST: readonly FeatureCost[] = [{ key: "hope", value: 1 }];

/** `CONFIG.DH.GENERAL.healingTypes.stress.id`. The only resource this reads. */
const STRESS = "stress";

/** `CONFIG.DH.GENERAL.itemAbilityCosts.resource.id` — the card's own counter. */
const ITEM_RESOURCE = "resource";

/** "…would cause you to mark **a** Stress." One, not however many arrived. */
const SWAP = 1;

/** The card's counter, in the shape the system's session refresh understands. */
const USES: Readonly<Record<string, string>> = {
  type: "simple",
  max: "1",
  recovery: "session",
  progression: "increasing",
  // The card's own idea of itself: a face put on for the occasion.
  icon: "fa-solid fa-masks-theater",
};

/**
 * How long an attack stays attributable, in milliseconds.
 *
 * Generous on purpose, for the reason `hex.ts` gives: `Actor#takeDamage` can sit
 * for thirty seconds inside the armor-slot query before this rule is reached, and
 * this prompt can sit for thirty more. A stale entry costs nothing — it is
 * consumed once and swept otherwise.
 */
const ATTRIBUTION_MS = 90_000;

/** Who is hurting whom, by damaged actor uuid. Never crosses a socket. */
interface Attack {
  /** The acting actor's uuid. */
  attacker: string;
  /**
   * How much Stress the attack itself carries.
   *
   * Recorded because by the time the update list exists, the attack's Stress and
   * the *player's own* Stress are the same number. A character with a
   * stress-for-damage rule who spends two Stress in the armor-slot dialog has
   * them folded into the very same `{ key: "stress" }` entry (`takeDamage` merges
   * them by hand), and Brave Face has no business touching those: nothing caused
   * them to be marked but the player deciding to. This is the figure from before
   * that dialog opened, and it is the ceiling on what the swap may take.
   */
  stress: number;
  at: number;
}
const incoming = new Map<string, Attack>();

/** Characters whose prompt is already on screen, by actor uuid. */
const asking = new Set<string>();

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.braveFace) === true;
}

/* ------------------------------------------------------------------ *
 * The card, and its once-per-session use
 * ------------------------------------------------------------------ */

/** The Brave Face card this character holds, or null. */
function braveFaceCard(actor: AnyObject | null | undefined): AnyObject | null {
  if (!actor || actor["type"] !== "character") return null;
  return findGrantingItem(actor, FEATURE_ID, MATCH);
}

/**
 * Has this session's use gone?
 *
 * A card with no counter on it yet reads as unused, which is the right answer:
 * the counter is this module's bookkeeping, and its absence means nothing has
 * happened rather than that everything has.
 */
function spent(card: AnyObject | null): boolean {
  return Number(card?.["system"]?.["resource"]?.["value"] ?? 0) >= 1;
}

/** Whether the card is carrying the counter the system's refresh can clear. */
function hasCounter(card: AnyObject | null): boolean {
  return Boolean(card?.["system"]?.["resource"]);
}

/**
 * Give every Brave Face card in the world the counter that shows the use on the
 * sheet, and clears itself at the end of a session.
 *
 * Called at `ready`. Writes, so exactly one client does it — {@link isWriter}
 * picks the active GM, like every other gated write in this module.
 *
 * Switching the feature **off** deliberately leaves an existing counter alone:
 * turning the automation off should stop the module acting, not quietly hand back
 * a use the table has already spent.
 */
export async function reconcileBraveFaceCards(): Promise<void> {
  if (!isWriter() || !enabled()) return;

  for (const actor of game.actors?.contents ?? []) {
    try {
      const card = braveFaceCard(actor as AnyObject);
      if (!card) continue;

      const resource = card["system"]?.["resource"] as AnyObject | null | undefined;
      const current = resource
        ? Object.entries(USES).every(([key, value]) => String(resource[key] ?? "") === value)
        : false;
      if (current) continue;

      // Written whole — see the note in the header on why a partial write into a
      // nullish `SchemaField` is the one shape to avoid. `value` is preserved so
      // repairing the shape mid-session cannot hand a spent use back.
      await card["update"]?.({
        "system.resource": { ...USES, value: spent(card) ? 1 : 0 },
      });
      console.debug(`${LOG_PREFIX} ${LABEL}: set up the counter on ${actor["name"]}'s card.`);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not set up ${actor["name"]}'s card.`, error);
    }
  }
}

/**
 * Spend the Hope and the session's use, in one write where the system allows it.
 *
 * Both go through `Actor#modifyResource`: the Hope as an ordinary resource, and
 * the card's counter through the system's own item-cost path, which relays the
 * Item update through a GM. That matters — the client running this is whoever
 * applied the damage, and they do not necessarily own the card.
 *
 * The fallback writes the counter directly, and only runs for a card that never
 * got one (a card added since the last `ready`, on a table with no GM connected
 * to reconcile it). It needs permission the relay would not have needed, so it is
 * allowed to fail with a line in the console rather than taking the swap with it:
 * the Stress is already off the list and the Hope already spent, and losing the
 * bookkeeping is much the smaller loss.
 */
async function pay(actor: AnyObject, card: AnyObject): Promise<void> {
  const updates: AnyObject[] = [...resourceUpdatesFor(actor, COST)];

  if (hasCounter(card)) {
    updates.push({ key: ITEM_RESOURCE, value: SWAP, itemId: card["id"], target: card });
  }

  await actor["modifyResource"]?.(updates);

  if (hasCounter(card)) return;

  try {
    await card["update"]?.({ "system.resource": { ...USES, value: 1 } });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not mark the use on the card.`, error);
  }
}

/* ------------------------------------------------------------------ *
 * Which attack this was
 * ------------------------------------------------------------------ */

/** Drop attributions too old to belong to anything still in flight. */
function sweep(now: number): void {
  for (const [key, entry] of incoming) if (now - entry.at > ATTRIBUTION_MS) incoming.delete(key);
}

/**
 * How much Stress this damage packet carries, before anybody has taken a hand in
 * it.
 *
 * `config.damage.resources.stress` is the evaluated roll for the attack's own
 * Stress part — the shape 42 of the SRD's adversary actions use for "the target
 * must mark a Stress". A `fullRestore` packet is a different rule with a
 * different arithmetic and answers zero.
 */
function stressCarried(config: AnyObject): number {
  const roll = config["damage"]?.["resources"]?.[STRESS] as AnyObject | number | undefined;
  if (roll === undefined || roll === null) return 0;
  if (typeof roll === "object" && roll["options"]?.["fullRestore"] === true) return 0;

  const total = Number(typeof roll === "number" ? roll : roll["total"] ?? 0);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Write down who is about to hurt whom, and with how much Stress.
 *
 * Runs on the client applying the damage, which is the same client the marking
 * rule runs on — the map never crosses a socket and never outlives the
 * application it describes. Damage carrying no Stress is not recorded at all,
 * which is what keeps `wants` from interposing on the overwhelming majority of
 * hits.
 */
function rememberAttack(config: AnyObject, targets: AnyObject[] | null, applying: boolean): void {
  if (!enabled() || !applying) return;
  if (config["hasHealing"] === true) return;

  const attacker = String(config["source"]?.["actor"] ?? "");
  if (!attacker) return;

  const stress = stressCarried(config);
  if (stress < SWAP) return;

  const now = Date.now();
  sweep(now);

  for (const target of damagedTargets(config, targets)) {
    const uuid = String(target?.["actorId"] ?? "");
    if (uuid) incoming.set(uuid, { attacker, stress, at: now });
  }
}

/* ------------------------------------------------------------------ *
 * The offer
 * ------------------------------------------------------------------ */

/** The banner: the attacker, what is about to be marked, and who is marking it. */
function headlineFor(attacker: AnyObject | null, actor: AnyObject, marks: number): PromptHeadline {
  return {
    source: {
      name: String(attacker?.["name"] ?? game.i18n.localize("EE.Features.BraveFace.UnknownSource")),
      img: attacker?.["img"] ? String(attacker["img"]) : undefined,
    },
    target: {
      name: String(actor["name"] ?? ""),
      img: actor["img"] ? String(actor["img"]) : undefined,
    },
    verdict: game.i18n.format("EE.Features.BraveFace.Verdict", { marks }),
  };
}

/**
 * Put the question on the damaged player's screen. Resolves to whether they said
 * yes.
 *
 * The hint names how much Hope they hold, because that is the number the decision
 * turns on and the sheet may well be behind another window at this moment.
 */
async function ask(
  actor: AnyObject,
  card: AnyObject,
  attacker: AnyObject | null,
  marks: number,
): Promise<boolean> {
  const hope = Number(actor["system"]?.["resources"]?.["hope"]?.["value"] ?? 0);

  const prompt: PromptRequest = {
    title: game.i18n.localize("EE.Features.BraveFace.Title"),
    intro: game.i18n.format(
      marks > SWAP ? "EE.Features.BraveFace.IntroMany" : "EE.Features.BraveFace.Intro",
      {
        attacker: String(attacker?.["name"] ?? game.i18n.localize("EE.Features.BraveFace.UnknownSource")),
        marks,
      },
    ),
    headline: headlineFor(attacker, actor, marks),
    offers: [
      {
        id: FEATURE_ID,
        label: game.i18n.localize("EE.Features.BraveFace.Label"),
        hint: game.i18n.format("EE.Features.BraveFace.Hint", { hope }),
        itemName: String(card["name"] ?? LABEL),
        img: card["img"] ? String(card["img"]) : undefined,
        useLabel: game.i18n.localize("EE.Features.BraveFace.Spend"),
        skipLabel: game.i18n.localize("EE.Features.BraveFace.Mark"),
      },
    ],
  };

  const chosen = await askUser(responderFor(actor), prompt);
  return chosen.has(FEATURE_ID);
}

/**
 * Say the Hope went instead, in the chat log.
 *
 * Public, and for the same reason the talisman's is: the reason a Stress was not
 * marked belongs beside the attack that would have marked it. Once per session is
 * also the table's business — somebody will want to know it has gone.
 */
async function announce(actor: AnyObject, attacker: AnyObject | null): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor as never }),
      content: `<p>${escapeHtml(
        game.i18n.format("EE.Features.BraveFace.Announce", {
          actor: String(actor["name"] ?? ""),
          attacker: String(
            attacker?.["name"] ?? game.i18n.localize("EE.Features.BraveFace.UnknownSource"),
          ),
        }),
      )}</p>`,
    });
  } catch (error) {
    // The Hope is already spent and the Stress already gone; losing the
    // announcement must not undo either.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the swap.`, error);
  }
}

/* ------------------------------------------------------------------ *
 * The rule
 * ------------------------------------------------------------------ */

/**
 * Would this actor's Brave Face have anything to say about a hit landing on
 * them right now?
 *
 * Asked before the damage is worked out, so it cannot know whether any Stress is
 * coming — {@link offer} still checks. What it can rule out is everything that
 * has nothing to do with this attack: the wrong kind of actor, no card, the use
 * already gone, no Hope to spend, and damage that arrived from somewhere this
 * feature does not read as an attack.
 */
function wants(actor: AnyObject): boolean {
  if (!enabled()) return false;
  if (!incoming.has(String(actor["uuid"] ?? ""))) return false;

  const card = braveFaceCard(actor);
  if (!card || spent(card)) return false;

  return canAfford(actor, COST);
}

/**
 * Offer the swap against one finished update list, and take the Stress off it if
 * the player says yes.
 *
 * `resources` is the system's own array, moments from being written, so the
 * change is made in place. The entry is *removed* rather than zeroed when nothing
 * is left of it: a `{ key: "stress", value: 0 }` left behind would write the same
 * number back harmlessly, but the system's damage summary would print "Mark 0
 * Stress" underneath the attack, which is worse than saying nothing.
 *
 * The sign is read rather than assumed. Stress is a *reversed* resource and so
 * arrives positive, but not hardcoding that is the same care `canAfford` takes.
 */
async function offer(actor: AnyObject, resources: AnyObject[]): Promise<void> {
  const index = (resources ?? []).findIndex(
    (update) => String(update?.["key"] ?? "") === STRESS,
  );
  const entry = index === -1 ? null : resources[index]!;
  const marks = Math.abs(Number(entry?.["value"] ?? 0));

  // No Stress, no swap. Nobody is interrupted and no use is spent.
  if (!entry || !Number.isFinite(marks) || marks < SWAP) return;

  // "Mark all your Stress" is a different rule with a different arithmetic.
  if (entry["clear"] === true) return;

  const uuid = String(actor["uuid"] ?? "");
  const attack = incoming.get(uuid);
  if (!attack) return;
  incoming.delete(uuid);

  // What the *attack* brought, which is not necessarily all of what is here: the
  // armor-slot dialog folds any Stress the player chose to spend into this same
  // entry, and that Stress is nobody's doing but theirs.
  const attributable = Math.min(attack.stress, marks);
  if (attributable < SWAP) return;

  const card = braveFaceCard(actor);
  if (!card || spent(card) || !canAfford(actor, COST)) return;

  // Two attacks landing at once would otherwise put the same card on screen
  // twice and spend the one use twice.
  if (asking.has(uuid)) return;
  asking.add(uuid);

  try {
    const attacker = (fromUuidSync(attack.attacker) ?? null) as AnyObject | null;
    if (!(await ask(actor, card, attacker, attributable))) return;

    // Re-read: the question sat on a screen for up to half a minute, and both the
    // Hope and the session's use may have gone elsewhere in the meantime.
    if (spent(card) || !canAfford(actor, COST)) {
      console.debug(`${LOG_PREFIX} ${LABEL}: the price went while the question was open.`);
      return;
    }

    const value = Number(entry["value"] ?? 0);
    const left = Math.abs(value) - SWAP;
    if (left <= 0) resources.splice(index, 1);
    else entry["value"] = value > 0 ? left : -left;

    await pay(actor, card);
    await announce(actor, attacker);
  } finally {
    asking.delete(uuid);
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/** Wire the feature up. Called once during `init`. */
export function registerBraveFace(): void {
  onDamageLanding({
    id: FEATURE_ID,
    before: (config, targets, applying) => {
      rememberAttack(config, targets, applying);
    },
  });

  onDamageMarking({
    id: FEATURE_ID,
    wants,
    mark: (actor, resources) => offer(actor, resources),
  });
}
