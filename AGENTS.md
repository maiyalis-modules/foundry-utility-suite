# Maiyalis: Utility Suite — Agent guide

> This is the canonical instruction file for all coding agents. Update this
> file when shared guidance changes. `CLAUDE.md` imports it for Claude Code;
> Codex reads `AGENTS.md` directly. Do not duplicate shared instructions in
> agent-specific files.

A FoundryVTT **v14** module (requires the **Daggerheart** system) for the Eryndor
campaign. Written in TypeScript, compiled to `dist/module.js` (what `module.json`
loads).

## Features

- **Invisible-to-players tokens** (`src/tokens/invisible-tokens.ts`) — when the GM
  drops a token, it's flagged `flags.eryndor-essentials.invisibleToPlayers` and its
  art is not rendered on player clients (we blank `mesh`/`border`/`nameplate`/etc.
  but never touch Foundry's `hidden` or `token.visible` — those would take the
  token out of the scene, and we only want it unseen). World setting
  `hideDmTokens` is the master switch; a GM-only token-HUD button toggles
  individual tokens.
  - *Inert tokens* (`blockPlayerTokenInteraction`, **on** by default, greyed out
    while `hideDmTokens` is off). The token is also removed from the pointer-event
    system on player clients: `token.eventMode = "none"`, set from the same
    `refreshToken` hook that blanks the art. Without it an unseen token still
    answers the mouse — hover tooltips off bare ground, click-select and drag of
    something invisible, and getting swept up in a box-select. `"none"` rather
    than `interactive = false` so PIXI skips the object *and its children*.
    - **Box-select falls out for free**, and this is the right way to do it:
      `PlaceablesLayer#controllableObjects()` yields only placeables that are
      `visible && renderable && interactive`, so a marquee (and `controlAll`,
      the select-all keybinding) never sees these tokens. An earlier attempt
      patched `selectObjects` to block the gesture; it was reverted — it left the
      marquee drawing and doing nothing, which reads as broken.
    - Safe to re-set every refresh, and self-undoing: `PlaceableObject#
      _refreshState` re-derives `eventMode = isInteractable ? "static" : "none"`,
      which is what hands interactivity back when the setting is turned off, the
      same way the blanked artwork returns.
    - A `preUpdateToken` backstop cancels player-initiated `x`/`y`/`elevation`/
      `rotation` changes to a flagged token. Inertness closes the pointer routes
      but not the keyboard, and `token-bar.ts` deliberately keeps something
      controlled at all times — arrow keys would otherwise silently move a token
      the GM placed, corrupting the distance automation the tokens exist for.
      `preUpdate*` fires only on the initiating client, so testing `game.user`
      is the same as testing who moved it.
  - **Targeting is unaffected, and that is load-bearing** — it's the reason the
    tokens are on the board at all, along with distance measurement.
    `TokenLayer#setTargets` resolves ids and consults neither visibility nor
    interactivity, and `daggerheart-target-helper` picks targets through its own
    UI (`canvas.tokens.setTargets(...)`), never by clicking the canvas. The target
    reticle (`targetPips`/`targetArrows`) is blanked so a target doesn't reveal
    its position, but `game.user.targets` is untouched.
  - The Tokens on Scene bar is unaffected too, and becomes the player's only way
    to select: it calls `control({force: true})`, which skips the
    `isInteractable` check, and `Token#_canControl` never consults the event mode.
- **Instant token drag** (`src/tokens/drag-animation.ts`) — world setting
  `disableDragAnimation` makes drag-and-dropped tokens snap to the destination
  instead of gliding at `CONFIG.Token.movement.defaultSpeed`. Implemented by
  setting `options.animate = false` from `preUpdateToken` when the update
  operation's `method` is `"dragging"`. Deliberately scoped to drag-drop only —
  keyboard movement, the HUD, paste/undo, and other modules' API moves still
  animate.
- **Tokens on Scene bar** (`src/tokens/token-bar.ts`) — the companion to the
  invisible-token feature above. Because players never see a token, they cannot
  click one — but they *can* still deselect (bare ground, Escape, or picking a
  non-interaction tool, which makes `TokenLayer#_onActivate` call `releaseAll`),
  and with nothing selected **`daggerheart-hud` falls back to the wrong
  character**: its `getPlayerCharacter()` returns
  `game.actors.filter(type === "character" && isOwner)[0]` and **never consults
  `game.user.character`**, so a player who owns two sheets gets somebody else's
  HUD with no visible token to click their way back to. Two halves, both needed:
  a **lock** that re-controls the last token whenever a player's selection
  empties, and a **floating bar** listing the tokens they own on the scene, which
  is the way back when the lock can't re-select (`Token#_canControl` refuses
  while a ruler is measuring; a token can also be deleted). World settings
  `tokenBar` (off by default) and `tokenBarLockSelection` (on, greyed out in the
  window while the bar is off — same `refreshControls` pattern as the Deck Limit
  fields). **Players only**; the GM can click tokens already, and
  `canvas.tokens.ownedTokens` would hand them the whole scene. Notes:
  - The roster is Foundry's own `canvas.tokens.ownedTokens`
    (`placeables.filter(t => t.actor && t.actor.isOwner)`) rather than a
    re-derived filter, sorted assigned-character-first. Rows are keyed and sorted
    on `document.actorId` (the *base* actor — same unlinked-token trap as
    `hotbar-pages.ts`) and labelled with the **actor's** name, since a PC's token
    is routinely left on a generic prototype name.
  - `controlToken` is debounced to 0 and the pass then reads
    `canvas.tokens.controlled`, exactly as `hotbar-pages.ts` does — acting on the
    release event alone would fight the release+control pair one click produces.
    Re-controlling re-enters the pass but settles in one extra turn (the
    selection is non-empty by then); a *failed* re-control fires no hook, so
    there's no loop either way.
  - `control({force: true})` skips `Token#isInteractable` (false whenever the
    active tool isn't an interaction tool). It does **not** bypass permissions —
    `_canControl` still runs.
  - **`CANVAS_SETTLE_MS` (750 ms) is load-bearing and deliberately later than it
    looks.** `daggerheart-hud` also hooks `canvasReady` and calls its own
    `createOrUpdateHUD()` on a **500 ms** timer *unconditionally* — it never
    checks whether a token is selected — so an opening selection made sooner is
    silently overwritten by the very fallback this feature exists to avoid.
    Re-asserting instead of waiting doesn't work: `PlaceableObject#control`
    returns early when the token is already controlled and fires no hook.
  - Each row carries a **crosshair button** opening the Target Helper's *range
    survey* for that token — a read-only list of what's on the scene and how far
    away it is, colour-coded by range band, targeting nothing. Routed through
    `src/integrations/target-helper-survey.ts`, and drawn **only when that
    module answers** (`surveysAvailable()`), since a control that's present but
    inert is worse than no control. It's a sibling `<button>` of the row button
    rather than nested — a `<button>` inside a `<button>` is invalid HTML and
    browsers unnest it — which is why the delegated listener checks
    `[data-ee-survey]` before `[data-ee-token]`.
  - Plain DOM appended to the **body**, not an ApplicationV2 window, following
    `../daggerheart-spotlight-tracker/src/ui/spotlight-bar.ts` (where a
    standalone window was built and removed as too heavy). Dragged by its header
    via pointer capture; the position is one of the module's two client-scoped
    settings (`tokenBarPosition`; the other is `notGoodEnoughAlwaysReroll`) —
    it's one user's window layout, and a player has to be able to write it,
    which world scope would forbid. Clamped back into
    the viewport on create, drag-end and window resize.
- **Per-actor hotbar pages** (`src/hotbar/hotbar-pages.ts`, `hotbar-pages-app.ts`) —
  selecting a token swaps the hotbar to the page assigned to its actor; anything
  unassigned (or an empty selection) falls back to a configurable default page.
  World setting `hotbarPageSwap` is the master switch; the assignments live in one
  world object setting `hotbarPages` (`{ defaultPage, applyToPlayers, pages }`)
  edited through the GM-only `hotbarPagesMenu` window. Driven off `controlToken` +
  `canvasReady`, debounced so the release/control pair one click produces yields a
  single page change. Assignments key on `token.document.actorId` (the *base*
  actor) — `token.actor.id` differs for unlinked tokens. Foundry's hotbar has
  exactly **5** pages: `Hotbar#changePage` throws outside 1–5.
- **Void (Unofficial) shared detection** (`src/integrations/void-shared.ts`) —
  `voidActive`, `isWriter`, `isLycan`/`isOrderOfTheLycan`, and
  `isInHybridForm`, shared by both Void integrations below so they can never
  disagree. Prefers asking Void itself via `voidApi()` (`window.Void`), but **as
  of v1.2.9 that only exposes `HybridForm()`, `WarlockFavor`, `DomainCards`, and
  `ComboStrikes`** (see its `features.js`) — not `isOrderOfTheLycan` or
  `isInHybridForm`, despite both being ordinary exports of its `hybrid-form.js`.
  So in practice every call falls through today to the name-scan fallback, which
  mirrors Void's own `isInHybridForm`: some effect named `Hybrid Form` / `Hybrid
  Form - Feral` / `Hybrid Form - Apex Hunter`, enabled. `voidApi()` exists so a
  future Void version that *does* export these is picked up with no code change.
- **Hybrid Form portrait sync** (`src/integrations/void-hybrid-form.ts`) —
  *optional* integration with **The Void (Unofficial)** (`the-void-unofficial`).
  That module transforms an Order of the Lycan's tokens but never `actor.img` or
  `actor.prototypeToken`, so the sheet portrait stays human. **Scope is the
  portrait only** — token artwork is Void's job and we never touch, snapshot, or
  revert it. Trigger: *any* ActiveEffect create/update/delete on an actor, after
  which we ask `void-shared.ts`'s `isInHybridForm(actor)` and make the portrait
  agree; `isLycan` filters out every other actor first. The effect usually lives
  on the subclass *item* and transfers, so `effect.parent` is an Item and the
  actor is one level up. Debounced by `SETTLE_MS` so a burst of effect changes is
  one decision. The portrait artwork comes from **our own**
  `Set Portrait Image with {{{…}}}` marker in the item description — *never* from
  a token. Deriving it from the transformed token's `texture.src` or from Void's
  `Set Token Image with {{{…}}}` marker is a dead end: it depends on whether Void
  has applied the texture yet, and when token art and portrait art are the same
  file it resolves to the *untransformed* portrait, so the apply is a silent
  no-op. Snapshot goes on the **actor**
  (`flags.eryndor-essentials.hybridFormPortrait`) so the revert survives with no
  tokens placed. **Two dead ends, do not revisit**: keying off Void's private
  `hybridFormAppearance` flag (only `toggleHybridForm` creates it, so the ability
  and status bar never fire), and matching effect *names* (world content, may not
  match). Both were replaced by asking Void directly (see the shared-detection
  entry above for why the "asking" today still bottoms out at a name scan). World
  settings `voidHybridFormPortrait` / `voidHybridFormPrototype`; gated on
  `game.modules.get(...)?.active`, never a hard dependency.
- **Hybrid Form ends at max Stress** (`src/integrations/void-hybrid-form-stress.ts`)
  — *optional* integration with The Void (Unofficial), completing its own "Beast
  Within" rule: gaining Hope while in Hybrid Form marks Stress (Void's
  `onPreUpdateActor`, left untouched), but Void never reverts the form once
  Stress is full. Trigger: `updateActor` on any Order of the Lycan character
  whose Stress is now at max while transformed. Reverting is more than disabling
  the gameplay effect — Void's `_applyHybridFormAppearance` also swaps the
  token's art/scale back and removes its Hybrid Form light effect, using flags
  private to its module, so disabling the effect ourselves would leave the token
  looking like a wolf forever. Since `window.Void` doesn't expose a
  targetable-actor toggle (only `HybridForm()`, which resolves the *acting
  user's* selected token/character), this dynamically imports Void's own
  `scripts/hybrid-form.js` for its exported `toggleHybridForm(actor)` — the exact
  function the wolf button calls — via
  `foundry.utils.getRoute("modules/the-void-unofficial/scripts/hybrid-form.js")`.
  The dynamic `import()` needs `/* @vite-ignore */`: `vite.config.ts` sets
  `inlineDynamicImports: true` for the single-file build, and without the
  comment Vite tries (and fails, since the path is a runtime string, not
  resolvable at build time) to analyze it. **Verified against v1.2.9** — re-read
  `scripts/hybrid-form.js` if this stops working after a Void update. World
  setting `voidHybridFormStressRevert`, **on by default** (unlike the portrait
  settings above) — this isn't optional artwork, it's a rule Void already half-
  implements; leaving it off leaves that half-implementation in place.
- **Target Helper hookup** (`src/integrations/target-helper-survey.ts`) — the one
  place here that talks to the sibling module **Maiyalis: Target Helper**
  (`daggerheart-target-helper`) through `game.modules.get(…).api`. *Optional*
  like every integration in that folder, and each entry point is probed
  separately (`typeof api?.x === "function"`) so an older install that publishes
  only some of them still gets those.
  - `openRangeSurvey` opens a read-only window listing everything on the scene
    with its distance from a given token. Its only caller is the Tokens on Scene
    bar above, and it is gated twice: `surveysAvailable()` decides whether the
    button is drawn at all, and `openRangeSurvey` re-checks on click, since a GM
    can disable a module in another tab between the two.
  - `registerRangeOrigin` declares where an action's range is measured *from*,
    for the case where the creature acting is not the creature rolling. Its only
    caller is the Companion feature. A `false` return is not worth a
    notification: without that module nothing gates range for anybody.
- **Raised-portrait refresh** (`src/integrations/ginzzzu-portraits.ts`) — *optional*
  integration with **Ginzzzu's Portraits & NPC Dock** (`ginzzzu-portraits`). Its
  own `updateActor` handler live-swaps a raised portrait's image, but only for six
  of its flags — **`img` is not one of them**, even though `actor.img` is the first
  entry in its `actorImagePaths` default. So any change to `actor.img` (ours or
  anyone's) leaves stale art on screen. We set the `<img>` src directly rather than
  lowering/re-raising, which would cost two replicated flag writes and flicker.
  Skips actors with an active emotion or a custom portrait image — there `actor.img`
  is legitimately not what's shown. World setting `refreshRaisedPortraits` (default
  **on**). Portraits are **local DOM** built from a replicated flag, so unlike the
  Hybrid Form writer this runs on *every* client.
- **Roll requests** (`src/integrations/quickactions-roll-request.ts`) — *optional*
  integration with **Daggerheart: Quick Actions** (`daggerheart-quickactions`),
  covering both surfaces of its *Request Roll* window: the Cinematic Mode prompt
  and the whispered chat card. Two world settings, both **on** by default and both
  on the **General Features** window (they change how another module's window
  behaves, not what a card's rule says — which is the line between that window and
  `daggerheartAutomationMenu`). Greyed out, with a warning line, when Quick Actions
  isn't active.
  - `rollRequestClose` — its cinematic prompt never closes after the roll. It tries
    to, from a listener on `.cinematic-roll-container`, but the system's
    `enricherRenderSetup` wraps every enriched-button handler in
    `event.stopPropagation()`, so the click never bubbles that far. We close from a
    **capture-phase** listener, which runs on the way down and can't be suppressed.
    Only installed when we did *not* take the button over; when we did, the close is
    driven by the roll completing.
  - `rollRequestOptions` — puts Advantage/Disadvantage and the character's
    Experiences (1 Hope each) on the request itself, and rolls with them. Needed
    because `renderDualityButton` resolves the roller through the system's
    `getCommandTarget`, which for a non-GM reads **only** `game.user.character` and
    ignores the selected token — so a player driving their character from the
    Tokens on Scene bar lands in the enricher's targetless branch, which hardcodes
    `config.data = { experiences: {}, traits: {}, rules: {} }`. No experiences, no
    trait modifier, no actor. We resolve selected token → `user.character` → lone
    owned character, build the same config `enrichedDualityRoll` does, and set
    `dialog.configure = false` (the card already asked what the roll dialog would).
    Advantage the **GM** set in the request renders locked — it's a ruling, not a
    default. Note the system never spends the Hope on this path at all: its dialog
    fills `config.costs` and `enrichedDualityRoll` then calls
    `resourceUpdates.updateResources()` without folding them in, the step the sheet's
    own `#rollAttribute` does do — so we charge Hope straight onto `resourceUpdates`
    rather than through `CostField`, which wants an Action context a request hasn't got.
  - **Everything is intercepted in the capture phase**, and it has to be. Replacing
    the button with `cloneNode(true)` (no listeners, same styling) *loses a race*:
    `#callHooks` walks `inheritanceChain()` derived-class first, so
    `renderCinematicRollPrompt` fires **before** `renderHandlebarsApplication` — and
    that second hook is where the system's `enricherRenderSetup` lives, so it wires
    whatever button is in the DOM by then, clone included. A capture listener on the
    container runs before any target-phase listener regardless of registration order,
    and `stopPropagation` there means the click never reaches the button at all.
  - Quick Actions also has a **bubbling** close listener on
    `.cinematic-roll-container` that can't tell one click from another. It has never
    fired in its intended case (the system's `stopPropagation` beats it — that *is*
    the `rollRequestClose` bug), so any click this module adds inside that container
    is the first ever to reach it. Chips therefore stop their own clicks, and the
    controls are anchored **before** the container rather than inside it. Get either
    wrong and picking an Experience closes the prompt instead.
  - The chat card
    is identified by structure (Quick Actions' background image in the inline style
    of `.card-content`, plus a `.duality-roll-button`), not a flag: it's their
    document, and a `preCreate` stamp would only catch requests sent after the
    feature was switched on. Card selections are DOM-only, so a chat re-render
    rebuilds them unselected.
- **Reach** (`src/daggerheart/reach.ts`) — the Giant ancestry's secondary feature
  ("Treat any weapon, ability, spell, or other feature that has a Melee range as
  though it had a Very Close range") is prose on a `feature` Item that the system
  enforces nowhere. World setting `reachMeleeAsVeryClose`, off by default, edited
  on the **General** tab of `daggerheartAutomationMenu` — it belongs to no single
  card, which is what that tab is for. An actor grants it by
  holding a `feature` Item named "Reach" (case-insensitive) — that's how the
  ancestry's feature is embedded on the character, and it's what the system's own
  `sheetLists` filters on. Deliberately *not* matched on other item types: a
  weapon someone named "Reach" shouldn't turn the rule on.
  - The change is made to the **derived** `range` of every Action the actor can
    use, never to stored data. Consumers all read the prepared value — the
    weapon/action tooltips (`templates/ui/tooltip/*.hbs`), the inventory rows, and
    `daggerheart-target-helper`'s `isWithinRange`, which is what actually stops a
    Very Close token being picked as a target for a Melee attack — while the
    action config sheet edits `source.range`, so the GM still sees the printed
    range. Nothing is written to the database, so the rule un-applies itself.
  - **Two hook points, because the system prepares actions in two places.**
    `Item#prepareEmbeddedDocuments` (Daggerheart overrides it to call
    `prepareData()` on each action) covers `system.actions` plus a weapon's base
    `system.attack`; `Actor#prepareData` covers the actor's *own*
    `system.attack` — a character's unarmed strike, an adversary's statblock
    attack — which lives on the actor, not on an item, and is where `melee` is the
    schema default. `system.attack` is **not** in the `system.actions`
    collection; the system's own code concatenates the two everywhere it wants
    both.
  - Prototype patches, because **Foundry fires no hook during data preparation**.
    Installed during `init`: the system assigns `CONFIG.Actor.documentClass` /
    `CONFIG.Item.documentClass` at script load (before any `init` hook) and no
    document is constructed until `setup`, so the patch is in place for the first
    preparation and there is nothing to catch up on at load.
  - It shares `Item#prepareEmbeddedDocuments` with the **Companion** feature, and
    `registerReach()` is called *first* so that patch wraps this one and runs
    last. Otherwise a Giant Beastbound's companion would get its Melee bite
    promoted to Very Close because the *partner* has long arms.
  - The adjustment is **idempotent in both directions**, and has to be:
    `Actor#prepareData` calls `Item#prepareData`, which does *not* re-initialize
    `system` from source, so a one-way write would stick forever. The undo is
    narrow on purpose — it reverts a `veryClose` only when `action._source.range`
    is `melee`, so an action genuinely printed as Very Close is never touched.
    `reconcileReach` (the setting's `onChange`) exists only for the toggle
    changing mid-session, where documents are already prepared and already on
    screen and nothing would otherwise re-prepare them.
- **Feature automation** (`src/daggerheart/feature-registry.ts`,
  `feature-prompt.ts`, `feature-ask.ts`, `roll-pipeline.ts`, `range-bands.ts`,
  `duality-outcome.ts`, `adversary-attack.ts`) — the framework behind Daggerheart
  features phrased *"when X happens, you can pay Y to change the outcome"*. Read
  this before automating another one: the second feature of a kind should be a
  registry entry, not a new interception.
  - **Why a framework and not a hook per feature.** Three structural walls. (1)
    Every interception the system offers is a `Hooks.call`, so a listener **cannot
    await** a player's answer — anything with a choice must be driven from a
    wrapped `async` method. (2) Foundry fires hooks in registration order across
    the whole install, so nothing arbitrates between two features on the same
    event; Fearless rewriting a Fear result *must* run before anything reacting to
    one, which `priority` expresses and independent listeners cannot. (3) One
    dialog per feature is unusable — three Fear-reactive features would mean three
    prompts in arbitrary order.
  - **The shape.** An interception point ("window") builds a context, asks
    `offersFor(window, context)` who is interested, prompts **once** via
    `chooseOffers`, and applies the answers in `priority` order. A feature is data
    plus `when`/`apply`. Non-optional features apply silently before the prompt is
    raised, so the question describes the situation actually being decided.
  - **Matching an Item** — flag, then compendium, then name, in that order.
    `flags.eryndor-essentials.featureId` naming the registry id is the escape
    hatch for homebrew and renamed cards; `_stats.compendiumSource` is the robust
    route for SRD content (survives renames, and a dragged copy still matches);
    the printed name is the last resort. Re-derived per event, never cached — the
    same reasoning as `reach.ts`.
  - **Costs.** `FeatureCost.value` is always the printed magnitude ("mark 2
    Stress" is `2`); direction is the resource's business. Daggerheart has two
    kinds and they move opposite ways — a **reversed** resource (Stress, Hit
    Points, Armor) counts marks used, so paying it *raises* the stored value
    toward `max`, while a normal one (Hope) counts what you hold. Every resource
    carries `isReversed`, and the system's own `CostField` branches on exactly
    that, so `resourceUpdatesFor` mirrors it rather than hardcoding per resource.
    Affordability is all-or-nothing: the system clamps on write, so 5-of-6 Stress
    asked to mark 2 would silently mark 1 and still get the benefit.
  - **The `dualityOutcome` window.** `DualityRoll.buildPost` (system **2.7.2**;
    a version mismatch logs a warning) runs four things in order: DSN presets →
    `super.buildPost` (system hooks, then **the chat message is created**) →
    `dualityUpdate` (Fear countdowns, then queues the GM's +1 Fear) →
    `handleTriggers` (the `fearRoll` trigger, gated on the result still being
    Fear). All four read **`config.roll.result.duality`**, not the roll's getters —
    so rewriting that field ahead of them means the Fear was never gained,
    countdowns never advanced, and other features' `fearRoll` triggers **never
    fired**. There is no equivalent "undo" afterwards.
  - **One patch, on `DHRoll.buildPost`, not `DualityRoll.buildPost` — and the one
    level matters.** `roll-pipeline.ts` owns the single wrapper; windows register
    into it with `registerRollWindow({id, matches, run})` and `installRollPipeline()`
    is called **last** in `module.ts` (registration order is execution order).
    `super.buildPost` resolves past `D20Roll` (which defines no `buildPost` — the
    chain is `Roll → BaseRoll → DHRoll → D20Roll → DualityRoll`) to `DHRoll`, so
    patching there lands a window *between* steps 1 and 2: after the Hope/Fear
    dice presets are stamped, before anything reads the result. It is also why a
    plain adversary `D20Roll` arrives here directly. Every window's `matches` has
    to gate on the roll type because `DHRoll` is the base all of them inherit.
    Classes come from `CONFIG.Dice.daggerheart`, assigned at script load — unlike
    `game.system.api`, which the system only fills inside its own `init`. A `run`
    that returns a Roll **replaces** the one the rest of `buildPost` posts and acts
    on; returning nothing keeps it. A throw from any window is swallowed, so a
    broken feature degrades to an ordinary roll rather than eating the chat card.
  - **The system destroys `config.roll.type` before any window sees it — use
    `rollTypeOf(config)`.** `RollField.prepareConfig` sets it to the action's roll
    type (`attack`, `spellcast`, `trait`, `diceSet`), but `D20Roll.buildEvaluate`
    then does `data.type = config.actionType`, where `actionType` is an unrelated
    taxonomy (`action` | `reaction`, from `CONFIG.DH.ITEM.actionTypes`, initial
    `'action'`). So from `buildPost` onward nothing on the config says what kind
    of roll this was, and a `matches` gating on `config.roll.type === 'attack'`
    silently never fires — no error, no prompt, which is exactly how it presented.
    `roll-pipeline.ts` captures the real type at `daggerheart.preRoll` (the first
    line of `buildConfigure`; `config.hooks` always ends in `''`, which produces
    the unsuffixed hook name) and parks it on `config.eeRollType` — on the config
    itself, because `DHRoll.buildEvaluate` **replaces `config.roll` wholesale**
    with `{...roll.options.roll, total, formula, dice}`. `rollTypeOf` returns null
    rather than falling back to the live field, since after evaluation that field
    answers a different question with the same confidence.
  - **The 3D dice are rolled early, by hand.** Dice So Nice animates off the *chat
    message*, which these windows are holding back — so without this the player
    would be asked to react to a result they had not watched arrive. `showDiceEarly`
    calls `game.dice3d.showForRoll(roll, game.user, true)` and awaits it, but only
    when a prompt is actually going to be raised; a roll that offers nothing keeps
    the system's ordinary timing. This is only correct from `DHRoll.buildPost`,
    because step 1 has by then stamped the presets that make the manual animation
    match the automatic one. Two follow-ups: `roll.options.eeDiceShown` is set and
    a `preCreateChatMessage` hook turns it into `flags.dice-so-nice.skip` (DSN's
    `shouldInterceptMessage` bails on that flag) so the dice don't roll twice, and
    `config.mute = true` stops the message replaying the dice sound — the same
    thing `DamageRoll.buildPost` does when it has rolled dice itself. Verified
    against Dice So Nice **6.2.9**. All of it no-ops when DSN isn't installed, and
    `showForRoll` resolving `false` (blind roll, or its visibility setting) leaves
    both the flag and the sound alone. The dice are shown **only to whoever the
    chat card will reach**: `rollVisibility(config)` asks core's
    `ChatMessage.applyMode` what `config.selectedMessageMode` means in
    `whisper`/`blind` terms — the same mode `DHRoll.toMessage` passes to
    `ChatMessage.create` — and those go to `showForRoll`'s 4th and 5th arguments,
    exactly as the system's own `DamageRoll.buildPost` does. Without that, a GM's
    private roll animates for the whole table and then posts a card only the GM
    can read. Note a roll's visibility is **not** ours to choose: it is one
    message built from one config, so a replaced roll inherits whatever the
    original had, and `core.messageMode` (the chat roll-mode dropdown) is what
    decides it. A window that **replaces** the roll must
    call `clearEarlyDice(config)` first: the dice the table watched belong to the
    discarded roll, and the replacement's have never been seen.
  - **A window that rerolls only *part* of a roll must animate that part itself.**
    Do **not** reach for `clearEarlyDice` there — that is for a window replacing
    the roll outright. Dice So Nice does not skip the dice that did not move: its
    `DiceNotation` walks every result of every term, groups the ones marked
    `rerolled` into an *earlier* throw than the ones that replaced them, and
    animates both. Letting the message animate after a one-die reroll therefore
    shows the whole original set landing on its old faces, and only then the new
    die — the reroll narrated backwards, which is exactly the bug Feline
    Instincts shipped with. `showRerolledDie(term, config)` is the fix: the
    message keeps its `eeDiceShown` suppression and the single new face is
    animated on its own. It hands `showForRoll` a duck-typed
    `{_evaluated, dice, options}` stand-in rather than a Roll, which is the
    system's own idiom for the job (`DualityDie#reroll` and `BaseDie#reroll`,
    Daggerheart 2.7.2, both build one) and is all DSN reads. The term is
    **copied, not borrowed** — the system's version assigns filtered results back
    onto the live term and so destroys the record of what was rerolled, which is
    what puts the discarded face on the chat card struck through. The copy is
    built through the term's own constructor, so a `HopeDie` stays a `HopeDie`,
    and carries the original's `options` so it keeps the appearance
    `setDiceSoNiceForDualityRoll` stamped on it. `showDiceEarly` being idempotent
    is what lets a *loop* do this repeatedly: it reports the dice as shown without
    throwing them again.
  - **Flipping the result** is done with a persisted marker, not by swapping dice.
    `withHope`/`withFear` are getters comparing the two dice totals with no setter,
    the chat card renders from the *Roll object* (`roll.totalLabel` in the system's
    `roll-part.hbs`), and the Roll is rebuilt from its serialized form on reload —
    so an instance-level override would vanish for every other client. Instead
    `roll.options.eeDualityOverride` (dot-free on purpose: Foundry's object helpers
    treat a dot as a path) round-trips through `toJSON`, and the two getters are
    patched at `init` to honour it. `totalLabel` and `isCritical` follow for free.
    The patch is installed **unconditionally**, whatever the settings say — a
    message converted last session still has to render as Hope today.
  - **Paying** folds into `config.resourceUpdates`, so the cost, the suppressed
    Fear and the gained Hope land as a single actor write. Every path that builds
    a duality roll (`Actor#diceRoll`, `DHBaseAction#use`) flushes that map once the
    roll returns.
  - **The prompt's banner.** A window may pass `headline` alongside `intro`: two
    round portraits with the verdict ("Hit", "Critical") between them, rendered by
    `feature-prompt.ts` and styled under `.ee-feature-prompt` in `styles/module.css`.
    Supply it only when the event really is one party acting on **exactly one**
    other — `adversary-attack.ts` falls back to the `intro` sentence when an
    attack hit several targets, because two circles cannot honestly show three
    people. Portraits come from `actor.img` (and `config.targets[].img`, which the
    system already stamps with `token.actor.img`) rather than token textures,
    since a top-down marker reads as nothing masked into a circle; a missing one
    falls back to core's `icons/svg/mystery-man.svg`. Everything in
    `PromptRequest` stays flat, localized and JSON-safe — it has to cross a socket.
  - **The offer carries its card's artwork.** `PromptOffer.img` is the granting
    Item's `img`, drawn square (not the banner's circle: this is an object, and a
    cropped circle reads as a face) to the left of the label. **No placeholder
    when it is absent** — unlike `chooseUpTo`, whose rows are people and where a
    missing portrait still leaves a face-shaped hole in a column of faces. It is
    filled by `toPromptOffers` for anything asked out of the registry, and by
    hand in the windows that build a `PromptOffer` themselves (`witchs-charm.ts`,
    `hex.ts`, `tethered-talisman.ts`, `blood-spike.ts`) — add it there when you
    write the next one. The name beside it is still shown only when it *differs*
    from the feature label; the artwork always is, since it repeats nothing else
    on screen and is how a player recognises a card without reading it.
    - Adding it turned both offer shapes from a two-column grid into a flex row
      of art plus one `.ee-feature-offer-text` block, which also fixed a latent
      bug: the single-offer shape wrapped `describeOffer`'s `<p class="hint">` in
      a `<p>` of its own, and the parser unnests a `<p>` inside a `<p>`.
    **No roll totals in a prompt.** Neither the banner nor the `intro` sentence
    names the number: whether the attack landed is what a reacting player decides
    on, the total changes nothing they can do about it, and the chat card may be
    about to withhold it (see the visibility note above). Keep new windows to the
    same line.
  - Dismissal, Escape and the 30s timeout all mean "leave the roll alone" — every
    caller is mid-pipeline holding something back, so the safe answer is always to
    let the unmodified outcome through.
  - **The timeout is drawn, not merely enforced.** `waitWithTimeout` installs a
    "Time remaining" bar between the dialog's content and its buttons on every
    prompt it raises, and none on an `untimed` one — a clock that answers "none"
    for you after half a minute reads as a question you can take your time over
    right up until it vanishes. One place, so a new prompt shape gets it by
    coming through here; the shapes that deliberately have no timer
    (`chooseOne`, `chooseFromList`, `chooseFromRadios`, `askText`, `showNotice`)
    never touch that function and so show nothing.
    - **The depletion is one CSS animation.** Script sets exactly one property
      on the bar, `animationDuration`, because it is the only part the stylesheet
      cannot know: what is *left* of the timeout at the moment it is drawn, which
      is not the whole of it after a re-render. Everything else lives in
      `.ee-prompt-timer*` in `styles/module.css`, where a `scaleX` on a fill
      anchored left never relayouts and keeps running smoothly while this client
      is busy. Don't replace it with an interval.
    - **The seconds beside it are the only tick**, at `TICK_MS` (250 ms) — short
      on purpose, since a 1000 ms interval started at an arbitrary moment shows
      each number for a second but changes it up to a second late, which reads as
      a clock lagging the bar next to it. Rounded **up**, so the last whole
      second reads "1s" rather than a "0s" the player can still answer during.
      `installTimerBar` returns a stopper, which `waitWithTimeout` calls in its
      `finally` and again before a re-render replaces the bar; the tick also
      stops itself once its element leaves the document, so a dialog closed by
      any route cleans up regardless. The readout carries `role="timer"` (whose
      implicit `aria-live: off` keeps it from interrupting four times a second)
      and the bar is `aria-hidden`, since the two say the same thing.
    - Anchored **before `footer.form-footer`** — DialogV2's markup is `<form>` →
      `.dialog-content` → `footer.form-footer` — falling back to the end of the
      content if that ever moves, on the same reasoning as `adaptability.ts`'s
      chat-card anchor: a countdown in a slightly odd place beats none. Drawn in
      a `try` of its own, *before* the caller's `onRender` wiring, so neither can
      cost the other.
  - **The `adversaryAttack` window** (`adversary-attack.ts`) — reactions to an
    adversary landing a hit. Differs from `dualityOutcome` in three ways that
    shape the code: the reacting character **is not the roller** (so the window
    enumerates candidate characters and builds a context each, rather than one),
    the client holding the pipeline open **is not the client that decides** (see
    the socket bullet below), and the outcome is changed by **replacing the roll**
    rather than editing a field. An adversary rolls a plain `D20Roll` (`Actor#rollClass`
    returns `DualityRoll` only for `character`/`companion`), which has no
    `buildPost`, so these arrive at the pipeline directly — before the chat card,
    before `TargetField.execute` (order 20) turns `config.roll.total` into each
    target's `hitResult`, and before the damage that follows. Candidates come from
    `canvas.tokens.placeables` filtered to `type === "character"`, deduped by actor
    uuid and **sorted by name** so the ask order is stable. They are asked **one at
    a time, stopping at the first acceptance** — once the attack is being rerolled
    there is nothing left to react to, and charging two players for one reroll
    would be worse.
  - **Rerolling means rebuilding, not re-rolling.** On a d20 roll disadvantage is
    not a die to subtract but a second d20 with `kl`, so the formula itself has to
    change. Set `config.roll.advantage = -1`, then `rollClass.createRollInstance(config)`
    and `rollClass.buildEvaluate(...)`. Feeding the evaluated formula back through
    the constructor is safe because `D20Roll.createBaseDice` **throws away
    everything except the leading die** and `configureModifiers` re-derives the
    bonuses from `config.roll.baseModifiers` plus the roll's active effects — the
    modifiers come back by recomputation, never by string surgery. This works at
    all because **`roll.options` *is* the config object**: `createRollInstance`
    passes `config` straight through and core `Roll` does `this.options = options`
    (a reference, `mergeObject` being `inplace` by default). That is also why
    anything stashed on `roll.options` has to be cleared through `config`.
  - **Asking someone else** (`feature-ask.ts`). Foundry has no request/response
    over its socket, so this adds one: a correlation id, a map of waiting
    promises, and a timeout. `responderFor(actor)` picks the active non-GM owner,
    preferring the player who has it assigned as their character, and falls back
    to *this* client (which makes `askUser` skip the socket entirely). The asker
    waits `PROMPT_TIMEOUT_MS + 5s` so the remote dialog's own timeout wins the
    race in every normal case. **Nothing off the socket is trusted**: the answer
    is a list of feature ids, re-checked against the offers the asking client
    built, so a malformed or stale reply can only ever mean *fewer* features fire.
    Costs are charged by the asking client too, keeping the whole transaction on
    one machine — a player disconnecting between "yes" and the reroll cannot leave
    their Hope spent on nothing. The asker also raises a notification naming who
    it is waiting on, because its own roll is visibly frozen until the reply lands.
    `PromptOffer` is flat, localized and JSON-safe for exactly this reason;
    localization happens on the *asking* side.
  - **Range** (`range-bands.ts`). `Token#distanceTo` is the **Daggerheart system's**
    addition to the core Token class (edge-to-edge, elevation-aware) and is what
    the system measures with, so anything checking range has to go through it to
    agree with the ruler and the token-hover readout. Thresholds come from the
    world's `VariantRules.rangeMeasurement`, which a scene may override via
    `scene.flags.daggerheart.rangeMeasurement` when its `setting` is `custom`
    (`disable` only changes *display*, not reach). The comparison is the system's
    own `distance <= threshold`, so sitting exactly on a threshold is **inside**
    the band. Everything returns null rather than guessing when it cannot measure,
    and callers treat null as "don't fire" — a reaction costing 3 Hope must not go
    off on an assumed distance. Deliberately **not** delegating to Maiyalis: Target
    Helper, which has the same logic for its picker: that module is an optional
    integration here, and a printed rule shouldn't stop working when it's disabled.
  - **Two deliberate silences** in `adversaryAttack`: an unmeasurable range (no
    canvas, either actor untokened) and an undeterminable success. `config.roll.success`
    is only populated when the attack had targets or a set difficulty, so a GM who
    rolls with nothing targeted and eyeballs it against Evasion gets no prompt.
  - **Paying when the feature isn't the roller's.** `config.resourceUpdates` is a
    `ResourceUpdateMap` bound to the **rolling** actor, so the adversary window
    cannot use it — folding a player's Hope into it would charge the adversary. It
    calls `actor.modifyResource(...)` directly and **awaits** it, which is why
    `payCost` returns `void | Promise<void>` and `applyOffer` is async: a failed
    write aborts the window before the outcome changes, rather than after.
- **Adaptability** (`src/daggerheart/adaptability.ts`) — the Human ancestry's
  (SRD p.30) "When you fail a roll that utilized one of your Experiences, you can
  mark a Stress to reroll." `Compendium.daggerheart.ancestries.Item.BNofV1UC4ZbdFTkb`,
  a `feature` Item whose one action ("Mark Stress") charges the Stress and does
  nothing else. World setting `adaptabilityReroll`, **on** by default, under
  **Ancestries → Human**. **Two delivery mechanisms that partition one rule** —
  read this before automating another "when you fail…" card, because choosing
  between the shapes is the whole design.
  - **The prompt is primary; the card button covers what it cannot.**
    `D20Roll.buildEvaluate` fills in `config.roll.success` only when the roll had
    targets or a difficulty typed into the dialog; anything else leaves it
    `undefined`, because the GM sets the difficulty and routinely says so only
    after the dice are read out. So: a **scored failure** (`success === false`)
    gets the ordinary roll-window prompt, like every other feature here — dice
    shown, one question, settled before the chat card posts. An **unscored** roll
    gets a control on the posted card instead, because no honest prompt can be
    raised for a roll nobody has adjudicated, and asking anyway would put a modal
    in front of the player on every Experience roll before they knew whether it
    failed. **This matters at tables that play with chat hidden** — the prompt is
    the mechanism they see, and it is why the card button alone was not enough.
    The two **overlap on purpose**: a scored failure raises the prompt *and*
    leaves the button, because the rule is retroactive ("when you fail a roll …
    you can") and a player who let the prompt go and then heard the GM narrate
    the miss should still be able to spend the Stress. Only a scored *success*
    withdraws the button.
  - **The two paths reroll differently and must.** From the posted card,
    `DualityRoll#reroll({liveRoll: true})` is right: the first result already
    handed out its Hope or Fear, and that call reconciles it through the system's
    own automation settings and Fear countdowns
    (`updateResourcesForDualityReroll`). From the prompt, at the pipeline seam,
    `dualityUpdate` has not run yet — nothing to reconcile, and that call would
    double-count — so the reroll is `rebuildRoll`, the same choice
    `rangers-focus.ts` makes. Getting this backwards is silent and costs the
    table a Hope or a Fear.
  - **`rebuildRoll` now lives in `roll-pipeline.ts`**, moved out of
    `rangers-focus.ts` when this became its second caller — the usual rule here,
    and it belongs beside `clearEarlyDice`, which it calls. It takes a `label`
    only to name the caller in its warnings.
  - **Registered before `registerDualityOutcome()`.** Both can fire on one roll,
    and this one may *replace* it: rerolling first means Fearless asks about
    converting the Fear on the dice the player is keeping, not on a result
    discarded a moment later.
  - **The trigger is `roll.options.experiences`**, an array of keys the roll
    dialog writes, cross-checked against `roll.options.data.experiences` — the
    same pairing `configureModifiers` filters on before it will add anything to
    the total. Both survive into the chat message, because `config` **is** the
    roll's `options`, so a card from last session still answers. A
    `roll.companionRoll` is excluded: those spend Hope on the *companion's*
    Experiences, and the card says one of **your** Experiences.
  - **`DualityRoll#reroll({liveRoll: true})` does the work**, and using it rather
    than rebuilding is deliberate — the opposite call from `rangers-focus.ts`, for
    the opposite reason. There the seam is *before* the Hope/Fear update, so
    `liveRoll` would reconcile something that had not happened yet. Here the first
    result has already given out its Hope or Fear, so the reconciliation
    (`updateResourcesForDualityReroll`, which also honours the world's `hopeFear`
    automation settings and the Fear countdowns) is exactly what is wanted, and
    reimplementing it would be copying policy. `Roll#reroll` clones from
    `this._formula`, by then fully resolved — every modifier including the
    Experience is already a number in the string, so the reroll keeps them all and
    nothing is charged twice.
  - **`refreshRollSnapshot` exists because the system's own reroll leaves the
    record stale.** `config.roll` is a plain-object snapshot written by the three
    `buildEvaluate` overrides and persisted with the message; the chat log's
    "Reroll Action" context entry replaces `message.rolls[0]` and updates none of
    it. Most of the card renders from the live Roll object, but the difficulty
    badge reads `roll.options.roll.success` for its "miss" styling and a
    result-based damage part reads `roll.options.roll.result.duality`. Mirrors
    `buildEvaluate` (Daggerheart **2.7.2**) rather than inventing a second set of
    rules, and deliberately skips `extra`, which derives from `roll.baseTerms` —
    only `configureModifiers` fills that in, and a cloned roll never runs it, so
    computing it here would report every die as an extra one. **It lives in
    `roll-pipeline.ts`**, moved out of this file when Feline Instincts became
    its second caller — the same rule `rebuildRoll` followed.
  - **Target hits need nothing**, which is what makes swapping the roll enough:
    `DhRollMessage#_getCurrentTargets` recomputes `hitResult` from `this.roll` on
    every render. Same fact `i-see-it-coming.ts` relies on from the other
    direction — it is why a flipped `hit` flag there would be cosmetic.
  - **`message.system.successConsumed` is deliberately not touched.** It reads
    like "the roll succeeded" and is not: it marks that a `consumeOnSuccess`
    action's deferred cost has already been charged. True *here* because this
    path runs after the message exists and `CostField` has already had its
    turn. A reroll at the **pipeline seam** is the opposite case and must
    rewrite it — see Feline Instincts below.
  - Offered only to a client that could actually carry it out — the actor's owner,
    *and* whoever the system would let rewrite the message (`isAuthor` or GM).
    Both paths also stand down on a critical, which is a success in Daggerheart
    whatever the difficulty was.
  - **Every gate logs at `console.debug` when it declines**, and the first build
    shipped without that — which cost a debugging round trip when the feature
    appeared to do nothing, exactly the lesson Hold Them Off already recorded.
    Detection is an `instanceof CONFIG.Dice.daggerheart.DualityRoll` over
    `message.rolls` rather than a `message.type` string plus the system's
    `message.system.roll` getter, and the card button anchors to the first of
    `.roll-buttons` / `.chat-roll` / last child that exists — so a template
    reshuffle can misplace it but never lose it.
  - **No use limit**, because the card prints none: a reroll that fails again may
    be rerolled for another Stress. Each announces itself in chat, whispered to
    whoever the original roll reached, so a table reading the rule more strictly
    can see it happen. Every gate is re-read on click as well as on render, so a
    card left in the log overnight can't pay a price that is no longer there.
  - `feature-registry.ts`'s `canAfford` is now exported alongside
    `findGrantingItem`, for the same reason: a feature with its own interception
    still has to withhold an offer nobody can pay for.
- **Feline Instincts** (`src/daggerheart/feline-instincts.ts`) — the Katari
  ancestry's (SRD p.30) "When you make an Agility Roll, you can spend 2 Hope to
  reroll your Hope Die."
  `Compendium.daggerheart.ancestries.Item.lNgbbYnCKgrdvA85`, a `feature` Item
  whose one action ("Spend Hope") charges the 2 Hope and does nothing else —
  the same empty shape Adaptability arrives in. World setting
  `felineInstinctsReroll`, **on** by default, under **Ancestries → Katari**.
  - **It rerolls one die, not the roll**, and that is the whole reason it is not
    a branch inside `adaptability.ts`. There is no system path for it: the die is
    thrown again in place, exactly the way core's own `r` modifier does it
    (`Die#reroll`, `client/dice/terms/die.mjs`) — mark the standing result
    `rerolled`, set `active = false`, `await term.roll({reroll: true})`.
    `DiceTerm#total` sums only *active* results, so the term reports the new face
    while the old one stays on the card struck through, which is the shape the
    system's `rerolled.rerolls` field and its chat template already expect.
  - **Two cached values then have to be put back by hand.** `Roll#total` is
    `_total`, written once at evaluation and never recomputed from the terms —
    refreshed with `roll._evaluateTotal()`, which is what core's own
    `Roll.fromTerms` does. And `config.roll`, the plain-object record everything
    downstream actually reads, is brought back into step with
    `refreshRollSnapshot` from `roll-pipeline.ts`. Forget either and the dice on
    the card disagree with the total beside them.
  - **`config.successConsumed` *is* rewritten here**, which is the opposite of
    what Adaptability does and is correct for the opposite reason. `CostField` is
    workflow order **150** against `RollField`'s **10**, so at this seam the costs
    have not been charged yet and will be charged against the success this reroll
    just rewrote; the message must describe the same outcome or a
    `consumeOnSuccess` cost gets charged twice. Adaptability's path runs after
    both, so there it must be left alone.
  - **Registered before `registerDualityOutcome()`**, like Adaptability and more
    sharply: the Hope Die *is* the Hope/Fear result, so this has to settle before
    Fearless asks whether to convert a Fear the player may be about to reroll
    away. Placed after Adaptability, so a character holding both is asked about
    the whole roll before being asked about one of its dice.
  - **"An Agility Roll" is `config.roll.trait === "agility"`** — the field the
    system fills in for both a sheet trait check (`Actor#rollTrait`) and an
    action that rolls a trait (`RollField.prepareConfig` via
    `DHActionRollData#rollTrait`), which is what makes an attack with a
    Finesse-and-Agility weapon count. It also catches a Spellcast Roll for a class
    whose spellcast trait is Agility; that is what the system's own field says and
    the reading this follows.
  - **Affordability is not `canAfford`.** A Duality roll's own costs — a Hope per
    Experience above all — sit unflushed in `config.resourceUpdates` until the
    workflow ends, so `actor.system.resources.hope.value` still reads the
    pre-roll number and `canAfford` would sell a 2-Hope reroll the character
    cannot pay for. `ResourceUpdateMap` extends `Map`, so the pending delta is
    just `config.resourceUpdates.get("hope")`; `hopeAvailable` adds it (and
    treats a `clear` entry as zero). **Any feature charging Hope on a roll in
    flight has this problem** — `modifyResource` clamps on write, so the
    shortfall is silent.
  - **The new Hope Die is animated by hand; the message stays suppressed.** The
    first build called `clearEarlyDice` here, and the table watched the original
    Hope and Fear land a second time on their old faces before the replacement
    die appeared. See the `showRerolledDie` bullet under the roll pipeline for
    why Dice So Nice does that and what replaces it. Gated on whether
    `showDiceEarly` actually played: if DSN is absent or declined, the message
    would not have animated either.
  - **The die is thrown before the Hope is charged**, the opposite order from
    Adaptability. There the price is an awaited `modifyResource` whose failure
    has to abort the reroll; here it is an entry in the roll's own pending map
    that cannot fail on its own, and `rerollHopeDie` *declines* rather than
    throws when the system's shape has moved — so charging first would be the
    only way to bill a player for a die that never left the table.
  - **Prompt only, no chat-card half.** Unlike Adaptability, which reconciles a
    posted card with `DualityRoll#reroll({liveRoll: true})`, this rewrites the
    Hope/Fear result itself and the system has no reconciliation for a one-die
    reroll. So a roll the GM never scored (`config.roll.success === undefined`)
    raises nothing at all — a real gap in a card whose printed rule has no
    failure condition, and the obvious next thing to build.
  - **No use limit**, because the card prints none: the loop re-scores the roll
    each time and offers again while the Hope lasts. It checks the **flat** 2
    Hope each round, not a cumulative price — `chargeCosts` has already put the
    previous spend into the pending map that `hopeAvailable` reads. Adaptability's
    loop *does* check cumulatively, because `canAfford` ignores that map. Same
    problem, opposite arithmetic; copying one into the other resells or refuses
    the same resource.
- **Fearless** (`src/daggerheart/fearless.ts`) — the Infernis ancestry's "When you
  roll with Fear, you can mark 2 Stress to change it into a roll with Hope
  instead." The SRD ships it as a `feature` Item whose single action only charges
  the Stress: no effects, no triggers, nothing converts the result. World setting
  `fearlessFearToHope`, **on** by default (it is the printed rule, and it acts only
  on the player's own answer), under **Ancestries → Infernis** in
  `daggerheartAutomationMenu`. Registered on `dualityOutcome` at priority 10 —
  rewriters sort ahead of reactors,
  which belong at 50+. The +1 Hope is deliberately *not* applied here: the system's
  own `addDualityResourceUpdates` runs afterwards, reads the rewritten result, and
  grants it. The only thing owed is the 2 Stress.
- **Blood Maledict** (`src/daggerheart/blood-maledict.ts`) — the Blood Hunter's
  (*Void for Daggerheart*) "Spend 3 Hope when an adversary succeeds on an attack
  roll within Close range to make them reroll with disadvantage."
  `Compendium.the-void-unofficial.classes.Item.gugHbXBWP24CFTJZ`, a `feature` Item
  whose single action only charges the Hope — no effects, no triggers, nothing
  forces the reroll. World setting `bloodMaledictReroll`, **on** by default, on the
  **Classes → Blood Hunter** panel of `daggerheartAutomationMenu`. Registered on
  `adversaryAttack` at priority 10 (it replaces the roll, so it sorts ahead of
  readers). *"Within
  Close range"* is read as **the adversary being within Close of you**, which is
  the standard reaction shape and the only reading that can be checked — the
  attack's own range band isn't recorded on the roll. It therefore also fires when
  the adversary hits *someone else* nearby, which is what the card says: it is
  conditioned on an adversary succeeding, not on you being the target. The
  `attacker.type === "adversary"` check lives in the feature, not the window — the
  window only knows "a non-Duality attack roll", and *adversary* is this card's
  wording. Both ends of the table need the module enabled: the prompt is raised on
  the GM's client and shown on the owner's.
- **Crimson Rite** (`src/daggerheart/crimson-rite.ts`) — the Blood Hunter's
  (*Void for Daggerheart*) "Mark a Hit Point to enchant one of your active weapons
  … until the end of your next rest or you use this feature again … an extra 1d4
  magic damage", scaling to 4d4.
  `Compendium.the-void-unofficial.classes.Item.otb0ThXWuqQzzWho`. World setting
  `crimsonRiteEnchant`, **on** by default, under **Classes → Blood Hunter** in
  `daggerheartAutomationMenu`. **Not a roll window** — it is the first feature here
  activated by an *action* and delivered as a standing ActiveEffect, so it hooks
  the system directly and is registered after `installRollPipeline()`. Read this
  entry before automating another feature of that shape.
  - **The Void's four shipped "Crimson Rite: Tier N" effects do nothing**, and the
    reason generalizes: `DamageRoll.applyBaseBonus` pulls type bonuses **per damage
    part, keyed on that part's own types** (`options.damageTypes?.forEach(t =>
    getBonus(\`${type}.${t}\`))`). They write to
    `system.bonuses.damage.magical.dice`, and an ordinary weapon's part is
    `type: ["physical"]` — so the bucket is never consulted and enabling one is a
    silent no-op. (They also write `"+2d4"`; `formatModifier` supplies its own
    operator, and the system's own `sharp` armour feature writes an unsigned
    `"1d4"`. Copy `sharp`, not the Void.)
  - **Weapon scoping is native — use it.** `system.bonuses.damage.primaryWeapon` /
    `secondaryWeapon` are gated on the damage roll's source item *being* the
    equipped weapon in that slot (`options.source.item === this.data[slot]?.id`),
    which is the only per-weapon damage scoping the system offers. A character has
    exactly two weapon slots, so "one of your active weapons" is always a
    primary-or-secondary choice. The bonus also shows up in the damage dialog as a
    toggleable "Weapon Bonus". `getActionRelevantEffects` feeds it from
    `actor.allApplicableEffects()`, so an effect created straight onto the actor
    qualifies.
  - **Rest expiry is native too.** `system.duration.type` accepts the ids in
    `CONFIG.DH.EFFECTS.activeEffectDurations`; the system's `expireActiveEffects`
    runs on both rests and `refreshIsAllowed` expires a **`shortRest`** duration on
    *either* kind — so `shortRest` is "until the end of your next rest", while
    `longRest` would survive a short one. Gated on the world's
    `Automation.autoExpireActiveEffects`, which is why the module warns when that
    is off rather than silently granting a permanent rite.
  - **Bonus dice can never be their own damage part.** `Actor#takeDamage` runs the
    main damage through `convertDamageToThreshold`, and Daggerheart thresholds work
    on the **total** — two parts would be converted twice and mark the wrong number
    of Hit Points. Anything adding damage to an existing attack has to join that
    attack's formula, and therefore inherits its damage types. This is the one real
    constraint on the whole class of "deals an extra Nd… of *some other* type"
    features; do not try to model them as separate parts.
  - Consequently the only code this needs is a `daggerheart.preRoll` listener
    adding `magical` to the enchanted weapon's `config.damageFormula.damageTypes`
    (that hook fires for damage rolls too — `DamageRoll` inherits `buildConfigure`
    and adds no hook suffix). The weapon's *base* damage becomes magic as well,
    which is a deviation in the character's favour: `getResistanceStatus` requires
    resistance to **all** of a part's types before it counts.
  - **The two halves are anchored differently** — dice to the slot, damage type to
    the weapon — so an `updateItem`/`deleteItem` guard ends the rite when the
    enchanted weapon leaves its slot, rather than letting them come apart. Any
    manually-enabled Void tier effect is disabled on activation, since giving the
    weapon a `magical` type is exactly the condition that would wake it up and
    stack it on top.
- **Blood Spike** (`src/daggerheart/blood-spike.ts`) — the Blood domain's (*Void
  for Daggerheart*) "Make a Spellcast Roll against a target within Close range. On
  a success, spend a Hope to deal d8+2 magic damage … and the target marks a
  Stress. If you have at least 3 Hit Points marked, the damage die is a d10
  instead." `Compendium.the-void-unofficial.domains.Item.pg4tkHr8WpfDrs17`, a
  `domainCard` carrying **three** actions: two identical attacks named "Blood
  Spike d8" and "Blood Spike d10", and an effect action "Spend Hope" that charges
  1 Hope and does nothing else. World setting `bloodSpikeSpendHope`, **on** by
  default, under **Domains → Blood** in `daggerheartAutomationMenu`. The first
  entry here that is a *domain card* rather than a class/ancestry feature, and the
  first to use both a roll window and a `preRoll` damage hook together.
  - **The Stress is already native — don't implement it.** Both attack actions
    carry a `damage.resources.stress` part of a flat `1`, and
    `DamageField.applyDamage` only applies to targets whose `hitResult.success` is
    true. "On a success, the target marks a Stress" therefore needs no code, and
    that is also what lets declining the Hope leave the Stress standing: nulling
    `config.damageFormula` removes only `damage.main`, and `Actor#takeDamage`
    handles a null `main` and applies the resource updates on their own.
  - **`config.roll.success` is set during the roll step, not after it.**
    `D20Roll.buildEvaluate` populates it (and each target's `hit`) before
    `buildPost` — so the seam in `roll-pipeline.ts` is the *only* place where the
    answer is knowable and the damage has not yet been rolled. The workflow order
    is roll (10) → damage (20) → target (20) → applyDamage (75) → … → cost (150),
    and every one of the system's own interception points between them is a
    synchronous `Hooks.call` that cannot await a dialog.
  - **Two windows can now fire on one roll.** A Blood Spike cast is a character's
    Duality roll, so `dualityOutcome` (Fearless) and this one both see it. They
    compose — converting Fear to Hope changes the result, never the total — but
    `showDiceEarly` had to be made **idempotent**, or the second prompt would throw
    the dice a second time. Register this window *after* `registerDualityOutcome`.
  - **The die is swapped by string edit, deliberately.** At the damage roll's
    `daggerheart.preRoll`, `config.damageFormula.formula` still holds only this
    action's own damage — `formatFormulas` has resolved `@prof` and merged
    same-typed parts, and bonuses join later in `constructFormula` — so the
    action's declared `damage.main.value.dice` is its only occurrence. Rebuilding
    the formula instead would be a second implementation of `formatFormulas` that
    could drift. Pattern is `` `${declared}(?![0-9])` `` so a `d1` never eats the
    `0` of a `d10`, and `declared` is validated against `/^d\d+$/` first. **Both
    dice are constants here, not read off the action** — the action's die says
    which *button* was pressed, so taking the base from it would leave a d10 press
    below the threshold rolling a d10, which is the mistake this removes.
  - The automation attaches to **both** attack actions (matched on `action.type`,
    never on the Void's action names), so whichever button is pressed the rule
    picks the die — the two stop being a choice a player can get wrong. The card's
    "Spend Hope" action is deliberately left alone: it is the manual route for a
    cast resolved with nothing targeted, which raises no prompt because there is
    then no one to damage and no one to mark Stress.
  - Costs go into `config.resourceUpdates` (see `duality-outcome.ts`), not a
    direct write: the roll is about to queue its own +1 Hope into the same map,
    and on a Hope result the two correctly cancel to a single net-zero write.
- **Blighting Strike** (`src/daggerheart/blighting-strike.ts`) — the Dread
  domain's (*Void for Daggerheart*) "Make a Spellcast Roll against a target
  within Far range. On a success, the target takes d6+1 magic damage using your
  Proficiency … If you succeed with Fear, the target instead takes d10+1 magic
  damage using your Proficiency."
  `Compendium.the-void-unofficial.domains.Item.BIze56vTneG5UJv6`. World setting
  `blightingStrikeDamage`, **on** by default, under **Domains → Dread** in
  `daggerheartAutomationMenu`. **Not a workflow feature at all — it repairs the
  card's shape at preparation time and then gets out of the way.**
  - **The card ships wrong, and the system already has the right mechanic.**
    `DHResourceData.resultBased` makes `DamageField.getFormulaValue` return a
    damage part's `valueAlt` instead of its `value` when
    `data.roll.result.duality === -1` (and `data` there is the workflow *config*,
    despite the parameter name — `formatFormulas` is called with it). The Void
    instead ships an `attack` with `damage.main: null` and two loose `damage`
    actions, "Damage (Hope)" (d6+1) and "Damage (Fear)" (d10+1).
  - **Three costs of the split, all of them real** — and the reason chaining the
    second action from `postUseAction` was tried first and abandoned:
    1. A `damage` action has no roll, so `TargetField.execute` leaves every
       target's `hitResult.success` false and `DamageField.applyDamage`
       (`targets.filter(t => t.hitResult?.success)`) filters them all out. **The
       damage never applied to anybody.**
    2. `DamageField.execute` reads `isCritical` off the *action's own* chat
       message (`Boolean(message?.system.roll?.isCritical)`). A standalone damage
       action has none, so **a critical Spellcast rolled ordinary dice.**
    3. Everything watching the action workflow — the spotlight tracker,
       Ginzzzu's raised portraits — saw the turn end when the Spellcast Roll
       ended, because as far as the system was concerned it had.
  - **The repair**: at `Item#prepareEmbeddedDocuments`, the Spellcast Roll is
    rebuilt with `damage.main` = the Hope action's part, `resultBased: true`, and
    `valueAlt` = the Fear action's `value`; the two damage actions are deleted
    from the prepared collection. The dice are **read off the card**, never
    written here, so a retuned card keeps its own numbers.
  - Built through `attack.constructor` rather than a class off `game.system.api`,
    so it stays whatever subclass the system made it, and from `attack.toObject()`
    so the constructor gets a source object it is guaranteed to accept.
    `prepareData()` is called by hand — the system's own loop over the collection
    has already run by the time this replaces an entry in it.
  - **`system.actions` is not rebuilt from source on each preparation** — the
    system's `prepareEmbeddedDocuments` re-prepares the actions already in the
    collection. So the reshape happens once and subsequent preparations find
    nothing to do, **and a deleted action does not come back on its own**. That is
    why `reconcileBlightingStrikeCards` calls `item.reset()` (re-initialise from
    `_source`) rather than `prepareData()`, unlike the other four users of this
    seam, which only ever *add* an action.
  - **A card whose damage actions charge resources is left alone.** Folding `main`
    across is one field; folding a resource collection across is not, and dropping
    a cost the card charges silently would be worse than leaving it as it shipped.
  - Side effect worth knowing: one action means `DhpItem#use` no longer opens
    `ActionSelectionDialog`, so a hotbar press just casts. An earlier
    `card-action-choice.ts` existed to force that and was deleted when this
    stopped needing it.
  - **The "reduced by half" rider is automated**, and is the only part of the card
    that is — nothing declares it, so nothing native can carry it. Two halves:
    1. **The mark.** On a hit, `daggerheart.postUseAction` reads `target.hit` and
       asks `gm-effects.ts` for a `blightingStrike` marker on each one, relayed to
       the GM because a player cannot write an ActiveEffect to an adversary. The
       effect **is** the record — unlike Ranger's Focus, whose marker is cosmetic
       and whose real record lives on the ranger, the thing that has to remember
       here is the blighted creature, whose next damage roll happens on the GM's
       client possibly turns later.
    2. **The halving.** A `before` rule on `damage-landing.ts`.
  - **`daggerheart.preTakeDamage` is a trap for anything about the attacker.**
    `Actor#parseDamageArgs` reduces the payload to `{ main, resourceUpdates }` and
    discards everything else, so the hook never learns who dealt the damage.
    `applyDamage` is the seam that knows all three of attacker
    (`config.source.actor`), targets, and the still-changeable packet.
  - **"An ally" is Friendly token disposition** (the table's choice), resolved
    through the same token lookup `applyDamage` does two lines later — scene token
    when the target entry names one, `actor.prototypeToken` otherwise.
  - Only `damage.main` is halved, with `Math.ceil`, matching
    `Actor#calculateDamage`'s `Math.ceil(baseDamage / 2)` for resistance. A damage
    roll's resource entries are costs, not damage. The mark is cleared **in the
    `before` phase**, not after: clearing on the way out would leave it standing
    if application threw.
  - The mark never expires on its own. The card says "the next time" with no
    limit, so that is faithful; deleting the effect is one click.
- **I See It Coming** (`src/daggerheart/i-see-it-coming.ts`) — the Bone domain's
  (SRD) "When you're targeted by an attack made from beyond Melee range, you can
  mark a Stress to roll a d4 and gain a bonus to your Evasion equal to the result
  against the attack." `Compendium.daggerheart.domains.Item.Kp6RejHGimnuoBom`, a
  `domainCard` whose one action ("Roll d4") charges the Stress and rolls the die
  but compares it to nothing. World setting `iSeeItComingEvasion`, **on** by
  default, under **Domains → Bone** in `daggerheartAutomationMenu`. Registered on
  `adversaryAttack` at priority 20 (a rewriter; reactors belong at 50+), so it
  shares Blood Maledict's socket relay — both ends of the table need the module.
  - **Raise `target.evasion`, never `target.hit`.** The chat message recomputes
    the hit on *every render* — `DhRollMessage#_getCurrentTargets` derives it from
    `data.difficulty || data.evasion` against `this.roll.total` — so a flipped
    `hit` flag would be cosmetic and would come apart on the first page reload.
    Evasion is also what `D20Roll.buildEvaluate` and `TargetField.execute` both
    read, which is why it is the one field that makes every consumer agree.
    `hit`/`config.roll.success` are still updated, for everything mid-flight.
  - **`beyond(band)` is not `!within(band)`.** `withinBand` returns `boolean |
    null`, and an unmeasurable distance must not satisfy "from beyond Melee
    range" — so the context grew an explicit `beyond`, which is `=== false`.
  - **`evasionDecides` guards the whole idea.** `buildEvaluate` compares against
    `config.roll.difficulty ?? target.difficulty ?? target.evasion`; when either
    of the first two is set, an Evasion bonus buys nothing and the Stress must not
    be charged. A `character` has no `system.difficulty` field at all, which is
    why the ordinary case passes.
  - "Targeted by an attack" is read as **hit** by one, since the window only opens
    on a success and a bonus against an attack that already missed is a wasted
    Stress. Deliberately *not* checked: that the attacker is an adversary — the
    card says "an attack" without qualification, unlike Blood Maledict.
  - `AutomatedFeature#apply` became `void | Promise<void>` for this, and
    `applyOffer` awaits it: rolling a die is async, and the window is holding the
    result back precisely so the change lands first. The d4 posts as a real Roll
    message (Dice So Nice animates it for free), whispered via `rollVisibility` to
    exactly the audience the attack card will reach — it is created on the
    *attacker's* client, so a blind GM roll would otherwise leak.
  - The window's loop now breaks when `config.roll.success` stops being true: a
    dodged attack must not then be offered to the next character as an adversary
    that "succeeded".
- **Hold Them Off** (`src/daggerheart/hold-them-off.ts`) — the Ranger's (SRD)
  "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll
  against two additional adversaries within range of the attack."
  `Compendium.daggerheart.classes.Item.2Cyb9ZeuAesf5Sb3`, a `feature` Item whose
  one action ("Spend Hope") charges the 3 Hope and does nothing else. World
  setting `holdThemOffExtraTargets`, **on** by default, under **Classes → Ranger**
  in `daggerheartAutomationMenu`. Its own roll window, registered last, and the
  first feature here that changes *who a roll resolves against* rather than what
  it rolled.
  - **The whole trick is that `config.targets` is just an array, and the seam is
    ahead of everything that reads it.** `TargetField.execute` (20) gives each
    entry a `hitResult`; `DamageField.applyDamage` (75) applies `config.damage` to
    every entry that hit, cloning per target; `DHRoll.toMessage` deep-clones the
    config into the card. All three are after `DHRoll.buildPost`, so "use that
    same roll against two more" is literally *append two entries*. Nothing is
    re-rolled and nothing is undone. Entries mirror `TargetField.formatTarget`
    field for field; `hit` is decided the way `D20Roll.buildEvaluate` decides it,
    and `hitResult` is deliberately left to `TargetField.execute`.
  - **"with a weapon" is exact, not a heuristic.** The action's parent Item must be
    a `weapon`. A character's unarmed strike lives on `actor.system.attack`, so
    `config.source.item` is the *actor's* id and `actor.items.get` finds nothing —
    which is the right answer for free. The action is resolved the way
    `DHRoll.toMessage` resolves it: `system.actions` (an `ActionCollection`, so
    `.get` works) first, then `system.attack`, which is not a member of it.
  - Range is read off the **action**, so it is the Reach-adjusted derived value.
    `range-bands.ts` grew `withinActionRange`, which handles the two ids
    `RangeBand` excludes: `veryFar` has no threshold in
    `VariantRules.rangeMeasurement` at all — the system saying it does not run out
    inside a scene — so anything measurable is inside it, while `self` is a plain
    no rather than a null.
  - **The picker never shows Difficulty**, and deliberately does not filter on it:
    the same roll against a different Difficulty may miss, which is the gamble the
    feature is.
  - **Candidate visibility is `document.hidden` and nothing else** — the same
    filter `daggerheart-target-helper`'s candidate list uses, so the two agree
    about who exists. The first version of this file also excluded
    `token.visible === false` and anything flagged `invisibleToPlayers`, and
    **both were wrong**: at this table *every* GM-dropped token carries that flag,
    and the invisible-token feature exists precisely so those tokens stay
    targetable and measurable, so the filter offered players nothing, ever.
    `token.visible` fails the same way for an off-screen theatre-of-mind token.
    Do not re-add either. (`Token#distanceTo` also never returns `Infinity` on a
    gridless scene, whatever it looks like — it clamps *down* to `grid.distance`
    inside the adjacency buffer.)
  - **Every exit past the "is this actor's business" gate logs.** That gate
    (`holderOf`) is silent because it declines on nearly every roll in the world;
    everything after it — wrong action, no printed range, missed, not enough
    Hope, no token, each out-of-range adversary and its distance — says so at
    `console.debug`. A window that declines silently is undebuggable at the table,
    which is exactly how the `invisibleToPlayers` bug above presented.
  - `feature-prompt.ts` grew **`chooseUpTo`**, a second dialog shape: portraits and
    distances, nothing pre-ticked, and a hard cap enforced by disabling the
    unticked boxes once it is reached (re-capped in the callback, since the UI
    limiter is one client's DOM). Deliberately *not* folded into `chooseOffers` —
    that one asks "which of your features", where taking everything is the usual
    answer; this asks "which of these people", where nothing is a default. Its
    `waitWithTimeout` now takes an optional `onRender`, wired on the same `render`
    callback the timeout already uses.
  - The "is this actor's business" gate and the weapon-attack resolution both
    moved to `attack-action.ts` when Ranger's Focus needed them too; the local
    copies are gone. See that entry.
  - `resourceUpdatesFor`'s partner **`chargeCosts(actor, config, costs)`** moved
    into `feature-registry.ts` out of `blood-spike.ts`, which now calls it: fold
    into `config.resourceUpdates` when the roller is the payer, fall back to a
    direct `modifyResource` when no map exists. A cost that falls on someone *else*
    still goes direct — see `adversary-attack.ts`.
- **Ranger's Focus** (`src/daggerheart/rangers-focus.ts`) — the Ranger's (SRD)
  "Spend a Hope and make an attack against a target. On a success … temporarily
  make the attack's target your Focus", plus its three benefits.
  `Compendium.daggerheart.classes.Item.ncLx2P8BOUtrAD38`, a `feature` Item whose
  one action ("Spend Hope") charges the Hope and applies a changeless marker
  ActiveEffect to whatever is targeted — regardless of any attack, and regardless
  of whether one succeeded. World setting `rangersFocusTracking`, **on** by
  default, under **Classes → Ranger**. Shares the `attack` roll window with Hold
  Them Off and is registered **before** it.
  - **The ability drives the attack; it does not watch for one.** Press the card
    → the system charges the Hope → we ask which equipped weapon
    (`system.primaryWeapon` / `secondaryWeapon`, the same pair `crimson-rite.ts`
    reads) → that weapon's `system.attack.use(…)` is called **with nothing
    targeted** → `daggerheart-target-helper`'s guard picks the target within that
    weapon's range → ordinary roll, damage, and on a hit the Focus is set with no
    prompt at all. Weapon before target is not cosmetic: the range to filter
    candidates by does not exist until the weapon is chosen.
    - **The marker travels on the `event`, not in `configOptions`.** The Target
      Helper's guard cancels the attack and replays it as
      `action.use(config.event ?? null)` — it cannot carry `configOptions`,
      which the hook never exposed to it. A marker in the options survives the
      ordinary path and vanishes on the one that matters, silently. `{}` as an
      event is the system's own convention (its `useAttack` macro helper), so an
      object with one extra property is well within what the field expects.
    - **`patchCardTargeting` blanks the card action's `target.type` for the
      duration of one `use()`.** The SRD action declares `target.type: "any"`,
      which makes the *button* a targeted action — so the player picks someone
      before the weapon is known, with no range to filter by, and is asked again
      for the attack. It cannot be fixed from a hook: `config.hasTarget` is set
      inside `TargetField.prepareConfig`, which runs **before**
      `daggerheart.preUseAction` fires, and which of the two modules' listeners
      goes first is module load order (both register at `init`). So the flag has
      to be gone before the hook exists. Restored in a `finally`; nothing is
      written to the card.
    - **Two earlier shapes were wrong. Do not return to either.** (1) *Asking on
      every attack* — the card left alone, every single-target attack asking "is
      this a Ranger's Focus attack?" before the dice were revealed. Faithful to
      when the rule says the choice is made, and unusable: a ranger attacks
      constantly and almost none of those attacks are this one. The seam does
      make it possible (at `DHRoll.buildPost` the dice are evaluated but unseen,
      since DSN animates off the chat message and there is no message yet), which
      is what made it tempting — frequency beat fidelity. (2) *Targeting before
      the weapon*, which is what the `target.type` patch above exists to stop.
    - The only prompt left on an ordinary attack is the reroll, and its door is
      narrow by construction: the attack must have **failed**, against the
      creature that already **is** the Focus. That one does call `showDiceEarly`
      first — "when you fail an attack" is knowable only after the failure.
  - **`gm-effects.ts` is the general fix for "a player cannot mark an
    adversary"**, and the focused creature's own label is its first user. One-way
    socket request, handled by `isWriter`'s single GM. **The payload is a
    description of a mark, never effect data** — the GM's client builds the
    ActiveEffect from a fixed table keyed on `MarkKind`, so a malformed or
    hostile message can at worst place a labelled, changeless marker, never
    `changes`, `statuses`, a duration or a script. Same principle as
    `feature-ask.ts`: the wire carries intent, the receiver decides what it
    means. Applied directly, without the socket, when this client already owns
    the subject.
  - **The Focus lives on the ranger, not on the target**, as an ActiveEffect
    carrying `flags.eryndor-essentials.rangersFocus`. The SRD marks the target
    and that is the one thing that cannot be automated: an attack resolves on the
    *attacking player's* client, and a player may not create an ActiveEffect on
    an adversary. Everything else falls out of it — one Focus per ranger is one
    such effect, re-focusing is delete-then-create, and "until this feature ends"
    is the player deleting an effect on their own sheet. The GM is told who it is
    by a chat line, since the record is on the one sheet they are not looking at.
  - **`Actor#modifyResource` relays to the GM on its own** (it routes through the
    system's `emitGMUpdate`/`GMUpdateEvent.UpdateDocument`), which is why marking
    the Focus's Stress works from a player's client and needs no socket protocol
    here. `ActiveEffect.implementation.create` does **not** — the system's
    `EffectsField.applyEffect` calls it directly, so its own "players apply
    effects" automation *cannot work* against an adversary. Do not model a
    target-side effect on it. **This is observed, not theoretical**: the SRD
    card's own button raised `User Niamh lacks permission to create ActiveEffect
    […] in parent ActorDelta […]` at the table. Core's
    `BaseActiveEffect.#canCreate` is `doc.parent.testUserPermission(user,
    "OWNER")`, and ownership resolves ActorDelta → TokenDocument → the base
    Actor, so a *linked* adversary refuses it identically — the delta in the
    message is incidental. It succeeds for a GM, which is how it went unnoticed.
  - **The card's own action is taken over entirely** — `registerFocusCard`, two
    hooks, and *which* hook matters because the cost lands between them.
    `daggerheart.preUseAction` runs **before** `CostField`, so it is where every
    refusal goes (no target, several targets, nothing equipped): returning
    `false` aborts `use()` with the Hope unspent. It also clears
    `config.hasEffect` — the flag `EffectsField.execute` returns early on, and
    the config object is the one `executeWorkflow` is about to run — so the
    doomed effect write never happens. Suppressed for the GM too, so the button
    does one thing rather than two depending on who pressed it.
    `daggerheart.postUseAction` runs **after** the flush, so that is where the
    weapon is chosen and the attack made; a player who backs out of the weapon
    dialog there is told the Hope is gone, the same way `crimson-rite.ts` reports
    a spent Hit Point. Both hooks are synchronous, and `false` from either
    cancels the action — load-bearing in the first, a hazard in the second, where
    every path (including the `catch`) must return `undefined`.
  - **The Stress rides the shared `applyDamage` seam** (`damage-landing.ts`) as an
    `after` rule — the exact moment damage lands, shared by the workflow (order
    75) and the chat card's *Apply* button. This file used to own that wrapper;
    it was extracted when Blighting Strike became the second consumer. Two cheaper
    seams were rejected and should stay rejected: declaring a `stress` resource on
    the damage applies it to **every** hit target (`applyDamage` clones the damage
    per target but not its resources, so a Hold Them Off swing would mark all
    three), and the damage *roll's* seam is before anything is applied, so a table
    with apply-automation off would mark Stress for damage nobody took.
  - **Rerolling a Duality roll needs the dice presets carried over by hand.**
    `DualityRoll.buildPost` stamps them onto `roll.dice[0..2]` *before* calling
    `super.buildPost` (where the window runs), so a roll rebuilt with
    `createRollInstance` has never been through that and would animate in default
    colours. Copying `dice[i].options` across is what the system's own
    `DualityRoll#reroll` does. Its `liveRoll: true` path is deliberately not used:
    it also runs `updateResourcesForDualityReroll`, which is only correct *after*
    the Hope/Fear update has been applied, and at this seam it has not been.
    Known edge, documented in the file: `handleTriggers` afterwards is handed
    `DualityRoll.buildPost`'s own local `roll`, still the original — what triggers
    are *gated* on (`config.roll.result.duality`) is correct, but a trigger that
    inspects the Roll object sees the discarded one. **This lives in
    `roll-pipeline.ts` as `rebuildRoll(roll, config, message, label)`**, moved
    there when Adaptability became its second caller.
  - **"You know precisely what direction they are in" is deliberately not
    automated.** It grants no number; the honest implementation is the GM
    answering, and the effect's description carries the wording so it is on the
    sheet. Don't "fix" this with a marker or a compass.
  - **"An attack", not "an attack with a weapon"** — the wording differs from
    Hold Them Off's and the code has to. An unarmed strike and a Spellcast attack
    both count, so this window matches roll types `attack` **and** `spellcast`
    (`DHAttackAction.getRollType` returns the second whenever the action's parent
    is not a weapon) and then confirms the *action* is an attack, since a
    `spellcast` roll on its own does not say so.
  - `attack-action.ts` was extracted for this: `rollingCharacter` (the silent
    "whose roll is this" gate) and the action resolution were Hold Them Off's,
    and two copies of the seam-reading would be two things to keep in step with
    the system. It exposes both readings — `attackActionOf` (any attack, and the
    one place that knows an actor-level attack has no Item behind it) and
    `weaponAttackOf` on top of it (Hold Them Off's, which also insists on a
    printed range to measure). `feature-registry.ts`'s `findGrantingItem` is now
    exported for the same reason — a feature with a window of its own still
    matches its Item flag-then-compendium-then-name.
  - `feature-prompt.ts` also grew **`chooseOne`**, which `crimson-rite.ts`'s
    weapon picker was folded onto — the same question about the same list, and
    two copies would be two things to restyle. It is the only prompt there with
    **no timeout**, deliberately: the others are raised from inside
    `DHRoll.buildPost` with the table's chat card and resource updates waiting on
    the answer, while this one runs after an action has resolved, so an
    unanswered dialog costs nobody but the player.
    - Two forms. Plain buttons, or — when an option carries `img`/`tag`/`stat` —
      **rows**: artwork left, name over its tag, figure right. The row form is
      shaped after `daggerheart-target-helper`'s target picker on purpose, since
      the two appear back to back in one flow (pick a weapon, then pick who to
      hit with it) and two consecutive choices that look unrelated read as two
      unrelated features. Same measurements, **its own classes** — that module's
      stylesheet isn't loaded when it's off, and these rows have to survive that.
    - The rows are `<button>`s in the dialog's *content*, not DialogV2 buttons,
      because a DialogV2 button takes a plain label and these need structure. So
      the answer can't be the dialog's own result: a click records the choice and
      closes, and the recorded value is returned. One delegated listener reading
      `data-ee-choice` via `closest()` — one listener rather than one per row.
      (Core sets `button > * { pointer-events: none }`, so the click target is
      already the row; `closest()` costs nothing and doesn't depend on that.)
    - `attack-action.ts`'s `weaponOption(id, weapon)` builds the row for both
      callers; `id` is the caller's, because Crimson Rite answers in slots and
      Ranger's Focus in Item ids. The damage figure is
      `action.getDamageFormula()` — the same call the system's own `damageFormula`
      Handlebars helper makes for the weapon tooltip, already resolved against the
      actor's roll data, so what the player reads is what will be rolled.
  - `feature-prompt.ts` grew **`confirmChoice`**, a plain yes/no in the *window's*
    own words. Not `chooseOffers`'s single-offer branch, which looks identical and
    is asking a different question ("do you want to use this feature you hold",
    with the shared button strings and the card named in the body).
- **Gifted Tracker** (`src/daggerheart/gifted-tracker.ts`) — the Sage domain's
  (SRD) "spend any number of Hope and ask the GM that many questions … when you
  encounter creatures you've tracked in this way, gain a +1 bonus to your Evasion
  against them". `Compendium.daggerheart.domains.Item.VZ2b4zfRzV73XTuT`, a
  `domainCard` whose one `effect` action carries a **scalable** Hope cost
  (`scalable: true, value: 1, step: 1`) and an ActiveEffect. World setting
  `giftedTrackerEvasion`, **on** by default, under **Domains → Sage**. Registered
  on the `adversaryAttack` window as a **registry feature**, plus a card takeover
  of its own.
  - **What the SRD ships is wrong twice, and this replaces it rather than
    extending it.** Its effect is a flat `system.changes: [{ key:
    "system.evasion", type: "add", value: "+1" }]` applied through `EffectsField`
    to whoever is **targeted** — so using the card means selecting somebody (the
    only sensible choice being yourself), and what you get is a *permanent,
    unconditional* +1 Evasion against the whole world. Press it twice for +2
    forever. Turning the setting off restores that, not "nothing".
    - **"+1 against these particular creatures" cannot be an ActiveEffect.** It
      isn't a property of the character; it's a property of one attack. That is
      the whole reason this feature exists in the roll window at all, and why the
      recorded effect deliberately carries **no `changes`**. Don't "simplify" it
      back into a change.
    - Suppressed with `config.hasEffect = false` in `preUseAction`, exactly as
      Ranger's Focus does. Blanking the card's target would *also* stop it
      (`applyEffects` returns with no targets), but relying on that would make a
      display decision load-bearing for a mechanical one.
  - **Flow: press → Hope → describe → GM names it → recorded.** The Hope prompt
    is the system's own scalable cost dialog, untouched; `postUseAction` reads
    the answer back off `config.costs` (`CostField.calcCosts` writes `total =
    value + scale * step`), because that number is *also* how many questions the
    rule buys. Then the **player** describes the signs in free text — not the
    GM's job, and naming the creature here would answer the very questions the
    Hope paid for.
  - **The GM round-trip is one-way**, like `gm-effects.ts` and for the same
    reason: the GM's client already owns a player's actor, so having it write the
    record itself avoids a second socket hop and a reply the player's client
    would have to re-validate. No GM connected means nothing happens — the right
    answer for a card whose whole text is "ask the GM". Payload is descriptive
    only, validated on arrival, and the player's free text is escaped everywhere
    it renders (it lands on someone else's screen).
  - **`actor-picker.ts` searches the compendiums; it does not list them.** The
    SRD adversary pack alone is a few hundred entries before any third-party
    content, so an empty box shows only what's on this scene and in the world —
    small enough to render honestly — and typing (≥2 chars) reaches into every
    Actor pack, capped at 40 results with the overflow counted. **Selection lives
    in a `Map`, not in the DOM**, because filtering destroys rows: reading the
    answer off the form at submit would silently drop everything picked before
    the last search. Picked entries render as chips above the results, which
    doubles as the running total.
  - **Identity is a *set* of keys, not one uuid.** What the GM points at and what
    later attacks you are rarely the same document — the GM picks a compendium
    statblock, an unlinked token walks on carrying an ActorDelta whose uuid names
    a scene and whose name is "Minor Treant (2)". So `identityKeys` collects
    uuid, `_stats.compendiumSource` and name for **both** the attacking actor and
    the world actor behind it, and any one match counts. Same
    flag-then-compendium-then-name philosophy as `FeatureMatch`, name last for
    the same reason: it's the only thing that catches a hand-typed statblock and
    the only one that can over-match.
  - **The effect *is* the record** (`flags.eryndor-essentials.giftedTracker`),
    not a label beside a flag kept elsewhere — deleting it from the sheet is the
    "or you stop tracking them" the card never spells out, and two places to look
    would drift. One per ranger, like `rangersFocus`.
  - **Ending it is deliberately only half automated.** The card never says what
    ends a tracking, and losing the trail / giving up / the creature dying are
    table judgements with no honest event behind them — hanging it on a rest, a
    scene change or a distance would be inventing a rule. So the effect is left to
    be deleted by hand. The **one** moment the system can be certain is a ranger
    starting on fresh tracks, so pressing the card again replaces the previous
    tracking (`endTracking`) and the chat line names what was dropped, since
    silently losing an Evasion bonus you were counting on is the worst version of
    this. Replacement happens **only when a new tracking is actually recorded** —
    a GM cancelling the picker must not destroy what the ranger was already
    following. Readers still handle finding several, so a hand-built effect or one
    left by a half-failed delete is read rather than ignored.
  - The chat record is **whispered to the GM and the ranger's owners**, not the
    table: the quarry is a list of statblock names the GM has just chosen, which
    is a straight spoiler for anyone who hasn't met them — while the ranger has
    legitimately just been told the answers.
  - The Evasion bonus announces itself **only when it changed the outcome**. A
    tracked creature hitting for 18 against Evasion 12 would still have hit at
    13, and a message on every swing would bury the one that matters. Same
    judgement `evasionDecides` makes: don't spend the table's attention on a
    change that changed nothing.
  - **This is the first non-optional feature on the `adversaryAttack` window, and
    it exposed a latent ordering bug there.** The window applies non-optional
    features *before* prompting for optional ones, but `offersFor` had been
    called once, up front — so a +1 that turned the only hit into a miss would
    still offer I See It Coming's "mark a Stress for a d4" against an attack that
    no longer landed. Fixed in `adversary-attack.ts`: `raiseEvasion` now keeps
    `context.isHitTarget` live (it already re-decided `target.hit`), and the
    optional offers are re-asked after the non-optional pass. Keep both if you
    touch that loop.
  - **Known gap, by choice:** the bonus rides the `adversaryAttack` window, which
    handles the plain `D20Roll` an adversary makes. A tracked creature built on a
    `character` sheet rolls Duality and that window never sees it, so tracking
    another party's PC records the quarry but applies no +1. Reimplementing
    `raiseEvasion`'s difficulty precedence and hit/success recomputation for
    duality rolls to close it would be two copies of subtle logic; adversaries
    are what anyone tracks.
  - `feature-prompt.ts` grew **`askText`** for the description — a textarea with
    a hard `maxLength` that is re-applied to the returned value, since `maxlength`
    is one client's DOM and this text crosses a socket. Empty comes back as
    `null`, the same as cancelling: every caller has to handle "they backed out"
    anyway, and a blank answer means the same thing.
- **Vicious Entangle** (`src/daggerheart/vicious-entangle.ts`) — the Sage domain's
  level-1 spell, `Compendium.daggerheart.domains.Item.qvpvTnkAoRn9vYO4`. World
  setting `viciousEntangleRestrain`, **on** by default, filed under Sage beside
  Gifted Tracker.
  - **The card is built correctly, unlike the Void's.** Two actions: **Cast**, an
    `attack` with 1d8+1 physical and an embedded *Restrained* ActiveEffect
    (`statuses: ["restrained"]`, `system.duration.type: "temporary"`), and
    **Restrain Another**, an `effect` action charging 1 Hope with a second copy of
    the same effect. The first sentence of the card therefore needs no help at
    all: `EffectsField.execute` copies the effect onto every target whose
    `hitResult.success` is true. Do not reshape this card — there is nothing wrong
    with it.
  - **What is missing is the join.** "Restrain Another" does not know whether the
    Cast succeeded, does not know who it hit, and enforces "within Very Close
    range of your target" nowhere. It is also a *peer* of the Cast in the action
    chooser, so pressing the card asks which you meant before you have rolled the
    one that gates the other.
  - **A second `use()` is a second action, and the table is watching for
    actions.** This is the same trap the chained version of Blighting Strike fell
    into, and it is worth stating as a general rule: **anything that fires after a
    card has resolved must not run another action workflow.**
    `daggerheart-spotlight-tracker`'s guard sits on `daggerheart.preUseAction`; by
    the time a follow-up runs the spotlight has already left the caster, so the
    guard sees a player acting out of turn, **cancels the action** and raises a
    "request the spotlight?" prompt mid-card. `action-watch.ts` and Ginzzzu's
    Portraits watch the same events. Passing `actionType: "reaction"` in
    `configOptions` *would* silence both halves of the tracker (each checks it
    first), but it is a lie told to get the right behaviour by accident — a
    follow-up is not a reaction, and any module that later distinguishes them
    breaks.
  - **So the workflow is skipped and its two effects are done directly, read off
    the card.** The cost comes from the follow-up action's own `cost` array; the
    effect from its `effects` array, resolved against the Item exactly as
    `EffectsField.applyEffects` does (`item.applyEffects ?? item.effects`) and
    applied through `EffectsField.applyEffect` — which is the static
    `gm-action-effects.ts` wraps, so it still reaches an adversary the player does
    not own. Effects first, cost second (the system's own 100/150 order, and the
    charge is a local write that cannot really fail); nothing is charged if no
    effect was found. One chat line replaces the card the workflow would have
    posted.
  - **`cost.itemId` disqualifies the card outright.** Charging is this file's own
    job now, and it can only do the plain `actor.system.resources` kind;
    `CostField.getItemIdCostUpdate` resolves an item cost against a path this
    knows nothing about. A card carrying one keeps its chooser and its manual
    button and gets no automation at all — better than approximating a price.
  - **`config.targetUuid` is a supported override**, recorded here because it is
    the right tool for a *different* job: `TargetField.prepareConfig` checks it
    ahead of `game.user.targets` (`fromUuidSync(uuid)` then `actor.token ??
    actor.prototypeToken`), and `prepareBaseConfig` spreads `configOptions` in. So
    `action.use(event, { targetUuid })` aims a printed action at one actor without
    touching the user's targets — correct whenever running a full workflow is
    what you actually want. It wants an **actor** uuid; an unlinked token's
    `actor.uuid` is its ActorDelta's, which correctly pins to that token.
  - **If you ever do call `use()` by hand, pass `{ shiftKey: true }`, not
    `null`.** `DHBaseAction.applyKeybindings` and `requireConfigurationDialog`
    both read `config.event.shiftKey` unguarded, so a null event throws. A truthy
    `shiftKey` sets `dialog.configure = false`, which skips the cost dialog *and*
    makes `CostField.prepareConfig` return false — an outright refusal — when the
    resource is short. Without it the workflow proceeds and charges anyway.
  - **The chooser is answered at `ActionSelectionDialog.create`.** The system's
    `game.system.api.applications.dialogs` namespace is `Object.freeze`d, so the
    class is *reached* through it and the static is patched on the class itself.
    `Item#use` does its `isDomainTouchedSuppressed` check and builds `actionsList`
    before calling `create`, so wrapping `use` would mean reproducing both.
    Returning `Promise.resolve(action)` from the wrapper is enough; `Item#use`
    awaits it.
  - **Range is measured from the target, not the caster** — that is the whole
    content of the clause, and the caster may be a Far range from both. Where the
    Cast hit more than one, Very Close of *any* of them qualifies and the picker
    row names which. Unmeasurable distance means not offered, as everywhere else
    here; the manual "Restrain Another" button on the card sheet is the
    theatre-of-mind route and is deliberately left in place.
  - **Not a preparation patch.** Nothing is written into prepared data, so the
    setting needs no `onChange` reconciliation — unlike Blighting Strike, whose
    reshape has to be undone.
- **Commune** (`src/daggerheart/commune.ts`) — the Void's Witch class feature,
  `Compendium.the-void-unofficial.classes.Item.PKcnVdqacraEf8uL`. World setting
  `communeOracle`, **on** by default, filed under Witch in the Classes tab (the
  entry was a bare `fromVoid("Witch")` before this).
  - **The card is half-built, and the half it has is fine.** One `effect` action
    with `uses: 1 / longRest` and `chatDisplay: true`, no cost and no effects. So
    the once-per-long-rest tracking, the confirmation dialog (the system raises
    one because the action has `uses`) and the description card all already work.
    **Do not touch the use tracking** — duplicating it would mean two places to
    be wrong.
  - **What is missing is the whole oracle**: nothing rolls the d6s, nothing knows
    how many, nothing offers the choice between the faces, nothing brings the GM
    in. Four steps hang off `daggerheart.postUseAction`: roll, choose, post what
    the chart says, ask the GM.
  - **`actor.system.spellcastModifier` is the dice count.** It is the system's own
    "what is your Spellcast trait" — the highest of the traits your subclasses
    cast with, which is exactly what a Spellcast Roll adds. Reading
    `subclass.system.spellcastingTrait` by hand would be a second implementation
    of that rule and a wrong one for a multiclassed character. The formula is
    clamped before it is built: a number that reaches a roll formula unvalidated
    is how one bad Active Effect hangs a client.
  - **The chart is three lang strings here, not parsed off the card.** The card
    carries its bands as three `<li>`s inside `system.description`. Parsing them
    would be a guess dressed as a read — it breaks on a translation or a
    reformat, and it breaks *silently*, mapping a 6 to the wrong sentence. The
    consequence is stated in the setting hint: a table that rewrote those lines
    should switch this off.
  - **Only distinct faces are offered.** "Choose one value from the rolled
    results" — two 4s are one choice. An all-same roll still raises the prompt,
    showing its one option settled: the choice is made for the player either way,
    and a prompt that never appears leaves them unsure a question was ever asked,
    which reads as the feature not working. Faces come off
    `roll.dice[].results` (skipping `active: false`), never `roll.total`: the sum
    is the one number this roll has no use for. They are listed **low to high**,
    the order the card prints its chart in, so the prompt does not ask the reader
    to re-map a list they already have in front of them; the highest is still the
    one pre-selected, so the default sits at the bottom.
  - **`showDiceEarly` is called here too, outside the roll pipeline** — the first
    place that does. The picker must open on dice that have already landed, and
    the message route cannot give that: Dice So Nice animates *from* the message,
    `toMessage` resolves the moment the message is created, and nothing hands
    back a handle on the animation afterwards. Throwing them by hand and awaiting
    it is the only way to sequence the two, and the marker it leaves on the roll
    makes `registerDiceSuppression` stop the message throwing them again. It is
    given a **local** config object, not the action's: it writes `config.mute`,
    which belongs to the system's `toChat` running concurrently (`postUseAction`
    is not awaited), and a suppressed message has no dice sound to double anyway.
    The pipeline's "only safe from inside `buildPost`" caveat is about the
    appearance presets `DualityRoll.buildPost` stamps on before that seam; a plain
    `Roll` of d6s has none, so it does not apply.
  - `feature-prompt.ts` grew **`chooseFromRadios`**, the third shape of "which
    one?", sharing `ListRequest` with `chooseFromList` unchanged. The three now
    split by what the reader has to do: `chooseOne` gives each option a button
    (few options, each its own act — "primary weapon or secondary?"); a
    `<select>` shows one and hides the rest (a merely long list of self-evident
    entries with an obvious default — a count, a die size); radios show every
    option at once (each entry carries a *consequence* to be weighed against the
    others, which is exactly Commune's chart). A rendering flag on
    `chooseFromList` would have been fewer lines and wrong — the shapes here are
    named after the question they ask, and "which of these, having read them
    all" is not "pick a number".
    - **The answer is read with `:checked`, not off `form.elements`.** They look
      equivalent and are not: several radios yield a RadioNodeList whose `value`
      is the checked entry's, but a group of *one* yields the input itself, whose
      `value` is its own whether or not anybody ticked it. `:checked` also matches
      a **disabled** input, which is what lets the single-option case still be
      answered.
    - **A list of one renders, checked and disabled, rather than being skipped.**
      Baked into the helper rather than left to callers, because one option is
      never a choice for anybody. The disabling is presentational — a lone radio
      cannot be un-checked by clicking — and it is deliberately *not* dimmed to
      the usual disabled opacity: the reader is being shown the answer, not
      refused it.
  - `feature-prompt.ts` also grew **`showNotice`**, the one shape there that asks
    nothing. It exists because a feature whose result is decided on *somebody
    else's* client has no other way to put that result in front of the person it
    happened to. Its `body` is a separate field from `intro` on purpose: the body
    is always somebody's authored prose, so it is escaped into a quoted block and
    cannot be mistaken for the module's own sentence introducing it. Styled
    identically to `.ee-commune-answer` on the chat card, because it is the same
    words arriving by a second route and two appearances would read as two
    different things.
  - **The GM's half is fire-and-forget over the socket**, the shape
    `gifted-tracker.ts` established — `isWriter()` locally, `SOCKET_EVENT`
    otherwise, one dialog even with three GMs logged in. The payload carries only
    a **message id**; everything the dialog says is re-read from that message's
    `FLAGS.commune` flag, and a message without the flag is refused. That refusal
    is the trust boundary: without it an arriving payload could steer a GM's
    client into rewriting any chat message in the log.
  - **The reply goes back the other way, and carries the words rather than an
    id.** The card holding the answer is not enough on its own — a chat card can
    be scrolled past, and at a table playing with the log collapsed it will be —
    so the answer is *delivered* to whoever pressed the card, as a `showNotice`
    dialog. The asymmetry with the request is deliberate and worth keeping: that
    direction can make a GM's client **write**, so it names only an id and
    re-reads everything from the flag; this one can only make a player's client
    **display**, where the worst a forged payload achieves is a dialog of escaped
    text any player could have typed into chat — while re-reading the flag here
    would instead race the update that has only just been broadcast. The text is
    still capped at the same limit the GM's own box enforces.
  - **`askedBy` is recorded on the flag, not taken from `message.author`.** They
    are the same user today and they answer different questions; "who asked the
    spirits" and "who created this chat message" come apart the moment anything
    else posts the card. A GM communing on a character of their own is skipped —
    they typed the words a moment ago.
  - **The flag is the record, not the markup.** `cardMarkup()` rebuilds the card
    from `{ name, value, answer? }`, so the GM's answer replaces the content
    rather than being appended to whatever HTML happens to be there — which is
    what keeps a second answer from stacking.
  - **`postUseAction` fires before `toChat`,** so in principle these messages
    could land above the card that explains them. They do not: `Hooks.callAll`
    does not await, so `use()` runs straight on into `toChat` while the first
    `await` here is still pending. Worth knowing, not worth defending against.
  - **`target.type: "any"` is suppressed** through `card-targeting.ts`, the same
    leftover Gifted Tracker has: there is nothing on the scene to target when you
    are asking a spirit a question, and the declaration would otherwise make
    `daggerheart-target-helper` open a picker first. (Nyx's own copy has already
    been edited to `self`; a fresh import from the Void pack has `any`.)
  - **Deliberate silences.** The player's question is not asked for — it is
    spoken at the table, and a text box would put transcription in front of a
    conversation. "During a moment of calm" is not enforced; nothing on a sheet
    knows whether the moment qualifies. A GM who dismisses the answer box is not
    chased: narrating it aloud is a legitimate answer.
- **Witch's Charm** (`src/daggerheart/witchs-charm.ts`) — the Void's Witch class
  feature, `Compendium.the-void-unofficial.classes.Item.uBQT6rw7mFJubv7e`. World
  setting `witchsCharm`, **on** by default, filed under Witch beside Commune.
  - **What the card ships.** One `effect` action, "Spend Hope", whose only
    content is `cost: [{ key: "hope", value: 3 }]`. `effects` is empty and there
    is no trigger, so pressing it takes the price and converts nothing — and it
    could not, because the roll it is about has already posted by the time anyone
    can reach the button. The card is left exactly as it is, and stays the manual
    fallback when the setting is off or the roll was never scored.
  - **A window of its own, not a registry entry.** `feature-registry.ts` looks a
    feature up on `context.actor`, and this card belongs to somebody *watching*
    the roll. Nothing else in the game so far reacts to an ally's failed action
    roll, so a new `FeatureWindow` would have exactly one occupant. Same shape as
    `blood-spike.ts` and `hold-them-off.ts`: one file, one `registerRollWindow`.
  - **The seam is `duality-outcome.ts`'s**, for the same reasons — before the
    chat message, the Fear countdowns, the Hope/Fear grant and the `dualityRoll`
    /`fearRoll` triggers. Registered immediately after `registerDualityOutcome()`
    and before every window that only *reads* a result; Blood Spike in particular
    asks whether the cast hit, which is the answer this changes.
  - **The success is written onto the number, not onto a flag.**
    `config.roll.success` is `roll.options.roll.success` (the system passes the
    config in as the Roll's `options`), so setting it is what the card renders
    from and what persists. Targets are the harder half: `TargetField.execute`
    and `DhRollMessage#_getCurrentTargets` both **re-derive** the hit from
    `difficulty || evasion` against the roll total, on every render — so the
    target's number is lowered to the roll's own total, the mirror image of
    `i-see-it-coming.ts` raising Evasion to make an attack miss. The card prints
    Hit or Miss and never the number behind it, so the change is invisible.
  - **The Fear half is `setRollDuality`**, exported from `duality-outcome.ts` for
    this — the persisted `eeDualityOverride` marker and the two patched getters
    already live there, and a second copy would be one more thing to keep in step
    with `withHope`/`withFear`. A roll that already failed *with* Fear is left
    alone rather than overridden to the value it already holds.
  - **Who is asked.** Every character holding the card who can pay and is close
    enough — the roller first ("you" needs no measuring), then everyone on the
    scene in name order, one at a time, **stopping at the first yes**. One charm
    turns one failure into one success; two players paying 3 Hope for it would be
    worse than a prompt nobody wanted. The 3 Hope is charged with
    `modifyResource` on the witch directly, never through `config.resourceUpdates`
    — that map belongs to the roller.
  - **Deliberate silences.** A roll the system never scored raises nothing:
    `config.roll.success` is only filled in when there was a Difficulty entered or
    a target with a number to beat, and reading its absence as a failure would put
    a prompt on a witch's screen after every unscored trait roll at the table.
    Unmeasurable range means no, as everywhere else here. Reaction rolls are not
    action rolls — the system says so itself by withholding Hope and Fear from
    them. A multi-target roll that succeeds now hits every target, which costs
    nothing to reason about because it only read as a failure by missing all of
    them.
- **Hex** (`src/daggerheart/hex.ts`) — the Void's Witch class feature,
  `Compendium.the-void-unofficial.classes.Item.4iy45CFDxqDrb5QN`: "when a
  creature causes you or an ally within Close range to mark any number of Hit
  Points, you can mark a Stress to Hex them. Action and damage rolls against a
  Hexed creature gain a bonus equal to your tier." World setting `hexCondition`,
  **on** by default, filed under Witch beside Witch's Charm.
  - **What the Void ships is right as far as it can go.** One `effect` action,
    "Mark Stress", charging 1 Stress and applying an embedded ActiveEffect named
    "Hex" whose `system.changes` is empty. The card is left entirely alone,
    button and effect both. The empty `changes` is not an oversight: *"a bonus to
    rolls made against this creature"* is a property of one roll, not of any
    character, so no ActiveEffect can carry it — the same wall Gifted Tracker
    documents and for the same reason.
  - **The trigger needs two seams, because neither half knows the other's
    answer.** *How many Hit Points were marked* is only settled after
    `Actor#takeDamage` has run resistances, thresholds and the armour-slot
    dialog, which is what `daggerheart.postTakeDamage` reports. *Which creature
    caused it* is not in that hook at all — `takeDamage` is told about damage,
    never about who threw it — and lives one level up in the action config
    (`config.source.actor`). So a `before` rule on `damage-landing.ts` writes down
    who is about to hurt whom, keyed on the actor uuid, and the `postTakeDamage`
    handler reads it back and deletes it. Entries are swept after a minute rather
    than seconds: the armour-slot query between the two seams has a thirty-second
    timeout of its own. Damage nobody applied — a GM typing a Hit Point onto a
    sheet — has no attacker attached and deliberately raises nothing.
  - **The bonus needs two more seams, because the system builds the two rolls
    differently.** Neither writes anything to a sheet: the bonus is recomputed
    from the hex every time a roll is built, so lifting the hex un-applies it with
    nothing to reconcile.
    - **Action rolls** ride `daggerheart.preRoll` into
      `config.roll.baseModifiers`, which `D20Roll.applyBaseBonus` deep-clones as
      its first act and `DualityRoll` inherits — so one hook covers an
      adversary's d20 and a character's Duality roll alike. It has to be that
      hook and not `postRollConfiguration`: `D20Roll`'s **constructor** calls
      `constructFormula`, so the formula is already built by the time the later
      one fires. The entry is labelled, so it shows in the roll dialog and in the
      card's breakdown rather than arriving as an unexplained number.
    - **Damage rolls** wrap `DamageRoll.temporaryModifierBuilder` — the system's
      own bucket for a per-roll bonus that is not an ActiveEffect, where Rally
      dice, Massive, Brutal and Serrated already live, and which renders in the
      damage dialog's **Modifiers** fieldset as a ticked checkbox. Wrapping is
      necessary rather than tidy: that builder ends with `config.modifiers =
      mods`, replacing the object wholesale, so anything a `preRoll` listener put
      there is discarded a few lines later. Several hexes collapse into one entry,
      because the damage is rolled once however many creatures it is aimed at.
    - `config.roll` is what tells the two apart. `RollField.prepareConfig` builds
      it with a formula and no total; `buildEvaluate` replaces it with the
      finished result. A config whose `roll.total` is a number is an evaluated
      roll being carried into the damage step, and the action-roll hook leaves it
      alone. Ours are also tagged and stripped before being re-added, so a roll
      rebuilt or re-configured ends up with one of each rather than two.
  - **The hex lives on the hexed creature** as the `gm-effects.ts` marker,
    flagged `FLAGS.hex` with the witch's uuid. The effect *is* the record; there
    is no second copy. This is Tethered Talisman's shape rather than Ranger's
    Focus's, and the difference is the point: the Focus record has to sit on the
    ranger because the bonus is the ranger's, while here the bonus belongs to the
    creature and every roll in the party reads it. Keyed by witch, so two Witches
    can hex the same adversary and each contributes her own tier — read live off
    her sheet, so a level-up applies to a hex already standing.
  - **Ending it is two-thirds automated, and the missing third is deliberate.**
    Hexing again lifts the previous hex, found by the same `game.actors`-plus-
    current-scene scan Tethered Talisman uses. The GM's clause is a button on the
    announcement card, drawn for the GM only, spending Fear equal to the witch's
    Spellcast trait — read live when it is pressed, because the rule names the
    trait and not the number it had that evening, and refused with the shortfall
    named when there is not enough. "Otherwise, remove it when the scene ends" is
    **not** automated: a Daggerheart scene is a fiction boundary, not a canvas one
    and not a combat, so hanging it on `canvasReady` or on an encounter ending
    would invent a rule and silently lift a hex the table still counts. The
    effect's description says when to remove it; deleting it is one click. Same
    judgement Gifted Tracker makes about "until you stop tracking them".
  - **Every eligible witch is asked, and the first yes does not settle it** —
    unlike Witch's Charm, where one rescue is one rescue. Two Witches each spend
    their own Stress and place their own hex, and the rule gives neither
    precedence. The person hurt is asked first when they hold the card, since
    "you" is the clause with nothing to measure. One attack that hurts three party
    members reaches the handler three times, concurrently, so the claim on a
    witch's attention is taken synchronously before the socket call — each witch
    is asked once per damage application, not once per casualty.
  - **Deliberate silences.** Damage that marks no Hit Points raises nothing,
    including a hit that marks only Stress. Nobody hexes their own doing — a
    creature that hurt itself, and a witch asked about damage she caused, are both
    skipped. Unmeasurable range means no, as everywhere else here. Reaction rolls
    gain nothing (they are not action rolls); damage is *not* filtered that way,
    since "damage rolls against a Hexed creature" is unqualified. Healing never
    gains it. One damage roll serves every target it hit, so a swing that catches
    a hexed creature and an unhexed one adds the bonus once, to both — which is
    the system's own arithmetic, and is why the modifier is left tickable.
- **Herbal Remedies** (`src/daggerheart/herbal-remedies.ts`) — the Hedge Witch
  subclass's foundation feature,
  `Compendium.the-void-unofficial.subclasses.Item.pYtLdnmhKmVtxsIM`. World setting
  `herbalRemedies`, **on** by default, filed under Witch in its own
  `HedgeWitchLegend` group (same rule as Beastbound under Ranger).
  - **Nothing is built on the card, and nothing could be.** `actions: {}`,
    `resource: null`. The rule fires on somebody else's button — whichever
    consumable happens to get drunk — so there is no action to derive and no
    prompt to raise. One number changes, in the one place it is still changeable.
  - **The +1 goes on the formula, before the roll.** `DamageField.formatFormulas`
    is wrapped at `setup` (`game.system.api.fields.ActionFields.DamageField` — the
    same object `damage-landing.ts` patches, a different method). It returns a
    fresh array of `{ formula, applyTo, fullRestore }` on every call, already
    merged by `applyTo` and stored nowhere, and it is called with the *action* as
    `this`, which is what lets the rule tell a consumable's healing from any
    other. `" + 1"` is appended to the string: these are additive expressions
    (`1d4`, `1d4 + 2`, `@system.resources.stress.max`), so the shape being
    extended does not matter.
  - **Why not the three other seams.** `daggerheart.preTakeHealing` is the most
    literal reading of "the number cleared" and hands over a plain
    `{ key, value }[]` — by which point `Actor#parseDamageArgs` has discarded
    where the healing came from, so there is no consumable left to recognise (the
    same wall `blighting-strike.ts` hit with `preTakeDamage`). `applyDamage`
    (`damage-landing.ts`) still knows the source and runs after the card is
    posted, so the card would read 2 while the sheet moved 3. Writing
    `roll._total` has that problem plus dice that no longer sum to their own
    total.
  - **`system.bonuses.healing` is a dead field.** Declared on the character
    schema, read nowhere in the 2.7.2 bundle: `DamageRoll.applyBaseBonus` returns
    early for anything with `hasHealing`, and `constructFormula` consults
    `config.modifiers` only for the main damage part, never for a resource. No
    ActiveEffect can reach a healing formula — don't go looking for one again.
  - **Healing consumables never auto-apply.** Every one the SRD ships has
    `target.type: ""`, so `applyDamage` returns with nobody to apply to and the
    number gets read off the card and marked by hand. That is the argument for
    raising the formula rather than the applied total: at most tables the reading
    *is* the applying.
  - **Only `hitPoints` and `stress`, and never a `fullRestore`.** Hope (Varik
    Leaves) and Armor Slots (Armor Stitcher) are not what the card names, and a
    full restore has no number to raise — the system swaps its formula for `"0"`
    and clears the resource off the flag instead. Consumables that *deal* damage
    (Dripfang Poison, the Arcane Shards) are kept out by `hasHealing`, which is
    false unless `action.type === "healing"`.
  - **"You or an ally" is read loosely on purpose**: the user is a `character`,
    and some `character` in the world has the card. "Assigned to a player" and
    `hasPlayerOwner` both fail where the GM owns every sheet; "same scene" fails
    between sessions, which is when potions get drunk. Said out loud in the
    setting hint, including the case it gets wrong (a rival party in the same
    world). The check reads *who used it*, not who is healed, and cannot do
    otherwise — a consumable declares no target, so at formula time there is no
    recipient yet.
  - **The world scan is uncached**, deliberately: a few times a session against a
    list matched in microseconds, versus a cache needing invalidation on item
    create/delete, actor import and compendium sync.
  - **Deliberate silences.** A consumable clearing both Hit Points and Stress
    (none ship) is raised on each — the card does not say which number when there
    are two. "Clear *one or more*" is not enforced, since the raise happens before
    the roll; no shipped formula can come up zero. Nothing is added to the chat
    card: the bonus shows as the system's own `+1` modifier chip, and the healing
    is folded into the *action's* existing message, so there is not even a
    document of ours to flag.
- **Tethered Talisman** (`src/daggerheart/tethered-talisman.ts`) — the Hedge
  Witch subclass's second feature,
  `Compendium.the-void-unofficial.subclasses.Item.UeY92YRyTAeTPnam`. World
  setting `tetheredTalisman`, **on** by default, filed under Witch in the same
  `HedgeWitchLegend` group as Herbal Remedies.
  - **What the card already does, and is left doing.** One `effect` action,
    "Tether": `target: { type: "any" }`, `uses: { max: "1", recovery:
    "shortRest" }`, `effects: []`. The press, the target and the once-per-rest
    bookkeeping are all the system's — `UsesField` refuses the second press by
    itself — so none of it is reimplemented. Only the three things the card can't
    do are here: imbuing something, asking when the holder is hit, and warning
    before a second talisman cancels a first.
  - **No talisman Item.** The talisman is an ActiveEffect on the holder, flagged
    `FLAGS.tetheredTalisman` with the witch's uuid, placed through
    `gm-effects.ts` (the holder is usually somebody else's character, and core
    requires OWNER of the parent to create an ActiveEffect). The effect *is* the
    record — spending it deletes it, deleting it by hand calls the feature off,
    and its absence is what lets another be imbued. Keyed by *witch*, not holder,
    so two Hedge Witches can tether the same person.
  - **The reduction is on the marks, not the damage.** Thresholds mean the two
    are not interchangeable: against a Major of 8, 8 damage marks 2 and 7 marks
    1, so the same subtraction is worth a whole Hit Point at one number and
    nothing at another. So it rides **Damage marking** (below), which hands it
    the finished `{ key: "hitPoints", value }` entry — after resistances,
    thresholds and the armor-slot dialog — and it takes one off before the write.
    Its `wants` is "is this actor carrying a talisman", which is what keeps the
    seam off everybody else.
  - **Why not healing it back.** Applying and then healing a point back is not
    merely cosmetic: marking your last Hit Point is a death move, so a character
    taken to zero and quietly refilled has already had the system's attention.
  - **It holds the damage open, on the system's own precedent** — see **Damage
    marking**. The wait only ever happens when a live talisman is on the person
    who was actually hit.
  - **The witch is asked, not the person hit.** `responderFor(witch)`, falling
    back to the client running the damage when nobody who owns her is connected.
    Spending the talisman is her decision and the only interesting one in the
    feature; a player about to mark two Hit Points always says yes.
  - **Replacing is a warning, not a refusal.** Raised from `preUseAction` —
    before the use is spent — by returning `false` and replaying the press with
    `event.eeTetheredTalisman` on a yes, the same cancel-and-replay
    `rangers-focus.ts` hands to the Target Helper. A synchronous hook cannot
    await a dialog, and asking after the use would be asking after the cost. The
    no-target refusal is raised there too, for the same reason: `prepareConfig`
    has already run when `preUseAction` fires, so the target is known while the
    press is still free.
  - **Deliberate silences.** A hit that marks no Hit Points raises no prompt and
    spends nothing. Stress is never reduced, and a Stress-only hit does not ask.
    Direct damage is included — it bypasses armor, not talismans. The world scan
    for an outstanding talisman covers `game.actors` plus the current scene's
    unlinked token actors; one on an unlinked token on another scene is not
    found, and the only cost is a warning that stays quiet.
- **Companion** (`src/daggerheart/companion.ts`) — the Beastbound subclass's
  foundation card, made pressable. World setting `companionCommands`, **on** by
  default, filed under Ranger with its own `BeastboundLegend` group (same rule as
  Hybrid Form under Blood Hunter: a subclass has nowhere of its own).
  - **What the system leaves broken.** The Companion card is
    `featureForm: "passive"` with `actions: {}` — clicking it posts prose. The
    rule that matters ("Make a Spellcast Roll to connect with your companion and
    command them to take action") lives on the *companion's* sheet, split across
    two buttons each holding half of it: the companion sheet's action roll does
    it correctly (`partner.diceRoll`, spellcast trait, `companionRoll: true`, so
    the ranger rolls and the dialog offers the companion's Experiences at a Hope
    each) but points at nothing; the companion's **attack** is rolled *by the
    companion* — `rollClass` returns `DualityRoll` for `companion` too — with the
    partner's spellcast modifier pasted on as a flat "Bonus to Hit". The number
    matches; nothing else does. Hope and Fear land on an actor with no Hope
    resource and none of the ranger's roll bonuses apply.
  - **The ranger rolls; the companion reaches.** Two actions are built on the
    *ranger*, parented to the Companion feature Item. `roll.type: "spellcast"`
    makes `DHActionRollData#rollTrait` return `spellcastModifierTrait.key`, so it
    is genuinely a Spellcast Roll; `action.actor` is the ranger, so
    `resourceUpdates`, Hope/Fear and every `system.bonuses.roll.*` are hers.
    `DualityRoll#applyBaseBonus` adds both `roll.spellcast` and (because the
    attack has damage) `roll.attack` bonuses — verified, that is the "any bonuses
    the character would get" half of the ask.
  - **Range is the one thing that decision costs**, and it is paid across the
    repo boundary: `daggerheart-target-helper` measures from `action.actor`'s
    token, so this file is the first caller of its new
    `api.registerRangeOrigin` (routed through
    `integrations/target-helper-survey.ts`, which is still the only place here
    that talks to that module). Only the *distance* moves — grouping and the
    disposition filter stay with the ranger. Without that module nothing gates
    range for anybody, so the fallback is the system's own behaviour.
  - **Injected into `item.system.actions`, not `actionsList`.** Not cosmetics:
    the system resolves an action back from `config.source.action` through
    `item.system.actionsList` in two places that both matter — `D20RollDialog`'s
    constructor and the chat message's `actionItem` (how a damage button finds
    what it is rolling for). Being in the collection also gets `usable`,
    `Item#use`'s native `ActionSelectionDialog`, the per-action buttons the
    `inventory-item-V2.hbs` partial already renders, and `fromUuid` resolution
    via `getEmbeddedDocument("Action", …)` — all for free. The `_id`s are fixed
    (`eeCompanionAtk01`, `eeCompanionCmd01`, sixteen alphanumeric characters
    because that is what `DocumentIdField` accepts) so a chat card from last
    session still resolves.
  - **Same seam as Reach** (`Item#prepareEmbeddedDocuments`), same reasoning:
    nothing is written to the database, so the rule un-applies itself — switch
    the setting off or unbind the companion and the next preparation deletes both
    actions. `reconcileCompanionCards` exists for the setting changing
    mid-session, exactly like `reconcileReach`.
  - **`registerCompanion()` goes after `registerReach()` in `module.ts`,** so our
    patch wraps theirs and runs last. Both touch the same method, and Reach
    rewrites the derived range of every action the actor can use — which would
    otherwise promote a Giant ranger's companion's Melee bite to Very Close
    because the *partner* has long arms. The cached ranges are re-asserted on
    every pass so the answer doesn't depend on how many times the item happened
    to be prepared.
  - **The Command roll is an `attack` action with no damage and no target**,
    which is not a fudge: `hasDamage` tests `damage.main`, and
    `TargetField#prepareConfig` returns early on a null `target.type` without
    setting `hasTarget`. There is no bare "roll" action type, and this keeps both
    options on one well-trodden workflow. Its `null`-free fallbacks matter —
    `range` is a blank-allowing StringField and `target`/`damage` are
    non-nullable SchemaFields.
  - **`companionRoll` is set on `preUseAction`, not baked into the action.**
    `RollField#prepareConfig` replaces `config.roll` wholesale, so anything
    written earlier is gone; that hook is the first and only moment. It is the
    entire Experience half of the rule — the dialog reads `config.data.companion`
    (the ranger's roll data resolves it through `ForeignDocumentUUIDField`, which
    initializes to a lazy getter, so world-load order is not a problem) and adds
    a 1 Hope cost per Experience, charged to the ranger because she is the acting
    actor. `CostField.order` is 150 against `RollField`'s 10, so a cost the
    dialog added is still applied.
  - **Deliberately not automated:** "on a success with Hope, if your next action
    builds on their success, you gain advantage". The condition is a judgement
    about the *next* action. A success with Hope posts a public note and stops
    there. `roll.success` is left `undefined` by `buildEvaluate` when there is
    neither a target nor a difficulty — the Command roll's normal case — so only
    an explicit `false` stands the note down.
- **Close-Knit** (`src/daggerheart/close-knit.ts`) — the Hearthborne community's
  (*Void for Daggerheart*) "Once per long rest, you can spend any number of Hope
  to give an ally the same number of Hope." World setting `closeKnitShareHope`,
  **on** by default, filed under Hearthborne in the Communities tab.
  - **The Void ships nothing** — `featureForm: "passive"`, `resource: null`,
    `actions: {}`. Worth knowing *why*, because two of the card's three clauses
    are natively expressible and the SRD uses both: "spend any number of Hope" is
    a **scalable cost** (`{ key: "hope", value: 1, scalable: true, step: 1 }`),
    which `CostField.calcCosts` turns into a slider capped at
    `maxStep = floor((max - value) / step)` and which `requireConfigurationDialog`
    shows for any costed action with no roll; "once per long rest" is
    `uses: { max: "1", recovery: "longRest" }`, exactly as Weapon Specialist
    declares its Slayer Dice reroll. The third clause is the one the schema cannot
    say — the only way to move a resource onto *somebody else* is a `healing`
    action, which needs a declared target, a targeted token on the canvas, and a
    trip through `DamageField.execute`'s damage-roll dialog.
  - **One derived `effect` action, and two house prompts behind it.** `effect`
    rather than `base`: `base` is in `actionsTypes` but has **no** entry in
    `CONFIG.DH.ACTIONS.actionTypes`, so its icon and tag resolve to `undefined`.
    `effect` is what the SRD itself uses for this shape (Adaptability's "Mark
    Stress", No Mercy's "Spend Hope"). With `effects: []` and `target.type: null`
    it does nothing on its own — `EffectsField.execute` returns early on
    `!config.hasEffect`, `TargetField#prepareConfig` on a null target type. One
    action on the card also means `Item#use` runs it directly rather than raising
    `ActionSelectionDialog`, so clicking the feature *is* the button.
  - **The cost is deliberately not declared on the action.** A native scalable
    cost is charged by `CostField.execute` (workflow order 150) long before
    `postUseAction`, so it would take the Hope and *then* ask who receives it —
    leaving a refund to write for every way a player can close a dialog. Asking
    both questions first means there is no half-state to undo. `chatDisplay:
    false` for the same reason: what goes to chat is the announcement, once the
    Hope has actually moved.
  - **The Hope moves by `Actor#modifyResource`,** which relays through
    `emitGMUpdate` — this is the same path that lets a player mark an adversary's
    Stress, and it is why a player can add Hope to a character they don't own. Note
    `emitAsGM` sends *every* non-GM change over the socket, including a character's
    changes to their own sheet, so with no GM connected **neither** half would land
    while the marker and the chat line (written by this client) would. Hence the
    `game.users.activeGM` gate in `refusal()`.
  - **The rest limit is an ActiveEffect, not the action's `uses`,** and that is
    forced by the action being derived: `UsesField.execute` records a use with
    `action.update({ "uses.value": n })` → `item.update({ "system.actions.<id>":
    … })`, a database write describing an action that only exists while this
    module is installed, and `RefreshFeatures` would write to the same place. So
    the marker is an effect with `system.duration.type = "longRest"`, the
    mechanism `crimson-rite.ts` already uses; `expireActiveEffects` clears it at a
    long rest and a GM can delete it by hand. `autoExpireActiveEffects` being off
    is a **worse** failure here than for Crimson Rite (a card that never comes
    back, rather than a rite that never ends), hence the warning at activation and
    the how-to-clear-it line in the effect's own description.
  - **Third patch on `Item#prepareEmbeddedDocuments`** after Reach and Companion,
    and the only one with no ordering to respect. Same reasoning as both: nothing
    is written to the database, so the rule un-applies itself, and
    `reconcileCloseKnitCards` exists for the setting changing mid-session. **Four**
    file-local copies of that prototype-patch helper now exist (Attack of
    Opportunity is the fourth) — a standing extraction candidate, deliberately not
    taken while all of them are working, since it would touch the two patches
    whose *ordering* carries a rule.
  - **Two house prompts rather than a bespoke dialog**: `chooseOne` rows for the
    ally (portrait, name, their Hope over their max), then `chooseFromList` for
    the amount. Neither has a timeout, because nothing is being held back while
    they are open.
  - `feature-prompt.ts` grew **`chooseFromList`**, a `<select>` with confirm and
    cancel. The amount started as `chooseOne`'s buttons and a row of six
    identically-shaped "N Hope" buttons reads as a wall rather than as a choice —
    the split is *few options each deserving weight* (buttons) against *a merely
    long list with an obvious default* (dropdown), the same call the system's own
    roll dialog makes for advantage. It opens on the recipient's headroom, the
    largest amount that would not be wasted. Reading the value off the form at
    submit time is safe here in a way it is not in `actor-picker.ts`: nothing
    filters this list, so the chosen `<option>` is still in the document.
  - **The ally list** is every other `character` assigned to a user, plus any on
    the current scene, falling back to the whole actor directory only if both come
    up empty — a world with a party shouldn't have to scroll past retired ones.
  - **Deliberately not clamped to the recipient's headroom.** The card says "any
    number"; `modifyResource` caps the receiving end, so overspending spends it
    all. The headroom is shown while choosing and the overspill is said out loud
    afterwards rather than silently swallowed.
- **Brave Face** (`src/daggerheart/brave-face.ts`) — the Warborne community's
  (*Void for Daggerheart*) "Once per session, when an attack would cause you to
  mark a Stress, you can spend a Hope instead."
  `Compendium.the-void-unofficial.communities.Item.KrqCfjp4E1r10XQr`, shipped as
  description only — no action, no resource, no effect. World setting
  `braveFace`, **on** by default, filed under Warborne in the Communities tab.
  - **There is nothing to press, and that is correct.** The rule has no moment a
    player could press it *at*: it fires inside somebody else's attack, after the
    damage is worked out and before the sheet is written. So this is the first
    feature here with no card takeover of any kind — one rule on
    `damage-marking.ts` and one on `damage-landing.ts`, and the card is left
    exactly as the Void ships it.
  - **The Stress is never marked, rather than marked and cleared**, and that is
    the whole reason the seam is where it is. `Actor#convertStressDamageToHP`
    turns an unmarkable Stress into a Hit Point, and it runs *inside*
    `modifyResource` — after this rule has had its say. So a character whose
    Stress track is already full is exactly the one Brave Face saves, which is
    what the rule is for; marking and refunding afterwards would take the Hit
    Point and hand back the Stress.
  - **The once-per-session use is the card's own `system.resource`** — `max: 1`,
    `increasing`, `session` recovery. Slayer's mechanism and all of its
    reasoning: it puts a counter on the card's row in the Features tab so the use
    is visible and correctable, and the system's own end-of-session refresh
    clears it, so no part of the reset is this module's to get wrong. Written
    *whole* by `reconcileBraveFaceCards` at `ready` from the single `isWriter`
    client — see `slayer.ts` on why a partial write into a nullish `SchemaField`
    is the one shape to avoid.
  - **The use is spent through `modifyResource`'s item-cost path**
    (`{ key: "resource", itemId, target }`), not by updating the card, because
    that path relays through a GM via `emitGMUpdate` — and the client running
    this is whoever applied the damage, which for an ally's area attack is
    another player who cannot write to Finnegan's sheet.
  - **Stress the player chose to spend is not Stress an attack caused.**
    `takeDamage` merges the armor-slot dialog's `stressSpent` into the very same
    `{ key: "stress" }` entry, so by the seam the two are indistinguishable.
    Hence the recorded `Attack.stress`, read off `config.damage.resources.stress`
    on the `damage-landing.ts` `before` rule: the swap can never take more than
    the attack brought, and a hit whose Stress is entirely the player's own
    raises no prompt. That recording is also what keeps `wants` from interposing
    on the overwhelming majority of hits — 42 of the SRD's adversary actions
    carry a Stress damage part, and nothing else does.
  - **"An attack" is read as an action's damage landing on you**, deliberately
    not narrowed to actions that made an attack roll: an environment's damage is
    an attack to everyone at the table, and narrowing would fail *silently* — the
    offer simply would not appear. The cost of the wide reading is an offer that
    can be declined. **"A Stress" is one**; an attack marking two leaves one
    marked, since taking the lot for a single Hope would be the more generous
    invention.
  - **The person hit is the one asked**, which is the only reaction here that
    goes to them rather than to somebody watching — the Stress is theirs to take
    and the Hope theirs to spend, so there is no third party with an interest.
  - **Deliberate silences.** Stress from pressing your own card, typed onto a
    sheet by the GM, or applied by a macro that never went through `applyDamage`
    raises nothing. Healing is skipped first. A `fullRestore` entry ("mark all
    your Stress") is left alone — a different rule with a different arithmetic.
    The use is neither refunded nor consumed on a decline.
- **Not Good Enough** (`src/daggerheart/not-good-enough.ts`) — the Blade domain's
  (SRD level 1) "When you roll your damage dice, you can reroll any 1s or 2s."
  Two settings: world `notGoodEnoughReroll`, **on** by default, filed under Blade
  in the Domains tab; and client `notGoodEnoughAlwaysReroll`, **off** by default.
  - **The one window on a damage roll.** `DamageRoll.buildPost` reaches
    `DHRoll.buildPost` — the patched seam — through `super`, so damage arrives at
    the pipeline like anything else. What makes it fit this card is the two lines
    `DamageRoll.buildPost` runs *first*: it builds a `PoolTerm` of
    `config.damage.main` plus the resource rolls and `await`s
    `triggerChatRollFx`. So the table has already watched the dice land when the
    window is asked, and nothing has been posted or applied yet. **Do not call
    `showDiceEarly` here** — it would throw the same dice twice.
  - **`matches` cannot use `rollTypeOf`.** `DamageField.execute` spreads the
    *action's* config into the damage config, so `config.roll.type` at
    `daggerheart.preRoll` is the attack's `actionType`. It asks
    `CONFIG.Dice.daggerheart.DamageRoll` directly instead.
  - **Reroll in place, not `rebuildRoll`.** That helper re-rolls the whole
    formula, which is the opposite of this card: the 6 has to survive. So it calls
    the system's own `BaseDie#rerollResult` — the method behind the per-die reroll
    button already on every damage card — which keeps the discarded result in
    `results` marked `rerolled`/`active: false`, splices the replacement into the
    die's own order, and handles combo dice (`c`/`cc`). `Roll.fromData` resolves
    the serialized `"BaseDie"` through `Object.values(CONFIG.Dice.terms).find(c =>
    c.name === data.class)`, since `CONFIG.Dice.termTypes` holds only the Duality
    dice — so the reconstructed `config.damage.main` really does carry the method.
  - **"Only once" needs no state.** `rerollResult` marks the *replacement*
    `rerolled = true` as well as the result it replaced, which is how the system
    stops its own button offering a second go. Reading the same flag means this
    window, a second damage roll and the card's chat button all agree, with no
    counter to keep.
  - **Totals are recomputed, not written.** `Roll#_evaluate` skips evaluated terms
    and re-reads `total`, and `DiceTerm#total` sums the *active* results each time
    it is asked. A `ParentheticalTerm` is the exception — its total is its inner
    roll's cached `_total`, which is how the system wraps a formula it is about to
    multiply — hence the innermost-first recursion in `recompute`. Dice inside a
    `PoolTerm` are deliberately out of reach for the same reason inverted: a
    pool's total is fixed at evaluation, so `diceTermsOf` walks `terms` by hand
    rather than using `Roll#dice`, which would reach into one.
  - **The replacement dice are animated**, in the stand-in-object shape the
    system uses in `ChatDamageData#rerollDamageDie` (`{ _evaluated: true, dice,
    options }` — a `Die` built from results is not `_evaluated`, so
    `Roll.fromTerms` would refuse it), with the whisper/blind pair worked out the
    way `DamageRoll.buildPost` works it out. Without it the card's numbers would
    simply differ from the ones the table just watched.
  - **`main` only.** Stress, healing and other resource formulas on the same
    action are left alone: `config.damage.main` is the only part the system itself
    treats as damage, and it is the only one `constructFormula` gives the damage
    bonuses and the critical bonus to.
  - **The loadout is checked.** A `domainCard` in the vault is inert, and
    `DhActiveEffect#isSuppressed` branches on `system.isVaultSupressed` (the
    system's typo) and `system.isDomainTouchedSuppressed`. `FeatureMatch` also
    needs `itemTypes: ["domainCard"]`, since it defaults to `["feature"]`.
  - **The player owns half of this**, which no other setting in the module does.
    "Always reroll" is a preference about being *asked*, and one player taking it
    every time while another decides case by case are both right — so it is
    client-scoped. It is also **the only `config: true` setting in the module**:
    every settings window here is `restricted: true`, so a player has nowhere else
    to reach it. Never add it to a window as well. It is written from two places —
    that checkbox, and the "Always reroll 1s and 2s" box on the prompt itself,
    which is where a player is standing when they realise they want it.
  - `feature-prompt.ts` grew **`confirmWithToggle`**: `confirmChoice` plus a "from
    now on" box, answering with two booleans rather than one so a caller can tell
    "yes, once" from "yes, always". `locksDecline` greys out the decline button
    while the box is ticked — "never ask me again" and "leave this roll alone" are
    contradictory instructions, and disabling the button says which one wins
    before the click rather than after it. The box is never pre-ticked: a caller
    only raises this when the preference is off.
  - It also grew **`ToggleRequest.dice`**, a strip of `PromptDie` between the
    question and the box. The chips are the **system's own `.dice` class**, which
    is one of the few roll rules it leaves unscoped by `.chat-message`, so the
    shape masked in behind each number is the same artwork the chat card draws;
    `module.css` adds only the centring the card gets from `.roll-die > div`, a
    fixed light number colour (the die gradient is the same in either theme), the
    marked colour, and a fallback shape for a denomination the system ships no
    SVG for. The rerollable ones are marked **by identity** against the list
    `lowResultsOf` already returned, not by re-testing the face value — "is a 1 or
    2" and "still has its reroll" are two conditions, and a die shown marked that
    the reroll then skips is the one lie this dialog could tell. That is what
    `LowResult.result` is for. This replaced an intro that named the faces in
    prose ("came up 6, 2, 1, for 12"), which made the reader apply the rule by
    hand; the colour does it instead, and the sentence is free to ask the
    question. There is no hint under the box for the same reason — the label is
    one line, and the notification after a tick says where the preference went.
- **Attack of Opportunity** (`src/daggerheart/attack-of-opportunity.ts`) — the
  Warrior's (SRD p.23) "If an adversary within Melee range attempts to leave that
  range, make a reaction roll using a trait of your choice against their
  Difficulty. Choose one effect on a success, or two if you critically succeed."
  `Compendium.daggerheart.classes.Item.3hNVqD1c0VIw2Nj5`, which ships
  `actions: {}`. World setting `attackOfOpportunity`, **on** by default, filed
  under Warrior in the Classes tab.
  - **The trigger is deliberately a button, not the trigger.** The printed trigger
    is a movement, and at this table tokens are invisible to players and shuffled
    by the GM to express positioning rather than to move a creature in the
    fiction. A `updateToken` watcher would fire on housekeeping — a reaction going
    off when nobody reacted is a worse failure than one that has to be asked for.
    Everything *after* the press is automated, because everything after it is
    mechanical.
  - **One derived `attack` action, and the type is load-bearing.** `roll` is only
    in `DHAttackAction`'s schema, so it is the only shape that can carry "make a
    reaction roll" at all. `damage.main: null` keeps the damage half asleep
    (`hasDamage` false → `DamageField.execute` returns at once), which is right:
    the damage this card deals is the *weapon's*, decided after the roll. Named
    after the card, because `prepareBaseConfig` prefixes the Item's name onto the
    roll title unless the two match exactly. `chatDisplay: false`, so the card's
    rules text stays out of the roll card and what goes to chat is the
    announcement of what was chosen.
  - **Four things the system already does**, once that action exists.
    `actionType: "reaction"` is read in four places (no Hope/Fear gained, no
    countdown advanced, a reroll that doesn't settle up, and the card titled
    "Reaction Roll"). "A trait of your choice" is the `<select name="trait">` the
    roll dialog already renders for any non-`lite` character Duality roll.
    "Against their Difficulty" is `D20Roll.buildEvaluate` scoring on
    `config.roll.difficulty ?? target.difficulty ?? target.evasion` — declaring
    *no* difficulty is what makes it read the target's. And the target picker is
    `daggerheart-target-helper`, which engages on `config.hasTarget` plus a
    non-`self` type.
  - **`target.type` is `any`, not `hostile`**, though the card says adversary.
    `TargetField.isTargetFriendly` compares dispositions
    (`actorDisposition + targetDisposition === 0`), so a hostile filter silently
    offers nobody when the GM's tokens sit at neutral — which on a map that exists
    only for range they routinely do. A filter that fails closed would take the
    feature away in exactly the situation it is for.
  - **Two things `preUseAction` sets that the action cannot declare.** The roll
    dialog is **forced open**: a world with the system's roll automation on has
    `RollField.prepareConfig` invert `dialog.configure`, and the trait dropdown
    lives *only* in that dialog, so the press would roll without asking. And
    `config.roll.trait` is set to the character's **highest** trait, because an
    action can only declare a fixed one and `DHActionRollData#rollTrait` falls
    back to `agility` for a feature Item with no `system.attack` — the same wrong
    answer for everybody. Ties go to the printed order (`CONFIG.DH.ACTOR.abilities`
    is already in it). It stays a dropdown; this decides only where it opens.
    `preUseAction` is the seam for both because it fires after `prepareConfig` —
    so after that inversion, and once `config.roll` exists — and before anything
    reads either value; both `applyKeybindings` implementations assign
    `dialog.configure` with `??=`, so a value set there survives to
    `buildConfigure`.
  - **The effects prompt** is `chooseUpTo` with `max` of one, or two on a
    critical, raised from `postUseAction` and only on `config.roll.success ===
    true`. A failed reaction buys nothing and the chat card already says so, so
    that path is silent — a dialog whose only honest content is "no" is noise. No
    targets at all *is* worth a notification: the player has just made a roll that
    cannot be scored and nothing else on screen says why.
  - `feature-prompt.ts` grew four things for it, all on `chooseUpTo`.
    `PromptChoice.img` is now genuinely optional: portraits are drawn when **any**
    choice supplies one and omitted when none does, because a column of
    mystery-men beside three printed sentences is worse than no column
    (`.ee-feature-choices-plain` is the three-column variant).
    `ChoiceRequest.untimed` drops the 30s timeout — the timeout exists so a dialog
    nobody is at cannot freeze a roll mid-pipeline, and this one is raised *after*
    the roll is posted, where expiring it would throw away a choice that cannot be
    made again; note `waitWithTimeout` does not merely stop racing the timer, it
    never starts it, since the timer *closes* the dialog when it fires.
    `declineLabel` became **optional**: two buttons are worth having when they are
    two decisions the player weighs (Hold Them Off's "spread it" against "leave
    it"), and are noise when the second is only the first with nothing ticked — so
    this prompt has one Confirm that reads back whatever the boxes say. And
    `emptyConfirm` guards the empty press, because with a single button an empty
    Confirm and a full one look identical and one of them throws the choice away.
    A confirmation rather than a disabled button: the rule does not force an effect
    on you, and a control that refuses to be pressed cannot say so.
  - **Blocking that empty press takes a capture-phase listener on the button
    itself.** `DialogV2` reaches `_onSubmit` two ways — its buttons are
    `type="submit"` so a click submits the form `_renderHTML` listens on, *and*
    `_initializeApplicationOptions` registers every button's `action` into
    ApplicationV2's delegated click dispatch. `preventDefault` stops the first,
    `stopImmediatePropagation` the second, and capture on the button is the only
    place that runs before an ancestor's bubble listener. The re-press is a real
    `button.click()` past an `armed` flag rather than a reach into the dialog's
    internals, so the answer travels the path it would have a moment earlier.
  - **The damage is the weapon's own damage step, with the attack roll skipped.**
    `attack.prepareConfig(event, { hasRoll: false })` produces the shape a
    `damage`-type action has natively (`RollField.prepareConfig` returns early, so
    `config.roll` is never populated), and
    `workflow.get("damage").execute(config, null, true)` is the same call the chat
    card's own **Roll Damage** button makes. `force` is set on purpose: without it
    a world whose damage automation is *never* would do nothing, and unlike an
    attack there is no card here with a damage button to fall back to. Rolling to
    hit again would be a second chance to miss something the rule says has already
    been hit.
  - **`config.effects` has to be supplied when calling the workflow directly.**
    `DHRoll`'s constructor builds `options.bonusEffects` from it and
    `calculateTotalModifiers` then reads that *without* guarding, so a missing list
    is a thrown error rather than a missing bonus. `use()` fills it in; we don't
    go through `use()`, so it comes from the system's own
    `getActionRelevantEffects`.
  - **The targets carry over and are marked hit**, which is the rule rather than a
    convenience — the effect is *chosen on a success*. `applyDamage` is then called
    **unforced**, so whether the numbers move on their own or wait for the GM's
    Apply button stays the world's answer, as for any other attack.
  - **Registered before `registerReach()`**, and that is the one ordering that
    matters. These preparation patches nest, so the earliest-installed runs
    innermost: under Reach's, the injected action is already in `system.actions`
    when Reach walks them, and a Giant Warrior's Attack of Opportunity reaches Very
    Close like everything else they own. Registered after Reach, the one action on
    the sheet still printing *Melee* would be the one whose whole trigger is a
    range.
  - **Not automated:** the trigger (above); "they can't move" and "you move with
    them", which are statements about a map this table's GM owns, so they are
    announced and left there; range, which the action declares as `melee` for the
    picker's benefit but nothing enforces; and a weapon whose damage changes on a
    Fear result, which rolls its base value because
    `DamageField.getFormulaValue` reads `config.roll.result.duality` and there is
    no roll on the damage config — passing the *reaction* roll's would mean handing
    the damage card a half-formed roll to render.
- **Slayer** (`src/daggerheart/slayer.ts`) — the Call of the Slayer subclass
  foundation feature's pool of d6s
  (`Compendium.daggerheart.subclasses.Item.1hF5KGKQc2VKT5O8`, a `feature` Item the
  SRD ships as description only). Four separate rules on one card, and every one
  of them attaches somewhere different.
  - **The pool lives in the system's own `system.resource`** — a `simple`
    resource with `increasing` progression and `session` recovery. That is what
    puts a counter with a number box on the card's row in the character sheet's
    Features tab (`item-resource.hbs`, reached through `daggerheart.inventory-items`),
    so "place a d6 on this card" is a thing the player can see and correct by hand.
  - **`resource.max` is a literal number, not `@prof`.** The formula is what the
    two places in the system that *reset* a resource use, but `item-resource.hbs`
    resolves the same field through `itemAbleRollParse(max, item.actor, item)` —
    whose third argument being an Item makes it resolve against the *item's* roll
    data, where `@prof` does not exist. `reconcileSlayerCards` keeps the literal
    in step with a level-up instead, and every rule in the file reads
    `actor.system.proficiency` live rather than the stored figure.
  - **The configuration is written to the card, not derived at preparation time**
    — the one card feature in this module that is. `resource` is a nullable
    `SchemaField` with a `required` member (`progression`), and
    `SchemaField#_updateDiff` validates a nullish field's first write *whole*
    (`const wasNullish = !state.source[key]` → `partial: !wasNullish`), so
    `item.update({"system.resource.value": 1})` against a card that has never held
    one is rejected for the fields it does not mention. A derived object would
    render the sheet's number box over exactly that condition. `writePool`
    therefore always writes the object whole; `reconcileSlayerCards` (writer-gated,
    at `ready` and on the setting) puts it there in the first place.
  - **Taking the die instead of the Hope is a registry feature on the**
    **`dualityOutcome` window**, so it rides in the same prompt as Fearless and
    anything else reacting to that roll. Priority 60 — reactive, not rewriting.
  - **It declares no `cost`.** A `hope` cost would make `canAfford` read "the actor
    must already hold one", and a character at 0 Hope rolling with Hope is exactly
    the one most likely to want the die. `apply` calls `context.payCost` itself, so
    the `-1` folds into the roll's own pending update and the system's `+1` nets
    against it: one actor write, and no moment where the player holds a Hope they
    declined.
  - **It names its own buttons.** `AutomatedFeature.useLabelKey`/`skipLabelKey`
    (localized by `toPromptOffers` into `PromptOffer.useLabel`/`skipLabel`)
    replace the generic "Use it" / "Leave the roll alone" pair with "Gain a Slayer
    Die" / "Gain a Hope". The generic wording is wrong here in a way it is not for
    Fearless: *both* buttons take something, and declining is not leaving the roll
    alone. Honoured **only when the feature is the sole offer** — with several on
    screen the buttons act on all of them at once, so one feature's wording would
    say something untrue about the others, and `chooseOffers` falls back. A feature
    sets them regardless, since it cannot know whether it will be alone.
  - **`hopeGain` mirrors `addDualityResourceUpdates` condition for condition** —
    automation switch, `actionType !== "reaction"`, `skips.resources`, the
    dead/defeated/unconscious statuses, and the rerolled-roll delta. Because the
    offer *nets against* what that method queues, a missed condition would not fail
    loudly; it would quietly take a Hope that was never granted.
  - **Damage spending needs no UI of its own.** `DamageRoll.temporaryModifierBuilder`
    builds `config.modifiers`, which the damage dialog renders as a labelled
    `<select>` per entry (`values`) and `constructFormula` applies through each
    entry's `callback` — the mechanism behind Bardic Rally and the weapon features.
    The wrap has to run **after** the original, which *assigns* `config.modifiers`.
    The entry's `label` is an i18n key, because the template does `{{localize label}}`.
  - **Attack spending is one injected row plus a wrapped `applyBaseBonus`.** The D20
    dialog has no modifier mechanism, only the player's own situational-bonus box,
    so `renderD20RollDialog` appends a `<span>` + `<select>` to `.modifier-container`
    in the same shape as the trait row. Going through `D20Roll#applyBaseBonus` rather
    than pushing terms buys the live formula preview (the dialog re-derives it every
    render) and a labelled entry in the attribution; `formatModifier` parses a
    non-numeric value as a formula, so `"2d6"` arrives as real dice. Patched on
    `D20Roll`, whose `DualityRoll` override calls `super`, so one patch covers both.
  - **The dice come off the card at `buildPost`, not in either dialog** — a
    cancelled dialog costs nothing. `DamageField.execute` builds the damage config
    as `{dialog: {}, ...config}`, so the attack's chosen count travels to the damage
    roll behind it; the two halves therefore carry **independent** "already taken"
    markers (`config.eeSlayerSpent` and `modifiers.eeSlayerDice.eeSpent`), and the
    attack's marker travels with its count. The count itself is never cleared, so a
    `DualityRoll#reroll` still carries the dice it was rolled with.
  - **End of session is the sidebar tab's refresh button.** The system has no
    "end session" event; the only thing that ends one mechanically is the
    **Daggerheart** sidebar tab with *Session* ticked, calling the unexported
    `RefreshFeatures`. What is reachable is `CONFIG.ui.daggerheartMenu` and the
    handler it names in `DEFAULT_OPTIONS.actions.refreshActors`, which ApplicationV2
    copies into an instance's options at construction — so wrapping it at `init`,
    before the sidebar is built, puts the Hope payout in front of the refresh. The
    card keeps declaring `session` recovery anyway: we zero the pools first, so the
    system's own sweep is a no-op, and the card still describes itself correctly.
  - **Not automated:** a critical damage roll **maximises spent Slayer Dice too** —
    `constructFormula` sums `formulaData.roll.dice` for the critical bonus after
    *both* modifier passes, so any die added to a damage roll is counted, exactly as
    for a Bardic Rally die, and there is no seam that adds dice after that sum; a
    Fear result another feature converts to Hope does not offer the die, because
    `offersFor` builds the whole prompt before any of it applies; and which dice were
    spent on what, since the card tracks a count rather than identities.
- **Card targeting** (`src/daggerheart/card-targeting.ts`) — the single wrapper
  around `DHBaseAction#use` behind every card that declares a target it must not
  ask for. Features register a predicate with `untargetAction(rule)`; the patch
  blanks `this.target.type` for the duration of one call and restores it in a
  `finally`. Extracted from Ranger's Focus when Gifted Tracker became the second
  consumer — two independent wrappers around the same method would nest in load
  order, warn separately when the system moves, and leave nowhere that answers
  "what un-targets a card". **Why a patch and not a hook** is unchanged and still
  the important part: `config.hasTarget` is set in `TargetField.prepareConfig`,
  which runs *before* `daggerheart.preUseAction` fires, and whether our listener
  or `daggerheart-target-helper`'s guard goes first is module load order (both
  register at `init`) — so the declaration has to be gone before the hook exists.
  Installed from `module.ts` at **setup** (`game.system.api` is only filled in the
  system's own `init`); rules are registered by features during `init`, so order
  between them doesn't matter.
- **Damage landing** (`src/daggerheart/damage-landing.ts`) — the single wrapper
  around `DamageField.applyDamage` behind every rule that fires when damage lands.
  Features register with `onDamageLanding({ id, before, after })`. Extracted from
  `rangers-focus.ts` when Blighting Strike became the second consumer — same
  one-patch-many-rules reasoning as **Card targeting**.
  - **Why this method**: it is the one moment damage is really dealt. The workflow
    calls it at order 75 and the chat card's *Apply* button calls the same entry
    (`workflow.get('applyDamage')`), so one seam covers the automated and the
    by-hand route, and a table with apply-automation off never fires a rule for
    damage nobody took.
  - **Two phases.** `before` runs with the packet still in hand and may change
    `config.damage` — the system's own `damageOnSave` scaling mutates it in the
    same place, so this is supported rather than a trick. `after` runs once the
    system has applied.
  - Both get `applying`, computed from the system's own answer
    (`force || getApplyAutomation()`) rather than a copy of the rule.
  - **`withoutApplyButtons()`** (in `roll-pipeline.ts`) keeps the system's *Deal
    Damage* / *Apply Healing* pair off a plain roll card. The system assigns
    `globalThis.Roll = BaseRoll`, so **every** `new Roll()` in the world renders
    through its `templates/ui/chat/foundryRoll.hbs`, which hangs both buttons
    under the total — fair for a GM typing `/r 2d6`, wrong for a die a rule asked
    for and whose meaning is already fixed. Spread the result into the data given
    to `Roll#toMessage`; it returns the whole `flags` key, so merge by hand if the
    caller has flags of its own. The template's own escape hatch is
    `{{#unless flags.core.RollTable}}`, which would silence them in one line and
    was rejected: it is a lie told to core, in a flag core reads for its own
    purposes. Marking the message as ours and removing the buttons on render says
    the true thing for one hook. Registered **before** every guard in
    `installRollPipeline`, since it has nothing to do with the `DHRoll` patch.
    **Known gap:** `i-see-it-coming.ts` posts its d4 without this and so still
    offers to apply an Evasion bonus as damage. Left alone pending a decision, not
    because it is right.
  - `damagedTargets(config, targets)` is exported because it is the same default
    `applyDamage` itself applies (`targets ?? config.targets.filter(t =>
    t.hitResult?.success)`), so a rule and the system can never disagree about who
    was damaged.
- **Damage marking** (`src/daggerheart/damage-marking.ts`) — the single
  interception of the finished mark list, behind every rule that changes what an
  actor is about to mark. Features register with
  `onDamageMarking({ id, wants, mark })`. Extracted from `tethered-talisman.ts`
  when Brave Face became the second consumer — same one-patch-many-rules
  reasoning as **Card targeting** and **Damage landing**, and sharper here: two
  wrappers would each shadow the other's shadow of the same instance method.
  - **The moment** is the argument `Actor#takeDamage` hands to
    `modifyResource` — after resistances, after `convertDamageToThreshold`, after
    the armor-slot dialog, and *before* `convertStressDamageToHP`. Entries are
    plain `{ key, value }`, and a reversed resource (Hit Points, Stress, Armor)
    arrives positive because marking raises it. The method's own hooks are all in
    the wrong place: `preTakeDamage` and `postCalculateDamage` fire while the
    value is still raw damage, `postTakeDamage` after the sheet is written.
  - **The shadow is an own property on the instance and one-shot.** It lasts one
    call on one actor, restores itself as its first act — so a rule that goes on
    to call `actor.modifyResource` to charge a cost reaches the real method — and
    the outer `finally` restores again, idempotently, if `takeDamage` throws.
  - **`wants(actor)` runs before the damage is calculated**, so it cannot know
    what will be marked; `mark` still has to check. What it buys is that the
    shadow is never installed for an actor no rule cares about, which is nearly
    every actor on every hit.
  - Rules run in registration order on the same array, so a later one sees what
    an earlier one did — the correct reading when two features both reduce a hit.
    One that throws is logged and skipped, because the damage lands either way.
  - **`mark` is awaited and the rules on it ask over a socket**, which holds the
    damage open on somebody else's answer. That is the system's own precedent,
    three lines earlier in the same method: `this.owner.query('armorSlot', …,
    { timeout: 30000 })` stops the same damage dead while the damaged player
    chooses whether to spend armor.
  - Patched during **`init`**, not `setup`, unlike the other two shared wrappers:
    `CONFIG.Actor.documentClass` is assigned at script load, and the patch has to
    be in place before anything can be damaged. Same reasoning as `reach.ts`.
- **GM action-effect relay** (`src/daggerheart/gm-action-effects.ts`) — fills the
  Daggerheart system's permission gap when a player's action applies an embedded
  ActiveEffect to an adversary. Its `EffectsField.applyEffect` calls core's
  `ActiveEffect.implementation.create` directly on the acting client, and core
  requires OWNER of the target; `ActorDelta` in the resulting error only means
  the token is unlinked, since linked adversaries fail the same ownership test.
  World setting `relayActionEffects` (on by default), edited in the Daggerheart
  Utilities window. The wrapper is installed at `setup`, after
  `game.system.api.fields.ActionFields.EffectsField` exists: owned targets and GM
  actions call the original method untouched, while an unowned target sends a
  correlated request to the single `isWriter` GM and waits up to ten seconds for
  its result. **The socket carries only the source effect UUID and target actor
  UUID, never ActiveEffect data.** The GM resolves both, requires the source to
  be an effect embedded in an Item whose actor the requesting active non-GM user
  owns, requires the target not to be owned by that user, then calls Daggerheart's
  original method so the system constructs the copied effect itself. Completed
  request ids are bounded and cached on the GM to prevent a duplicate delivery
  from applying twice; distinct uses deliberately are not deduplicated, because
  stacking is the system's rule to decide. This is not a generic
  `preCreateActiveEffect` relay: accepting arbitrary effect data there would make
  the module socket a privileged document writer.
- **Deck Limit** (`src/daggerheart/deck-limit.ts`, settings only so far) — models
  the table's card pool as physical decks: a card in one character's hands isn't
  available to anyone else. World settings `deckLimitEnabled` (off by default)
  and `deckLimitCount` (default 1, minimum 1), plus one copies-per-deck count per
  card type — `DECK_CARD_TYPES` maps each to a Daggerheart Item type
  (`domainCard`, `class`, `subclass`, `ancestry`, `community`) and to what a
  printed deck holds (1 each, **2 for `community`**). Pool for a type is
  `copies × deckLimitCount`. A `subclass` is a single Item even though it's three
  physical cards — Foundation/Specialization/Mastery are `foundationFeatures` /
  `specializationFeatures` / `masteryFeatures` on it, gated by `featureState` —
  so one copy is the whole set. Edited in the `daggerheartUtilitiesMenu` window
  (`src/apps/daggerheart-utilities-config.ts`), the copies fields in a
  collapsed-by-default `<details>`. That window is the home for the *table's own
  house rules*, as opposed to `daggerheartAutomationMenu`, which automates rules
  the system or a third-party module already states but leaves to the table to
  apply.
  - *Counting* (`deck-pool.ts`): nothing is stored — the pool is recomputed from
    the world on every question, so deleting a card (or its owner) returns it to
    the deck with no ledger to drift. Only `character` actors hold cards; vault
    and loadout both count. `drawsFromDeck()` is the single answer to "is this
    sheet in the pool", used by the census *and* the guard so they can't disagree
    — with `deckLimitPlayersOnly` on it narrows to actors a non-GM user has
    assigned as their character or owns (GMs are skipped first, since a GM tests
    as OWNER on everything). **Card identity is the subtle part.** A copy carries
    `_stats.compendiumSource` (stamped by `ClientDocument.fromDropData`, and by
    the system's own `createEmbeddedItemData`), but the compendium entry *is* the
    source and so has none, and homebrew never gets one — so a `CardKey` holds
    both a source UUID and a `type:name` fallback, and `sameCard` compares
    whichever the two sides have in common. The fallback is blunt on purpose:
    same-named homebrew cards count as one, renaming frees a copy.
  - *Holds* (`deck-holds.ts`, `deck-limit-wizard.ts`): character creation and
    level-up are wizards — cards are chosen minutes before any Item exists, and
    tables level up simultaneously, so selections are published as **holds** that
    count against the pool like a held copy but read differently in the UI.
    Transport is a **User flag** (`FLAGS.deckHolds`), because a player may always
    update their own User document (`BaseUser.#canUpdate` permits
    `user.id === doc.id`; `flags` isn't restricted) and User documents replicate
    to every client — so no socket protocol and no GM relay. Holds are cleared on
    wizard close, on `ready` (`releaseOwnHolds`, mopping up after a crash), and
    are ignored on read for users who aren't `active`, so a card can never be
    stranded. Writes are serialized through one promise chain: the flag holds
    *all* of a user's wizards, and these apps re-render fast enough
    (`submitOnChange`) for two read-modify-writes to overlap. Selections are found
    by **walking** `app.setup` (creation) / `app.levelup.toObject()` (level-up)
    rather than by reading known paths — the paths are the system's business, the
    convention is stabler. Two things about that walk are load-bearing, and
    getting either wrong makes it silently find nothing:
    - It reads `sourceUuid`/`uuid`/`itemUuid` by **property access, never
      `Object.entries`**. Character creation assigns live Item *documents*
      (`this.setup.class = item` in its `_onDrop`), and `uuid` on a Document is a
      prototype getter, invisible to enumeration. Level-up stores plain
      `{uuid, itemUuid}` objects. Property access reads both. `sourceUuid` is
      preferred — it's the system's own getter, resolving a copy back through
      `duplicateSource`/`compendiumSource` to the compendium entry.
    - It stops at any node that names a card, and never descends into a Document
      (`documentName` present), whose graph reaches the whole world.

    `Actor.…` UUIDs are skipped (already-created cards, which the census counts),
    as are cards already on the wizard's own actor — a level-up model is seeded
    from previous level-ups, and reserving those would take a copy from everyone
    else twice. Reading a hold resolves its UUID with `fromUuidSync`, which is
    safe on any client: pack indexes are seeded from world data at load and
    Item's `compendiumIndexFields` include `type` and `name`.
  - *Enforcement* (`deck-limit-guard.ts`): `preCreateItem` is the choke point —
    every route onto a sheet (drag, character creation, level-up, other modules)
    ends in an embedded Item create. `preCreate` hooks are **synchronous**, so
    both paths cancel with `return false` and *then* open a dialog: a player gets
    a dead end naming the holders, a GM gets a confirm whose yes re-issues the
    create with the `eryndor-essentialsDeckLimitBypass` option, which the hook
    waves through. The GM's card therefore lands a moment after the click.
    Advisory, not a security boundary — it runs on the initiating client.
  - *Greying* (`deck-limit-browser.ts`): the system keeps **one** shared
    `ui.compendiumBrowser` (`ItemBrowser`) and re-opens it with presets for every
    picking flow, so one pass covers them all. `loadItems()` fills `.item-list`
    after the render hook and refills it on every search/filter/sort without
    re-rendering the part — hence a `MutationObserver` (childList only; marking
    rows touches attributes, so watching those would self-retrigger), plus an
    `updateUser` hook so someone else's hold appears while the browser is open.
    Three states, checked in this order: **gone** (`freeIgnoringHolds <= 0`,
    dimmed grey — copies are actually on sheets), **on hold** (`free <= 0`, amber
    dashed outline — merely reserved), available. Both restricted states set
    `draggable="false"`; nothing is ever removed from the list.
  - **Known gap**: items created *as part of* an Actor creation (duplicating or
    importing a character) never fire `preCreateItem`, so they bypass the limit.
- **Session Log** (`src/session-log/`) — records what happens at the table as
  plain-text lines, meant to be combined with the Discord voice transcript
  (Craig) afterward and fed to an LLM to draft session notes. No viewer yet —
  entries just accumulate in the world-scoped `sessionLogEntries` array setting.
  "Session" isn't tracked at write time — `groupIntoSessions` splits the flat
  entry list wherever the gap between two consecutive entries exceeds
  `SESSION_GAP_MS` (12 hours), not by calendar day, so a session that runs past
  midnight (or survives a server restart mid-session) doesn't get split; each
  resulting session is labeled with its first entry's local calendar date.
  Master switch `sessionLogEnabled`, plus one on-by-default category switch each
  for `rolls`, `resources`, `status`, `combat`, `scenes`, `flags`
  (`session-log-store.ts`'s `CATEGORY_SETTING_KEYS`), edited in the
  `sessionLogMenu` window. All writing goes through `recordSessionLogEvent`,
  which is the only place that checks both switches and picks the one client
  that persists (`utils/is-writer.ts`'s `isWriter`, `activeGM` — extracted out
  of `void-shared.ts`, which re-exports it so its own call sites didn't need to
  change). Event sources (`session-log-events.ts`):
  - *Rolls*: `createChatMessage`, filtered to Daggerheart's `dualityRoll` /
    `fateRoll` / `adversaryRoll` message types, reading `message.rolls[0]`'s
    `.total` / `.totalLabel` ("Hope" / "Fear" / "Critical Success" /
    "Guaranteed Critical Success"). Deliberately doesn't resolve hit/miss or a
    target — not a roll property, and the resources line below tells that part
    of the story. Damage/healing *roll* messages are skipped in favor of what
    was actually applied. **Verified against the Daggerheart system v2.7.2
    bundle** (`build/daggerheart.js`, searched for `messageType` and
    `getHooks`) — re-check there if this stops matching after a system update.
  - *Resources*: `preUpdateActor` snapshots
    `system.resources.{hitPoints,stress,armor,hope}`, `updateActor` diffs
    against it. Deliberately **not** built on Daggerheart's own
    `daggerheart.postTakeDamage`/`postTakeHealing` hooks — those are
    function-local `Hooks.call`s inside `Actor#takeDamage`/`takeHealing`, so
    they only fire on whichever client called the method (e.g. a player
    self-marking their own Hit Points), never broadcast the way `updateActor`
    is. GM Fear is a world-level pool, not a per-actor resource, and its
    storage in the installed v2.7.2 system couldn't be pinned down from the
    minified bundle — out of scope for now. "Down" (Hit Points fully marked) is
    logged under `status` off the same snapshot.
  - *Status*: `createActiveEffect`/`deleteActiveEffect`, actor resolved via
    `utils/actor-of-effect.ts` (extracted out of `void-hybrid-form.ts`, same
    "usually on the item, walk up one level" logic). Logs every effect
    gained/lost, not just conditions — can get chatty; that's what its category
    toggle is for.
  - *Combat*: Daggerheart's own unprefixed `combatStart` hook
    (`Hooks.callAll("combatStart", combat)`) for the start — stronger signal
    than "a Combat document was created." `deleteCombat` for the end, skipped
    if the round never advanced past 0.
  - *Scenes*: `updateScene` filtered to `changes.active === true` — a GM
    *activating* a scene, not a per-client view change.
  - *Flags*: `session-log-flag-button.ts` prepends a button to Foundry's
    `#chat-controls` bar (`renderChatLog`) opening a `DialogV2.prompt` for
    optional free text. GM-only; shown only once master + the `flags` category
    are both on.
  Export to a Journal Entry (`session-log-export.ts`): one JournalEntry named
  "Session Logs", filed in a journal-sidebar folder named "Utility Suite" (found
  by name *and* `type === "JournalEntry"` — folder names are only unique within a
  document type; falls back to the sidebar root if the folder can't be created).
  One page per session named by its date, plain-text content
  built with `escapeHtml` since entry text can embed player/GM-authored names.
  Re-exporting a session updates its existing page rather than duplicating it.
  A journal left at the root by an older version is moved into the folder on the
  next export, but one the GM has filed somewhere themselves is left alone.
  Two triggers: the Session Log window's "Export Current Log" button always
  exports whatever `groupIntoSessions` puts last (finished or still in
  progress), and `sessionLogEntries`'s `onChange` (wired in `settings.ts`) calls
  `checkForSessionBoundary` on every change — narrowed to the GM's own client
  via `isWriter`, it compares the two newest entries and, if the gap between
  them crosses `session-log-store.ts`'s `isSessionBoundary` threshold, exports
  everything before the new entry as the session that just ended. The
  in-progress session is never auto-exported on its own; only its successor's
  first entry triggers it (or a manual export).

## Build — read this first

**Node.js is NOT installed on the host, and Python isn't either.** The build runs
in Docker. Do not run `npm` / `node` / `tsc` / `vite` directly on the host — they
won't exist.

```
docker compose run --rm build     # one-off type-check + build (tsc --noEmit && vite build)
docker compose up watch           # rebuild dist/module.js on every save
```

- First run installs deps into a **named Docker volume** (`eryndor-essentials-node-modules`),
  not the host — Vite ships platform-specific binaries that a Windows `node_modules`
  can't run in the Linux container. `package-lock.json` still persists to the host.
- The host `node_modules/` folder is an empty mount-point artifact; ignore it.
- **Never add a `restart:` policy** to `docker-compose.yml` (keep `restart: "no"`).
  These are manual, developer-invoked containers. Don't change Docker Desktop settings.
- To validate JSON without Node, use PowerShell: `Get-Content -Raw file.json | ConvertFrom-Json`.

### Hot reload

While a world runs, Foundry live-applies (no refresh): `styles/module.css`,
`templates/*.hbs`, `lang/*.json`. **JavaScript is not hot-swapped** — after `watch`
rebuilds `dist/module.js`, **press F5** in the browser.

## Layout

```
src/
  module.ts            entry point — Hooks.once("init"|"ready")
  constants.ts         MODULE_ID, MODULE_TITLE, LOG_PREFIX, SETTINGS, FLAGS, TEMPLATES
  settings.ts          game.settings registration (called from init)
  settings-groups.ts   headings between our buttons in core's settings list
  tokens/              per-feature modules, each exports a register…() called from init
  apps/                ApplicationV2 windows not owned by a single feature
  daggerheart/         Daggerheart table rules we implement ourselves (cf. integrations/)
  integrations/        optional third-party module hookups (runtime-gated, never required)
  session-log/         Session Log store, event sources, and the chat flag button
  utils/               small stateless helpers with no feature of their own (e.g. escape-html.ts)
  types/foundry.d.ts   minimal ambient Foundry type shim
dist/module.js         build output (git-ignored)
module.json            manifest — esmodules -> dist/module.js
styles/ templates/ lang/ packs/   served from the repo root as-is
```

## Conventions

- **One id, one title.** `MODULE_ID = "eryndor-essentials"` and `MODULE_TITLE`
  live in `constants.ts`. `LOG_PREFIX` derives from the title; log with
  `` console.log(`${LOG_PREFIX} …`) ``. Reserve `log` for once-per-session
  lifecycle lines. Routine per-action tracing goes to `console.debug` (the
  console's Verbose level) so it's there when something needs diagnosing and
  silent during play; `warn` is for anything the GM can act on.
- **Settings**: add a key to `SETTINGS` in `constants.ts`, register it in
  `settings.ts`, which is called during the `init` hook (settings can't be
  registered later). **Every setting is `config: false` bar one** — the module's
  category in Foundry's settings list holds only buttons (General Features,
  Per-Token Hotbars, Daggerheart Automation, Daggerheart Utilities, Session Log),
  each opening a window that owns its group. A new setting belongs in one of those
  windows, not in the flat list; a setting must never be both `config: true` and
  window-edited or the same control appears twice. The exception is
  `notGoodEnoughAlwaysReroll`: every one of those menus is `restricted: true`, so
  a *client-scoped, player-owned* setting has nowhere to live and goes in the flat
  list instead. That is the bar a second one has to clear — client scope **and**
  no window a player can open — not "it felt easier". Menus render in registration
  order, which is why they are all registered together at the end of
  `settings.ts`. A window lists its boolean keys in `settingKeys` and its numeric
  ones in `numberSettingKeys`; `ConfigWindow#onSave` reads each back off the
  input whose `name` is the key, holding numbers to the field's own `min`/`max`
  since nothing here goes through form submission (which is what would otherwise
  enforce them).
  - **A switch for an automated feature goes in the catalog, not a template.**
    The Daggerheart Automation window has a "General" tab plus one tab per kind of
    character content — Ancestries, Communities, Classes, Domains — and a rule is
    filed under the card that prints it (Fearless under Infernis, Adaptability
    under Human, Close-Knit under Hearthborne, Brave Face under Warborne; Blood
    Maledict,
    Crimson Rite and Hybrid Form under Blood Hunter; Hold Them Off, Ranger's
    Focus and Companion under Ranger;
    Blood Spike under the Blood domain, I See It Coming under Bone, Gifted
    Tracker under Sage, Not Good Enough under Blade, Attack of Opportunity and
    Slayer under Warrior, Commune, Witch's Charm, Hex, Herbal Remedies and
    Tethered Talisman under Witch). A subclass
    has no home of
    its own, so its rules are filed under its parent class in a group of their own — Hybrid Form under
    Blood Hunter, Beastbound under Ranger, Slayer (Call of the Slayer) under
    Warrior, Hedge Witch under Witch. All four
    content tabs render
    the *same* template from data in `src/apps/automation-catalog.ts`, so adding a
    switch is one `CatalogSetting` in the right entry's `groups`. `settingKeys` is
    derived from that data by `catalogSettingKeys()` — never list a key in both, and
    never add one to only the catalog's *template*, or it would render and then
    silently refuse to save. General is for rules belonging to no single card.
  - Content tabs use a `<select>` rather than nested tabs (18 ancestries before
    The Void adds six), with every entry's panel in the DOM at once and all but the
    selected one `hidden` — that is what keeps one Save covering the whole window.
    Switching panels needs no listener: `ConfigWindow#_onRender` calls
    `refreshControls` after every render *and* every `change`, so the panels are
    re-derived from whatever the selects currently say.
  - Entries from The Void (Unofficial) sit in their own `<optgroup>`, marked with a
    literal `☾` and `disabled` when that module is inactive. `☾` and `title=`
    rather than a Font Awesome moon and `data-tooltip`, because an `<option>`
    renders text only and a native select's options aren't hoverable elements.
- **Templates**: add the path to `TEMPLATES` in `constants.ts`; they're preloaded
  via `loadTemplates(Object.values(TEMPLATES))` in `init`.
- **Types**: there's no full Foundry type package — `src/types/foundry.d.ts` is a
  deliberately minimal shim. When you touch a new Foundry global, **add it to the
  shim** rather than reaching for `any` everywhere. (Swap in `fvtt-types` later if
  the surface grows large.)
- **Localization**: every user-facing string lives in `lang/en.json` under the
  `EE.` prefix — `game.i18n.localize("EE.…")` in TS, `{{localize "EE.…"}}` in
  templates. Don't hardcode display strings. One documented exception: the
  *content names* in `src/apps/automation-catalog.ts` ("Clank", "Blood Hunter") are
  literal, because they are the names of compendium documents that neither the
  system nor The Void translates — a `lang/` entry for them would advertise a
  translation the content itself would never have. Everything the window says
  around them is localized as usual.

## Foundry gotchas (apply when you build the features)

- **ApplicationV2 UI**: the built-in `actions` click dispatch has proven
  unreliable in this Foundry build. Prefer one delegated click listener attached
  in `_onRender` that reads a `data-*` attribute via `closest()`.
- **Handlebars**: no `{{else if}}` and no `eq` helper here — precompute booleans
  in `_prepareContext` and use nested `{{#if}}`/`{{else}}`.
- **Module settings get exactly one flat category.** `SettingsConfig` extends
  `CategoryBrowser` and `_categorizeEntry` maps a namespace to a single category —
  there is no native sub-tab. Each group of settings gets its own `ApplicationV2`
  instead — `src/apps/config-window.ts` is the shared base, and a tabbed one adds
  `static TABS` (see `src/apps/daggerheart-automation-config.ts`). The tab markup
  contract, which
  `Application#changeTab` queries for: a `.tabs` nav holding `[data-group][data-tab]`
  links, and content sections with `class="tab"` plus the same two attributes.
  Visibility is core's — `.tab[data-tab]:not(.active)` hides, and the `standard-form`
  class on the window supplies `.tab.active { display: flex }` — so don't write
  tab CSS. Settings that live in such a window register `config: false`, or they
  show up in both places.
  Within that one flat category the buttons are grouped *presentationally* by
  `src/settings-groups.ts`: on `renderSettingsConfig` it finds
  `section[data-category="eryndor-essentials"]`, locates each menu's row by its
  `button[data-key="<namespace>.<key>"]` (core's
  `templates/settings/config-category.hbs`), and wraps each contiguous run in a
  `div.ee-settings-group` headed by core's `h3.divider`. Two consequences:
  registration order in `settings.ts` *is* DOM order, so a group's menus must be
  registered contiguously; and core's search filter (`CategoryBrowser`'s
  `_onSearchFilter`, debounced 200ms) sets `hidden` on non-matching `.form-group`
  rows while knowing nothing about our headings — which is why the wrapper hides
  itself via `:not(:has(> .form-group:not([hidden])))` in `styles/module.css`
  rather than any JS trying to race that debounce.
- **Line endings vary per file — sniff before you write.** About a third of the
  tracked files are CRLF and the rest LF, and there is no rule that predicts which:
  `src/constants.ts`, `src/settings.ts`, `lang/en.json`, `styles/module.css` and this
  file are CRLF, while `src/module.ts` and everything under `src/daggerheart/` is LF.
  **Match whatever the file you are editing already uses.** Appending LF lines to a
  CRLF file leaves it mixed, which is easy to do and easy to miss: `core.autocrlf` is
  `true` here, so git normalizes on commit and `git diff` looks clean — the damage
  lives only in the working tree, where it surfaces later as whole-file diffs in an
  editor and `^M` noise for anyone whose git is set up differently. A new file may use
  either, as long as it is consistent within itself.
  Detect with `l=$(wc -l < f); c=$(tr -cd '\r' < f | wc -c)` — `c == 0` is LF, `c == l`
  is CRLF, anything between is mixed. **Never use `cat -A` for this**: the Git Bash
  build here strips CR before printing and reports every file as LF. List the stray
  lines with `perl -ne 'print "$.\n" unless /\r\n$/' f` and repair a CRLF file with
  `perl -i -pe 's/(?<!\r)\n$/\r\n/' f`. Note that `perl -i -pe` substitutions anchored
  with `^`/`$` behave differently on a CRLF file — `$` sits before the `\r`, not after
  it — so match `(...\r?\n)` and emit `\r\n` explicitly rather than relying on anchors.
- **Hand-edited JSON** (`lang/`, `packs/`): save **UTF-8 without a BOM**. Foundry's
  loader chokes on a BOM, and PowerShell's `Set-Content -Encoding utf8` adds one —
  use `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
- **Update options are shared state**: the `options` object handed to a
  `preUpdate<Type>` hook *is* the database operation — the client backend
  re-assigns it after the hooks run, so mutating it there is supported, and the
  result travels to every client with the update. That's how one user's drag can
  un-animate for the whole table.
- **World state**: only GMs can write world-scoped settings; all clients can read.
  Player→GM coordination goes over `game.socket` — enabled via `"socket": true`
  in `module.json`. Use the `SOCKET_EVENT` channel (`module.eryndor-essentials`).

## Dev environment

- A directory **junction** links this repo into Foundry:
  `%LOCALAPPDATA%\FoundryVTT\Data\modules\eryndor-essentials` → the repo root.
  Foundry serves the built `dist/module.js` and the root assets directly.
- Sibling modules **Maiyalis: Target Helper** (`../daggerheart-target-helper`) and
  **Campaign Story Decks** (`../foundry-narrative-tools`) use the same toolchain and are
  good references for patterns — ApplicationV2 windows, delegated-click dispatch,
  GM-authoritative world-setting sync over sockets, and the Docker build setup are
  all worked out there.
```
