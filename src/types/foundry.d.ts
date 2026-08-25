/**
 * Minimal ambient declarations for the FoundryVTT globals this module touches.
 *
 * This is a deliberately small shim so the project type-checks and builds without
 * pulling in the full community type packages. When you want richer typings,
 * install `fvtt-types` (https://github.com/League-of-Foundry-Developers/foundry-vtt-types)
 * and delete this file.
 *
 * When you touch a new Foundry global, add it here rather than reaching for `any`
 * everywhere.
 */

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObject = Record<string, any>;

  /** Loose stand-in for jQuery — some classic Foundry hooks still pass it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JQuery = any;

  /** A PIXI display object — we only ever toggle its visibility. */
  interface DisplayObject {
    visible: boolean;
  }

  /** The persisted side of a Token (embedded in a Scene). */
  interface TokenDocument {
    id: string;
    /** The token's own name, which is often a generic prototype name for a PC. */
    name?: string;
    /** Token artwork. `src` is the image path. */
    texture?: { src?: string | null } & AnyObject;
    /** Foundry's own GM-only hidden flag — deliberately left untouched here. */
    hidden: boolean;
    /**
     * Id of the *base* Actor this token represents. Unlike `actor.id`, this is
     * stable for unlinked tokens (whose `actor` is a synthetic ActorDelta actor).
     */
    actorId?: string | null;
    /** The placeable on the canvas, once drawn. */
    object?: Token | null;
    actor?: AnyObject | null;
    getFlag(scope: string, key: string): unknown;
    setFlag(scope: string, key: string, value: unknown): Promise<TokenDocument>;
    unsetFlag(scope: string, key: string): Promise<TokenDocument>;
    /** Mutate the document's source data in place (used from preCreate hooks). */
    updateSource(changes: AnyObject, options?: AnyObject): object;
  }

  /** A Token placeable on the canvas. Only the members this module touches. */
  interface Token {
    id: string;
    document: TokenDocument;
    /** The Actor this token represents — synthetic (ActorDelta) when unlinked. */
    actor?: AnyObject | null;
    /** Whether this token is currently selected on *this* client. */
    controlled?: boolean;
    /**
     * PIXI's pointer-event mode. Foundry re-derives it on every state refresh as
     * `isInteractable ? "static" : "none"`; `"none"` also excludes the token from
     * `PlaceablesLayer#controllableObjects()`, and so from box-select.
     */
    eventMode?: string;
    /**
     * Select this token. Returns false when Foundry refused — the token layer
     * isn't active, a ruler is up, or `_canControl` said no. `force` skips the
     * `isInteractable` check, which is false whenever the active tool isn't an
     * interaction tool; it does *not* bypass permissions.
     */
    control(options?: {
      releaseOthers?: boolean;
      force?: boolean;
      pan?: boolean;
      renderSidebar?: boolean;
    }): boolean;
    /** The sprite. Parented to the primary canvas group; null until drawn. */
    mesh: DisplayObject | null;
    border: DisplayObject;
    nameplate: DisplayObject;
    bars: DisplayObject;
    tooltip: DisplayObject;
    effects: DisplayObject;
    /** Target reticle graphics, drawn when the token is targeted. */
    targetPips: DisplayObject;
    targetArrows: DisplayObject;
    levelIndicator?: DisplayObject | null;
    /** Schedules an incremental refresh; fires the `refreshToken` hook. */
    renderFlags: { set(flags: AnyObject): void };
    /**
     * Distance to another token in scene grid units — **the Daggerheart
     * system's** addition to the core Token class, not Foundry's own. It is
     * edge-to-edge and elevation-aware, and it is what the system itself uses
     * for range-dependent effects and the token-hover readout, so anything
     * measuring range here has to go through it to agree with the table.
     *
     * `NaN` when the canvas isn't ready. On a **gridless** scene it also clamps:
     * anything within `grid.distance * 1.75` of the measured edge-to-edge figure
     * reports exactly `grid.distance`, so touching tokens read as one square
     * rather than as zero. It does not return `Infinity` — the `Math.min` that
     * looks like it might is `Math.min(distance, Infinity)`.
     */
    distanceTo(target: Token): number;
  }

  /** The active canvas. `tokens` is undefined until the canvas is ready. */
  const canvas: {
    ready: boolean;
    scene?: ({ id: string } & AnyObject) | null;
    tokens?: {
      placeables: Token[];
      /** Currently selected tokens, in the order they were selected (last = newest). */
      controlled: Token[];
      /** Foundry's own `placeables.filter(t => t.actor && t.actor.isOwner)`. */
      ownedTokens: Token[];
      get(id: string): Token | undefined;
    };
  } & AnyObject;

  /** Foundry's global hook dispatcher. */
  const Hooks: {
    on(hook: string, fn: (...args: any[]) => unknown): number;
    once(hook: string, fn: (...args: any[]) => unknown): number;
    off(hook: string, fn: number | ((...args: any[]) => unknown)): void;
    call(hook: string, ...args: any[]): boolean;
    callAll(hook: string, ...args: any[]): boolean;
  };

  /** The active game instance. Only ready after the `ready` hook fires. */
  const game: {
    modules: Map<string, { active: boolean; api?: unknown } & AnyObject>;
    system: { id: string; version: string } & AnyObject;
    settings: {
      register(namespace: string, key: string, data: AnyObject): void;
      registerMenu(namespace: string, key: string, data: AnyObject): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    /**
     * The local user. `setFlag`/`unsetFlag` work here even for a player — a user
     * may always update their own User document, and `flags` isn't restricted.
     */
    user?: {
      id: string;
      isGM: boolean;
      name: string;
      getFlag(scope: string, key: string): unknown;
      setFlag(scope: string, key: string, value: unknown): Promise<AnyObject>;
      unsetFlag(scope: string, key: string): Promise<AnyObject>;
    } & AnyObject;
    /**
     * Connected users. `activeGM` is Foundry's designated single GM — the same
     * user on every client — which is how a hook that fires everywhere can pick
     * exactly one writer without any socket coordination. Undefined when no GM
     * is connected.
     */
    users?: {
      activeGM?: ({ id: string; isSelf: boolean } & AnyObject) | null;
      /** Every user, connected or not — `character` is their assigned actor. */
      contents: AnyObject[];
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** World actors. Undefined before the `setup` hook. */
    actors?: {
      contents: AnyObject[];
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /**
     * The chat log. Undefined before the `setup` hook. A message fetched here
     * carries `update`, which a GM may call on anybody's message.
     */
    messages?: {
      contents: AnyObject[];
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** Every sidebar folder in the world, across all document types. */
    folders?: {
      contents: AnyObject[];
      find(predicate: (folder: AnyObject) => boolean): AnyObject | undefined;
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** Present once the socket connects; requires `"socket": true` in module.json. */
    socket?: {
      on(event: string, callback: (...args: any[]) => void): void;
      emit(event: string, ...args: any[]): void;
    };
    i18n: {
      localize(key: string): string;
      format(key: string, data?: AnyObject): string;
      /**
       * Core's cached `Intl.ListFormat` for the active language — the right way
       * to join a list into a sentence, since "a, b and c" is not punctuated the
       * same way in every language.
       */
      getListFormatter(options?: {
        style?: "long" | "short" | "narrow";
        type?: "conjunction" | "disjunction" | "unit";
      }): { format(list: string[]): string };
    };
  } & AnyObject;

  /**
   * Synchronous UUID resolution. Returns null for anything not yet loaded, and
   * a compendium's *index entry* (name/type, no system data) when the pack is
   * indexed but the document isn't cached. Pass `{ strict: false }` to get null
   * instead of a throw for a UUID that can only be resolved asynchronously.
   */
  function fromUuidSync(uuid: string, options?: AnyObject): AnyObject | null;

  /**
   * Asynchronous UUID resolution. The one to reach for when the document may
   * live in a compendium that has not been loaded, where `fromUuidSync` returns
   * an index entry with no system data on it.
   */
  function fromUuid(uuid: string, options?: AnyObject): Promise<AnyObject | null>;

  /**
   * Foundry's dice roller.
   *
   * A `class` rather than a `const`, because this is the one global the module
   * *constructs* — a feature that has to roll a die of its own builds one here.
   * Everything the module receives from the system's roll pipeline is a
   * `DualityRoll`/`DamageRoll` subclass and travels as `AnyObject`, so only the
   * members used to make and post a plain roll are declared.
   */
  class Roll {
    constructor(formula: string, data?: AnyObject, options?: AnyObject);
    readonly formula: string;
    readonly total: number;
    /**
     * The roll's DiceTerms, in formula order. Each carries a `results` array of
     * `{ result, active }` — the individual faces, which is the only thing a
     * roll asked to "choose one value" has any use for.
     */
    readonly dice: AnyObject[];
    evaluate(options?: AnyObject): Promise<Roll>;
    toMessage(data?: AnyObject, options?: AnyObject): Promise<AnyObject | undefined>;
    /**
     * Turn a formula into RollTerms, substituting `@paths` from `data` first.
     * The terms are unevaluated, which is what makes this the way to *append*
     * dice to a roll the system is still assembling.
     */
    static parse(formula: string, data?: AnyObject): AnyObject[];
  }

  /** Chat log entries. Only the members this module touches. */
  const ChatMessage: {
    create(data: AnyObject): Promise<AnyObject>;
    getSpeaker(data: AnyObject): AnyObject;
    /**
     * Stamp `whisper` and `blind` onto message data for a visibility mode (a key
     * of `CONFIG.ChatMessage.modes` — `public`, `self`, `gm`, `blind`, `ic`, …).
     * Mutates and returns the object it is given. An omitted mode falls back to
     * the client's `core.messageMode` setting.
     */
    applyMode(data: AnyObject, mode?: string): AnyObject;
  };

  /**
   * Items, world or embedded. `create` takes `parent` (the owning Actor) and any
   * other operation options in its second argument.
   */
  const Item: {
    create(data: AnyObject, options?: AnyObject): Promise<AnyObject | undefined>;
  };

  /** World journal entries. Only the members this module touches. */
  const JournalEntry: {
    create(data: AnyObject): Promise<AnyObject | undefined>;
  };

  /**
   * Sidebar folders. `type` is the document type the folder holds
   * ("JournalEntry", "Actor", …) — folder names are only unique within a type.
   */
  const Folder: {
    create(data: AnyObject): Promise<AnyObject | undefined>;
  };

  const CONFIG: AnyObject;
  const CONST: AnyObject;
  const ui: AnyObject & {
    notifications?: { info(m: string): void; warn(m: string): void; error(m: string): void };
    /** The macro bar. Foundry supports exactly 5 pages; `changePage` throws outside 1–5. */
    hotbar?: { page: number; changePage(page: number): Promise<void> } & AnyObject;
  };

  /** The Foundry client-side API namespace (ApplicationV2, template helpers). */
  const foundry: {
    applications: {
      api: {
        ApplicationV2: any;
        HandlebarsApplicationMixin: <T>(base: T) => T;
        DialogV2: any;
      };
      handlebars: {
        loadTemplates(paths: string[]): Promise<unknown>;
        /** Render a preloaded template to an HTML string. */
        renderTemplate(path: string, context: AnyObject): Promise<string>;
      };
    };
    utils: AnyObject;
  } & AnyObject;
}
