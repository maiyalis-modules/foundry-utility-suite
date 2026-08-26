/**
 * The GM's Fear counter: read it, and spend from it.
 *
 * Fear is the one resource in Daggerheart that belongs to nobody's sheet. Hope
 * and Stress are actor fields and go through `Actor#modifyResource`; Fear is a
 * **world-scoped game setting** the system owns, displayed by its own counter UI
 * and written by nothing else. That difference is the whole reason this file
 * exists as a file rather than four lines inside a feature.
 *
 * Extracted from `hex.ts` — which had "the GM spends a number of Fear equal to
 * your Spellcast trait to remove it" and therefore all of this — when `slumber.ts`
 * arrived with "the GM spends a Fear on their turn to clear this condition". Two
 * cards, one counter, one place that knows how to reach it.
 *
 * ## Why the setting and not `modifyResource`
 *
 * The system's resource path wants an actor, and there isn't one: the Fear pool
 * is the GM's, not any adversary's. Writing the setting directly is also what the
 * system's own counter does, and its `onChange` re-renders the display — so a
 * spend made here shows up on every client without this module touching the UI.
 *
 * ## Why every writer here is a GM
 *
 * A world-scoped setting can only be written by a GM; Foundry rejects the write
 * from anyone else. That is not a restriction this file works around — it is the
 * correct rule, since every card that spends Fear spends it on the GM's decision.
 * {@link spendFear} therefore declines rather than relaying, and says so.
 *
 * The setting *name* is read out of `CONFIG.DH` rather than hardcoded, with the
 * observed key as the fallback: the system has renamed settings across versions
 * before, and a wrong key here would silently read zero Fear forever — which
 * looks exactly like a table that has spent it all.
 */
import { LOG_PREFIX } from "../constants.js";

/** The system id, and the world setting its Fear counter lives in. */
const DH_ID = "daggerheart";
const FEAR_KEY = "ResourcesFear";

/** The name of the system setting holding the GM's Fear. */
function fearSetting(): string {
  return String(CONFIG["DH"]?.SETTINGS?.gameSettings?.Resources?.Fear ?? FEAR_KEY);
}

/** The GM's Fear counter, as the system stores it. */
export function currentFear(): number {
  const fear = Number(game.settings.get(DH_ID, fearSetting()) ?? 0);
  return Number.isFinite(fear) ? fear : 0;
}

/**
 * Set it, floored at zero.
 *
 * The floor is here rather than at the call sites because a negative Fear is not
 * a state the system's counter can draw — it would render as a number the GM
 * cannot spend down and cannot see the top of.
 */
export async function setFear(value: number): Promise<void> {
  await game.settings.set(DH_ID, fearSetting(), Math.max(0, value));
}

/**
 * Spend `price` Fear, if there is that much. Returns whether it was spent.
 *
 * Re-reads the counter immediately before the write on purpose: every caller
 * asked a human a question first, and half a minute of somebody deciding is
 * plenty of time for the GM to have spent that Fear on something else. Reporting
 * `false` is a real answer, not an error — the caller's job is to leave the
 * world alone when it comes back.
 */
export async function spendFear(price: number, label = "Fear"): Promise<boolean> {
  if (!Number.isFinite(price) || price < 1) return false;

  if (!game.user?.isGM) {
    console.warn(`${LOG_PREFIX} ${label}: only a GM can spend Fear.`);
    return false;
  }

  const fear = currentFear();
  if (fear < price) return false;

  await setFear(fear - price);
  return true;
}
