/**
 * The **Daggerheart Automation** window — rules that are already written down
 * somewhere (in the system, on a card, or in a third-party module) but that
 * nothing applies for you.
 *
 * Five tabs: "General" for rules that belong to no one card, then one per kind of
 * character content — Ancestries, Communities, Classes, Domains. Each of those
 * four is a dropdown of every piece of content in that category plus a panel per
 * entry, so a switch is found where the rule is printed rather than in a flat
 * list. The content itself, and which switch sits under which entry, lives in
 * `automation-catalog.ts`; this file only renders it.
 *
 * Dropdowns rather than a second row of tabs because there are 18 ancestries
 * before The Void adds any, which no tab strip survives. Entries from The Void
 * are grouped under their own `<optgroup>` and disabled outright when that module
 * isn't active, since selecting one would only show switches that cannot do
 * anything.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { CATALOGS, catalogSettingKeys, type Catalog } from "./automation-catalog.js";
import { ConfigWindow } from "./config-window.js";

/** The Void (Unofficial)'s module id — only used here to gate its entries. */
const VOID_MODULE_ID = "the-void-unofficial";

/** The tab group id. One group, so ApplicationV2 injects `tabs` into the context. */
const TAB_GROUP = "automation";

export class DaggerheartAutomationConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-daggerheart-automation`,
    window: {
      title: "EE.Automation.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
    },
    // Wider than the shared default: five labelled tabs wrap the nav at 560.
    position: { width: 640 },
  };

  static TABS: AnyObject = {
    [TAB_GROUP]: {
      tabs: [
        { id: "general", icon: "fa-solid fa-sliders", label: "EE.Automation.Tabs.General" },
        ...CATALOGS.map((catalog) => ({
          id: catalog.id,
          icon: catalog.icon,
          label: catalog.tabLabel,
        })),
      ],
      initial: "general",
    },
  };

  // Declaration order is DOM order: the nav, then each tab's section, then the
  // footer — which sits outside the tabs, so one Save/Cancel bar covers them all.
  // The four catalog tabs share one template and differ only by the `catalog`
  // their part context carries.
  static PARTS = {
    // Core's own nav markup, so the tabs look like every other Foundry window.
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    general: { template: TEMPLATES.automationGeneral },
    ...Object.fromEntries(
      CATALOGS.map((catalog) => [catalog.id, { template: TEMPLATES.automationCatalog }]),
    ),
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
    SETTINGS.reachMeleeAsVeryClose,
    SETTINGS.noRollDamageApply,
    SETTINGS.hiddenConditionRolls,
    ...catalogSettingKeys(),
  ];

  /**
   * Which entry each catalog tab is showing, by catalog id. Kept on the instance
   * because the panels are all rendered and hidden with `hidden` rather than
   * re-rendered — this is only so a re-render (which rebuilds the DOM from the
   * context) doesn't snap every tab back to its first entry.
   */
  #selection: Record<string, string> = {};

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return {
      ...context,
      voidActive: game.modules.get(VOID_MODULE_ID)?.active === true,
      reach: DaggerheartAutomationConfig.flag(SETTINGS.reachMeleeAsVeryClose),
      noRollDamage: DaggerheartAutomationConfig.flag(SETTINGS.noRollDamageApply),
      hiddenCondition: DaggerheartAutomationConfig.flag(SETTINGS.hiddenConditionRolls),
    };
  }

  /** Hand a catalog tab its own prepared catalog; every other part is untouched. */
  override async _preparePartContext(
    partId: string,
    context: AnyObject,
    options: AnyObject,
  ): Promise<AnyObject> {
    const prepared = await super._preparePartContext(partId, context, options);
    const catalog = CATALOGS.find((entry) => entry.id === partId);
    if (!catalog) return prepared;
    return {
      ...prepared,
      catalog: this.#prepareCatalog(catalog, prepared["voidActive"] === true),
    };
  }

  /**
   * Flatten one catalog for Handlebars: resolve each switch's current value, mark
   * the selected entry, and split the entries into the two `<optgroup>`s. Entries
   * from The Void are disabled — and so are their switches, belt and braces — when
   * that module isn't active.
   */
  #prepareCatalog(catalog: Catalog, voidActive: boolean): AnyObject {
    const selected = this.#selection[catalog.id] ?? catalog.entries[0]?.id ?? "";

    const entries = catalog.entries.map((entry) => {
      const blocked = entry.fromVoid === true && !voidActive;
      return {
        id: entry.id,
        label: entry.label,
        fromVoid: entry.fromVoid === true,
        disabled: blocked,
        selected: entry.id === selected,
        groups: entry.groups?.map((group) => ({
          legend: group.legend,
          settings: group.settings.map((setting) => ({
            ...setting,
            checked: DaggerheartAutomationConfig.flag(setting.key),
            disabled: blocked,
          })),
        })),
      };
    });

    return {
      id: catalog.id,
      selectLabel: catalog.selectLabel,
      entries,
      coreEntries: entries.filter((entry) => !entry.fromVoid),
      voidEntries: entries.filter((entry) => entry.fromVoid),
      voidBlocked: !voidActive,
    };
  }

  /**
   * Show the panel each dropdown is pointing at, and grey out the prototype option
   * whenever the master switch above it is off.
   *
   * The base class calls this after every render *and* on every input change, so
   * the dropdowns need no listener of their own — the panels are simply re-derived
   * from whatever the selects currently say.
   */
  protected override refreshControls(root: HTMLElement): void {
    for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-ee-catalog]")) {
      const group = select.dataset["eeCatalog"];
      if (!group) continue;
      this.#selection[group] = select.value;
      for (const panel of root.querySelectorAll<HTMLElement>(`[data-ee-panel="${group}"]`)) {
        panel.hidden = panel.dataset["entry"] !== select.value;
      }
    }

    const master = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.voidHybridFormPortrait}']`,
    );
    const dependent = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.voidHybridFormPrototype}']`,
    );
    // `master.disabled` carries through the Void-missing case, where neither
    // control should be reachable regardless of what the master is set to.
    if (master && dependent) dependent.disabled = !master.checked || master.disabled;
  }
}
