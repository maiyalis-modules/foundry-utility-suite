/**
 * Maiyalis: Utility Suite — module entry point.
 *
 * Wires the module into FoundryVTT's lifecycle hooks. Feature logic lives in
 * sibling modules under `src/`; this file only bootstraps.
 */
import { LOG_PREFIX, TEMPLATES } from "./constants.js";
import { releaseOwnHolds } from "./daggerheart/deck-holds.js";
import { registerDeckLimitBrowser } from "./daggerheart/deck-limit-browser.js";
import { registerDeckLimitGuard } from "./daggerheart/deck-limit-guard.js";
import { registerDeckLimitWizard } from "./daggerheart/deck-limit-wizard.js";
import { registerAdaptability } from "./daggerheart/adaptability.js";
import { registerAdversaryAttack } from "./daggerheart/adversary-attack.js";
import { registerAttackOfOpportunity } from "./daggerheart/attack-of-opportunity.js";
import { registerBloodMaledict } from "./daggerheart/blood-maledict.js";
import { registerBlightingStrike } from "./daggerheart/blighting-strike.js";
import { registerDamageLanding } from "./daggerheart/damage-landing.js";
import { registerBloodSpike } from "./daggerheart/blood-spike.js";
import { registerCardTargeting } from "./daggerheart/card-targeting.js";
import { registerCloseKnit } from "./daggerheart/close-knit.js";
import { registerCommune } from "./daggerheart/commune.js";
import { registerCompanion } from "./daggerheart/companion.js";
import { registerCrimsonRite } from "./daggerheart/crimson-rite.js";
import { registerDualityOutcome } from "./daggerheart/duality-outcome.js";
import { registerFearless } from "./daggerheart/fearless.js";
import { registerFeatureAsk } from "./daggerheart/feature-ask.js";
import { registerFelineInstincts } from "./daggerheart/feline-instincts.js";
import { registerGiftedTracker } from "./daggerheart/gifted-tracker.js";
import { registerHerbalRemedies } from "./daggerheart/herbal-remedies.js";
import { registerHoldThemOff } from "./daggerheart/hold-them-off.js";
import { registerISeeItComing } from "./daggerheart/i-see-it-coming.js";
import { registerGmEffects } from "./daggerheart/gm-effects.js";
import { registerGmActionEffects } from "./daggerheart/gm-action-effects.js";
import { registerNotGoodEnough } from "./daggerheart/not-good-enough.js";
import { registerRangersFocus } from "./daggerheart/rangers-focus.js";
import { registerReach } from "./daggerheart/reach.js";
import { reconcileSlayerCards, registerSlayer } from "./daggerheart/slayer.js";
import { installRollPipeline } from "./daggerheart/roll-pipeline.js";
import { registerViciousEntangle } from "./daggerheart/vicious-entangle.js";
import { registerHotbarPages } from "./hotbar/hotbar-pages.js";
import { registerGinzzzuPortraits } from "./integrations/ginzzzu-portraits.js";
import { registerQuickActionsRollRequest } from "./integrations/quickactions-roll-request.js";
import { registerVoidHybridForm } from "./integrations/void-hybrid-form.js";
import { registerVoidHybridFormStressEnd } from "./integrations/void-hybrid-form-stress.js";
import { registerSessionLog } from "./session-log/session-log-events.js";
import { registerSessionLogFlagButton } from "./session-log/session-log-flag-button.js";
import { registerSettingsGroups } from "./settings-groups.js";
import { registerSettings } from "./settings.js";
import { registerDragAnimation } from "./tokens/drag-animation.js";
import { registerInvisibleTokens } from "./tokens/invisible-tokens.js";
import { registerTokenBar } from "./tokens/token-bar.js";

Hooks.once("init", async () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  registerSettings();
  registerSettingsGroups();
  registerInvisibleTokens();
  registerTokenBar();
  registerDragAnimation();
  registerHotbarPages();
  registerSessionLog();
  registerSessionLogFlagButton();
  registerDeckLimitGuard();
  registerDeckLimitBrowser();
  registerDeckLimitWizard();
  // Every one of these patches the system's data preparation, so they have to be
  // in place before any document is constructed — `init` is the last hook that
  // guarantees that.
  //
  // Attack of Opportunity first, and *before* Reach: these patches nest, so the
  // one installed earliest runs innermost. Its derived action is therefore already
  // in `system.actions` when Reach walks them, which is what lets a Giant Warrior's
  // Attack of Opportunity reach Very Close like everything else they own. After
  // Reach it would be injected too late to be promoted, and the one action on the
  // sheet still printing Melee would be the one whose whole trigger is a range.
  registerAttackOfOpportunity();
  // Reach next, so the Companion card's patch wraps it and therefore runs last:
  // the companion's attack reaches as far as the companion does, whatever the
  // ranger's ancestry says about their own arms. See `CachedActions.ranges`.
  registerReach();
  registerCompanion();
  // A third patch on the same seam, and the only one with no ordering to respect:
  // it adds a button to one community card and touches nothing Reach or Companion
  // reads. Here rather than down with the roll windows because, like Crimson Rite,
  // it is activated by an action and takes no part in the pipeline's ordering.
  registerCloseKnit();
  // Feature automation: every window declares itself, then every feature
  // registers into one, and only then is the system's roll pipeline patched —
  // `installRollPipeline` runs the windows in registration order, so it has to
  // come last. All of it before the first roll, and `init` is the earliest point
  // the system's roll classes are reachable.
  registerFeatureAsk();
  // The other half of the socket channel: marking somebody else's actor, which a
  // player has no permission to do themselves. Listener only — the senders are
  // features, and it does nothing on a client that isn't the writing GM.
  registerGmEffects();
  // Daggerheart applies action effects directly on the acting client's machine.
  // Relay the copy through the GM only when that client does not own the target.
  registerGmActionEffects();
  // Before the duality window, and the order is deliberate: Adaptability may
  // *replace* the roll outright, and Fearless asks whether to convert that
  // roll's Fear into Hope. Rerolling first means the question is asked about the
  // dice the player is keeping, rather than about a result that is discarded a
  // moment later. (It also carries a chat-card control for rolls the system
  // never scores, which takes no part in this ordering.)
  registerAdaptability();
  // Beside Adaptability and for the same reason, though it buys a narrower
  // thing: it rerolls the Hope Die alone, which *is* the Hope/Fear result, so it
  // has to settle before the duality window asks anything about that result.
  // After Adaptability only because a character holding both would rather be
  // asked about the whole roll before being asked about one of its dice.
  registerFelineInstincts();
  registerDualityOutcome();
  registerAdversaryAttack();
  // Its own window rather than a registry feature — one card's rule, not a
  // reaction anything else could join. After `registerDualityOutcome` because
  // both can fire on the same roll, and the one that rewrites the Hope/Fear
  // result should settle before the one that only reads whether it hit.
  registerBloodSpike();
  registerFearless();
  registerBloodMaledict();
  registerISeeItComing();
  // A registry feature on the same window, plus a card of its own. Registered
  // before the Ranger pair only because it is a domain card, like the two above
  // it — nothing on this window depends on the order between them, since each
  // re-decides the hit from whatever Evasion the last one left behind.
  registerGiftedTracker();
  // Two Ranger features that fire on the same weapon attack, and the order
  // between them is deliberate: Ranger's Focus may *replace* the roll (its reroll)
  // and asks its first question before the dice are revealed, so it has to settle
  // before Hold Them Off shows them and offers extra adversaries.
  registerRangersFocus();
  // Its own window too — one class feature's rule, and one that adds targets to a
  // roll rather than reacting to one. Last of the windows, which costs nothing: a
  // weapon attack is neither a spellcast nor an adversary's roll, so no other
  // window is looking at it.
  registerHoldThemOff();
  // The only window on a *damage* roll rather than an attack or a Duality, so
  // nothing else is looking at what it changes and its place in this list costs
  // nothing. It has to be registered before `installRollPipeline` all the same.
  registerNotGoodEnough();
  // Four separate rules on one card, and none of them is a reaction window: it
  // hooks the duality window through the registry, patches two of the system's
  // roll classes, and installs one roll window of its own. Before
  // `installRollPipeline` for that last reason; its place in the window order
  // costs nothing, since it changes no roll and only takes dice off a card.
  registerSlayer();
  installRollPipeline();
  // Not a roll window: Crimson Rite is activated by an action and delivered as a
  // standing ActiveEffect, so it hooks the system directly and takes no part in
  // the pipeline's ordering.
  registerCrimsonRite();
  // Not a roll window at all: it repairs the card's own shape at preparation time
  // so the system resolves it natively, and takes no part in any ordering here.
  registerBlightingStrike();
  // Not a roll window either: one card, whose second clause is a follow-up the
  // SRD leaves entirely to the table. It answers that card's action chooser and
  // then reads the price and the effect off the card's own second action, so it
  // takes no part in any ordering.
  registerViciousEntangle();
  // Not a roll window either: one card whose dice are its own, rolled after the
  // action has already resolved. It hooks `postUseAction` and a socket of its
  // own, so its place in this list costs nothing.
  registerCommune();
  // Not a roll window either, and not a card that can be pressed at all: a
  // passive rule that raises a consumable's healing formula before it is rolled.
  // It patches one of the system's action fields directly, and waits for `setup`
  // to do it, so its place in this list is only tidiness.
  registerHerbalRemedies();
  // The single wrapper behind every rule that fires when damage lands. After the
  // features, so every rule they register is already listed — though the patch
  // itself waits for `setup`, so the order is only tidiness.
  registerDamageLanding();
  // The single wrapper behind every card that declares a target it must not ask
  // for. After the features, so every rule they register is already listed —
  // though the patch itself waits for `setup`, so the order is only tidiness.
  registerCardTargeting();
  // Third-party integrations: each hooks nothing unless its module is active.
  registerVoidHybridForm();
  registerVoidHybridFormStressEnd();
  registerGinzzzuPortraits();
  registerQuickActionsRollRequest();
  await foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} Ready (system: ${game.system.id} v${game.system.version}).`);
  // No wizard of ours can be open this early, so any Deck Limit hold still on
  // this user is left over from a crash or a mid-wizard reload.
  void releaseOwnHolds();
  // The Slayer card's dice pool is stored on the card, so somebody has to put it
  // there. Only the active GM's client actually writes; see `reconcileSlayerCards`.
  void reconcileSlayerCards();
});
