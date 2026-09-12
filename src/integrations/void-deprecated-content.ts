/**
 * Hiding the content **The Void (Unofficial)** now duplicates from the Daggerheart
 * SRD.
 *
 * The Hope and Fear SRD absorbed a large slice of what Void used to be the only
 * source for — the Witch, Warlock, Assassin and Brawler, the whole Dread domain,
 * six ancestries, six communities, four environments and fourteen adversaries all
 * ship with the system now. Void still carries them, so every picker in the game
 * shows each of those twice, and the two copies are *not* the same text: Void's
 * are the pre-release wording and the SRD's are final. Blighting Strike is the
 * clearest case — Void deals a flat `d6+1` with a damage-reduction rider, the SRD
 * splits it `d6+1` on Hope / `d10+1` on Fear. Picking the wrong one is silent.
 *
 * So this hides Void's half of every duplicate until Void itself drops them.
 * World setting `hideVoidDeprecatedContent`, off by default.
 *
 * **Nothing here deletes, edits, or unlinks anything.** Both surfaces below are
 * display filters over a list that was about to be drawn; `pack.index`,
 * `pack.getDocuments()`, `fromUuid` and the system's own `fetchSubclasses` are
 * untouched. A character already holding Void's Assassin keeps it, levels up
 * through Void's subclasses, and prints exactly what it printed before — the card
 * simply stops being offered to anyone starting fresh. Turning the setting back
 * off restores every row.
 *
 * ## What counts as duplicated
 *
 * Derived at runtime, never a hardcoded list: a Void entry is deprecated when a
 * document of the **same type and the same name** exists in a pack belonging to
 * the *system*. Comparing against the system's packs specifically — rather than
 * "any non-Void pack" — is what keeps a world compendium full of copied cards
 * from hiding the originals.
 *
 * That makes the feature self-maintaining in both directions. When Void ships the
 * update that removes its copies, nothing matches and nothing is hidden, with no
 * code change here. When a later SRD absorbs more of Void (the Blood domain, say),
 * those cards start being hidden the day the system updates.
 *
 * It reads `pack.index` only — `_id`/`name`/`type` are core
 * `compendiumIndexFields` for both Item and Actor packs and are populated
 * synchronously in `CompendiumCollection`'s constructor from world data — so the
 * whole comparison costs no document loads and no `await`.
 *
 * ## Why `feature` is not in {@link HIDEABLE_TYPES}
 *
 * Deliberate, and the one place the name match is not safe. 143 of Void's
 * top-level feature items share a name with an SRD feature, and one of them —
 * **Regeneration**, on Order of the Lycan — belongs to a Void-*only* subclass we
 * are keeping, so a plain name match would hide a feature of a card that is still
 * on offer. Telling the two apart means resolving every parent's
 * `system.features[].item` UUIDs, which is not in the index and would cost a
 * `getDocuments()` over every Void pack at startup. Features are also not *picked*
 * — they arrive attached to the ancestry or class that prints them — so hiding
 * them buys almost nothing. The cost is that Void's `void-adv-features` pack still
 * lists its ~55 drag-onto-an-adversary features, some of which duplicate the
 * system's. Left visible on purpose.
 *
 * ## The two surfaces
 *
 * 1. **The system's card pickers.** Daggerheart keeps one shared `ItemBrowser`
 *    (`ui.compendiumBrowser`) and re-opens it with presets for character creation,
 *    level-up and the plain browser alike, so one filter covers all of them — the
 *    same single seam `deck-limit-browser.ts` relies on. Its `loadItems()` already
 *    filters every result through `CompendiumBrowserSettings#isEntryExcluded`
 *    (the model behind the system's own *Compendium Browser Settings* dialog), so
 *    we wrap that one method rather than touching the browser. The system's dialog
 *    is no use on its own here: it excludes a *whole pack* per document type, and
 *    every Void pack that matters mixes duplicated content with content found
 *    nowhere else — its classes pack holds Assassin *and* Blood Hunter.
 * 2. **The compendium sidebar.** Core builds each pack's directory listing from
 *    `CompendiumCollection#_getVisibleTreeContents()`, a documented seam whose
 *    whole job is answering "what should be drawn". Filtering there beats hiding
 *    rows in the DOM: the entry is gone before the tree is built, so core's search
 *    can't turn it up again and folder counts stay honest.
 *
 * Verified against Daggerheart 2.9.3 and The Void 1.3.3.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { VOID, voidActive } from "./void-shared.js";

/**
 * Document types a duplicate is hidden for. Everything a player or GM *picks*
 * from a compendium, and nothing else — see the header for why `feature` is
 * absent, which is the only deliberate omission rather than an oversight.
 */
const HIDEABLE_TYPES: ReadonlySet<string> = new Set([
  // Character content, in the order the pickers offer it.
  "ancestry",
  "community",
  "class",
  "subclass",
  "domainCard",
  // Equipment.
  "weapon",
  "armor",
  "consumable",
  "loot",
  // GM content.
  "adversary",
  "environment",
  "beastform",
  "transformation",
]);

/**
 * `type|name`, with the name flattened enough to survive the punctuation drift
 * between a pre-release card and its printed version. Curly apostrophes go
 * entirely (Void writes `Executioner’s Guild`, the system `Executioner's Guild`)
 * and every other run of non-alphanumerics collapses to one space, which is what
 * lets `Convergence, The City Of Portals` match across a comma.
 */
function contentKey(type: unknown, name: unknown): string {
  const flattened = String(name ?? "")
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${String(type ?? "")}|${flattened}`;
}

/** Is `pack` one of The Void's? */
function isVoidPack(pack: CompendiumPack | null | undefined): boolean {
  const metadata = pack?.metadata;
  return metadata?.["packageType"] === "module" && metadata?.["packageName"] === VOID.moduleId;
}

/** Is `pack` one of the *system's* — i.e. the SRD content we defer to? */
function isSystemPack(pack: CompendiumPack | null | undefined): boolean {
  return pack?.metadata?.["packageType"] === "system";
}

/**
 * Every `type|name` the system ships, built from pack indexes alone.
 *
 * Cached because it is asked once per Void entry per tree build and the answer
 * only changes when packs do. {@link refreshVoidDeprecatedContent} clears it.
 */
let srdKeyCache: ReadonlySet<string> | null = null;

function srdContentKeys(): ReadonlySet<string> {
  if (srdKeyCache) return srdKeyCache;

  const keys = new Set<string>();
  for (const pack of game.packs) {
    if (!isSystemPack(pack)) continue;
    for (const entry of pack.index) {
      if (!HIDEABLE_TYPES.has(String(entry?.["type"]))) continue;
      keys.add(contentKey(entry["type"], entry["name"]));
    }
  }

  srdKeyCache = keys;
  return keys;
}

/**
 * The dotted path holding a domain card's domain (`"dread"`, `"blood"`, …).
 * **Not** a core `compendiumIndexField`, which is what {@link ensureDomainIndex}
 * exists to deal with.
 */
const DOMAIN_FIELD = "system.domain";

/** Does this pack hold any domain cards? Answered from the index it already has. */
function hasDomainCards(pack: CompendiumPack): boolean {
  for (const entry of pack.index) {
    if (entry?.["type"] === "domainCard") return true;
  }
  return false;
}

/**
 * Pull `system.domain` into the index of every pack holding domain cards.
 *
 * The startup index carries only core `compendiumIndexFields` (`_id`, `name`,
 * `img`, `type`, `sort`, `folder`) — the server builds it and knows nothing of
 * client `CONFIG`, which is why the system itself has to `await
 * pack.getIndex({fields: […]})` for `system.linkedClass` in `fetchSubclasses`
 * rather than reading `pack.index`. Core merges the extra fields into the
 * existing index entries and remembers it has done so, so this is one round trip
 * per pack for the life of the session and every later read is synchronous.
 *
 * Scoped to packs that actually hold domain cards — five in practice — rather
 * than re-indexing everything.
 */
let domainIndexLoaded = false;

async function ensureDomainIndex(): Promise<void> {
  if (domainIndexLoaded) return;
  domainIndexLoaded = true;

  const packs = [...game.packs].filter(
    (pack) => (isVoidPack(pack) || isSystemPack(pack)) && hasDomainCards(pack),
  );
  await Promise.all(
    packs.map((pack) =>
      pack.getIndex({ fields: [DOMAIN_FIELD] }).catch((error: unknown) => {
        console.warn(`${LOG_PREFIX} Could not index ${pack.collection} domains:`, error);
      }),
    ),
  );
}

/**
 * Every domain the *system* publishes cards for — `arcana`, `blade`, `bone`,
 * `codex`, `dread`, `grace`, `midnight`, `sage`, `splendor`, `valor` as of 2.9.3.
 *
 * Read off the packs rather than `CONFIG.DH`, deliberately: Void registers its
 * own `blood` domain with the system, so the config list is the union of both and
 * would mark every Void card as duplicated.
 *
 * Empty until {@link ensureDomainIndex} has run, which is safe — an empty set
 * simply means no card is hidden *by domain* yet, and the name match below still
 * applies.
 */
let srdDomainCache: ReadonlySet<string> | null = null;

function srdDomains(): ReadonlySet<string> {
  if (srdDomainCache) return srdDomainCache;

  const domains = new Set<string>();
  for (const pack of game.packs) {
    if (!isSystemPack(pack)) continue;
    for (const entry of pack.index) {
      if (entry?.["type"] !== "domainCard") continue;
      const domain = foundry.utils["getProperty"]?.(entry, DOMAIN_FIELD);
      if (domain) domains.add(String(domain));
    }
  }

  srdDomainCache = domains;
  return domains;
}

/**
 * Is the feature switched on? Guarded because both call sites can run before
 * `registerSettings()` on a client where load order surprises us, and
 * `game.settings.get` throws on an unregistered key rather than returning
 * undefined.
 */
function hidingActive(): boolean {
  if (!voidActive()) return false;
  try {
    return game.settings.get(MODULE_ID, SETTINGS.hideVoidDeprecatedContent) === true;
  } catch {
    return false;
  }
}

/**
 * Does this entry duplicate something the system already ships? Takes either an
 * index stub (sidebar) or a full document (browser); both carry `type`, `name`
 * and — once {@link ensureDomainIndex} has run — `system.domain`.
 *
 * **A domain card is judged by its domain, not its name.** Once the SRD publishes
 * a domain at all, Void's whole copy of that domain goes, because matching card
 * by card leaves a deck half from each source and the seams do not line up: Void's
 * `Umbra Veil` is the SRD's **`Umbral Veil`**, a rename that no name match can
 * see, so it survived as a phantom twin of a card that was already there. Levels
 * move too. The domain is the unit a player actually picks from, so it is the
 * unit to keep whole. Void's `blood` has no SRD counterpart and is untouched —
 * all 21 of its cards stay.
 */
function isDeprecated(entry: AnyObject | null | undefined): boolean {
  const type = entry?.["type"];
  if (!HIDEABLE_TYPES.has(String(type))) return false;

  if (type === "domainCard") {
    const domain = foundry.utils["getProperty"]?.(entry as AnyObject, DOMAIN_FIELD);
    // Falls through to the name match while the domain is still unknown — during
    // the tree build at `setup`, before `ensureDomainIndex` has resolved.
    if (domain) return srdDomains().has(String(domain));
  }

  return srdContentKeys().has(contentKey(type, entry?.["name"]));
}

/** Every Void pack, for the re-render after the switch is flipped. */
function voidPacks(): CompendiumPack[] {
  return [...game.packs].filter((pack) => isVoidPack(pack));
}

/**
 * Rebuild after the setting changes: drop the cache, re-derive each Void pack's
 * directory tree, and re-draw whatever is on screen showing one.
 *
 * `pack.render()` is core's own fan-out to the applications registered against
 * that collection, so an open compendium window updates in place; a closed one
 * has nothing registered and costs nothing.
 *
 * **The card picker needs `loadItems()` called by hand, and rendering alone is
 * not enough.** `ItemBrowser` fills `.item-list` from `loadItems()`, which is
 * *not* driven by `_onRender` — the system always calls the two together (see its
 * own `openSettings`, and the `DhCompendiumBrowserRefresh` socket handler). Re-
 * rendering on its own repaints the frame around a list of rows that were built
 * before the switch moved, which looks exactly like the filter having no effect.
 *
 * No socket emit to go with it, unlike the system's `openSettings`: this is a
 * *world* setting, so Foundry fires its `onChange` on every client already, and
 * each one rebuilds its own trees and reloads its own list.
 *
 * Awaits {@link ensureDomainIndex} first, since the very first time the switch is
 * turned on the domains are not in any index yet — redrawing before they land
 * would apply the name match alone and leave the renamed cards behind, which is
 * the bug that made the domain rule necessary in the first place. Once loaded it
 * resolves immediately and every later flip redraws in the same tick.
 */
export function refreshVoidDeprecatedContent(): void {
  void redraw();
}

async function redraw(): Promise<void> {
  srdKeyCache = null;
  srdDomainCache = null;

  if (hidingActive()) await ensureDomainIndex();
  // Cleared again: a concurrent read during the await above could have rebuilt
  // either cache from an index that was still missing its domains.
  srdKeyCache = null;
  srdDomainCache = null;

  for (const pack of voidPacks()) {
    pack.initializeTree();
    pack.render();
  }

  const browser = ui["compendiumBrowser"] as AnyObject | undefined;
  if (!browser?.["rendered"]) return;
  void browser["render"]?.();
  void browser["loadItems"]?.();
}

/**
 * Count what is currently hidden, for the one line logged at `ready`. Cheap —
 * the same index walk the filter already does.
 */
function hiddenCount(): number {
  let count = 0;
  for (const pack of voidPacks()) {
    for (const entry of pack.index) {
      if (isDeprecated(entry)) count++;
    }
  }
  return count;
}

/**
 * Wrap `CompendiumCollection#_getVisibleTreeContents` so a Void pack's directory
 * listing never contains a duplicate.
 *
 * Installed during `init`, and that timing is load-bearing: `Game#setupGame`
 * calls `initializePacks()` and then `initializeTrees()` *before* the `setup`
 * hook, so a patch applied any later would leave every tree already built from
 * the unfiltered list.
 */
function patchSidebarTree(): void {
  const CompendiumCollection = foundry.documents?.["collections"]?.["CompendiumCollection"] as
    | AnyObject
    | undefined;
  const prototype = CompendiumCollection?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["_getVisibleTreeContents"] as
    | ((this: CompendiumPack) => AnyObject[])
    | undefined;

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} CompendiumCollection#_getVisibleTreeContents is missing — ` +
        `The Void's duplicated content will still be listed in the compendium sidebar.`,
    );
    return;
  }

  prototype!["_getVisibleTreeContents"] = function (this: CompendiumPack): AnyObject[] {
    const contents = original.call(this);
    if (!isVoidPack(this) || !hidingActive()) return contents;
    return contents.filter((entry) => !isDeprecated(entry));
  };
}

/**
 * Wrap the system's `CompendiumBrowserSettings#isEntryExcluded`, which its
 * `ItemBrowser.loadItems()` already runs every result through — so this covers
 * character creation, level-up and the plain browser in one.
 *
 * Deferred to `setup`: the model class hangs off `game.system.api`, which the
 * system assigns during its own `init`. Systems load before modules, so ours
 * would almost certainly be late enough — but "almost certainly" is not worth it
 * when nothing can open a browser before `ready` anyway.
 *
 * The system's own exclusions are asked first and win outright; we only ever add
 * to what it already hides.
 */
function patchCardPickers(): void {
  const model = game.system?.["api"]?.["models"]?.["CompendiumBrowserSettings"] as
    | AnyObject
    | undefined;
  const prototype = model?.["prototype"] as AnyObject | undefined;
  const original = prototype?.["isEntryExcluded"] as
    | ((this: AnyObject, item: AnyObject) => boolean)
    | undefined;

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} Daggerheart's CompendiumBrowserSettings#isEntryExcluded is missing — ` +
        `The Void's duplicated content will still be offered in the card pickers.`,
    );
    return;
  }

  prototype!["isEntryExcluded"] = function (this: AnyObject, item: AnyObject): boolean {
    if (original.call(this, item)) return true;
    if (!hidingActive()) return false;
    return isVoidPack(game.packs.get(String(item?.["pack"]))) && isDeprecated(item);
  };
}

/** Install both filters. Called once during `init`. */
export function registerVoidDeprecatedContent(): void {
  patchSidebarTree();

  Hooks.once("setup", () => {
    patchCardPickers();
  });

  // The trees built during `setup` used the name match alone, because no index
  // carried `system.domain` yet. Load it and rebuild them, so the domain rule
  // catches what the names missed — Void's `Umbra Veil` against the SRD's
  // `Umbral Veil`, above all. Cheap and silent when the switch is off:
  // `redraw` skips the round trip entirely and re-derives trees that don't
  // change.
  Hooks.once("ready", () => {
    void redraw().then(() => {
      if (!hidingActive()) return;
      console.log(
        `${LOG_PREFIX} Hiding ${hiddenCount()} compendium entries The Void duplicates from the SRD.`,
      );
    });
  });
}
