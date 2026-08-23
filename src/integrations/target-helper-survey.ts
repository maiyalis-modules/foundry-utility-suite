/**
 * **Maiyalis: Target Helper** (`daggerheart-target-helper`) — the one place here
 * that talks to that module's API. Its `src/api.ts` is the contract.
 *
 * Two things are asked of it:
 *
 * - **Range surveys.** Its targeting picker already knows how to list everything
 *   on the scene with its distance from a given token, colour-coded by range
 *   band, and it publishes a read-only version of that window. That lets the
 *   **Tokens on Scene** bar offer a "how far is everything from this token"
 *   button without knowing anything about how the window is built.
 * - **Range origins.** Where an action's range is measured *from*, for the case
 *   where the creature acting is not the creature rolling — see
 *   `daggerheart/companion.ts`, which is the only caller.
 *
 * *Optional*, like every other integration in this folder: with that module
 * absent or disabled, {@link surveysAvailable} is false, the bar renders no
 * button, {@link registerRangeOrigin} quietly does nothing, and nothing else
 * changes. Each entry point is probed separately, so an older install that
 * publishes only the survey still gets the survey.
 */
import { LOG_PREFIX } from "../constants.js";

/** The Target Helper's module id. */
const TARGET_HELPER_ID = "daggerheart-target-helper";

/**
 * Answers "where is this action measured from?", or null to leave that to the
 * acting actor's own token. A token id or uuid is accepted in place of the
 * placeable; anything not on the current scene counts as null.
 */
export type RangeOriginResolver = (action: AnyObject) => Token | string | null;

/** The slice of its API this file uses. Its `src/api.ts` is the contract. */
interface TargetHelperApi {
  /** Opens the read-only survey for a token; false if it isn't on this scene. */
  openRangeSurvey(source: Token | string): boolean;
  /** Declares where an action's range is measured from. Added after the survey. */
  registerRangeOrigin(resolver: RangeOriginResolver): void;
}

/**
 * Its published API, whatever of it exists, or null when the module isn't
 * active. Deliberately un-narrowed: each caller checks the one method it needs,
 * so an install predating a method still gets everything else.
 */
function targetHelperApi(): Partial<TargetHelperApi> | null {
  const module = game.modules.get(TARGET_HELPER_ID);
  if (module?.active !== true) return null;

  return (module["api"] as Partial<TargetHelperApi> | undefined) ?? null;
}

/**
 * Whether a survey can be opened at all. The bar asks before drawing the button:
 * a control that is present but does nothing is worse than no control.
 */
export function surveysAvailable(): boolean {
  return typeof targetHelperApi()?.openRangeSurvey === "function";
}

/**
 * Declare where some actions' range is measured from. Returns whether the
 * declaration was accepted.
 *
 * A `false` here is not a failure worth a notification: without that module
 * nothing gates range for anybody, so an unheard origin changes nothing that was
 * otherwise going to work.
 */
export function registerRangeOrigin(resolver: RangeOriginResolver): boolean {
  const api = targetHelperApi();
  if (typeof api?.registerRangeOrigin !== "function") return false;

  try {
    api.registerRangeOrigin(resolver);
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not declare a range origin.`, error);
    return false;
  }
}

/**
 * Open the survey for one token. Silent no-op when the module is gone — which is
 * reachable even after {@link surveysAvailable} said yes, since a GM can disable
 * a module in another tab.
 */
export function openRangeSurvey(tokenId: string): void {
  const api = targetHelperApi();
  if (typeof api?.openRangeSurvey !== "function") return;

  try {
    api.openRangeSurvey(tokenId);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not open the range survey.`, error);
  }
}
