/**
 * Divider headings between our controls in Foundry's own Configure Settings list.
 *
 * A module gets exactly one flat category there — `SettingsConfig` extends
 * `CategoryBrowser`, whose `_categorizeEntry` maps a namespace to a single
 * category with no notion of a sub-heading (see AGENTS.md). Registering under a
 * second namespace *would* buy a second category, but it would also be a second
 * module id in the sidebar, and every setting under it would be a stranger to
 * `MODULE_ID`. So the grouping is presentational: after core renders its list we
 * head each run of our controls with core's own `h3.divider`.
 *
 * The runs have to be contiguous, which is why `settings.ts` registers menus in
 * this order — the settings list renders menus before its ordinary settings.
 *
 * Nothing here is load-bearing: if a future core release changes the markup this
 * queries, the buttons still all work, they just come back ungrouped.
 */
import { LOG_PREFIX, MENUS, MODULE_ID, SETTINGS } from "./constants.js";

/**
 * The headings, top to bottom, each naming the controls that fall under it. A
 * control missing from every group simply stays unheaded where core put it.
 */
const SETTING_GROUPS: readonly { label: string; keys: readonly string[] }[] = [
  {
    label: "EE.SettingsList.GeneralHeading",
    keys: [MENUS.generalFeaturesMenu, MENUS.hotbarPagesMenu, MENUS.sessionLogMenu],
  },
  {
    label: "EE.SettingsList.DaggerheartHeading",
    keys: [MENUS.daggerheartAutomationMenu, MENUS.daggerheartUtilitiesMenu],
  },
  {
    label: "EE.SettingsList.PlayerDaggerheartHeading",
    keys: [SETTINGS.notGoodEnoughAlwaysReroll],
  },
] as const;

/**
 * The rows for one group, in DOM order. Core renders each as a `.form-group`
 * wrapping either a menu button with `data-key` or a setting input with `name`
 * set to its fully-qualified id. The label is localized and the position isn't
 * ours, so the control is the stable handle for finding its row.
 */
function rowsFor(section: HTMLElement, keys: readonly string[]): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const key of keys) {
    const id = `${MODULE_ID}.${key}`;
    const control = section.querySelector<HTMLElement>(
      `button[data-key='${id}'], input[name='${id}'], select[name='${id}']`,
    );
    const row = control?.closest<HTMLElement>(".form-group");
    if (row) rows.push(row);
  }
  return rows;
}

/** Install the settings-list headings. Called once during `init`. */
export function registerSettingsGroups(): void {
  Hooks.on("renderSettingsConfig", (_app: AnyObject, html: AnyObject) => {
    const root: HTMLElement | null = html instanceof HTMLElement ? html : (html?.[0] ?? null);
    const section = root?.querySelector<HTMLElement>(`section[data-category='${MODULE_ID}']`);
    if (!section) {
      // Every menu is `restricted: true`, so a player has no category at all —
      // expected, and not worth a console line. For anyone who can configure
      // settings, its absence means the markup moved.
      if (game.user?.isGM) {
        console.warn(`${LOG_PREFIX} Settings category not found — buttons are left ungrouped.`);
      }
      return;
    }

    // A re-render rebuilds these rows from scratch, so this only guards against
    // the hook firing twice against the same DOM.
    if (section.querySelector(".ee-settings-group")) return;

    for (const group of SETTING_GROUPS) {
      const rows = rowsFor(section, group.keys);
      if (!rows.length) continue;

      const wrapper = document.createElement("div");
      wrapper.className = "ee-settings-group";

      const heading = document.createElement("h3");
      // Core's own divider style — a centered label with a rule out to each
      // side. Borrowed rather than styled here so the headings track Foundry's
      // theme (including the GM's light/dark choice) for free.
      heading.className = "divider";
      heading.textContent = game.i18n.localize(group.label);

      // Position the wrapper while the first row is still in place, *then* move
      // the rows into it — `append` reparents them, so doing this the other way
      // round would insert the wrapper inside itself.
      rows[0]!.before(wrapper);
      wrapper.append(heading, ...rows);
    }
  });
}
