/**
 * **Blighting Strike** (Dread domain, *Void for Daggerheart*) — "Make a Spellcast
 * Roll against a target within Far range. On a success, the target takes d6+1
 * magic damage using your Proficiency and the next time the target deals damage
 * to an ally, it is reduced by half. If you succeed with Fear, the target instead
 * takes d10+1 magic damage using your Proficiency."
 *
 * ## What the Void ships, and what is wrong with it
 *
 * Three actions on one card:
 *
 * - **Spellcast Roll** — an `attack` action at Far range whose `damage.main` is
 *   `null`, so it rolls the Spellcast and stops.
 * - **Damage (Hope)** — a `damage` action, d6+1 magical, scaled by Proficiency.
 * - **Damage (Fear)** — the same, with a d10.
 *
 * The numbers are right and the shape is wrong. Daggerheart has a native mechanic
 * for a damage part that changes on a Fear result — `DHResourceData.resultBased`,
 * which makes `DamageField.getFormulaValue` return the part's `valueAlt` instead
 * of its `value` when `duality === -1` — and this card is what it is for. Split
 * across three actions instead, the rule needs a human to read the Hope/Fear
 * result and press the matching button, and the split costs more than the press:
 *
 * - A standalone `damage` action has no roll, so `TargetField.execute` leaves
 *   every target's `hitResult.success` false and `DamageField.applyDamage`
 *   filters them all out. The damage never applies to anyone.
 * - `DamageField.execute` takes `isCritical` from the *action's own* chat message.
 *   A separate damage action has none, so a critical Spellcast rolled ordinary
 *   damage dice.
 * - Everything watching the action workflow — the spotlight tracker, Ginzzzu's
 *   raised portraits — sees the turn end when the Spellcast Roll ends, because as
 *   far as the system is concerned it did.
 *
 * ## So this repairs the card rather than working around it
 *
 * At preparation time the Spellcast Roll gains the damage part the card should
 * have carried all along — `value` from the Hope action, `valueAlt` from the Fear
 * one, `resultBased: true` — and the two damage actions are removed. From there
 * nothing here is involved: the system rolls the Spellcast, picks the die off the
 * duality result, rolls the damage inside the same workflow, maximises it on a
 * critical, and applies it to the targets that were hit.
 *
 * The dice are **read off the card**, never written here, so a table that retunes
 * them keeps their numbers and the Void changing them is followed without being
 * told.
 *
 * ## Why in code rather than by editing the card
 *
 * Because the edit would have to be made again for every copy, on every
 * character, and undone by the next import from the Void's compendium. This is
 * the same `Item#prepareEmbeddedDocuments` seam `reach.ts`, `companion.ts`,
 * `close-knit.ts` and `attack-of-opportunity.ts` already use, and like all of
 * them it touches prepared data only — nothing is written to the database, and
 * switching the feature off puts the card back exactly as it shipped.
 *
 * A pleasant side effect: one action means `DhpItem#use` no longer opens its
 * `ActionSelectionDialog`, so pressing the card from the hotbar simply casts it.
 *
 * ## The rider, and where it lives
 *
 * "…and the next time the target deals damage to an ally, it is reduced by half."
 * Nothing on the card declares this, so it is the one part that is genuinely
 * automated here rather than handed back to the system. Two halves:
 *
 * 1. **The mark.** On a hit, `gm-effects.ts` puts a labelled ActiveEffect on the
 *    target — relayed to the GM, because a player has no permission to write to
 *    an adversary. The effect *is* the record; there is nowhere else it could be
 *    kept, since the thing that has to remember is the blighted creature, whose
 *    next damage roll may come turns later and is made on the GM's client.
 * 2. **The halving.** A `before` rule on the shared `applyDamage` seam
 *    (`damage-landing.ts`), which is the only place that knows the attacker, the
 *    targets and the still-changeable damage packet at once. `preTakeDamage`
 *    looks like the natural seam and is not: `Actor#parseDamageArgs` reduces its
 *    payload to `{ main, resourceUpdates }` and discards the attacker.
 *
 * "An ally" is read as **Friendly token disposition** — what the table can see on
 * the scene, rather than who owns the actor.
 *
 * ## Deliberate silences
 *
 * - **A card carrying damage *resources*** — a Stress cost on one of the two
 *   damage actions, say — is left alone. Folding `main` across is one field;
 *   folding a resource collection across is not, and silently dropping a cost the
 *   card charges would be worse than leaving the card as it shipped.
 * - **The mark never expires on its own.** The card says "the next time", with no
 *   limit, so a blighted creature that never swings at anyone friendly carries it
 *   indefinitely. Faithful, and deleting the effect is one click if a table would
 *   rather call it off.
 * - **Only `main` is halved**, not a damage roll's resource entries: the card
 *   reduces *damage*, and a Stress an attack marks is not damage.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, FLAGS } from "../constants.js";
import { damagedTargets, onDamageLanding } from "./damage-landing.js";
import { markActor, unmarkActor } from "./gm-effects.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const BLIGHTING_STRIKE_SOURCE = "Compendium.the-void-unofficial.domains.Item.BIze56vTneG5UJv6";

/** Printed name, as the fallback match for a hand-copied card. */
const BLIGHTING_STRIKE_NAME = "Blighting Strike";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "blightingStrike";

/** Prefix for this feature's console lines. */
const LABEL = "Blighting Strike";

/**
 * The words that name the card's two damage actions.
 *
 * Tried before the dice, because the names are the author's own statement of
 * which is which — "Damage (Hope)" and "Damage (Fear)" — and they survive a table
 * changing the dice. Matched as a substring, case-insensitively, so a card
 * renamed to "Blighting Strike — Fear" still reads.
 */
const HOPE_WORD = "hope";
const FEAR_WORD = "fear";

/** The card as it ships: the action that casts, and one damage action per result. */
interface CardShape {
  attack: AnyObject;
  hope: AnyObject;
  fear: AnyObject;
}

/**
 * The action built for one card, kept against the `system` it was built for.
 *
 * Preparation runs on every actor update, and `system.actions` is *not* rebuilt
 * from source each time — the system's `prepareEmbeddedDocuments` re-prepares the
 * actions already in the collection. So the reshape happens once and then finds
 * nothing left to do; the cache exists for the case where a document is
 * re-initialised (`reset()`) and the original three actions come back.
 */
const cache = new WeakMap<AnyObject, { parent: AnyObject; action: AnyObject | null }>();

/** Is this feature switched on? Read per preparation, so the toggle is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.blightingStrikeDamage) === true;
}

/** Is this the Blighting Strike card? Flag first, then compendium, then name. */
function isBlightingStrike(item: AnyObject | null | undefined): boolean {
  if (!item) return false;

  // The homebrew escape hatch the feature registry uses, honoured here for the
  // same reason: a table that rewrote the card should still get the automation.
  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (String(item["_stats"]?.["compendiumSource"] ?? "") === BLIGHTING_STRIKE_SOURCE) return true;

  return String(item["name"] ?? "").trim().toLowerCase() === BLIGHTING_STRIKE_NAME.toLowerCase();
}

/** The denomination of a damage action's own die, or 0 if it has none to read. */
function faces(action: AnyObject): number {
  const die = String(action["damage"]?.["main"]?.["value"]?.["dice"] ?? "");
  const match = /^d(\d+)$/.exec(die);
  return match ? Number(match[1]) : 0;
}

/**
 * Read the card, or null if it is not the three-action shape this repairs.
 *
 * Actions are matched on their `type`, never their names: one `attack` and two
 * `damage` actions is the shape, whatever a table has renamed them to. An attack
 * that already carries damage is a card that has been fixed by hand (or by an
 * earlier preparation), and there is nothing left to do.
 *
 * The two damage actions are told apart by **name** first, and by **die size** as
 * the fallback — with exactly two of them and two denominations, the bigger die is
 * the Fear one, which is the whole content of the rule.
 */
function readCard(item: AnyObject): CardShape | null {
  const attacks: AnyObject[] = [];
  const damages: AnyObject[] = [];

  for (const action of (item["system"]?.["actions"] ?? []) as Iterable<AnyObject>) {
    const type = String(action?.["type"] ?? "");
    if (type === "attack") attacks.push(action);
    else if (type === "damage" && action?.["damage"]?.["main"]) damages.push(action);
  }

  if (attacks.length !== 1 || damages.length !== 2) return null;

  const attack = attacks[0]!;
  if (attack["hasDamage"]) return null;

  // See the header: a damage part is one field, a resource collection is not.
  for (const damage of damages) {
    if (Object.keys(damage["damage"]?.["resources"] ?? {}).length > 0) {
      console.debug(`${LOG_PREFIX} ${LABEL}: a damage action charges resources; leaving the card alone.`);
      return null;
    }
  }

  const named = (word: string): AnyObject[] =>
    damages.filter((action) => String(action["name"] ?? "").toLowerCase().includes(word));

  const hopeNamed = named(HOPE_WORD);
  const fearNamed = named(FEAR_WORD);
  if (hopeNamed.length === 1 && fearNamed.length === 1 && hopeNamed[0] !== fearNamed[0]) {
    return { attack, hope: hopeNamed[0]!, fear: fearNamed[0]! };
  }

  const [first, second] = damages as [AnyObject, AnyObject];
  const firstFaces = faces(first);
  const secondFaces = faces(second);
  if (!firstFaces || !secondFaces || firstFaces === secondFaces) return null;

  return firstFaces < secondFaces
    ? { attack, hope: first, fear: second }
    : { attack, hope: second, fear: first };
}

/**
 * The Spellcast Roll as it should have shipped: the same action, carrying the
 * card's own damage with the Fear die as its `valueAlt`.
 *
 * Built through the existing action's own constructor rather than a class looked
 * up on `game.system.api`, so it stays whatever subclass the system made it —
 * and `toObject()` gives a source object the constructor is guaranteed to accept.
 * `prepareData` is called here because the system's own
 * `Item#prepareEmbeddedDocuments` loop has already run over the collection by the
 * time this replaces an entry in it.
 */
function buildCastAction(item: AnyObject, shape: CardShape): AnyObject | null {
  const ActionClass = shape.attack["constructor"] as
    | (new (data: AnyObject, context: AnyObject) => AnyObject)
    | undefined;
  const source = shape.attack["toObject"]?.() as AnyObject | undefined;
  const hopeMain = shape.hope["damage"]?.["main"]?.["toObject"]?.() as AnyObject | undefined;
  const fearMain = shape.fear["damage"]?.["main"]?.["toObject"]?.() as AnyObject | undefined;

  if (typeof ActionClass !== "function" || !source || !hopeMain || !fearMain) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not read the card's damage; leaving it as it shipped.`);
    return null;
  }

  source["damage"] = {
    ...((source["damage"] as AnyObject | undefined) ?? {}),
    main: { ...hopeMain, resultBased: true, valueAlt: fearMain["value"] },
  };

  try {
    const action = new ActionClass(source, { parent: item["system"] as AnyObject });
    action["prepareData"]?.();
    return action;
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not rebuild the card's cast action.`, error);
    return null;
  }
}

/**
 * Put the card into the shape the rule describes. Called after every preparation
 * of every Item, so the first line is the hot path.
 */
export function reshapeBlightingStrike(item: AnyObject): void {
  if (!isBlightingStrike(item) || !enabled()) return;

  const actions = item["system"]?.["actions"] as AnyObject | undefined;
  if (typeof actions?.["set"] !== "function" || typeof actions["delete"] !== "function") return;

  const shape = readCard(item);
  // Already reshaped, or never the shape this repairs. Either way, nothing to do.
  if (!shape) return;

  const cached = cache.get(item);
  const action =
    cached && cached.parent === item["system"] ? cached.action : buildCastAction(item, shape);

  // Cached even when null, which is the "the system moved" case: preparation runs
  // on every actor update, and a build that cannot succeed should warn once
  // rather than once per update.
  cache.set(item, { parent: item["system"] as AnyObject, action });
  if (!action) return;

  actions["set"](String(shape.attack["id"] ?? ""), action);
  actions["delete"](String(shape.hope["id"] ?? ""));
  actions["delete"](String(shape.fear["id"] ?? ""));
}

/**
 * Bring every Blighting Strike in play into line with the current setting.
 *
 * `reset()` rather than `prepareData()`, and that is the whole reason this exists:
 * the reshape *removes* two actions from the prepared collection, and preparation
 * does not rebuild that collection from source — so putting the card back needs
 * the document re-initialised from `_source`, which is what `reset` does. It ends
 * by calling `prepareData` itself, so the patch below re-applies on the way out
 * when the setting is being turned on rather than off.
 */
export function reconcileBlightingStrikeCards(): void {
  const seen = new Set<string>();

  const sweep = (actor: AnyObject): void => {
    let changed = false;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      if (!isBlightingStrike(item)) continue;
      cache.delete(item);
      try {
        item["reset"]?.();
      } catch (error) {
        console.warn(`${LOG_PREFIX} ${LABEL}: could not reset the card.`, error);
      }
      changed = true;
      item["render"]?.(false);
    }
    // The character sheet lists the card's actions, so it re-renders whether or
    // not the card's own sheet happens to be open.
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

/* -------------------------------------------------------------------------- */
/*  "…and the next time the target deals damage to an ally, it is reduced by    */
/*  half."                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which kind of `gm-effects.ts` marker records the blighting.
 *
 * The marker *is* the rule. Unlike Ranger's Focus, whose label on the creature is
 * cosmetic and whose real record lives on the ranger, there is nowhere else this
 * could be kept: the thing that has to remember is the blighted creature, whose
 * next damage roll may come turns later and is made on the GM's client.
 */
const MARK_KIND = "blightingStrike";

/**
 * `CONST.TOKEN_DISPOSITIONS.FRIENDLY`.
 *
 * The chosen reading of "an ally": whatever the token is pointed at on the scene,
 * not who owns it. Read as a literal so a `CONST` that has moved costs the rule
 * rather than throwing inside damage application — and checked against `CONST`
 * first, so it follows if the value ever changes.
 */
const FRIENDLY = 1;

/** How the blighted damage is scaled, and how the remainder is rounded. */
const HALF = 0.5;

/** The blighting mark on this actor, whoever cast it, or null. */
function blightingMarkOn(actor: AnyObject | null | undefined): AnyObject | null {
  for (const effect of actor?.["effects"] ?? []) {
    if (effect?.["flags"]?.[MODULE_ID]?.[FLAGS.blightingStrikeMark]) return effect;
  }
  return null;
}

/**
 * The token one `config.targets` entry stands for.
 *
 * The same resolution `DamageField.applyDamage` does two lines further on — the
 * scene token when the entry names one, the actor's prototype otherwise — so the
 * disposition read here is the one the table is looking at.
 */
function tokenFor(target: AnyObject): AnyObject | null {
  const id = String(target["id"] ?? "");
  if (id) {
    const scene = game.scenes?.find?.((candidate: AnyObject) => candidate["active"] === true) as
      | AnyObject
      | undefined;
    const token = scene?.["tokens"]?.get?.(id) as AnyObject | undefined;
    if (token) return token;
  }

  const actor = fromUuidSync(String(target["actorId"] ?? "")) as AnyObject | null;
  return (actor?.["prototypeToken"] as AnyObject | undefined) ?? null;
}

/** Is this target an ally, in the sense the table can see on the token? */
function isFriendly(target: AnyObject): boolean {
  const friendly = (CONST?.["TOKEN_DISPOSITIONS"] as AnyObject | undefined)?.["FRIENDLY"] ?? FRIENDLY;
  return tokenFor(target)?.["disposition"] === friendly;
}

/**
 * Halve the damage packet in place.
 *
 * `main` only, and deliberately: the card says the *damage* is reduced, and a
 * damage roll's other entries are resource costs — a Stress the attack marks is
 * not damage and halving it would round straight back to 1. `Math.ceil` is the
 * system's own rounding for a halving, from `Actor#calculateDamage`'s
 * `Math.ceil(baseDamage / 2)` for resistance.
 *
 * Mutating `config.damage` here is the same thing the system does for
 * `damageOnSave` a few lines into `applyDamage`, and for the same reason: the
 * packet has been rolled and has not yet been dealt.
 */
function halveDamage(config: AnyObject): boolean {
  const main = (config["damage"] as AnyObject | undefined)?.["main"] as AnyObject | undefined;
  if (typeof main?.["total"] !== "number") return false;

  const parts = (main["parts"] ?? []) as AnyObject[];
  if (parts.length > 0) {
    let total = 0;
    for (const part of parts) {
      part["total"] = Math.ceil(Number(part["total"] ?? 0) * HALF);
      total += Number(part["total"]);
    }
    main["total"] = total;
  } else {
    main["total"] = Math.ceil(Number(main["total"]) * HALF);
  }

  return true;
}

/**
 * Put the mark on everyone the strike hit.
 *
 * `daggerheart.postUseAction`, which fires once the workflow has been awaited, so
 * `target.hit` is settled. The card grants this on a success, alongside the
 * damage — so the same targets that took damage are the ones that carry the mark,
 * and a miss marks nobody.
 *
 * Note this deliberately does **not** wait for the damage to be *applied*: the
 * rule reads "on a success", not "on damage dealt", and a table with apply
 * automation off still hit the target.
 */
function markBlightedTargets(action: AnyObject, config: AnyObject): void {
  if (!enabled()) return;
  if (String(action?.["type"] ?? "") !== "attack") return;
  if (!isBlightingStrike(action?.["item"] as AnyObject | undefined)) return;

  const caster = action["actor"] as AnyObject | undefined;
  const sourceUuid = String(caster?.["uuid"] ?? "");
  if (!sourceUuid) return;

  for (const target of (config["targets"] ?? []) as AnyObject[]) {
    if (target["hit"] !== true) continue;
    const actorUuid = String(target["actorId"] ?? "");
    if (!actorUuid) continue;

    // Fire-and-forget, like every other marker: it is relayed to the GM when the
    // caster cannot write it, and nothing here is conditional on it landing.
    void markActor({
      kind: MARK_KIND,
      actorUuid,
      sourceUuid,
      sourceName: String(caster?.["name"] ?? ""),
    });
  }
}

/**
 * "…the next time the target deals damage to an ally, it is reduced by half."
 *
 * A `before` rule on the shared `applyDamage` seam, which is the only place all
 * three facts are in hand at once: who is dealing the damage
 * (`config.source.actor`), who it is landing on, and the packet itself, still
 * changeable. `daggerheart.preTakeDamage` looks like the natural seam and is not
 * — `Actor#parseDamageArgs` reduces its payload to `{ main, resourceUpdates }`
 * and discards the attacker, which is the one thing this rule is about.
 *
 * The mark is cleared here rather than after the fact: "the next time" is spent
 * the moment the halving is applied, and clearing on the way out would leave it
 * standing if the application threw.
 */
function halveBlightedDamage(config: AnyObject, targets: AnyObject[] | null, applying: boolean): void {
  if (!enabled() || !applying) return;

  // Healing reaching an ally is not "dealing damage" to them.
  if (config["hasHealing"] === true) return;

  const attacker = fromUuidSync(String((config["source"] as AnyObject | undefined)?.["actor"] ?? "")) as
    | AnyObject
    | null;
  const mark = blightingMarkOn(attacker);
  if (!mark) return;

  const damaged = damagedTargets(config, targets);
  if (!damaged.some(isFriendly)) return;

  if (!halveDamage(config)) return;

  console.debug(`${LOG_PREFIX} ${LABEL}: halved ${String(attacker?.["name"] ?? "")}'s damage; mark spent.`);

  void unmarkActor({
    kind: MARK_KIND,
    actorUuid: String(attacker?.["uuid"] ?? ""),
    sourceUuid: String(mark["flags"]?.[MODULE_ID]?.[FLAGS.blightingStrikeMark]?.["sourceUuid"] ?? ""),
    sourceName: "",
  });
}

export function registerBlightingStrike(): void {
  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject) => {
    try {
      markBlightedTargets(action, config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not mark the strike's targets.`, error);
    }
  });

  onDamageLanding({ id: FEATURE_ID, before: halveBlightedDamage });

  patchPreparation();
}

/**
 * Wrap `Item#prepareEmbeddedDocuments`, the same seam `reach.ts`, `companion.ts`,
 * `close-knit.ts` and `attack-of-opportunity.ts` use: the system overrides it to
 * call `prepareData()` on each of an item's actions, so it runs on every
 * preparation of every item and is the last thing to touch `system.actions`
 * before anyone reads it.
 *
 * Fifth file-local copy of this helper, and the extraction is now overdue — see
 * the note in `attack-of-opportunity.ts` for why it has been deferred.
 */
function patchPreparation(): void {
  const prototype = CONFIG.Item?.documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["prepareEmbeddedDocuments"];
  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no prepareEmbeddedDocuments to patch — the card stays as it shipped.`,
    );
    return;
  }

  prototype!["prepareEmbeddedDocuments"] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      reshapeBlightingStrike(this);
    } catch (error) {
      // A broken card must not take item preparation — and with it the whole
      // sheet — down with it.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not reshape the card.`, error);
    }
    return result;
  };
}
