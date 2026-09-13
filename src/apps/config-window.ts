/**
 * Shared base for the module's settings windows.
 *
 * Foundry v14 gives every module exactly one flat category in Configure Settings —
 * `SettingsConfig` extends `CategoryBrowser`, and its `_categorizeEntry` maps a
 * namespace to a single category with no notion of a sub-tab. So each group of
 * settings gets its own `ApplicationV2`, opened from a button in that category,
 * and this class holds what those windows have in common: the delegated click
 * dispatch, and saving a set of checkboxes back to `game.settings`.
 *
 * A subclass supplies `PARTS`, a window title, an id, and {@link settingKeys}.
 */
import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Read a whole number out of a number input, held to the field's own `min`/`max`.
 * A browser only enforces those when the form is *submitted*, and nothing here is
 * (see `_onRender`), so an empty or out-of-range box would otherwise be saved as
 * typed. An unusable value falls back to `fallback` — the setting's current
 * value — so clearing the box and pressing Save changes nothing rather than
 * storing `NaN`.
 */
function readNumber(input: HTMLInputElement, fallback: number): number {
  const raw = Math.round(input.valueAsNumber);
  let value = Number.isFinite(raw) ? raw : fallback;

  const min = Number(input.min);
  if (input.min !== "" && Number.isFinite(min)) value = Math.max(min, value);
  const max = Number(input.max);
  if (input.max !== "" && Number.isFinite(max)) value = Math.min(max, value);

  return value;
}

export class ConfigWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  // Typed loosely on purpose: Foundry merges DEFAULT_OPTIONS along the inheritance
  // chain (`ApplicationV2#_initializeApplicationOptions`), so a subclass supplies
  // only the keys it changes — which an inferred literal type would reject as an
  // incomplete override.
  static DEFAULT_OPTIONS: AnyObject = {
    // A form element so the controls pick up Foundry's settings styling. Nothing
    // is submitted through the form plumbing — see `_onRender`.
    tag: "form",
    // `standard-form` is what supplies `.tab.active { display: flex }` for the
    // tabbed subclasses; the base `.tab[data-tab]:not(.active) { display: none }`
    // rule does the hiding. That pair is why no window here needs tab CSS.
    classes: [MODULE_ID, "ee-config", "standard-form"],
    window: {
      resizable: true,
    },
    position: {
      width: 560,
      height: "auto",
    },
  };

  /**
   * Keys of the boolean settings this window edits. The `name` attribute of each
   * checkbox in the templates is its key, which is how {@link onSave} reads them
   * back without a per-field list.
   */
  protected settingKeys: readonly string[] = [];

  /**
   * Keys of the *numeric* settings this window edits, read back the same way
   * from `<input type="number" name="…">`. Separate from {@link settingKeys}
   * because the two are saved differently — see {@link onSave}.
   */
  protected numberSettingKeys: readonly string[] = [];

  /** Read a boolean setting without caring whether it has ever been written. */
  protected static flag(key: string): boolean {
    return game.settings.get(MODULE_ID, key) === true;
  }

  /** Read a numeric setting, falling back if it has somehow been left unset. */
  protected static count(key: string, fallback: number): number {
    const value = Number(game.settings.get(MODULE_ID, key));
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * Hand each tab part its own tab descriptor, which is what supplies the
   * `data-group`/`data-tab`/`active` attributes `changeTab` looks for. A no-op in
   * an untabbed window, where the context carries no `tabs`.
   *
   * Returns a copy rather than mutating the shared context, since every part is
   * prepared from the same object.
   */
  async _preparePartContext(
    partId: string,
    context: AnyObject,
    options: AnyObject,
  ): Promise<AnyObject> {
    const prepared = (await super._preparePartContext?.(partId, { ...context }, options)) ?? {
      ...context,
    };
    const tab = (prepared["tabs"] as AnyObject | undefined)?.[partId];
    return tab ? { ...prepared, tab } : prepared;
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    // Runs on every render: the parts are re-rendered from scratch, so derived
    // control state has to be reapplied even though the listeners below don't.
    this.refreshControls(root);

    // One delegated listener bound once, per the pattern in HotbarPagesConfig —
    // ApplicationV2's built-in `actions` dispatch is unreliable in this Foundry
    // build (see CLAUDE.md), which is also why tab clicks are driven by hand
    // below even though core's nav template emits `data-action="tab"`.
    if (root.dataset["eeBound"]) return;
    root.dataset["eeBound"] = "1";

    root.addEventListener("submit", (event: Event) => event.preventDefault());
    root.addEventListener("change", () => this.refreshControls(root));

    root.addEventListener("click", (event: Event) => {
      const target = event.target as HTMLElement | null;

      const tabLink = target?.closest?.("[data-action='tab']") as HTMLElement | null;
      if (tabLink && root.contains(tabLink)) {
        const { tab, group } = tabLink.dataset;
        if (tab && group) this.changeTab(tab, group);
        return;
      }

      const el = target?.closest?.("[data-ee]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      const action = el.dataset["ee"];
      if (action === "save") void this.onSave();
      else if (action === "cancel") void this.close();
      else if (action) this.onAction(action, el);
    });
  }

  /**
   * Re-derive control state that depends on other controls. Called after every
   * render and on every input change. Does nothing unless a subclass needs it.
   */
  protected refreshControls(_root: HTMLElement): void {}

  /**
   * Handle a `data-ee` click this base class doesn't already own (i.e. anything
   * besides `save`/`cancel`/`tab`). No-op unless a subclass needs one — see
   * `SessionLogConfig`'s `export` button.
   */
  protected onAction(_action: string, _element: HTMLElement): void {}

  /**
   * Persist anything that isn't a lone checkbox or number — a window whose
   * controls assemble one Object setting builds and writes it here (see
   * `DefaultOverridesConfig`). Runs after {@link settingKeys} and
   * {@link numberSettingKeys} on every Save; a no-op unless a subclass needs it.
   */
  protected async saveComposite(_root: HTMLElement): Promise<void> {}

  /**
   * Persist {@link settingKeys} and {@link numberSettingKeys}, then whatever
   * {@link saveComposite} owns. In a tabbed window inactive tabs are hidden with
   * CSS but still in the DOM, so one Save covers all of them.
   *
   * Unchanged settings are skipped, because writing one fires its `onChange` —
   * there is no reason to refresh every token on the canvas just because someone
   * opened this window and pressed Save.
   */
  private async onSave(): Promise<void> {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    for (const key of this.settingKeys) {
      const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
      if (!input) continue;
      if (input.checked === ConfigWindow.flag(key)) continue;
      await game.settings.set(MODULE_ID, key, input.checked);
    }

    for (const key of this.numberSettingKeys) {
      const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
      if (!input) continue;
      const current = ConfigWindow.count(key, 0);
      const value = readNumber(input, current);
      if (value === current) continue;
      await game.settings.set(MODULE_ID, key, value);
    }

    await this.saveComposite(root);

    ui.notifications?.info(game.i18n.localize("EE.Config.Saved"));
    await this.close();
  }
}
