/**
 * The **Daggerheart Utilities** window — table rules this module enforces on its
 * own, as opposed to `DaggerheartAutomationConfig`, which only hooks up
 * third-party Daggerheart modules.
 *
 * Untabbed today: one section per rule, starting with Deck Limit. A second rule
 * is a new `<fieldset>` in the template plus its keys here, so this stays a flat
 * window until it's long enough to want tabs.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import {
  COPY_SETTING_KEYS,
  DECK_CARD_TYPES,
  DEFAULT_DECK_LIMIT,
} from "../daggerheart/deck-limit.js";
import { ConfigWindow } from "./config-window.js";

export class DaggerheartUtilitiesConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-daggerheart-utilities`,
    window: {
      title: "EE.Utilities.Title",
      // fa-layer-group, not fa-cards: the latter is Font Awesome Pro-only and
      // renders as an empty box in the free set Foundry ships.
      icon: "fa-solid fa-layer-group",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.daggerheartUtilities },
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
    SETTINGS.relayActionEffects,
    SETTINGS.deckLimitEnabled,
    SETTINGS.deckLimitPlayersOnly,
  ] as const;

  protected override numberSettingKeys = [SETTINGS.deckLimitCount, ...COPY_SETTING_KEYS] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return {
      ...context,
      relayActionEffects: DaggerheartUtilitiesConfig.flag(SETTINGS.relayActionEffects),
      deckLimitEnabled: DaggerheartUtilitiesConfig.flag(SETTINGS.deckLimitEnabled),
      deckLimitCount: DaggerheartUtilitiesConfig.count(SETTINGS.deckLimitCount, DEFAULT_DECK_LIMIT),
      deckLimitPlayersOnly: DaggerheartUtilitiesConfig.flag(SETTINGS.deckLimitPlayersOnly),
      // One row per card type rather than five hand-written fields, so adding a
      // card type is a DECK_CARD_TYPES entry and a label string.
      deckCopies: DECK_CARD_TYPES.map((cardType) => ({
        key: cardType.settingKey,
        label: cardType.label,
        value: DaggerheartUtilitiesConfig.count(cardType.settingKey, cardType.copies),
      })),
    };
  }

  /**
   * Grey out everything the switch governs — the deck count and every
   * copies-per-deck field, which are just as meaningless while it's off.
   */
  protected override refreshControls(root: HTMLElement): void {
    const master = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.deckLimitEnabled}']`,
    );
    if (!master) return;
    // Everything in the section except the master switch itself.
    for (const key of [...this.numberSettingKeys, SETTINGS.deckLimitPlayersOnly]) {
      const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
      if (input) input.disabled = !master.checked;
    }
  }
}
