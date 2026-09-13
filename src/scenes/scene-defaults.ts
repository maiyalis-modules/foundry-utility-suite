/**
 * Scene default overrides — the "Scenes" tab of the Default Overrides window.
 *
 * Foundry has no setting for what a brand-new scene looks like: every one starts
 * with 25% padding, a 100px square grid, token vision on, and so on, and a GM who
 * always wants something else re-does the same edits in Configure Scene every
 * time. This feature lets the GM pick, per property, a value that every scene
 * created from the "Create Scene" button starts with instead.
 *
 * Each property is *opt-in*: only the ones the GM has ticked are touched, and
 * only when the creation data says nothing about that property. That second
 * condition is what keeps Duplicate, compendium import and any other module that
 * creates scenes with full data working as before — all of those pass the
 * property explicitly, so the override never fires for them. Only the bare
 * create dialog (name and folder) leaves the fields open.
 *
 * Everything lives in one world Object setting, {@link SETTINGS.sceneDefaults},
 * shaped like {@link SceneDefaults}; `getSceneDefaults` is the only reader, and
 * it fills in anything a stored value is missing so the shape can grow later
 * without a migration.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/** The overridable properties, each with its own on/off switch. */
export interface SceneDefaults {
  /** `grid.type` and `grid.size` together — one switch, since neither is much use alone. */
  grid: { enabled: boolean; type: number; size: number };
  /** `environment.darknessLevel`, 0 (full daylight) to 1 (pitch black). */
  darkness: { enabled: boolean; level: number };
  /** `padding`, stored as Foundry stores it — a fraction from 0 to 0.5, not a percentage. */
  padding: { enabled: boolean; value: number };
  /** `tokenVision`. */
  tokenVision: { enabled: boolean; value: boolean };
  /** `environment.globalLight.enabled`. */
  globalLight: { enabled: boolean; value: boolean };
}

/**
 * Nothing overridden, and each value set to what Foundry itself would use, so
 * ticking a switch without touching its value changes nothing — the GM edits
 * from Foundry's default rather than from an arbitrary one.
 */
export const DEFAULT_SCENE_DEFAULTS: SceneDefaults = {
  grid: { enabled: false, type: 1, size: 100 },
  darkness: { enabled: false, level: 0 },
  padding: { enabled: false, value: 0.25 },
  tokenVision: { enabled: false, value: true },
  globalLight: { enabled: false, value: false },
};

/**
 * Foundry's `CONST.GRID_TYPES`, listed here so the window can offer them in a
 * fixed, documented order with our own labels. The numeric values are the
 * Scene document's own and have been stable since v10.
 */
export const GRID_TYPES: readonly { value: number; label: string }[] = [
  { value: 0, label: "EE.DefaultOverrides.Scenes.GridType.Gridless" },
  { value: 1, label: "EE.DefaultOverrides.Scenes.GridType.Square" },
  { value: 2, label: "EE.DefaultOverrides.Scenes.GridType.HexOddR" },
  { value: 3, label: "EE.DefaultOverrides.Scenes.GridType.HexEvenR" },
  { value: 4, label: "EE.DefaultOverrides.Scenes.GridType.HexOddQ" },
  { value: 5, label: "EE.DefaultOverrides.Scenes.GridType.HexEvenQ" },
] as const;

/** Foundry's `CONST.GRID_MIN_SIZE` — a smaller grid is rejected by the schema. */
export const GRID_MIN_SIZE = 20;

/**
 * The stored overrides, with anything missing or malformed filled from
 * {@link DEFAULT_SCENE_DEFAULTS}. Deliberately tolerant: the setting is a plain
 * object with no schema of its own, and this is the one place its shape is
 * enforced.
 */
export function getSceneDefaults(): SceneDefaults {
  const stored = game.settings.get(MODULE_ID, SETTINGS.sceneDefaults) as
    | Partial<Record<keyof SceneDefaults, AnyObject>>
    | null
    | undefined;
  const d = DEFAULT_SCENE_DEFAULTS;

  const grid = stored?.grid ?? {};
  const darkness = stored?.darkness ?? {};
  const padding = stored?.padding ?? {};
  const tokenVision = stored?.tokenVision ?? {};
  const globalLight = stored?.globalLight ?? {};

  return {
    grid: {
      enabled: grid["enabled"] === true,
      type: GRID_TYPES.some((t) => t.value === grid["type"]) ? (grid["type"] as number) : d.grid.type,
      size: finiteOr(grid["size"], d.grid.size, GRID_MIN_SIZE),
    },
    darkness: {
      enabled: darkness["enabled"] === true,
      level: finiteOr(darkness["level"], d.darkness.level, 0, 1),
    },
    padding: {
      enabled: padding["enabled"] === true,
      value: finiteOr(padding["value"], d.padding.value, 0, 0.5),
    },
    tokenVision: {
      enabled: tokenVision["enabled"] === true,
      value: typeof tokenVision["value"] === "boolean" ? tokenVision["value"] : d.tokenVision.value,
    },
    globalLight: {
      enabled: globalLight["enabled"] === true,
      value: typeof globalLight["value"] === "boolean" ? globalLight["value"] : d.globalLight.value,
    },
  };
}

/** A finite number held to `[min, max]`, or `fallback` when the value isn't one. */
function finiteOr(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * The update to apply to a scene being created with `data`, or `null` when
 * there is nothing to change. Exported separately from the hook so the rule —
 * enabled *and* not already specified — is in one testable place.
 */
export function sceneDefaultOverrides(data: AnyObject): AnyObject | null {
  const defaults = getSceneDefaults();
  const update: AnyObject = {};
  const has = (path: string): boolean => foundry.utils.hasProperty(data, path) === true;

  // Both grid fields are held back if either was given: a creator who set the
  // type has thought about the grid, and a size meant for a square grid is not
  // necessarily right for the hex grid they asked for.
  if (defaults.grid.enabled && !has("grid.type") && !has("grid.size")) {
    update["grid"] = { type: defaults.grid.type, size: defaults.grid.size };
  }
  if (defaults.darkness.enabled && !has("environment.darknessLevel")) {
    foundry.utils.setProperty(update, "environment.darknessLevel", defaults.darkness.level);
  }
  if (defaults.padding.enabled && !has("padding")) {
    update["padding"] = defaults.padding.value;
  }
  if (defaults.tokenVision.enabled && !has("tokenVision")) {
    update["tokenVision"] = defaults.tokenVision.value;
  }
  if (defaults.globalLight.enabled && !has("environment.globalLight.enabled")) {
    foundry.utils.setProperty(update, "environment.globalLight.enabled", defaults.globalLight.value);
  }

  return Object.keys(update).length ? update : null;
}

/** Install the hook. Called once during `init`. */
export function registerSceneDefaults(): void {
  // `preCreateScene` runs only on the creating client, so this fires exactly
  // once per scene. `data` is the creation data as handed to `Scene.create`,
  // before Foundry fills in schema defaults — which is what lets "the creator
  // didn't say" be told apart from "the creator asked for Foundry's default".
  Hooks.on("preCreateScene", (scene: AnyObject, data: AnyObject) => {
    const update = sceneDefaultOverrides(data ?? {});
    if (!update) return;
    scene.updateSource(update);
    console.debug(`${LOG_PREFIX} Applied scene default overrides to "${scene.name}".`, update);
  });
}
