/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 *
 * **Every setting here is `config: false`, bar one.** Foundry would otherwise
 * list them flat under the module's category, and this module has enough of them
 * that they read better grouped. So the module's category contains only the
 * buttons registered at the bottom of this file, each opening a window that owns
 * its group — and a setting must never be both `config: true` and editable in a
 * window, or the same control appears twice.
 *
 * The exception is `notGoodEnoughAlwaysReroll`, which is client-scoped and
 * therefore belongs to the *player*. Every window here is `restricted: true`, so
 * a player who opened the module's category would otherwise find it empty — that
 * one checkbox is the only control in this module they own, and it has nowhere
 * else to live. It is deliberately not in any window, for the reason above.
 *
 * Menus are listed in registration order, which is why they are all together at
 * the end rather than next to the settings they edit.
 */
import { DaggerheartAutomationConfig } from "./apps/daggerheart-automation-config.js";
import { DaggerheartUtilitiesConfig } from "./apps/daggerheart-utilities-config.js";
import { GeneralFeaturesConfig } from "./apps/general-features-config.js";
import { SessionLogConfig } from "./apps/session-log-config.js";
import { MENUS, MODULE_ID, SETTINGS } from "./constants.js";
import { reconcileOpportunityCards } from "./daggerheart/attack-of-opportunity.js";
import { reconcileBlightingStrikeCards } from "./daggerheart/blighting-strike.js";
import { reconcileBraveFaceCards } from "./daggerheart/brave-face.js";
import { reconcileCloseKnitCards } from "./daggerheart/close-knit.js";
import { reconcileCompanionCards } from "./daggerheart/companion.js";
import { DECK_CARD_TYPES, DEFAULT_DECK_LIMIT } from "./daggerheart/deck-limit.js";
import { reconcileReach } from "./daggerheart/reach.js";
import { reconcileSlayerCards } from "./daggerheart/slayer.js";
import { HotbarPagesConfig } from "./hotbar/hotbar-pages-app.js";
import { DEFAULT_CONFIG, refreshHotbarPage } from "./hotbar/hotbar-pages.js";
import { reconcileHybridFormPortraits } from "./integrations/void-hybrid-form.js";
import { checkForSessionBoundary } from "./session-log/session-log-export.js";
import { CATEGORY_SETTING_KEYS } from "./session-log/session-log-store.js";
import { refreshTokenBar } from "./tokens/token-bar.js";

export function registerSettings(): void {
  /* ---- General Features ------------------------------------------------- */

  // World-scoped: this is the GM's table-wide switch. Players can read it (so
  // their client knows to hide flagged tokens) but cannot change it.
  game.settings.register(MODULE_ID, SETTINGS.hideDmTokens, {
    name: "EE.Settings.HideDmTokens.Name",
    hint: "EE.Settings.HideDmTokens.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // Toggling the master switch takes effect immediately: re-refresh every token
    // on the canvas so players' art hides (on) or comes back (off) without a reload.
    onChange: () => {
      for (const token of canvas.tokens?.placeables ?? []) {
        token.renderFlags.set({ refreshState: true });
      }
    },
  });

  // World-scoped, like the switch it extends. On by default: a token a player
  // cannot see but can still hover, click and drag is the surprising case, not
  // the useful one.
  game.settings.register(MODULE_ID, SETTINGS.blockPlayerTokenInteraction, {
    name: "EE.Settings.BlockPlayerTokenInteraction.Name",
    hint: "EE.Settings.BlockPlayerTokenInteraction.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // Same immediate re-refresh as the master switch above: Foundry re-derives
    // `eventMode` on every refresh, so this is what hands interactivity back
    // when it's turned off, without a reload.
    onChange: () => {
      for (const token of canvas.tokens?.placeables ?? []) {
        token.renderFlags.set({ refreshState: true });
      }
    },
  });

  // World-scoped: skipping the movement animation is an update option that reaches
  // every client, so this can't meaningfully be a per-user preference.
  game.settings.register(MODULE_ID, SETTINGS.disableDragAnimation, {
    name: "EE.Settings.DisableDragAnimation.Name",
    hint: "EE.Settings.DisableDragAnimation.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — this changes Foundry's stock behavior.
    default: false,
    // No onChange: the setting is read at drop time, so the next drag picks it up.
  });

  // World-scoped to match the other feature switches. The work it gates is
  // per-client DOM, but the decision to do it at all belongs to the GM.
  game.settings.register(MODULE_ID, SETTINGS.refreshRaisedPortraits, {
    name: "EE.Settings.RefreshRaisedPortraits.Name",
    hint: "EE.Settings.RefreshRaisedPortraits.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // On by default: it only fires when a portrait is raised *and* the artwork
    // behind it changed, which is a case where the stale image is simply wrong.
    default: true,
    // No onChange: read at refresh time, so the next change picks it up.
  });

  // World-scoped to match the other feature switches, even though the close
  // itself is per-client DOM. On by default: Quick Actions already intends this,
  // and its own listener is simply unreachable.
  game.settings.register(MODULE_ID, SETTINGS.rollRequestClose, {
    name: "EE.Settings.RollRequestClose.Name",
    hint: "EE.Settings.RollRequestClose.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // No onChange: both hooks read the setting on every fire, so the next roll
    // request picks it up without a reload.
  });

  // World-scoped: this decides which character a requested roll belongs to and
  // what Hope it spends, which has to be one answer for the whole table.
  game.settings.register(MODULE_ID, SETTINGS.rollRequestOptions, {
    name: "EE.Settings.RollRequestOptions.Name",
    hint: "EE.Settings.RollRequestOptions.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // On by default: without it a requested roll cannot apply an Experience at
    // all, and lands on the system's actor-less fallback for any player who has
    // no assigned character.
    default: true,
    // No onChange: read at render time, so the next roll request picks it up.
  });

  // World-scoped: whether players can reach their own tokens without the canvas
  // is a table-wide decision, made by the same GM who hid the tokens in the first
  // place. Off by default — it puts a panel on every player's screen.
  game.settings.register(MODULE_ID, SETTINGS.tokenBar, {
    name: "EE.Settings.TokenBar.Name",
    hint: "EE.Settings.TokenBar.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // Take effect on every client at once: draw or remove the bar, and (when
    // turning it on) select something so the HUD stops guessing.
    onChange: () => refreshTokenBar(),
  });

  game.settings.register(MODULE_ID, SETTINGS.tokenBarLockSelection, {
    name: "EE.Settings.TokenBarLockSelection.Name",
    hint: "EE.Settings.TokenBarLockSelection.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // On by default: the bar exists *because* an empty selection is the problem.
    default: true,
    onChange: () => refreshTokenBar(),
  });

  // Client-scoped — see SETTINGS.tokenBarPosition in constants.ts. Written by
  // dragging the bar, never by a window, and a player has to be able to write
  // their own, which a world-scoped setting would forbid. One of two client
  // settings in the module; the other is notGoodEnoughAlwaysReroll below.
  game.settings.register(MODULE_ID, SETTINGS.tokenBarPosition, {
    scope: "client",
    config: false,
    type: Object,
    default: null,
    // No onChange: the drag has already moved the element it would re-place.
  });

  /* ---- Per-Token Hotbars ------------------------------------------------- */

  // World-scoped: the GM owns the actor→page assignments, and players read them
  // (so their client can honor the "apply to players" option). Edited from the
  // same window as the assignments it gates, since one is useless without the other.
  game.settings.register(MODULE_ID, SETTINGS.hotbarPageSwap, {
    name: "EE.Settings.HotbarPageSwap.Name",
    hint: "EE.Settings.HotbarPageSwap.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — it moves the hotbar out from under the user, so it should
    // be something you opt into after setting up assignments.
    default: false,
    // Turning it on should take effect against the current selection, not the next.
    onChange: () => refreshHotbarPage(),
  });

  // The assignments themselves, edited as a whole rather than as a control.
  game.settings.register(MODULE_ID, SETTINGS.hotbarPages, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_CONFIG,
    onChange: () => refreshHotbarPage(),
  });

  /* ---- Daggerheart Automation -------------------------------------------- */

  // World-scoped: the range a Melee weapon reaches has to be one answer for the
  // whole table, or two clients would gate targeting differently. Off by
  // default — it changes what a printed card says, even if only to enforce what
  // another card says about it.
  game.settings.register(MODULE_ID, SETTINGS.reachMeleeAsVeryClose, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // Ranges are adjusted as documents are prepared, and nothing re-prepares an
    // already-open sheet on its own — so toggling has to sweep what's in play.
    onChange: () => reconcileReach(),
  });

  // World-scoped: one answer for the whole table, or two clients would resolve
  // the same Duality roll differently. On by default — this is the printed rule,
  // which nothing currently applies, and it only ever acts on a player's own
  // answer to the prompt. Nothing to reconcile on change: the switch is read per
  // roll, so turning it off stops the next prompt appearing.
  game.settings.register(MODULE_ID, SETTINGS.fearlessFearToHope, {
    name: "EE.Settings.FearlessFearToHope.Name",
    hint: "EE.Settings.FearlessFearToHope.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // Same reasoning again. Nothing to reconcile on change either, and for a
  // slightly different reason than Fearless: the switch is read when a card is
  // rendered *and* again when its button is pressed, so a card already on screen
  // when the GM turns this off is inert rather than stale.
  game.settings.register(MODULE_ID, SETTINGS.adaptabilityReroll, {
    name: "EE.Settings.AdaptabilityReroll.Name",
    hint: "EE.Settings.AdaptabilityReroll.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // And again. Nothing to reconcile on change: the switch is read once per
  // Agility roll, at the seam where the prompt would be raised, so turning it
  // off simply stops the next roll asking.
  game.settings.register(MODULE_ID, SETTINGS.felineInstinctsReroll, {
    name: "EE.Settings.FelineInstinctsReroll.Name",
    hint: "EE.Settings.FelineInstinctsReroll.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for the same reason, and doubly so here: the roll happens on the
  // GM's client while the prompt appears on the player's, so a per-client answer
  // would let the two ends disagree about whether the reaction exists.
  game.settings.register(MODULE_ID, SETTINGS.bloodMaledictReroll, {
    name: "EE.Settings.BloodMaledictReroll.Name",
    hint: "EE.Settings.BloodMaledictReroll.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for the reason above and one of its own: a single switch covers
  // both halves of the card, so a per-client answer could leave the attack reroll
  // offered and the damage reroll not.
  game.settings.register(MODULE_ID, SETTINGS.notThisTimeReroll, {
    name: "EE.Settings.NotThisTimeReroll.Name",
    hint: "EE.Settings.NotThisTimeReroll.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for a reason of its own: this one decides whether an edit to a
  // sheet is refused, and a per-client answer would let the same change be
  // blocked on the player's screen and waved through on the GM's.
  game.settings.register(MODULE_ID, SETTINGS.strangePatternsNumber, {
    name: "EE.Settings.StrangePatternsNumber.Name",
    hint: "EE.Settings.StrangePatternsNumber.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for a plainer reason than most: this one changes what a damage
  // roll totals, and a per-client answer would leave the GM and the player
  // reading different numbers off the same hit.
  game.settings.register(MODULE_ID, SETTINGS.faceYourFearDamage, {
    name: "EE.Settings.FaceYourFearDamage.Name",
    hint: "EE.Settings.FaceYourFearDamage.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped like the others, and for a further reason: this one decides
  // whether an ActiveEffect gets written to a sheet, and a per-client answer
  // would let one player's rite exist and another's not. Read at activation and
  // again per damage roll, so turning it off stops new rites immediately.
  game.settings.register(MODULE_ID, SETTINGS.crimsonRiteEnchant, {
    name: "EE.Settings.CrimsonRiteEnchant.Name",
    hint: "EE.Settings.CrimsonRiteEnchant.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped like the rest: the prompt and the damage roll happen on the
  // caster's client, but the die a spike rolls is a table-wide reading of the
  // card, not a per-client preference.
  game.settings.register(MODULE_ID, SETTINGS.bloodSpikeSpendHope, {
    name: "EE.Settings.BloodSpikeSpendHope.Name",
    hint: "EE.Settings.BloodSpikeSpendHope.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped like the rest, and this one has to be: it changes the shape of a
  // card every client prepares, so two clients disagreeing would have them rolling
  // different actions off the same item. Reconciled on change, because the reshape
  // removes actions from prepared data and nothing re-prepares an open sheet.
  game.settings.register(MODULE_ID, SETTINGS.blightingStrikeDamage, {
    name: "EE.Settings.BlightingStrikeDamage.Name",
    hint: "EE.Settings.BlightingStrikeDamage.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => reconcileBlightingStrikeCards(),
  });

  // World-scoped for the same reason as Blood Maledict, whose window this shares:
  // the attack is rolled on the GM's client and the prompt is answered on the
  // player's, so a per-client answer would let the two ends disagree about
  // whether the reaction exists at all.
  game.settings.register(MODULE_ID, SETTINGS.iSeeItComingEvasion, {
    name: "EE.Settings.ISeeItComingEvasion.Name",
    hint: "EE.Settings.ISeeItComingEvasion.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped like the rest, though this one is decided entirely on the
  // attacking player's own client: it changes who an attack resolves against, and
  // that has to be one answer for the table rather than a per-client preference.
  game.settings.register(MODULE_ID, SETTINGS.holdThemOffExtraTargets, {
    name: "EE.Settings.HoldThemOffExtraTargets.Name",
    hint: "EE.Settings.HoldThemOffExtraTargets.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for the same reason as the one above, and with one extra: the
  // Stress this marks is written to an adversary through the system's GM relay,
  // so the answer has to be the same on the client that asks and the one that
  // applies it.
  game.settings.register(MODULE_ID, SETTINGS.rangersFocusTracking, {
    name: "EE.Settings.RangersFocusTracking.Name",
    hint: "EE.Settings.RangersFocusTracking.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and here it is not merely for consistency: the card is pressed
  // on the player's client, the quarry is chosen on the GM's, and the Evasion
  // bonus is applied on whichever client rolled the attack. Three machines have
  // to agree that this feature exists, so it cannot be a per-client preference.
  game.settings.register(MODULE_ID, SETTINGS.giftedTrackerEvasion, {
    name: "EE.Settings.GiftedTrackerEvasion.Name",
    hint: "EE.Settings.GiftedTrackerEvasion.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped like the rest. It governs two clients at once: the chooser is
  // answered wherever the card is pressed, and the follow-up presses an action
  // whose effect may be relayed to the GM to land. Nothing here is written into
  // prepared data, so unlike Blighting Strike it needs no reconciliation — the
  // next press reads the new value.
  game.settings.register(MODULE_ID, SETTINGS.viciousEntangleRestrain, {
    name: "EE.Settings.ViciousEntangleRestrain.Name",
    hint: "EE.Settings.ViciousEntangleRestrain.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and here that is load-bearing rather than conventional: the
  // guard cancels a deletion and spends the GM's Fear, so a per-user version
  // would make the same right-click do two different things depending on which
  // GM pressed it. Read at the moment of the delete, so a change takes effect on
  // the very next one.
  // World-scoped because the record is written by the GM's client onto actors a
  // player may not own, so a per-user version would mean the same cast tracked
  // itself on one screen and not another. Read at the moment a connection opens
  // or closes, so a change takes effect on the very next cast.
  game.settings.register(MODULE_ID, SETTINGS.telepathyLink, {
    name: "EE.Settings.TelepathyLink.Name",
    hint: "EE.Settings.TelepathyLink.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.slumberFearGuard, {
    name: "EE.Settings.SlumberFearGuard.Name",
    hint: "EE.Settings.SlumberFearGuard.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped because it decides whether a hit lands on the GM's adversary,
  // which both sides of the table have to agree on. Read at the moment damage is
  // applied, so a change takes effect on the very next one.
  game.settings.register(MODULE_ID, SETTINGS.noRollDamageApply, {
    name: "EE.Settings.NoRollDamageApply.Name",
    hint: "EE.Settings.NoRollDamageApply.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for a reason beyond consistency here too: the actions this adds
  // are built during data preparation on every client that prepares the card, and
  // the range origin they declare is read on whichever client rolled. A per-user
  // preference would put a button on one screen and not another.
  game.settings.register(MODULE_ID, SETTINGS.companionCommands, {
    name: "EE.Settings.CompanionCommands.Name",
    hint: "EE.Settings.CompanionCommands.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // Same reason as Reach: the buttons are added as documents are prepared, and
    // nothing re-prepares an open sheet on its own.
    onChange: () => reconcileCompanionCards(),
  });

  // World-scoped, and not merely for consistency: the dice are rolled wherever
  // the card is pressed and the answer is typed on the GM's client, so two
  // machines have to agree the feature exists. Nothing is written into prepared
  // data, so no reconciliation is needed — the next press reads the new value.
  game.settings.register(MODULE_ID, SETTINGS.communeOracle, {
    name: "EE.Settings.CommuneOracle.Name",
    hint: "EE.Settings.CommuneOracle.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and here about as plainly as it gets: the rule pauses one
  // client's roll to ask a question on another client's screen, and the answer
  // rewrites the Hope, the Fear and the hit that the whole table reads off a
  // single chat card. Nothing is written into prepared data — the next roll reads
  // the new value — and a roll already rewritten stays rewritten, which is what
  // the persisted duality marker is for.
  game.settings.register(MODULE_ID, SETTINGS.witchsCharm, {
    name: "EE.Settings.WitchsCharm.Name",
    hint: "EE.Settings.WitchsCharm.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and here it is the only coherent answer rather than house
  // style: the bonus is added while a roll is being built, on whichever client
  // is building it, so a per-user answer would have the same attack land at two
  // different numbers depending on who threw it. Nothing is written into
  // prepared data — the next roll re-reads the hex — so switching it off needs
  // no reconciliation, and leaves any effect already placed as an inert label.
  game.settings.register(MODULE_ID, SETTINGS.hexCondition, {
    name: "EE.Settings.Hex.Name",
    hint: "EE.Settings.Hex.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and not merely for consistency: this changes a number a chat
  // card prints for the whole table, so a per-user answer would have two people
  // reading different totals off the same potion. Nothing is written into
  // prepared data, so no reconciliation is needed — the next consumable pressed
  // reads the new value.
  game.settings.register(MODULE_ID, SETTINGS.herbalRemedies, {
    name: "EE.Settings.HerbalRemedies.Name",
    hint: "EE.Settings.HerbalRemedies.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped, and here more plainly than usual: the rule holds one client's
  // damage open while it asks a question on another client's screen, so a
  // per-user answer would make the talisman work or not depending on who pressed
  // Apply. Nothing is written into prepared data — the next hit reads the new
  // value — but a talisman already imbued stays on its holder until it is spent
  // or deleted, which is the same thing switching the feature off mid-session
  // does to every other standing effect in this module.
  game.settings.register(MODULE_ID, SETTINGS.tetheredTalisman, {
    name: "EE.Settings.TetheredTalisman.Name",
    hint: "EE.Settings.TetheredTalisman.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // World-scoped for the same reason as Companion, and it shares the mechanism:
  // the action is built during data preparation on every client that prepares the
  // card, so a per-user answer would put a button on one screen and not another.
  game.settings.register(MODULE_ID, SETTINGS.closeKnitShareHope, {
    name: "EE.Settings.CloseKnitShareHope.Name",
    hint: "EE.Settings.CloseKnitShareHope.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // Same reason as Reach and Companion: the button is added as documents are
    // prepared, and nothing re-prepares an open sheet on its own.
    onChange: () => reconcileCloseKnitCards(),
  });

  // World-scoped for the same reason as Tethered Talisman, whose seam it shares:
  // it changes what a hit writes, on whichever client is applying the damage.
  game.settings.register(MODULE_ID, SETTINGS.braveFace, {
    name: "EE.Settings.BraveFace.Name",
    hint: "EE.Settings.BraveFace.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // The card carries a counter that has to exist before the first hit lands.
    // Only the active GM's client writes; see `reconcileBraveFaceCards`.
    onChange: () => reconcileBraveFaceCards(),
  });

  // Same mechanism and so the same scope as Close-Knit: the button is built
  // during data preparation on every client, so it cannot be a per-user answer.
  game.settings.register(MODULE_ID, SETTINGS.attackOfOpportunity, {
    name: "EE.Settings.AttackOfOpportunity.Name",
    hint: "EE.Settings.AttackOfOpportunity.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => reconcileOpportunityCards(),
  });

  // World-scoped because the thing it switches on is *stored* — a counter on the
  // card that every client reads — rather than a view of it, so there is no
  // coherent per-user answer. The reconcile puts that counter on any card that
  // does not have one yet; switching the feature off leaves the dice alone.
  game.settings.register(MODULE_ID, SETTINGS.slayerDice, {
    name: "EE.Settings.SlayerDice.Name",
    hint: "EE.Settings.SlayerDice.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => void reconcileSlayerCards(),
  });

  game.settings.register(MODULE_ID, SETTINGS.notGoodEnoughReroll, {
    name: "EE.Settings.NotGoodEnoughReroll.Name",
    hint: "EE.Settings.NotGoodEnoughReroll.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // No onChange: this is read per damage roll rather than baked into a card, so
    // switching it takes effect on the next one with nothing to reconcile.
  });

  // The one client-scoped, player-facing setting — see the note at the top of
  // this file, and SETTINGS.notGoodEnoughAlwaysReroll in constants.ts. Off by
  // default: a card that has just appeared should ask the first time rather than
  // silently change a roll the player has not seen it change before.
  game.settings.register(MODULE_ID, SETTINGS.notGoodEnoughAlwaysReroll, {
    name: "EE.Settings.NotGoodEnoughAlwaysReroll.Name",
    hint: "EE.Settings.NotGoodEnoughAlwaysReroll.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    // No onChange: nothing is rendered from it — the next damage roll reads it.
  });

  // World-scoped: only a GM can write actor documents, and the artwork this
  // changes is shared by the whole table.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormPortrait, {
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — this is an opt-in integration with a third-party module,
    // and it rewrites character artwork.
    default: false,
    // Catch up immediately: enabling it mid-transformation should sync the
    // portrait, and disabling it should hand the original artwork back.
    onChange: () => void reconcileHybridFormPortraits(),
  });

  // Separate from the switch above because this one mutates persistent actor data
  // (the prototype token) rather than just the portrait that's displayed, so it's
  // off unless explicitly asked for.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormPrototype, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // No onChange: the value is read at transform time. Turning it off mid-form
    // is handled by the revert, which always restores from the snapshot.
  });

  // On by default — see SETTINGS.voidHybridFormStressRevert in constants.ts for why
  // this one doesn't follow the "third-party integration defaults off" pattern.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormStressRevert, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // No onChange: read live from the updateActor hook, so toggling it takes
    // effect on the next Stress change either way.
  });

  /* ---- Daggerheart Utilities ---------------------------------------------- */

  // Daggerheart applies an action's effects on the acting client, while core
  // requires OWNER of the target. On by default: without the GM relay the
  // system's own player-effect automation fails against ordinary adversaries.
  game.settings.register(MODULE_ID, SETTINGS.relayActionEffects, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // Read for every application, so the next effect observes a changed value.
  });

  // World-scoped: a cap on the decks in play is a table-wide rule the GM sets,
  // not a per-client preference. Off by default — it constrains something the
  // system itself leaves open.
  game.settings.register(MODULE_ID, SETTINGS.deckLimitEnabled, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // No onChange: nothing reads this yet — the enforcement is still to come.
  });

  // Only meaningful while the switch above is on, which is why the window greys
  // it out otherwise. `min="1"` on the field is what keeps a saved value usable;
  // a limit of zero is what turning the feature off already means.
  game.settings.register(MODULE_ID, SETTINGS.deckLimitCount, {
    scope: "world",
    config: false,
    type: Number,
    default: DEFAULT_DECK_LIMIT,
    // No onChange, for the same reason as the switch above.
  });

  // World-scoped like the rest: which actors are in the pool has to be one
  // answer for the whole table, or two clients would count differently.
  game.settings.register(MODULE_ID, SETTINGS.deckLimitPlayersOnly, {
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — the stricter reading, and the behavior that shipped
    // first. Turning it on is how a GM keeps their own sheets out of the count.
    default: false,
    // No onChange: the pool is recomputed on every question, so the next one
    // picks this up.
  });

  // One copies-per-deck setting per card type (see daggerheart/deck-limit.ts for
  // what each counts). All shaped the same: world-scoped, defaulting to what a
  // printed deck holds, and multiplied by the count above to get the real pool.
  for (const cardType of DECK_CARD_TYPES) {
    game.settings.register(MODULE_ID, cardType.settingKey, {
      scope: "world",
      config: false,
      type: Number,
      default: cardType.copies,
    });
  }

  /* ---- Session Log -------------------------------------------------------- */

  // World-scoped: the log is one shared record of the session, not a per-client
  // preference. Off by default — nothing should be recorded until the GM opts in.
  game.settings.register(MODULE_ID, SETTINGS.sessionLogEnabled, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // No onChange: every event source reads this live.
  });

  // One toggle per log category (see session-log/session-log-store.ts), all
  // shaped the same: world-scoped, on by default once the master switch above
  // is on, and read live by each event source rather than needing an onChange.
  for (const key of CATEGORY_SETTING_KEYS) {
    game.settings.register(MODULE_ID, key, {
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
    });
  }

  // The recorded entries themselves — a plain append-only list. Not edited
  // through this window; there's no viewer yet.
  game.settings.register(MODULE_ID, SETTINGS.sessionLogEntries, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    // Fires on every client whenever the log changes; checkForSessionBoundary
    // narrows to the GM's own client and only acts once a 12-hour gap has
    // actually opened up (see session-log-export.ts).
    onChange: (value: unknown) => checkForSessionBoundary(value),
  });

  /* ---- The buttons, in the order they should appear ----------------------- */
  //
  // `restricted: true` on all of them keeps them GM-only, which matters because
  // every setting above is world-scoped and only a GM can write one.
  //
  // Registration order is DOM order in Foundry's settings list, so the two menu
  // groups below are kept contiguous. `settings-groups.ts` also gives the lone
  // player-facing setting, which core renders after the menus, its own group.
  // Moving a menu between groups means moving both its registration here and
  // its entry in that file's SETTING_GROUPS.

  game.settings.registerMenu(MODULE_ID, MENUS.generalFeaturesMenu, {
    name: "EE.Settings.GeneralFeaturesMenu.Name",
    label: "EE.Settings.GeneralFeaturesMenu.Label",
    hint: "EE.Settings.GeneralFeaturesMenu.Hint",
    icon: "fa-solid fa-sliders",
    type: GeneralFeaturesConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.hotbarPagesMenu, {
    name: "EE.Settings.HotbarPagesMenu.Name",
    label: "EE.Settings.HotbarPagesMenu.Label",
    hint: "EE.Settings.HotbarPagesMenu.Hint",
    icon: "fa-solid fa-bars-staggered",
    type: HotbarPagesConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.sessionLogMenu, {
    name: "EE.Settings.SessionLogMenu.Name",
    label: "EE.Settings.SessionLogMenu.Label",
    hint: "EE.Settings.SessionLogMenu.Hint",
    icon: "fa-solid fa-book",
    type: SessionLogConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.daggerheartAutomationMenu, {
    name: "EE.Settings.DaggerheartAutomationMenu.Name",
    label: "EE.Settings.DaggerheartAutomationMenu.Label",
    hint: "EE.Settings.DaggerheartAutomationMenu.Hint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: DaggerheartAutomationConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.daggerheartUtilitiesMenu, {
    name: "EE.Settings.DaggerheartUtilitiesMenu.Name",
    label: "EE.Settings.DaggerheartUtilitiesMenu.Label",
    hint: "EE.Settings.DaggerheartUtilitiesMenu.Hint",
    icon: "fa-solid fa-layer-group",
    type: DaggerheartUtilitiesConfig,
    restricted: true,
  });
}
