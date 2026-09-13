/**
 * The **Default Overrides** window — what a freshly created document starts as,
 * where Foundry's own default isn't the one this table wants.
 *
 * Tabbed, one tab per document kind, though only "Scenes" exists so far; the
 * tab strip is there so the next kind (tokens, say) is a tab rather than a
 * second window. Every row is an *Override* switch plus the value it imposes,
 * with the value greyed out until the switch is on, so an unticked row reads as
 * "leave this to Foundry" rather than as a value that merely happens to match.
 *
 * All of one tab's rows save into a single Object setting rather than a key per
 * control — a property and its switch are one fact, and `scenes/scene-defaults.ts`
 * reads them together — which is why this window overrides `saveComposite`
 * instead of listing anything in `settingKeys`.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import {
  GRID_MIN_SIZE,
  GRID_TYPES,
  getSceneDefaults,
  type SceneDefaults,
} from "../scenes/scene-defaults.js";
import { ConfigWindow } from "./config-window.js";

/** The tab group id. One group, so ApplicationV2 injects `tabs` into the context. */
const TAB_GROUP = "overrides";

/**
 * A number out of an input, held to the field's own `min`/`max`, falling back
 * when the box is empty or unparsable. Like `readNumber` in the base class but
 * without rounding — padding and darkness are fractions.
 */
function readDecimal(input: HTMLInputElement | null, fallback: number): number {
  if (!input) return fallback;
  let value = input.valueAsNumber;
  if (!Number.isFinite(value)) return fallback;
  const min = Number(input.min);
  if (input.min !== "" && Number.isFinite(min)) value = Math.max(min, value);
  const max = Number(input.max);
  if (input.max !== "" && Number.isFinite(max)) value = Math.min(max, value);
  return value;
}

export class DefaultOverridesConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-default-overrides`,
    window: {
      title: "EE.DefaultOverrides.Title",
      icon: "fa-solid fa-file-pen",
    },
  };

  static TABS: AnyObject = {
    [TAB_GROUP]: {
      tabs: [{ id: "scenes", icon: "fa-solid fa-map", label: "EE.DefaultOverrides.Tabs.Scenes" }],
      initial: "scenes",
    },
  };

  // Declaration order is DOM order: the nav, the tab, then the footer outside
  // the tabs so one Save/Cancel bar covers whatever tabs are added later.
  static PARTS = {
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    scenes: { template: TEMPLATES.defaultOverridesScenes },
    footer: { template: TEMPLATES.configFooter },
  };

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    const scenes = getSceneDefaults();
    return {
      ...context,
      scenes: {
        ...scenes,
        // Shown as a whole percentage, stored as the fraction Foundry keeps.
        paddingPercent: Math.round(scenes.padding.value * 100),
        gridTypes: GRID_TYPES.map((type) => ({
          ...type,
          selected: type.value === scenes.grid.type,
        })),
        gridMinSize: GRID_MIN_SIZE,
      },
    };
  }

  /**
   * Grey out each value control while its Override switch is off. The pairing
   * is by `data-ee-override` on the switch and `data-ee-overridden` on the
   * controls it governs, so a row with two controls (grid type and size) needs
   * no special case.
   */
  protected override refreshControls(root: HTMLElement): void {
    for (const toggle of root.querySelectorAll<HTMLInputElement>("input[data-ee-override]")) {
      const key = toggle.dataset["eeOverride"];
      if (!key) continue;
      for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        `[data-ee-overridden='${key}']`,
      )) {
        control.disabled = !toggle.checked;
      }
    }
  }

  /**
   * Assemble the Scenes tab back into one {@link SceneDefaults} and store it —
   * only if it differs from what is stored, for the same reason the base class
   * skips unchanged keys.
   *
   * A row's value is read back whether or not its switch is on, so turning a
   * row off and on again restores what the GM typed rather than Foundry's value.
   */
  protected override async saveComposite(root: HTMLElement): Promise<void> {
    const current = getSceneDefaults();

    const checked = (name: string): boolean =>
      root.querySelector<HTMLInputElement>(`input[name='${name}']`)?.checked === true;
    const number = (name: string): HTMLInputElement | null =>
      root.querySelector<HTMLInputElement>(`input[name='${name}']`);

    const gridTypeRaw = Number(
      root.querySelector<HTMLSelectElement>("select[name='grid.type']")?.value,
    );
    const gridType = GRID_TYPES.some((t) => t.value === gridTypeRaw)
      ? gridTypeRaw
      : current.grid.type;

    const next: SceneDefaults = {
      grid: {
        enabled: checked("grid.enabled"),
        type: gridType,
        size: Math.round(readDecimal(number("grid.size"), current.grid.size)),
      },
      darkness: {
        enabled: checked("darkness.enabled"),
        level: readDecimal(number("darkness.level"), current.darkness.level),
      },
      padding: {
        enabled: checked("padding.enabled"),
        // The field is a percentage; round through an integer so float noise
        // from the division never reaches the setting.
        value:
          Math.round(readDecimal(number("padding.percent"), current.padding.value * 100)) / 100,
      },
      tokenVision: {
        enabled: checked("tokenVision.enabled"),
        value: checked("tokenVision.value"),
      },
      globalLight: {
        enabled: checked("globalLight.enabled"),
        value: checked("globalLight.value"),
      },
    };

    if (foundry.utils.objectsEqual(next, current)) return;
    await game.settings.set(MODULE_ID, SETTINGS.sceneDefaults, next);
  }
}
