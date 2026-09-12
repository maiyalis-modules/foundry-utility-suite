/**
 * **Hex** (Witch class — Hope and Fear SRD) — "Mark a Stress to temporarily
 * *Hex* a target within Far range. While *Hexed*, the target gains a penalty to
 * their damage rolls and Difficulty equal to your tier. The maximum number of
 * creatures you can *Hex* at one time is equal to your Spellcast trait."
 *
 * ## A different rule, not a rewording
 *
 * This file was first written against the Void's Hex, which was a *reaction* —
 * "when a creature causes you or an ally within Close range to mark any number
 * of Hit Points, you can mark a Stress to Hex them" — granting the party a
 * *bonus* to rolls against the creature, one hex per witch, lifted by the GM
 * spending Fear. The SRD's (Daggerheart 2.9.3) is proactive, penalises the
 * target's own rolls, allows several at once, and names no way to lift it.
 * Everything the first version did — the damage-landing attribution, the
 * Close-range prompt, the `preRoll` and damage-modifier bonus seams, the Fear
 * button on the announcement — implemented the old rule and is gone. What
 * follows implements the SRD's. A Void copy of the card still on a sheet is
 * matched too (see `MATCH`) and gets this rule, because the module implements
 * one Hex and the Void's is retired; its printed text will disagree.
 *
 * ## What the SRD card ships, and how much of it just works
 *
 * One `effect` action, "Hex": `cost: [{ key: "stress", value: 1 }]`,
 * `target: any`, `range: far`, and one embedded ActiveEffect — "Hex", duration
 * `temporary` — with three `subtract` changes: `system.difficulty` and
 * `system.bonuses.damage.{physical,magical}.bonus`, each by `ORIGIN.@tier`.
 * That is most of the rule, and the system carries all of it:
 * `DhActiveEffect.getChangeValue` resolves `ORIGIN.@…` against the item the
 * effect's `origin` points at — the witch's card, whose roll data is hers — so
 * the penalty is *her* tier, read live; `DamageRoll.getBonus` honours
 * `subtract` and lists it as a ticked modifier in the damage dialog; and
 * `DhActiveEffect._preCreate` refuses a second effect with the same `origin`,
 * so re-hexing the same creature does not stack. None of that is reimplemented.
 *
 * Three things the card cannot do, and this file does:
 *
 * 1. **Land on an adversary from the witch's client.** `EffectsField.applyEffect`
 *    is a bare `ActiveEffect.create` on the target, which core refuses to
 *    anyone but an OWNER of the target — every adversary, from every player.
 *    So the action's own `effects` are taken off at preparation time
 *    ({@link stripNativeEffects}, the seam `blighting-strike.ts` uses;
 *    display-only, `reset()` restores them) and the effect is placed by
 *    `gm-effects.ts` instead, from a fixed shape carrying the same three
 *    changes and an `origin` of the witch's card. The GM's client builds it;
 *    nothing crosses the socket but a description, and the origin is checked
 *    there to be an Item on the witch it claims (see that file).
 * 2. **The cap.** "The maximum number … at one time is equal to your Spellcast
 *    trait." Counted on `preUseAction` — before the Stress is charged — from
 *    the hexes flagged with the witch's uuid on every actor in `game.actors`
 *    and on the current scene's tokens. At or over the cap the press is
 *    **refused**, naming the cap and who is hexed; the card says "maximum", not
 *    "replace", so nothing is lifted to make room. Re-hexing a creature already
 *    under this witch's hex is allowed through — it refreshes, and adds nothing
 *    to the count. A Spellcast trait of zero is a cap of zero, as printed.
 * 3. **Far range.** The system checks no range against targets. Measured on
 *    `preUseAction` with `range-bands.ts`, and refused when the target is
 *    *measurably* beyond Far. A distance that cannot be measured — the witch
 *    has no token on this scene — is let through: this is a deliberate,
 *    targeted press rather than a picker offering names, and a GM casting for
 *    a witch from the sidebar should not be stopped by geometry nobody drew.
 *
 * ## Where the hex lives
 *
 * On the hexed creature, as the ActiveEffect `gm-effects.ts` places, flagged
 * {@link FLAGS.hex} with the witch's uuid. The effect **is** the record — its
 * changes are the penalty, its count against the witch's uuid is the cap, and
 * deleting it from the sheet is how it ends. Keyed by witch, so two Witches can
 * hex the same creature and each subtracts her own tier.
 *
 * ## Deliberate silences
 *
 * - **Ending it is by hand.** "Temporarily" names no moment, and the SRD dropped
 *   the Void's Fear price and scene clause. The effect's description says to
 *   delete it; nothing here watches a rest, a combat or a scene.
 * - **Hexing a character penalises only their damage.** Characters have no
 *   Difficulty for the change to reach; that is the card, not a gap.
 * - **A hex on an unlinked token on another scene is not counted.** The cap
 *   can under-count by exactly that much, and the alternative is a scan of
 *   every scene's tokens on every press.
 * - **Range is measured, not enforced by the system**, so a table with range
 *   measurement off in the module still gets the cap and the effect.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { findGrantingItem, type FeatureMatch } from "./feature-registry.js";
import { markActor, type MarkRequest } from "./gm-effects.js";
import { distanceBetweenActors, withinBand, type RangeBand } from "./range-bands.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "hex";

/** Prefix for this feature's console lines. Deliberately the printed card name. */
const LABEL = "Hex";

/**
 * How the granting card is recognised — flag, then compendium, then name. The
 * Void's copy is listed second and gets this rule; see the header.
 */
const MATCH: FeatureMatch = {
  compendiumSources: [
    "Compendium.daggerheart.classes.Item.EFgQVcDiADsKxG3T",
    "Compendium.the-void-unofficial.classes.Item.4iy45CFDxqDrb5QN",
  ],
  names: ["Hex"],
};

/** `MATCH.names`, lower-cased once, for {@link isHexCard}. */
const PRINTED_NAMES: ReadonlySet<string> = new Set(
  (MATCH.names ?? []).map((name) => name.toLowerCase()),
);

/** "…a target within Far range." */
const BAND: RangeBand = "far";

/** Which kind of `gm-effects.ts` marker carries the hex. */
const MARK_KIND = "hex";

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.hexCondition) === true;
}

/** Trimmed string, however the value arrives. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

/** The Hex card on this actor, or null. */
function hexCard(actor: AnyObject | null | undefined): AnyObject | null {
  return actor ? findGrantingItem(actor, FEATURE_ID, MATCH) : null;
}

/**
 * Is this Item the card? The same three routes as `findGrantingItem`, asked of
 * an Item rather than an actor, because {@link stripNativeEffects} meets the
 * card during its own preparation.
 */
function isHexCard(item: AnyObject | null | undefined): boolean {
  if (!item || item["type"] !== "feature") return false;

  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  const source = text(item["_stats"]?.["compendiumSource"]);
  if (source && (MATCH.compendiumSources ?? []).includes(source)) return true;

  return PRINTED_NAMES.has(text(item["name"]).toLowerCase());
}

/**
 * Is this the card's button? The card ships exactly one action, so matching the
 * granting Item is enough and no action name is hardcoded.
 */
function hexAction(action: AnyObject): AnyObject | null {
  const card = hexCard(action?.["actor"] as AnyObject | null);
  if (!card) return null;

  return card["id"] === action["item"]?.["id"] ? card : null;
}

/**
 * The Spellcast trait, which is the cap. `system.spellcastModifier` is the
 * system's own reading of it — the highest spellcasting trait among the
 * character's subclasses — and zero when there is none.
 */
function spellcastTrait(witch: AnyObject): number {
  const value = Number(witch["system"]?.["spellcastModifier"] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The witch's tier, for the announcement only; the effect reads its own. */
function tierOf(witch: AnyObject): number {
  const value = Number(witch["system"]?.["tier"] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/* ------------------------------------------------------------------ *
 * The card's native effect
 * ------------------------------------------------------------------ */

/**
 * Take the card's actions' `effects` off the prepared collection, so the system
 * does not try to apply the embedded effect itself — see the header on why it
 * could not, from a player's client, and would double up from the GM's.
 *
 * Every action on the card, not one by id: the card ships one, and a homebrew
 * that added another with the same effect has the same problem. The effect
 * stays on the Item; only the action's reference to it is dropped, from
 * prepared data, so `reset()` — which {@link reconcileHexCards} calls —
 * restores it the moment the setting is turned off. Called after every
 * preparation of every Item, so the first line is the hot path.
 */
function stripNativeEffects(item: AnyObject): void {
  if (!isHexCard(item)) return;
  if (!enabled()) return;

  for (const action of (item["system"]?.["actions"] ?? []) as Iterable<AnyObject>) {
    const effects = action?.["effects"];
    if (Array.isArray(effects) && effects.length > 0) action["effects"] = [];
  }
}

/**
 * Bring every Hex card in play into line with the current setting, on this
 * client. `reset()` rather than `prepareData()`, for the reason
 * `blighting-strike.ts` gives: only re-initialising from `_source` puts back
 * what preparation took off. Unlinked token actors are separate documents from
 * anything in `game.actors`, hence the second pass.
 */
export function reconcileHexCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isHexCard(item)) continue;
      try {
        item["reset"]?.();
      } catch (error) {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not reset the card.`, error);
      }
      changed = true;
      item["render"]?.(false);
    }
    if (changed) actor["render"]?.(false);
  };

  for (const actor of game.actors?.contents ?? []) {
    sweep(actor);
    seen.add(String(actor["uuid"] ?? ""));
  }

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor as AnyObject | null;
    if (!actor || seen.has(String(actor["uuid"] ?? ""))) continue;
    sweep(actor);
  }
}

/* ------------------------------------------------------------------ *
 * Reading hexes
 * ------------------------------------------------------------------ */

/** The hex flag on an effect, or null. */
function hexFlag(effect: AnyObject): AnyObject | null {
  const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.hex];
  return mark && typeof mark === "object" ? (mark as AnyObject) : null;
}

/** Is this creature under this witch's hex? */
function hexedBy(creature: AnyObject | null | undefined, witchUuid: string): boolean {
  for (const effect of (creature?.["effects"] ?? []) as AnyObject[]) {
    if (String(hexFlag(effect)?.["sourceUuid"] ?? "") === witchUuid) return true;
  }
  return false;
}

/**
 * Every actor a hex could currently be sitting on: the world's own, plus the
 * synthetic actors behind unlinked tokens on the current scene — which is the
 * usual case here rather than the exotic one, since an adversary on the board
 * is very often an unlinked token whose effects live on its ActorDelta.
 */
function bearers(): AnyObject[] {
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

/** Every creature this witch currently has hexed, wherever it is. */
function creaturesHexedBy(witchUuid: string): AnyObject[] {
  if (!witchUuid) return [];
  return bearers().filter((bearer) => hexedBy(bearer, witchUuid));
}

/** The one creature this press is aimed at, or null. */
function soleTarget(config: AnyObject): { actorUuid: string; name: string } | null {
  const targets = (config["targets"] ?? []) as AnyObject[];
  if (targets.length !== 1) return null;

  const actorUuid = String(targets[0]?.["actorId"] ?? "");
  return actorUuid ? { actorUuid, name: String(targets[0]?.["name"] ?? "") } : null;
}

/** Names, joined the way the language does it. */
function names(actors: AnyObject[]): string {
  return game.i18n.getListFormatter().format(actors.map((actor) => String(actor["name"] ?? "")));
}

/* ------------------------------------------------------------------ *
 * Casting
 * ------------------------------------------------------------------ */

/**
 * Should this press go ahead? Returns a localized refusal, or null to allow.
 *
 * Asked from `preUseAction`, where `prepareConfig` has already run — so the
 * target is known — and the Stress is still unspent, which is the only moment
 * refusing is free. Order: no target, out of range, over the cap; each is the
 * first thing the player would want to hear.
 */
function refusal(witch: AnyObject, config: AnyObject): string | null {
  const target = soleTarget(config);
  if (!target) return game.i18n.localize("EE.Features.Hex.NoTarget");

  const creature = fromUuidSync(target.actorUuid) as AnyObject | null;
  if (!creature) return game.i18n.localize("EE.Features.Hex.NoTarget");

  // Measurably beyond Far is refused; unmeasurable is let through — see the
  // header on why this press is not the picker Close-Knit offers.
  if (withinBand(distanceBetweenActors(witch, creature), BAND) === false) {
    return game.i18n.format("EE.Features.Hex.OutOfRange", { creature: target.name });
  }

  const witchUuid = String(witch["uuid"] ?? "");
  // Refreshing a hex already standing adds nothing to the count.
  if (hexedBy(creature, witchUuid)) return null;

  const cap = spellcastTrait(witch);
  const standing = creaturesHexedBy(witchUuid);
  if (standing.length >= cap) {
    return cap === 0
      ? game.i18n.localize("EE.Features.Hex.NoCap")
      : game.i18n.format("EE.Features.Hex.AtCap", { cap, creatures: names(standing) });
  }

  return null;
}

/** The mark request describing one hex. */
function request(creatureUuid: string, witch: AnyObject, card: AnyObject): MarkRequest {
  return {
    kind: MARK_KIND,
    actorUuid: creatureUuid,
    sourceUuid: String(witch["uuid"] ?? ""),
    sourceName: String(witch["name"] ?? ""),
    // What `ORIGIN.@tier` in the effect's changes resolves against.
    originUuid: String(card["uuid"] ?? ""),
  };
}

/** Say who hexed whom, and how many hexes the witch now has out. */
async function announce(
  witch: AnyObject,
  creature: string,
  standing: number,
  cap: number,
): Promise<void> {
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: witch as never }),
      content: `<p>${escapeHtml(
        game.i18n.format("EE.Features.Hex.Announce", {
          witch: String(witch["name"] ?? ""),
          creature,
          tier: tierOf(witch),
          standing,
          cap,
        }),
      )}</p>`,
    });
  } catch (error) {
    // The hex is placed either way; losing the line must not undo it.
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the hex.`, error);
  }
}

/**
 * Place the hex. `postUseAction`, once the Stress has been charged, relayed
 * through `gm-effects.ts` because the creature is almost always the GM's.
 *
 * The count announced is the one *after* this hex — the same scan as the cap
 * check, plus one when this creature was not already under the witch's hex,
 * since the relayed effect may not have landed yet when the line is written.
 */
async function cast(action: AnyObject, config: AnyObject, card: AnyObject): Promise<void> {
  const witch = action["actor"] as AnyObject | null;
  const target = soleTarget(config);
  if (!witch || !target) return;

  const witchUuid = String(witch["uuid"] ?? "");
  const creature = fromUuidSync(target.actorUuid) as AnyObject | null;
  const already = hexedBy(creature, witchUuid);

  await markActor(request(target.actorUuid, witch, card));

  const standing = creaturesHexedBy(witchUuid).length + (already ? 0 : 1);
  await announce(witch, target.name, standing, spellcastTrait(witch));

  console.debug(`${LOG_PREFIX} ${LABEL}: ${witch["name"]} hexed ${target.name}.`);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts`,
 * `companion.ts`, `close-knit.ts`, `blighting-strike.ts`, `brave-face.ts`,
 * `tethered-talisman.ts` and `attack-of-opportunity.ts` use. Eighth file-local
 * copy — see the note in `attack-of-opportunity.ts` for why the extraction has
 * been deferred.
 */
function patchPreparation(): void {
  const prototype = CONFIG.Item?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["prepareEmbeddedDocuments"];
  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no prepareEmbeddedDocuments to patch — the card keeps its effect.`,
    );
    return;
  }

  prototype!["prepareEmbeddedDocuments"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      stripNativeEffects(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not strip the card's effect.`, error);
    }
    return result;
  };
}

/** Wire the feature up. Called once during `init`. */
export function registerHex(): void {
  patchPreparation();

  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): boolean | void => {
    try {
      if (!enabled() || !hexAction(action)) return;

      const witch = action["actor"] as AnyObject | null;
      if (!witch) return;

      const reason = refusal(witch, config);
      if (reason === null) return;

      ui.notifications?.warn(reason);
      return false;
    } catch (error) {
      // Never `false` from the error path: a failed check must not cost the
      // player their press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not check the card.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject): void => {
    try {
      if (!enabled()) return;
      const card = hexAction(action);
      if (!card) return;

      // Started, not awaited: the hook is synchronous, and the card's own chat
      // message is not waiting on the effect.
      void cast(action, config, card).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not place the hex.`, error);
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not place the hex.`, error);
    }
  });
}
