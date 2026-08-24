/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "eryndor-essentials" as const;
export const MODULE_TITLE = "Maiyalis: Utility Suite" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Localization key prefix — every user-facing string lives under this in lang/. */
export const I18N_PREFIX = "EE" as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /**
   * Master switch for the "hide DM-dropped tokens" feature. World-scoped so the
   * GM owns it and players can't turn it off to reveal hidden tokens.
   */
  hideDmTokens: "hideDmTokens",
  /**
   * Make drag-and-dropped token movement instant instead of animated. World-scoped
   * because the update option that skips the animation travels to every client, so
   * one user's drag is un-animated for the whole table either way.
   */
  disableDragAnimation: "disableDragAnimation",
  /**
   * Make tokens flagged {@link FLAGS.invisibleToPlayers} completely inert on
   * player clients: no hover, no click, no drag, no box-select, and no moving
   * them with the arrow keys. A sub-option of {@link SETTINGS.hideDmTokens},
   * which is why the window greys it out while that is off.
   *
   * Targeting is deliberately *not* affected, and doesn't need to be:
   * `TokenLayer#setTargets` resolves ids and never consults visibility or
   * interactivity, and the Target Helper picks targets through its own UI rather
   * than by clicking the canvas. Distance automation reads token positions, which
   * is likewise untouched.
   */
  blockPlayerTokenInteraction: "blockPlayerTokenInteraction",
  /**
   * Master switch for the Tokens on Scene bar — a floating list of the tokens a
   * player owns on the current scene, so they can pick which one they're driving
   * without finding it on the canvas. World-scoped: at this table every token is
   * invisible to players (see {@link SETTINGS.hideDmTokens}), which is a
   * table-wide decision, and so is the answer to "can players still get back to
   * their character". Off by default — it puts a panel on every player's screen.
   */
  tokenBar: "tokenBar",
  /**
   * Whether the bar also stops a player's selection from emptying: releasing the
   * last controlled token immediately re-controls it. Separate from
   * {@link SETTINGS.tokenBar} only so the lock can be dropped mid-session without
   * taking the bar (the player's only way back) with it — the two are meant to
   * run together, which is why this is on by default and greyed out while the bar
   * is off.
   */
  tokenBarLockSelection: "tokenBarLockSelection",
  /**
   * Where this client has dragged the bar to: `{ left, top }` in pixels, or null
   * for "wherever the default puts it". **Client-scoped**, unlike everything else
   * here — it's one user's window layout, and a player must be able to write it.
   * Never shown in a settings window; the drag is its only editor.
   */
  tokenBarPosition: "tokenBarPosition",
  /**
   * Master switch for swapping the hotbar page to match the selected token's
   * actor. World-scoped so the GM owns the whole feature.
   */
  hotbarPageSwap: "hotbarPageSwap",
  /**
   * The actor→page assignments behind {@link SETTINGS.hotbarPageSwap}, edited
   * through the {@link SETTINGS.hotbarPagesMenu} window rather than the settings
   * list. Shape: `{ defaultPage: number, applyToPlayers: boolean,
   * pages: Record<actorId, number> }`.
   */
  hotbarPages: "hotbarPages",
  /**
   * Master switch for syncing the actor *portrait* to The Void (Unofficial)'s
   * Hybrid Form transformation. World-scoped because only a GM can write actor
   * documents, and because the artwork it changes is shared by the whole table.
   * Not shown in Foundry's settings list — the Daggerheart Automation tab of
   * {@link MENUS.daggerheartAutomationMenu} is its only editor.
   */
  voidHybridFormPortrait: "voidHybridFormPortrait",
  /**
   * Whether {@link SETTINGS.voidHybridFormPortrait} also rewrites the actor's
   * *prototype token*, so a token dragged out mid-transformation arrives in
   * Hybrid Form. World-scoped for the same reason, and separate because this one
   * mutates persistent actor data rather than just the displayed portrait.
   */
  voidHybridFormPrototype: "voidHybridFormPrototype",
  /**
   * Master switch for ending Hybrid Form when an Order of the Lycan character's
   * Stress fills up — the counterpart to The Void's own "gain Hope while
   * transformed, mark Stress" rule, which never reverts the form once Stress has
   * nowhere left to go. World-scoped for the same reason as the rest of this
   * group: only a GM can write actor documents. On by default, unlike the two
   * settings above — this isn't optional artwork, it's the form ending the way
   * the rule says it should; leaving it off would leave that already-incorrect
   * behavior in place.
   */
  voidHybridFormStressRevert: "voidHybridFormStressRevert",
  /**
   * Master switch for the **Reach** rule: an actor holding a feature called
   * "Reach" (the Giant ancestry's) uses anything with a Melee range at Very
   * Close instead. World-scoped like every other rule switch — one answer for
   * the whole table, or two clients would gate targeting differently. Off by
   * default, since it changes what a printed card says.
   */
  reachMeleeAsVeryClose: "reachMeleeAsVeryClose",
  /**
   * Master switch for automating **Fearless** (Infernis): offer to mark 2 Stress
   * and turn a roll with Fear into a roll with Hope, before the system has acted
   * on the Fear at all. See `daggerheart/fearless.ts`.
   *
   * World-scoped like every other rule switch — one answer for the whole table,
   * or two clients would resolve the same roll differently. **On** by default,
   * for the same reason as {@link SETTINGS.voidHybridFormStressRevert}: this is
   * the rule exactly as printed on the card, which nothing currently applies, and
   * it does nothing at all unless a player chooses it at the prompt.
   */
  fearlessFearToHope: "fearlessFearToHope",
  /**
   * Master switch for automating **Adaptability** (Human): put a "mark a Stress
   * to reroll" control on the chat card of any roll that spent Hope on one of
   * your own Experiences. See `daggerheart/adaptability.ts`.
   *
   * World-scoped and **on** by default, like the other card rules. The odd one
   * out in *where* it appears — a button on the posted card rather than a prompt
   * mid-roll — because the card's trigger is a failure the system frequently
   * cannot score, the difficulty being the GM's to set.
   */
  adaptabilityReroll: "adaptabilityReroll",
  /**
   * Master switch for automating **Feline Instincts** (Katari): on an Agility
   * roll the system scored as a miss, offer to spend 2 Hope and throw the Hope
   * Die again, keeping the Fear Die exactly as it landed. See
   * `daggerheart/feline-instincts.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.fearlessFearToHope}: it is the rule as printed on a card the
   * system already charges for and does not apply, and it does nothing at all
   * unless a player takes the offer at the prompt.
   */
  felineInstinctsReroll: "felineInstinctsReroll",
  /**
   * Master switch for automating **Blood Maledict** (Blood Hunter, *Void for
   * Daggerheart*): when an adversary lands an attack within Close range, offer
   * the character 3 Hope to make it reroll at disadvantage — before the chat card
   * is posted and before the hit becomes damage. See
   * `daggerheart/blood-maledict.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.fearlessFearToHope}. Note that the prompt is raised on the
   * GM's client (adversaries roll there) but shown to the character's owner over
   * the module's socket, so both ends need the module enabled.
   */
  bloodMaledictReroll: "bloodMaledictReroll",
  /**
   * Master switch for automating **Crimson Rite** (Blood Hunter, *Void for
   * Daggerheart*): marking the Hit Point enchants a chosen active weapon with
   * tier-scaled bonus damage that expires at the next rest, and gives that
   * weapon's damage the `magical` type. See `daggerheart/crimson-rite.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.fearlessFearToHope}. Unlike the two roll-window features this
   * one writes a lasting ActiveEffect, so turning it off stops new rites being
   * applied but leaves any already on a sheet — they still expire on their own.
   */
  crimsonRiteEnchant: "crimsonRiteEnchant",
  /**
   * Master switch for automating **Blood Spike** (Blood domain, *Void for
   * Daggerheart*): after a successful cast, offer to spend the Hope, and roll the
   * damage with the die the character's marked Hit Points call for. See
   * `daggerheart/blood-spike.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.fearlessFearToHope}. Note that the Stress the card marks is
   * already the system's own — the card's attack actions carry it as a damage
   * part — so this switch governs only the Hope and the die.
   */
  bloodSpikeSpendHope: "bloodSpikeSpendHope",
  /**
   * Master switch for automating **I See It Coming** (Bone domain): when an
   * attack from beyond Melee range lands on the character, offer to mark a Stress,
   * roll a d4 and add it to their Evasion against that attack — before the chat
   * card is posted and before the hit becomes damage. See
   * `daggerheart/i-see-it-coming.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.bloodMaledictReroll}, whose window and socket relay it
   * shares — so both ends of the table need the module enabled.
   */
  iSeeItComingEvasion: "iSeeItComingEvasion",
  /**
   * Master switch for automating **Hold Them Off** (Ranger): after a successful
   * weapon attack, offer to spend 3 Hope and add up to two more adversaries
   * within the attack's range to the roll that already happened — before the
   * chat card is posted and before the damage is rolled, so the same roll and the
   * same damage reach all of them. See `daggerheart/hold-them-off.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.fearlessFearToHope}. Unlike the reaction features this one is
   * decided entirely on the attacking player's own client, so no socket relay is
   * involved.
   */
  holdThemOffExtraTargets: "holdThemOffExtraTargets",
  /**
   * Master switch for automating **Ranger's Focus** (Ranger): the card's button
   * asks which equipped weapon to attack with and makes that attack, marks the
   * target as the ranger's Focus on a success, marks the Focus a Stress whenever
   * the ranger damages it, and offers to end the feature for a reroll when an
   * attack on the Focus fails. See `daggerheart/rangers-focus.ts`.
   *
   * World-scoped and **on** by default, like the rest. Note this one *owns* the
   * card's own action rather than sitting beside it — the system leaves that
   * button broken for players (it tries to write an ActiveEffect onto an
   * adversary, which core refuses) — so switching it off restores that error
   * along with everything else.
   */
  rangersFocusTracking: "rangersFocusTracking",
  /**
   * Master switch for automating **Gifted Tracker** (Sage domain): the card's
   * button asks what the character is following, puts that in front of the GM
   * with a searchable picker of every actor in the install, records the answer on
   * the ranger, and gives them +1 Evasion against those creatures — and only
   * those — whenever one attacks them. See `daggerheart/gifted-tracker.ts`.
   *
   * World-scoped and **on** by default, like the rest. Note this one *replaces*
   * the card's own ActiveEffect rather than sitting beside it: the SRD ships a
   * flat, permanent `system.evasion +1` against the entire world, so switching
   * this off restores that instead of restoring nothing.
   */
  giftedTrackerEvasion: "giftedTrackerEvasion",
  /**
   * Master switch for the Beastbound **Companion** card: it grows two buttons —
   * the companion's attack, and a plain action roll — and both are made as the
   * ranger's own Spellcast Roll, with the companion's Experiences on offer for a
   * Hope each. The attack's range is still measured from the companion's token.
   * See `daggerheart/companion.ts`.
   *
   * World-scoped and **on** by default, like the rest. This one *adds* to a card
   * the system leaves passive rather than replacing anything, so switching it off
   * returns the card to being description-only — the companion's own sheet keeps
   * both of its buttons either way.
   */
  companionCommands: "companionCommands",
  /**
   * Master switch for automating **Close-Knit** (Hearthborne, *Void for
   * Daggerheart*): put a "share Hope" action on a card the Void ships as prose,
   * so a character can spend any number of Hope to hand an ally the same number,
   * once per long rest. See `daggerheart/close-knit.ts`.
   *
   * World-scoped and **on** by default, for the same reasons as
   * {@link SETTINGS.companionCommands}, whose card this one resembles: both *add*
   * an action to a passive card rather than replacing anything, and both build it
   * during data preparation on every client, so a per-user preference would put a
   * button on one screen and not another. Switching it off returns the card to
   * being description-only, and leaves any "spent" marker already on a sheet to
   * expire on its own at the next long rest.
   */
  closeKnitShareHope: "closeKnitShareHope",
  /**
   * Master switch for automating **Attack of Opportunity** (Warrior class
   * feature): put a button on a card the SRD ships as prose, so the player can
   * make the reaction roll — trait of their choice, scored against the target's
   * Difficulty — and then be asked which of the card's three effects the result
   * bought, one on a success and two on a critical. Choosing the damage clause
   * rolls the primary weapon's damage. See `daggerheart/attack-of-opportunity.ts`.
   *
   * World-scoped and **on** by default, for the same reason as
   * {@link SETTINGS.closeKnitShareHope}, whose card this one resembles: the action
   * is built during data preparation on every client that prepares the card, so a
   * per-user answer would put a button on one screen and not another. Switching it
   * off returns the card to being description-only.
   */
  attackOfOpportunity: "attackOfOpportunity",
  /**
   * Master switch for automating **Slayer** (Call of the Slayer, the Warrior
   * subclass): the pool of d6s the card stores. Puts a counter on the card, offers
   * the die in place of the Hope on every roll with Hope while there is room for
   * one, adds a "Slayer Dice" dropdown to the attack and damage dialogs that rolls
   * the spent dice into the total, and converts whatever is left into Hope when
   * the GM ends the session. See `daggerheart/slayer.ts`.
   *
   * World-scoped and **on** by default, like the rest of the feature switches —
   * and this one has to be, since the counter it puts on the card is stored data
   * every client reads rather than a per-user view of it.
   *
   * Switching it off stops all four halves but deliberately **leaves any dice
   * already on a card alone**: they are the player's, and turning the automation
   * off should stop the module acting on them rather than confiscate them.
   */
  slayerDice: "slayerDice",
  /**
   * Master switch for automating **Not Good Enough** (Blade domain): after a
   * character holding the card rolls damage, offer to reroll every damage die
   * that came up 1 or 2 — before the result reaches the chat card, so the table
   * reads one damage figure rather than watching it get corrected. See
   * `daggerheart/not-good-enough.ts`.
   *
   * World-scoped and **on** by default, like the rest of the feature switches.
   * The *player's* half of this feature is a separate, client-scoped preference —
   * see {@link SETTINGS.notGoodEnoughAlwaysReroll} — and this switch outranks it:
   * with this off nothing is rerolled and nothing is asked, whatever any
   * individual player has set.
   */
  notGoodEnoughReroll: "notGoodEnoughReroll",
  /**
   * Skip the Not Good Enough prompt and reroll the 1s and 2s outright.
   *
   * **Client-scoped, and the only setting in this module a player owns.** The
   * rule is not a choice the table makes once — a player who always takes the
   * reroll (which is nearly everyone, since the card costs nothing to use) does
   * not want a dialog on every attack, while one who likes deciding case by case
   * does. That is a per-person preference, and a world-scoped switch would make
   * one of them wrong.
   *
   * **Also the only setting registered `config: true`.** Every window this module
   * puts in Foundry's settings category is `restricted: true`, so there is
   * nowhere else a player could reach this; it therefore sits directly in the
   * module's category, where for a player it is the only thing there. Never add
   * it to a settings window as well — see the note at the top of `settings.ts`.
   *
   * Written from two places: the checkbox in that category, and the "always
   * reroll" box on the prompt itself, which is how a player turns it on at the
   * moment they realise they want it rather than by going looking.
   */
  notGoodEnoughAlwaysReroll: "notGoodEnoughAlwaysReroll",
  /**
   * Repoint a portrait raised by Ginzzzu's Portraits & NPC Dock when the actor's
   * artwork changes underneath it — something that module doesn't do for `img`.
   * World-scoped for consistency with the other feature switches, even though the
   * refresh itself is per-client DOM work.
   */
  refreshRaisedPortraits: "refreshRaisedPortraits",
  /**
   * Close Daggerheart: Quick Actions' cinematic roll prompt once the player has
   * rolled. That module already means to — its own close listener just can't
   * hear the click, because the system stops the event before it bubbles (see
   * `integrations/quickactions-roll-request.ts`). World-scoped like the rest of
   * the feature switches, and on by default: a prompt left over a result it was
   * asking for is nobody's intended behaviour.
   */
  rollRequestClose: "rollRequestClose",
  /**
   * Offer Advantage/Disadvantage and Experiences on a GM's roll request, and
   * roll it as the player's character rather than the no-actor fallback the
   * system's enricher lands on. Applies to both the cinematic prompt and the
   * whispered chat card.
   *
   * World-scoped: it changes what a requested roll *does* — which character it
   * belongs to and what Hope it spends — which is a table-wide answer, not a
   * per-client preference. On by default, for the same reason as
   * {@link SETTINGS.voidHybridFormStressRevert}: without it a requested roll has
   * no way to apply an Experience at all.
   */
  rollRequestOptions: "rollRequestOptions",
  /**
   * Master switch for the Deck Limit — capping how many decks are in play at
   * once. World-scoped: it's a table-wide rule the GM sets, not a per-client
   * preference. Off by default, since it constrains something Daggerheart
   * itself leaves open.
   */
  deckLimitEnabled: "deckLimitEnabled",
  /**
   * Let a player's Daggerheart action apply its embedded effects to an actor the
   * player does not own by asking the active GM to perform the copy. This is
   * intentionally scoped to `EffectsField.applyEffect`, not arbitrary
   * ActiveEffect creation. See `daggerheart/gm-action-effects.ts`.
   */
  relayActionEffects: "relayActionEffects",
  /**
   * How many decks {@link SETTINGS.deckLimitEnabled} allows. Meaningless while
   * that switch is off, which is why the window greys it out then. Defaults to
   * 1 and is held to at least 1 on save — a limit of zero would mean "no decks
   * at all", which is what turning the feature off is for.
   */
  deckLimitCount: "deckLimitCount",
  /**
   * Narrow the Deck Limit to characters that belong to a player, leaving the
   * GM's own character actors — pregens, test sheets, retired PCs — outside the
   * pool entirely: they neither consume copies nor get blocked. Off by default,
   * where every `character` actor in the world draws from the decks.
   */
  deckLimitPlayersOnly: "deckLimitPlayersOnly",
  /**
   * Copies of each Domain card one deck contains. This and its four siblings
   * below describe the *shape* of a deck rather than switching anything on, so
   * they're edited in a collapsed section under the switch above. See
   * `daggerheart/deck-limit.ts` for which Daggerheart Item type each one counts
   * and what a printed deck holds by default.
   */
  deckCopiesDomain: "deckCopiesDomain",
  /** Copies of each class card one deck contains. */
  deckCopiesClass: "deckCopiesClass",
  /** Copies of each subclass card one deck contains (one Item = all three tiers). */
  deckCopiesSubclass: "deckCopiesSubclass",
  /** Copies of each ancestry card one deck contains. */
  deckCopiesAncestry: "deckCopiesAncestry",
  /** Copies of each community card one deck contains — 2 in a printed deck. */
  deckCopiesCommunity: "deckCopiesCommunity",
  /**
   * Master switch for the Session Log — recording what happens at the table so
   * it can later be combined with the Discord voice transcript and fed to an LLM
   * to draft session notes. World-scoped: the log is one shared record for the
   * whole table, not a per-client preference. Off by default — nothing should be
   * recorded until the GM opts in.
   */
  sessionLogEnabled: "sessionLogEnabled",
  /** Log category switch: dice rolls (Duality/Fate results). See `session-log/session-log-store.ts`. */
  sessionLogRolls: "sessionLogRolls",
  /** Log category switch: Hit Point/Stress/Armor/Hope changes. */
  sessionLogResources: "sessionLogResources",
  /** Log category switch: effects gained/lost, and a character going down. */
  sessionLogStatus: "sessionLogStatus",
  /** Log category switch: combat beginning and ending. */
  sessionLogCombat: "sessionLogCombat",
  /** Log category switch: activating a different scene. */
  sessionLogScenes: "sessionLogScenes",
  /** Log category switch: the manual GM "flag this" button. */
  sessionLogFlags: "sessionLogFlags",
  /**
   * The recorded entries themselves — a plain append-only array (see
   * `SessionLogEntry` in `session-log/session-log-store.ts`). Not edited through
   * a settings window; there's no viewer yet.
   */
  sessionLogEntries: "sessionLogEntries",
} as const;

/** Settings-menu keys (buttons that open a config window instead of a control). */
export const MENUS = {
  /**
   * Opens the tabbed module window on its General Features tab. GM only.
   *
   * Registered first, because Foundry lists a namespace's menus in registration
   * order and this is the one a GM wants most often.
   */
  generalFeaturesMenu: "generalFeaturesMenu",
  /** Opens the actor→hotbar-page assignment window. GM only. */
  hotbarPagesMenu: "hotbarPagesMenu",
  /**
   * Opens the tabbed module window on its Daggerheart Automation tab. GM only —
   * everything it edits is world-scoped.
   */
  daggerheartAutomationMenu: "daggerheartAutomationMenu",
  /**
   * Opens the Daggerheart Utilities window — the table's *own* house rules (how
   * many decks are in play), as opposed to
   * {@link MENUS.daggerheartAutomationMenu}, which automates rules the system
   * or a third-party module already states but leaves to the table to apply.
   * GM only.
   */
  daggerheartUtilitiesMenu: "daggerheartUtilitiesMenu",
  /** Opens the Session Log window. GM only. */
  sessionLogMenu: "sessionLogMenu",
} as const;

/** Document flag keys stored under `flags.eryndor-essentials.*`. */
export const FLAGS = {
  /**
   * Marks a token that should be invisible to players (but still targetable and
   * interactive). Set automatically when the GM drops a token, or by hand from
   * the token HUD.
   */
  invisibleToPlayers: "invisibleToPlayers",
  /**
   * What an actor's portrait (and prototype token art) looked like *before* The
   * Void put it into Hybrid Form: `{ img, proto }`. Present only while
   * transformed — its absence is how we know there is nothing to revert.
   *
   * Deliberately stored on the Actor rather than read back off a token, so the
   * revert still works when no token of that actor is placed on any scene.
   */
  hybridFormPortrait: "hybridFormPortrait",
  /**
   * Cards a user has picked in an open character-creation or level-up wizard but
   * not yet committed to a sheet — see `daggerheart/deck-holds.ts`. Stored on the
   * **User**, not an Actor: a player can always write their own User document
   * (`BaseUser.#canUpdate` lets `user.id === doc.id` through, and `flags` isn't a
   * restricted field), so a reservation reaches the whole table with no GM relay.
   *
   * Shape: `{ [applicationId]: { actorName: string, cards: string[] } }`, where
   * each card is the source UUID of a pending selection.
   */
  deckHolds: "deckHolds",
  /**
   * Marks an Item as granting an automated feature, naming the registry id it
   * should be matched as (`"fearless"`, …). See `daggerheart/feature-registry.ts`.
   *
   * The escape hatch for homebrew: a feature is normally recognised by the
   * compendium it came from, falling back to its printed name, and neither finds
   * a card the table wrote itself. Set this by hand on such an Item and it joins
   * the automation. Checked ahead of both other routes, so it also works to point
   * a renamed or reworded card at the rule it is meant to be.
   */
  featureId: "featureId",
  /**
   * Marks the ActiveEffect this module creates for an active **Crimson Rite**,
   * and records what it enchanted: `{ slot, weaponId, weaponUuid }`.
   *
   * The flag is what makes the effect *ours* — it is how the next activation
   * finds the previous rite to replace ("or you use this feature again"), and how
   * the damage hook knows which weapon should be dealing magic damage. A rite
   * effect someone builds by hand without it is left entirely alone.
   */
  crimsonRite: "crimsonRite",
  /**
   * Marks the ActiveEffect this module creates for an active **Ranger's Focus**,
   * and records who the Focus is: `{ actorUuid, tokenId, name, img }`.
   *
   * The effect lives on the **ranger**, not on the creature they are focused on
   * — an attack resolves on the attacking player's client, and a player cannot
   * create an ActiveEffect on an adversary. It is therefore both the marker and
   * the record: exactly one per ranger, replaced when they focus on someone else,
   * and deleted when the feature ends.
   */
  rangersFocus: "rangersFocus",
  /**
   * The companion marker on the *creature* being focused on: `{ sourceUuid }`,
   * naming the ranger.
   *
   * A separate key from {@link FLAGS.rangersFocus} on purpose, even though both
   * mean "Ranger's Focus". One actor can be both a ranger with a Focus and
   * somebody else's Focus, and a single key would make "find my Focus record"
   * and "find the mark on me" the same search with two different payload shapes.
   *
   * Written by the GM's client on request — see `daggerheart/gm-effects.ts` —
   * because a player has no permission to create an ActiveEffect on an adversary.
   * Purely a label: the authoritative record is always the ranger's own effect.
   */
  rangersFocusTarget: "rangersFocusTarget",
  /**
   * Marks an ActiveEffect as one **Gifted Tracker** tracking, and records what is
   * being tracked: `{ description, hope, quarry: [{ uuid, name, img }] }`.
   *
   * The effect *is* the record rather than a label beside one kept elsewhere:
   * deleting it from the sheet is how a ranger stops tracking, and two places to
   * look would eventually disagree. It deliberately carries no `changes` — the
   * +1 Evasion it stands for applies only against the listed creatures, which is
   * not something an ActiveEffect can express, so it is applied per attack in the
   * `adversaryAttack` window instead.
   *
   * Exactly one per ranger, like {@link FLAGS.rangersFocus}: using the card
   * again replaces it, which is the only thing that ends a tracking
   * automatically. Everything else the rule might mean by "until you stop
   * tracking them" is the table's judgement and is settled by deleting the
   * effect. The readers still handle finding several, so an effect built by hand
   * — or one left by a delete that failed halfway — is read rather than ignored.
   */
  giftedTracker: "giftedTracker",
  /**
   * Marks the ActiveEffect standing for a **Close-Knit** already spent this long
   * rest, and records what it bought: `{ allyUuid, allyName, amount }`.
   *
   * The effect *is* the record. The card is "once per long rest" and the action
   * carrying it is derived rather than written to the Item, so the system's own
   * `uses` counter is unavailable — recording a use there would mean writing half
   * an action to the card's source. See `daggerheart/close-knit.ts` for why.
   *
   * `system.duration.type` is `longRest`, so the system expires it at the next
   * long rest exactly as it expires a Crimson Rite. Deleting it by hand hands the
   * use back, which is the escape hatch for a world that has turned the system's
   * effect expiry off. An effect built by hand without this flag is left alone.
   */
  closeKnit: "closeKnit",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  /** The actor→hotbar-page assignment window (settings menu). */
  hotbarPages: `modules/${MODULE_ID}/templates/hotbar-pages.hbs`,
  /** Body of the (untabbed) General Features window. */
  generalFeatures: `modules/${MODULE_ID}/templates/general-features.hbs`,
  /** Contents of the floating Tokens on Scene bar. */
  tokenBar: `modules/${MODULE_ID}/templates/token-bar.hbs`,
  /** "General" tab of the Daggerheart Automation window. */
  automationGeneral: `modules/${MODULE_ID}/templates/daggerheart-automation-general.hbs`,
  /**
   * Shared body of the Daggerheart Automation window's four *content* tabs
   * (Ancestries, Communities, Classes, Domains) — one template, four parts, each
   * handed its own catalog. See `src/apps/automation-catalog.ts`.
   */
  automationCatalog: `modules/${MODULE_ID}/templates/daggerheart-automation-catalog.hbs`,
  /** Body of the (untabbed) Daggerheart Utilities window. */
  daggerheartUtilities: `modules/${MODULE_ID}/templates/daggerheart-utilities.hbs`,
  /** Save/Cancel bar, shared by every settings window here. */
  configFooter: `modules/${MODULE_ID}/templates/config-footer.hbs`,
  /** Body of the (untabbed) Session Log window. */
  sessionLog: `modules/${MODULE_ID}/templates/session-log.hbs`,
} as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;
