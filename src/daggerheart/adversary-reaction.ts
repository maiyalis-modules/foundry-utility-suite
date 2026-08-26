/**
 * What the two **adversary reaction** windows share.
 *
 * `adversary-attack.ts` came first and owned all of this. `adversary-damage.ts`
 * is the second window built the same way — an adversary rolls, a player
 * character standing nearby pays to change it, and the client holding the
 * pipeline open is not the client that decides — so the three pieces that are
 * about *who may react*, rather than about what is being rerolled, moved here
 * instead of being copied.
 *
 * Everything else stays in the two windows, and deliberately. They differ in the
 * question they ask (did it land, versus how hard), in what a reroll has to
 * rebuild, and in whether the table has already watched the dice — which is most
 * of each file. The common part is small on purpose: this is the second-consumer
 * extraction the module does elsewhere (`damage-marking.ts`), not a base class.
 */
import { resourceUpdatesFor, type FeatureCost } from "./feature-registry.js";

/**
 * The actor that made the roll, or null when the roll has no owner.
 *
 * `roll.data.parent` is the direct answer and is present for anything rolled
 * through an action; the `config.source.actor` uuid is the fallback for a roll
 * rebuilt or replayed without its data, which is how a damage roll pressed off
 * an existing chat card arrives.
 */
export function rollActor(roll: AnyObject, config: AnyObject): AnyObject | null {
  const parent = roll["data"]?.["parent"];
  if (parent) return parent as AnyObject;

  const uuid = config["source"]?.["actor"];
  return uuid ? (fromUuidSync(String(uuid)) as AnyObject | null) : null;
}

/**
 * Every player character with a token on this scene, other than the roller.
 *
 * Drawn from the canvas rather than from `game.actors` because a character has to
 * be *present* to react, and because the distance check needs a token anyway.
 * Sorted by name so that when two characters could both react, the order they are
 * asked in is the same on every client and from one roll to the next.
 */
export function candidateReactors(roller: AnyObject): AnyObject[] {
  const seen = new Set<string>();
  const actors: AnyObject[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor as AnyObject | null;
    if (!actor || actor["type"] !== "character") continue;

    const uuid = String(actor["uuid"] ?? "");
    if (!uuid || uuid === roller["uuid"] || seen.has(uuid)) continue;

    seen.add(uuid);
    actors.push(actor);
  }

  return actors.sort((a, b) => String(a["name"] ?? "").localeCompare(String(b["name"] ?? "")));
}

/**
 * Charge a reacting character for their own feature.
 *
 * Not `config.resourceUpdates` — that map belongs to the actor who *rolled*, and
 * folding a player's Hope into it would charge the adversary. Awaited so that a
 * failed write (a client without permission on this actor) aborts the window
 * before the outcome changes, rather than after.
 */
export async function payCostFor(
  actor: AnyObject,
  costs: readonly FeatureCost[],
): Promise<void> {
  if (costs.length === 0) return;
  await actor["modifyResource"]?.(resourceUpdatesFor(actor, costs));
}
