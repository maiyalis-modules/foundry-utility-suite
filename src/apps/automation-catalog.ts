/**
 * What the **Daggerheart Automation** window's four content tabs list, and which
 * automated rule belongs to which piece of content.
 *
 * Every automated feature in this module is printed on *something* — an ancestry
 * card, a class card, a domain card. Filing the switches under the thing that
 * grants them is how a GM finds one: you look up Fearless under Infernis, not
 * under an alphabetical list of settings. The catalogs below are therefore
 * complete rather than pruned — an ancestry with no automation still gets an
 * entry, so its absence reads as "nothing here yet" instead of "did I miss it?".
 *
 * The lists were taken from the installed compendia (`daggerheart` system and
 * `the-void-unofficial`) rather than transcribed from the books, and cover every
 * `ancestry`, `community`, `class` and `domain` document in them.
 *
 * **Why the labels aren't localized.** These are the names of compendium
 * documents, and neither the system nor The Void translates them — a `lang/`
 * entry for "Clank" would advertise a translation that the content it points at
 * would never have. Everything the *window* says (tab titles, legends, hints,
 * the empty-state note) is localized as usual; only the content names are literal.
 */
import { SETTINGS } from "../constants.js";

/** One checkbox in an entry's panel. */
export interface CatalogSetting {
  /** Key in {@link SETTINGS}, which is also the input `name` `ConfigWindow#onSave` reads back. */
  key: string;
  /** i18n key of the label. */
  name: string;
  /** i18n key of the hint printed under it. */
  hint: string;
}

/** A titled `<fieldset>` inside an entry's panel. */
export interface CatalogGroup {
  /** i18n key of the legend. */
  legend: string;
  settings: readonly CatalogSetting[];
}

/** One ancestry, community, class or domain. */
export interface CatalogEntry {
  /** Slug, used as the `<option>` value and the panel's `data-entry`. */
  id: string;
  /** The content's printed name — deliberately not an i18n key (see the file header). */
  label: string;
  /** Set when the content ships with The Void (Unofficial) rather than the system. */
  fromVoid?: boolean;
  /** Absent means "nothing automated here yet", which the panel says out loud. */
  groups?: readonly CatalogGroup[];
}

/** One tab: a dropdown of entries and a panel per entry. */
export interface Catalog {
  /** Tab id, part id, and the `data-ee-catalog`/`data-ee-panel` value tying the two together. */
  id: string;
  /** i18n key of the tab's label in the nav. */
  tabLabel: string;
  /** Font Awesome 6 *free* class — Foundry ships the free set, so Pro-only icons render blank. */
  icon: string;
  /** i18n key of the label beside the dropdown. */
  selectLabel: string;
  entries: readonly CatalogEntry[];
}

/** Slug for an entry id: lowercased, spaces hyphenated. */
function slug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

/** An entry with nothing automated on it yet — most of them. */
function plain(label: string): CatalogEntry {
  return { id: slug(label), label };
}

/** The same, for content that comes from The Void (Unofficial). */
function fromVoid(label: string): CatalogEntry {
  return { id: slug(label), label, fromVoid: true };
}

const ANCESTRIES: Catalog = {
  id: "ancestries",
  tabLabel: "EE.Automation.Tabs.Ancestries",
  icon: "fa-solid fa-dna",
  selectLabel: "EE.Automation.SelectAncestry",
  entries: [
    plain("Clank"),
    plain("Drakona"),
    plain("Dwarf"),
    plain("Elf"),
    plain("Faerie"),
    plain("Faun"),
    plain("Firbolg"),
    plain("Fungril"),
    plain("Galapa"),
    plain("Giant"),
    plain("Goblin"),
    plain("Halfling"),
    {
      id: "human",
      label: "Human",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.adaptabilityReroll,
              name: "EE.Settings.AdaptabilityReroll.Name",
              hint: "EE.Settings.AdaptabilityReroll.Hint",
            },
          ],
        },
      ],
    },
    {
      id: "infernis",
      label: "Infernis",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.fearlessFearToHope,
              name: "EE.Settings.FearlessFearToHope.Name",
              hint: "EE.Settings.FearlessFearToHope.Hint",
            },
          ],
        },
      ],
    },
    {
      id: "katari",
      label: "Katari",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.felineInstinctsReroll,
              name: "EE.Settings.FelineInstinctsReroll.Name",
              hint: "EE.Settings.FelineInstinctsReroll.Hint",
            },
          ],
        },
      ],
    },
    plain("Orc"),
    plain("Ribbet"),
    plain("Simiah"),
    fromVoid("Aetheris"),
    fromVoid("Earthkin"),
    fromVoid("Emberkin"),
    fromVoid("Gnome"),
    fromVoid("Skykin"),
    fromVoid("Tidekin"),
  ],
};

const COMMUNITIES: Catalog = {
  id: "communities",
  tabLabel: "EE.Automation.Tabs.Communities",
  icon: "fa-solid fa-people-group",
  selectLabel: "EE.Automation.SelectCommunity",
  entries: [
    plain("Highborne"),
    plain("Loreborne"),
    plain("Orderborne"),
    plain("Ridgeborne"),
    plain("Seaborne"),
    plain("Slyborne"),
    plain("Underborne"),
    plain("Wanderborne"),
    plain("Wildborne"),
    fromVoid("Duneborne"),
    fromVoid("Freeborne"),
    fromVoid("Frostborne"),
    {
      id: "hearthborne",
      label: "Hearthborne",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.closeKnitShareHope,
              name: "EE.Settings.CloseKnitShareHope.Name",
              hint: "EE.Settings.CloseKnitShareHope.Hint",
            },
          ],
        },
      ],
    },
    fromVoid("Reborne"),
    {
      id: "warborne",
      label: "Warborne",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.braveFace,
              name: "EE.Settings.BraveFace.Name",
              hint: "EE.Settings.BraveFace.Hint",
            },
          ],
        },
      ],
    },
  ],
};

const CLASSES: Catalog = {
  id: "classes",
  tabLabel: "EE.Automation.Tabs.Classes",
  icon: "fa-solid fa-shield-halved",
  selectLabel: "EE.Automation.SelectClass",
  entries: [
    plain("Bard"),
    plain("Druid"),
    plain("Guardian"),
    {
      id: "ranger",
      label: "Ranger",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.holdThemOffExtraTargets,
              name: "EE.Settings.HoldThemOffExtraTargets.Name",
              hint: "EE.Settings.HoldThemOffExtraTargets.Hint",
            },
            {
              key: SETTINGS.rangersFocusTracking,
              name: "EE.Settings.RangersFocusTracking.Name",
              hint: "EE.Settings.RangersFocusTracking.Hint",
            },
          ],
        },
        {
          // Companion is the Beastbound subclass's foundation feature. Same
          // filing rule as Hybrid Form under Blood Hunter: a subclass has
          // nowhere of its own here, and its parent class is unambiguous.
          legend: "EE.Automation.BeastboundLegend",
          settings: [
            {
              key: SETTINGS.companionCommands,
              name: "EE.Settings.CompanionCommands.Name",
              hint: "EE.Settings.CompanionCommands.Hint",
            },
          ],
        },
      ],
    },
    plain("Rogue"),
    plain("Seraph"),
    plain("Sorcerer"),
    {
      id: "warrior",
      label: "Warrior",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.attackOfOpportunity,
              name: "EE.Settings.AttackOfOpportunity.Name",
              hint: "EE.Settings.AttackOfOpportunity.Hint",
            },
          ],
        },
        {
          // Slayer is the Call of the Slayer subclass's, and a subclass has
          // nowhere of its own here — same treatment as Hybrid Form under Blood
          // Hunter and Beastbound under Ranger.
          legend: "EE.Automation.CallOfTheSlayerLegend",
          settings: [
            {
              key: SETTINGS.slayerDice,
              name: "EE.Settings.SlayerDice.Name",
              hint: "EE.Settings.SlayerDice.Hint",
            },
          ],
        },
      ],
    },
    {
      id: "wizard",
      label: "Wizard",
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.notThisTimeReroll,
              name: "EE.Settings.NotThisTimeReroll.Name",
              hint: "EE.Settings.NotThisTimeReroll.Hint",
            },
            {
              key: SETTINGS.strangePatternsNumber,
              name: "EE.Settings.StrangePatternsNumber.Name",
              hint: "EE.Settings.StrangePatternsNumber.Hint",
            },
          ],
        },
      ],
    },
    fromVoid("Assassin"),
    {
      id: "blood-hunter",
      label: "Blood Hunter",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.bloodMaledictReroll,
              name: "EE.Settings.BloodMaledictReroll.Name",
              hint: "EE.Settings.BloodMaledictReroll.Hint",
            },
            {
              key: SETTINGS.crimsonRiteEnchant,
              name: "EE.Settings.CrimsonRiteEnchant.Name",
              hint: "EE.Settings.CrimsonRiteEnchant.Hint",
            },
          ],
        },
        {
          // Hybrid Form is the Order of the Lycan subclass's, but a subclass has
          // nowhere of its own to live here and its parent class is unambiguous.
          legend: "EE.Automation.HybridFormLegend",
          settings: [
            {
              key: SETTINGS.voidHybridFormPortrait,
              name: "EE.Settings.VoidHybridFormPortrait.Name",
              hint: "EE.Settings.VoidHybridFormPortrait.Hint",
            },
            {
              key: SETTINGS.voidHybridFormPrototype,
              name: "EE.Settings.VoidHybridFormPrototype.Name",
              hint: "EE.Settings.VoidHybridFormPrototype.Hint",
            },
            {
              key: SETTINGS.voidHybridFormStressRevert,
              name: "EE.Settings.VoidHybridFormStressRevert.Name",
              hint: "EE.Settings.VoidHybridFormStressRevert.Hint",
            },
          ],
        },
      ],
    },
    fromVoid("Brawler"),
    fromVoid("Summoner"),
    fromVoid("Warlock"),
    {
      id: "witch",
      label: "Witch",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.FeaturesLegend",
          settings: [
            {
              key: SETTINGS.communeOracle,
              name: "EE.Settings.CommuneOracle.Name",
              hint: "EE.Settings.CommuneOracle.Hint",
            },
            {
              key: SETTINGS.witchsCharm,
              name: "EE.Settings.WitchsCharm.Name",
              hint: "EE.Settings.WitchsCharm.Hint",
            },
            {
              key: SETTINGS.hexCondition,
              name: "EE.Settings.Hex.Name",
              hint: "EE.Settings.Hex.Hint",
            },
          ],
        },
        {
          // Herbal Remedies is the Hedge Witch subclass's foundation feature, and
          // a subclass has nowhere of its own here — the same filing as Hybrid
          // Form under Blood Hunter, Beastbound under Ranger and Call of the
          // Slayer under Warrior.
          legend: "EE.Automation.HedgeWitchLegend",
          settings: [
            {
              key: SETTINGS.herbalRemedies,
              name: "EE.Settings.HerbalRemedies.Name",
              hint: "EE.Settings.HerbalRemedies.Hint",
            },
            {
              key: SETTINGS.tetheredTalisman,
              name: "EE.Settings.TetheredTalisman.Name",
              hint: "EE.Settings.TetheredTalisman.Hint",
            },
          ],
        },
      ],
    },
  ],
};

const DOMAINS: Catalog = {
  id: "domains",
  tabLabel: "EE.Automation.Tabs.Domains",
  icon: "fa-solid fa-book-open",
  selectLabel: "EE.Automation.SelectDomain",
  entries: [
    plain("Arcana"),
    {
      id: "blade",
      label: "Blade",
      groups: [
        {
          legend: "EE.Automation.DomainCardsLegend",
          settings: [
            {
              key: SETTINGS.notGoodEnoughReroll,
              name: "EE.Settings.NotGoodEnoughReroll.Name",
              hint: "EE.Settings.NotGoodEnoughReroll.Hint",
            },
          ],
        },
      ],
    },
    {
      id: "bone",
      label: "Bone",
      groups: [
        {
          legend: "EE.Automation.DomainCardsLegend",
          settings: [
            {
              key: SETTINGS.iSeeItComingEvasion,
              name: "EE.Settings.ISeeItComingEvasion.Name",
              hint: "EE.Settings.ISeeItComingEvasion.Hint",
            },
          ],
        },
      ],
    },
    plain("Codex"),
    plain("Grace"),
    plain("Midnight"),
    {
      id: "sage",
      label: "Sage",
      groups: [
        {
          legend: "EE.Automation.DomainCardsLegend",
          settings: [
            {
              key: SETTINGS.giftedTrackerEvasion,
              name: "EE.Settings.GiftedTrackerEvasion.Name",
              hint: "EE.Settings.GiftedTrackerEvasion.Hint",
            },
            {
              key: SETTINGS.viciousEntangleRestrain,
              name: "EE.Settings.ViciousEntangleRestrain.Name",
              hint: "EE.Settings.ViciousEntangleRestrain.Hint",
            },
          ],
        },
      ],
    },
    plain("Splendor"),
    plain("Valor"),
    {
      id: "blood",
      label: "Blood",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.DomainCardsLegend",
          settings: [
            {
              key: SETTINGS.bloodSpikeSpendHope,
              name: "EE.Settings.BloodSpikeSpendHope.Name",
              hint: "EE.Settings.BloodSpikeSpendHope.Hint",
            },
          ],
        },
      ],
    },
    {
      id: "dread",
      label: "Dread",
      fromVoid: true,
      groups: [
        {
          legend: "EE.Automation.DomainCardsLegend",
          settings: [
            {
              key: SETTINGS.blightingStrikeDamage,
              name: "EE.Settings.BlightingStrikeDamage.Name",
              hint: "EE.Settings.BlightingStrikeDamage.Hint",
            },
          ],
        },
      ],
    },
  ],
};

/** Tab order in the window, after "General". */
export const CATALOGS: readonly Catalog[] = [ANCESTRIES, COMMUNITIES, CLASSES, DOMAINS];

/**
 * Every setting key filed under a catalog entry, for the window's `settingKeys`.
 * Derived rather than listed a second time — a switch that is in the catalogs but
 * not in `settingKeys` would render and then silently refuse to save.
 */
export function catalogSettingKeys(): string[] {
  return CATALOGS.flatMap((catalog) => catalog.entries)
    .flatMap((entry) => entry.groups ?? [])
    .flatMap((group) => group.settings)
    .map((setting) => setting.key);
}
