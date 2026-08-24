/**
 * **Ranger's Focus** (Ranger class feature, SRD) — "Spend a Hope and make an
 * attack against a target. On a success, deal your attack's normal damage and
 * temporarily make the attack's target your Focus. Until this feature ends or you
 * make a different creature your Focus, you gain the following benefits against
 * your Focus: you know precisely what direction they are in; when you deal damage
 * to them, they must mark a Stress; when you fail an attack against them, you can
 * end your Ranger's Focus feature to reroll your Duality Dice."
 *
 * ## What the SRD ships, and what it leaves to the table
 *
 * `Compendium.daggerheart.classes.Item.ncLx2P8BOUtrAD38`, a `feature` Item with
 * one action — an `effect` action named "Spend Hope" that charges 1 Hope and
 * applies a marker ActiveEffect (no `changes`, pure prose) to whatever is
 * targeted. That is genuinely half of the first sentence, and none of the rest:
 *
 * - it is not attached to an attack, so the Hope is spent by pressing a card and
 *   the attack is a separate roll nobody has tied to it;
 * - the marker lands **whether or not the attack succeeded**, and whether or not
 *   an attack happened at all;
 * - nothing removes a previous Focus, so "or you make a different creature your
 *   Focus" has to be policed by hand;
 * - none of the three benefits does anything;
 * - and the marker **cannot land at all for a player**, because core requires
 *   OWNER of the parent to create an ActiveEffect and an adversary is the GM's.
 *   Pressing the button as a player raises "lacks permission to create
 *   ActiveEffect" and does nothing else. It works for the GM, which is how that
 *   survived. {@link registerFocusCard} takes the action over and makes it do its
 *   own job by the route that works.
 *
 * ## Where the Focus is kept, and why it is not on the target
 *
 * On the **ranger**, as an ActiveEffect carrying
 * `flags.eryndor-essentials.rangersFocus` — the target's uuid, token id and name.
 * The SRD puts its marker on the target, and that is the one thing here that
 * could not be automated: an attack is resolved on the *attacking player's*
 * client, and a player has no permission to create an ActiveEffect on an
 * adversary. Every write this feature makes therefore lands either on the
 * ranger's own actor (the effect) or through a system call that relays to the GM
 * on its own ({@link markFocusStress}), so nothing needs a socket protocol of its
 * own and nothing silently fails on the client that matters.
 *
 * Keeping it on the ranger also makes the rest fall out: exactly one Focus per
 * ranger is "exactly one such effect", replacing it is delete-then-create, and
 * "until this feature ends" is a player deleting an effect on their own sheet.
 *
 * The creature *does* get a companion label — "Aangry Mank's Focus" — so the GM
 * can see which token is being hunted without opening the ranger's sheet. That
 * one is written by the GM's client on request (`gm-effects.ts`), carries no
 * `changes`, and is treated as losable: it is a label, and the ranger's own
 * effect remains the only thing this feature reads.
 *
 * ## The three benefits
 *
 * - **"You know precisely what direction they are in"** — deliberately not
 *   automated. It grants no mechanical bonus, and the honest implementation is
 *   the GM telling the player; the effect's own description carries the wording
 *   so it is on the sheet where they will look. (The Tokens on Scene bar's range
 *   survey already answers "where is everyone" when the table wants a number.)
 * - **"When you deal damage to them, they must mark a Stress"** — a wrapper on
 *   the system's `DamageField.applyDamage`, which is the exact moment damage
 *   lands: it is what the action workflow calls at order 75, and it is also what
 *   the chat card's *Apply* button calls. See {@link registerFocusStress}.
 * - **"When you fail an attack against them, you can end your Ranger's Focus
 *   feature to reroll your Duality Dice"** — a prompt at the roll seam, ending
 *   the effect and rebuilding the roll, which is how `adversary-attack.ts`
 *   already delivers a reroll.
 *
 * ## The order of operations, which is the whole design
 *
 * "Spend a Hope **and** make an attack" is one action, so the card's button is
 * the entry point and everything else follows from it:
 *
 * 1. **Press the card.** The system charges the Hope, exactly as it would.
 * 2. **Choose a weapon** — one of the two equipped. Asked here rather than later
 *    because step 3 needs a range to filter by, and until now there isn't one.
 * 3. **Choose a target.** The attack is launched with *nothing* targeted, which
 *    is precisely the condition `daggerheart-target-helper`'s guard exists for:
 *    it cancels the attack before anything is rolled or spent, offers the scene's
 *    candidates within **that weapon's** range, and replays it.
 * 4. **Roll to hit** — an ordinary attack from here, with its own dialog,
 *    advantage, Experiences and damage. None of it is reimplemented.
 * 5. **On a hit**, the target becomes the Focus: a record on the ranger, a label
 *    on the creature, and a line in chat. Nothing further is asked.
 *
 * Two earlier shapes were tried and were wrong. Don't return to either.
 *
 * - **Asking on every attack.** The card was left alone and *every* single-target
 *   attack asked "is this a Ranger's Focus attack?", raised before the dice were
 *   revealed — faithful to the moment the rule says the choice is made, and
 *   unusable, because a ranger attacks constantly and almost none of those
 *   attacks are this one. Frequency beats fidelity here.
 * - **Targeting before the weapon.** Leaving the card's own `target.type` alone
 *   makes the button a targeted action, so the player picks someone with no range
 *   to filter by and is then asked again for the attack. The shared patch in
 *   `card-targeting.ts` closes that before any hook can run.
 *
 * The one prompt that still fires off an ordinary attack is the reroll, and its
 * door is narrow by construction: the attack must have *failed*, against the
 * creature that already **is** the Focus. That one does reveal the dice first
 * ({@link showDiceEarly}) — "when you fail an attack" is knowable only after the
 * failure.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { damagedTargets, onDamageLanding } from "./damage-landing.js";
import { chooseOne, confirmChoice, type PromptParty } from "./feature-prompt.js";
import { markActor, unmarkActor, type MarkRequest } from "./gm-effects.js";
import { findGrantingItem, resourceUpdatesFor, type FeatureMatch } from "./feature-registry.js";
import {
  rebuildRoll,
  registerRollWindow,
  rollTypeOf,
  rollVisibility,
  showDiceEarly,
} from "./roll-pipeline.js";
import { attackActionOf, rollingCharacter, weaponOption } from "./attack-action.js";
import { untargetAction } from "./card-targeting.js";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "rangersFocus";

/** How the granting Item is recognised — flag, then compendium, then name. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.classes.Item.ncLx2P8BOUtrAD38"],
  // Both apostrophes: the SRD's own name uses a straight one, and a card typed in
  // by hand in any word processor will not.
  names: ["Ranger's Focus", "Ranger’s Focus"],
};

/** Prefix for this feature's console lines. */
const LABEL = "Ranger's Focus";

/**
 * The two roll types an attack action can produce.
 *
 * Both are needed, and the reason is a trap: `DHAttackAction.getRollType` returns
 * `attack` when the action's parent is a weapon and `spellcast` otherwise, so a
 * ranger's Sage-domain spell attack is a `spellcast` roll. This card says only
 * "make an attack", unlike Hold Them Off's "an attack **with a weapon**" — so
 * matching `attack` alone would silently exclude half of what it covers. The roll
 * type is not by itself proof of an attack, though (a non-attack action can also
 * roll `spellcast`), which is why the action's own type is checked as well.
 */
const ATTACK_ROLLS = ["attack", "spellcast"];

/**
 * Marks the attack the card launched, so the roll window knows this one is
 * Ranger's Focus without having to ask anybody anything.
 *
 * **It rides on the `event`, not on `configOptions`, and that is load-bearing.**
 * Both reach the config — `prepareBaseConfig` stores the event and spreads the
 * options — but the attack is expected to be *cancelled and replayed* by
 * `daggerheart-target-helper`'s targeting guard, which is how the target gets
 * picked (see {@link makeFocusAttack}). That guard replays with
 * `action.use(config.event ?? null)` and **cannot** carry `configOptions`, which
 * the hook never exposed to it. A marker in the options would therefore survive
 * the ordinary path and vanish on the one that matters. The event object round
 * trips.
 *
 * `{}` as an event is the system's own convention for using an action from
 * something other than a click (see its `useAttack` macro helper), so a plain
 * object carrying one extra property is well within what the field expects.
 *
 * Dot-free on purpose, for the reason `roll-pipeline.ts` sets out: Foundry's
 * object helpers treat a dot in a key as a path.
 */
const FOCUS_ATTACK = "eeRangersFocus";

/** The character's two weapon slots, in the order they should be offered. */
const WEAPON_SLOTS = ["primaryWeapon", "secondaryWeapon"];

/** What the Focus marks when it is damaged. */
const STRESS = "stress";
const STRESS_MARK = 1;

/**
 * Actor types that can be a Focus.
 *
 * The card says "creature", and these are the four `CONFIG.DH.ACTOR.actorTypes`
 * that are one — `environment` and `party` are the two that are not. Kept
 * permissive rather than narrowed to `adversary`, because nothing in the wording
 * limits it and a table running an NPC statblock as an enemy should not have the
 * rule quietly decline.
 */
const FOCUSABLE_TYPES = ["adversary", "npc", "character", "companion"];

/** What the effect on the ranger records about their Focus. */
interface FocusMark {
  /** The focused actor's UUID — an ActorDelta's for an unlinked token, so unique. */
  actorUuid: string;
  /** Its token on the scene it was focused on, for display only. */
  tokenId: string;
  /** The token's name at the time, so the effect reads as itself with no lookup. */
  name: string;
  /** Portrait, for the prompt's banner. */
  img: string;
}

/** One entry of `config.targets`, as `TargetField.formatTarget` builds it. */
interface TargetEntry {
  id: string;
  /** The target actor's **uuid**, despite the name. */
  actorId: string;
  name: string;
  img: string;
}

/** An active Focus: the effect that records it, and what it records. */
interface ActiveFocus {
  effect: AnyObject;
  mark: FocusMark;
}

/** Is this feature switched on? Checked per event, so the toggle is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.rangersFocusTracking) === true;
}

/**
 * The Focus effect on this actor, if it has one.
 *
 * Note this is the ranger's *own* record, keyed on `FLAGS.rangersFocus`. The
 * label a focused creature carries uses `FLAGS.rangersFocusTarget` instead, so
 * that a character who is both a ranger with a Focus and somebody else's Focus
 * never has one mistaken for the other.
 */
function focusEffectOn(actor: AnyObject): AnyObject | null {
  for (const effect of actor["effects"] ?? []) {
    if (effect?.["flags"]?.[MODULE_ID]?.[FLAGS.rangersFocus]) return effect;
  }
  return null;
}

/** What that effect points at, or null if it isn't ours or is malformed. */
function focusMarkOf(effect: AnyObject | null): FocusMark | null {
  const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.rangersFocus];
  const actorUuid = String(mark?.["actorUuid"] ?? "");
  if (!actorUuid) return null;

  return {
    actorUuid,
    tokenId: String(mark?.["tokenId"] ?? ""),
    name: String(mark?.["name"] ?? ""),
    img: String(mark?.["img"] ?? ""),
  };
}

/** This ranger's current Focus, or null. */
function focusOn(actor: AnyObject): ActiveFocus | null {
  const effect = focusEffectOn(actor);
  const mark = focusMarkOf(effect);
  return effect && mark ? { effect, mark } : null;
}

/** An equipped weapon and the attack action on it. */
interface EquippedAttack {
  weapon: AnyObject;
  attack: AnyObject;
}

/**
 * The character's equipped weapons that actually carry an attack, primary first.
 *
 * `system.primaryWeapon` / `secondaryWeapon` are the system's own prepared
 * pointers at the two equipped Items — the same pair `crimson-rite.ts` reads, and
 * the only per-weapon slotting Daggerheart has. A weapon with no `system.attack`
 * is skipped rather than offered and then found to be unusable.
 */
function equippedAttacks(actor: AnyObject): EquippedAttack[] {
  const found: EquippedAttack[] = [];

  for (const slot of WEAPON_SLOTS) {
    const weapon = actor["system"]?.[slot] as AnyObject | undefined;
    const attack = weapon?.["system"]?.["attack"] as AnyObject | undefined;
    if (weapon && attack && typeof attack["use"] === "function") found.push({ weapon, attack });
  }

  return found;
}

/** A party for the prompt's banner. */
function partyOf(actor: AnyObject): PromptParty {
  return {
    name: String(actor["name"] ?? ""),
    img: actor["img"] ? String(actor["img"]) : undefined,
  };
}

/**
 * The one creature this attack could focus on, or null.
 *
 * **Exactly one**, because the card says "make an attack against *a target*" and
 * then "the attack's target" — singular both times, with no tie-break offered for
 * a swing that went at three people. Declining on a multi-target attack is
 * therefore the rule rather than a simplification, and it keeps the prompt from
 * having to ask a second question the player would answer before seeing the dice.
 */
function soleTarget(config: AnyObject): TargetEntry | null {
  const targets = (config["targets"] ?? []) as AnyObject[];
  if (targets.length !== 1) return null;

  const target = targets[0]!;
  const actorId = String(target["actorId"] ?? "");
  if (!actorId) return null;

  return {
    id: String(target["id"] ?? ""),
    actorId,
    name: String(target["name"] ?? ""),
    img: String(target["img"] ?? ""),
  };
}

/** Does this target name something that can actually be a Focus? */
function focusable(target: TargetEntry | null): TargetEntry | null {
  if (!target) return null;

  const actor = fromUuidSync(target.actorId);
  return actor && FOCUSABLE_TYPES.includes(String(actor["type"] ?? "")) ? target : null;
}

/**
 * Say what happened, in the chat card's own audience.
 *
 * A message rather than a notification because the *GM* is the one who has to
 * remember who the Focus is — the effect that records it lives on the ranger's
 * sheet, which is the one sheet the GM is not looking at. Whispered exactly as
 * far as the attack itself will be: this runs on the roller's client, and a
 * private roll must not have its consequences announced to the table.
 *
 * Failure is swallowed. The Hope is already spent and the Focus already set;
 * losing the announcement must not cost the player the feature.
 */
async function announce(config: AnyObject, actor: AnyObject, text: string): Promise<void> {
  try {
    const { whisper, blind } = rollVisibility(config);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${escapeHtml(text)}</p>`,
      // Omitted rather than passed as null: core reads the presence of the field.
      ...(whisper ? { whisper } : {}),
      blind,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce.`, error);
  }
}

/**
 * End the ranger's current Focus, if they have one. Returns what it was.
 *
 * The delete *is* the rule — "until this feature ends or you make a different
 * creature your Focus" — so both the reroll and a re-focus go through here.
 */
async function endFocus(ranger: AnyObject): Promise<FocusMark | null> {
  const current = focusOn(ranger);
  if (!current) return null;

  await ranger["deleteEmbeddedDocuments"]?.("ActiveEffect", [current.effect["id"]]);

  // The companion marker on the creature, which usually needs the GM's client to
  // remove it. Not awaited against the ranger's own record: that one is the
  // truth, and a marker left on a deleted token must not block ending a feature.
  void unmarkActor(markRequestFor(ranger, current.mark.actorUuid));

  return current.mark;
}

/** The GM-side marker request pairing this ranger with a creature. */
function markRequestFor(ranger: AnyObject, actorUuid: string): MarkRequest {
  return {
    kind: "rangersFocus",
    actorUuid,
    sourceUuid: String(ranger["uuid"] ?? ""),
    sourceName: String(ranger["name"] ?? ""),
  };
}

/**
 * Make `target` this ranger's Focus, replacing whatever it was before.
 *
 * The effect is built here rather than copied from the granting Item's own
 * marker: the SRD's is written about an adversary, for the adversary's sheet
 * ("they know precisely what direction *they* are in"), and this one goes on the
 * ranger. It carries no `changes` — every benefit is enforced by code elsewhere
 * in this file — so it is a visible, deletable record and nothing more.
 */
async function setFocus(ranger: AnyObject, item: AnyObject, target: TargetEntry): Promise<void> {
  await endFocus(ranger);

  const mark: FocusMark = {
    actorUuid: target.actorId,
    tokenId: target.id,
    name: target.name,
    img: target.img,
  };

  await ranger["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.format("EE.Features.RangersFocus.EffectName", { target: target.name }),
      img: item["img"],
      // The card it came from, so the effect is traceable back on the sheet.
      origin: String(item["uuid"] ?? ""),
      description: game.i18n.localize("EE.Features.RangersFocus.EffectDescription"),
      disabled: false,
      // Created straight onto the actor: there is no item for it to transfer from.
      transfer: false,
      type: "base",
      system: { changes: [] },
      flags: { [MODULE_ID]: { [FLAGS.rangersFocus]: mark } },
    },
  ]);

  // The companion marker on the creature, so the GM can see which token is being
  // hunted without reading the ranger's sheet. Routed through the GM because a
  // player cannot write an ActiveEffect onto an adversary; not awaited, and a
  // table with no GM connected simply doesn't get it. The record above is the
  // one this feature reads — this is a label, and is treated as losable.
  void markActor(markRequestFor(ranger, target.actorId));
}


/**
 * Settle an attack the card launched: the Focus is made, or the Hope was wasted.
 *
 * No prompt, because the decision was taken when the button was pressed. That is
 * the whole point of driving the attack from the ability rather than watching
 * every attack go past and asking about each one.
 */
async function settleFocusAttack(
  config: AnyObject,
  ranger: AnyObject,
  item: AnyObject,
  target: TargetEntry | null,
): Promise<void> {
  if (config["roll"]?.["success"] !== true || !target) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the Focus attack missed; the Hope is spent.`);
    await announce(
      config,
      ranger,
      game.i18n.format("EE.Features.RangersFocus.Missed", {
        ranger: String(ranger["name"] ?? ""),
      }),
    );
    return;
  }

  await setFocus(ranger, item, target);
  await announce(
    config,
    ranger,
    game.i18n.format("EE.Features.RangersFocus.Announced", {
      ranger: String(ranger["name"] ?? ""),
      target: target.name,
    }),
  );
}

/**
 * Offer the reroll on a failed attack against the Focus.
 *
 * Shows the dice first, unlike the declaration: "when you fail an attack" is a
 * condition the player has to be able to see before deciding what to give up
 * for it.
 */
async function offerReroll(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
  ranger: AnyObject,
  focus: ActiveFocus,
): Promise<AnyObject | void> {
  await showDiceEarly(roll, config);

  const rerolling = await confirmChoice({
    title: game.i18n.localize("EE.Features.RangersFocus.Title"),
    headline: {
      source: partyOf(ranger),
      target: { name: focus.mark.name, img: focus.mark.img || undefined },
      verdict: game.i18n.localize("EE.Features.VerdictMiss"),
    },
    intro: game.i18n.format("EE.Features.RangersFocus.RerollIntro", { target: focus.mark.name }),
    confirmLabel: game.i18n.localize("EE.Features.RangersFocus.RerollConfirm"),
    declineLabel: game.i18n.localize("EE.Features.RangersFocus.RerollDecline"),
  });

  if (!rerolling) return;

  // Ended first, and awaited: the feature is what pays for the reroll, so a
  // failed delete must not leave the ranger with both.
  await endFocus(ranger);
  await announce(
    config,
    ranger,
    game.i18n.format("EE.Features.RangersFocus.Ended", {
      ranger: String(ranger["name"] ?? ""),
      target: focus.mark.name,
    }),
  );

  return (await rebuildRoll(roll, config, message, LABEL)) ?? undefined;
}

/**
 * The roll window: declare on a fresh target, or reroll against the Focus.
 *
 * The two are mutually exclusive by construction — one needs the attack's target
 * *not* to be the Focus, the other needs it to be — which is why they can share a
 * window without either having to know about the other.
 */
async function runRangersFocusWindow(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
): Promise<AnyObject | void> {
  if (!enabled()) return;

  // Silent gate: most attack rolls in the world are nothing to do with this.
  // Past here every exit says why, because past here a player might reasonably
  // have expected the prompt and needs to be able to find out.
  const ranger = rollingCharacter(config);
  if (!ranger) return;

  const item = findGrantingItem(ranger, FEATURE_ID, MATCH);
  if (!item) return;

  // Any attack, not only one with a weapon — the card says nothing about how the
  // attack is made. This is what rules out a Spellcast roll that was not an
  // attack in the first place; see {@link ATTACK_ROLLS}.
  if (!attackActionOf(ranger, config, LABEL)) return;

  const target = focusable(soleTarget(config));

  // The attack the card launched. It asked its questions up front, so this
  // branch is silent: it either makes the Focus or reports the wasted Hope.
  if (config["event"]?.[FOCUS_ATTACK] === true) {
    await settleFocusAttack(config, ranger, item, target);
    return;
  }

  // Otherwise the only thing left is the third benefit, and only when this
  // attack failed against the creature that already *is* the Focus. That is a
  // narrow enough door that no ordinary attack ever raises a prompt.
  if (config["roll"]?.["success"] === true) return;

  const focus = focusOn(ranger);
  if (!focus || !target || focus.mark.actorUuid !== target.actorId) return;

  return await offerReroll(roll, config, message, ranger, focus);
}

/**
 * The card's own "Spend Hope" action, if this is it — returning the granting Item.
 *
 * Matched through {@link findGrantingItem} rather than against the action
 * directly, so the card is recognised here exactly as it is on a roll, homebrew
 * flag included, and then confirmed to be the *same* Item this action belongs to.
 * Narrowed to an action that carries effects, because that is the one whose job
 * this takes over; a table that adds a second action to the card keeps it.
 */
function focusCardAction(action: AnyObject | null | undefined): AnyObject | null {
  const actor = action?.["actor"] as AnyObject | undefined;
  const item = action?.["item"] as AnyObject | undefined;
  if (!actor || !item || actor["type"] !== "character") return null;

  const granting = findGrantingItem(actor, FEATURE_ID, MATCH);
  if (!granting || granting["id"] !== item["id"]) return null;

  const effects = action?.["effects"] as unknown[] | undefined;
  return effects && effects.length > 0 ? granting : null;
}

/**
 * The card's button becomes the whole feature: press it, pick a weapon, attack.
 *
 * ## Why the ability drives the attack instead of the attack asking
 *
 * "Spend a Hope **and make an attack**" is one action, and the card is where a
 * player goes to take it. An earlier version put the question the other way
 * round — every single-target attack asked "is this a Ranger's Focus attack?"
 * before revealing the dice, which was faithful to the moment the choice is made
 * and unusable at the table, because a ranger attacks constantly and almost none
 * of those attacks are this. Driving the attack *from* the ability asks nothing
 * of the attacks that aren't, and asks nothing at all of the one that is: press,
 * choose a weapon, and the answer to "did you spend the Hope" is already yes.
 *
 * ## What was wrong with the button
 *
 * The SRD action applies its marker ActiveEffect to whatever is targeted, and
 * `EffectsField.applyEffect` does that with a bare
 * `ActiveEffect.implementation.create(data, { parent: actor })`. Core requires
 * OWNER of the parent to create an ActiveEffect (`BaseActiveEffect.#canCreate`),
 * and an adversary is the GM's — so for a **player** the button has never done
 * anything but raise "lacks permission to create ActiveEffect". It works when the
 * GM presses it, which is exactly how a bug like that survives. (Note this is the
 * system's own gap rather than something fixable generally: its "players apply
 * effects" automation writes directly, where `modifyResource` relays to the GM.)
 *
 * ## The two hooks
 *
 * `preUseAction` runs **before the cost**, so it is where everything that could
 * make the press pointless is checked — no target, too many targets, nothing
 * equipped — and refused by returning `false`, which aborts `use()` with the Hope
 * unspent. It also clears `config.hasEffect`, the flag `EffectsField.execute`
 * returns early on, so the doomed write never happens. Suppressed for the GM too:
 * leaving the SRD effect to land for whoever has permission would mean the button
 * did two different things depending on who pressed it.
 *
 * `postUseAction` runs **after** it — `use()` flushes `resourceUpdates` between
 * the two — so by then the Hope is spent and the attack can be launched.
 *
 * Both hooks are synchronous, and a listener returning `false` cancels the
 * action. That is load-bearing in the first and a hazard in the second, where
 * every path must return `undefined`.
 */
function registerFocusCard(): void {
  Hooks.on("daggerheart.preUseAction", (action: AnyObject, config: AnyObject): boolean | void => {
    try {
      if (!enabled() || !focusCardAction(action)) return;

      // The one line that stops the permission error. `EffectsField.execute`
      // opens with `if (!config.hasEffect) return`, and `config` is the same
      // object `executeWorkflow` is about to run on.
      config["hasEffect"] = false;

      // Refusals happen here rather than in `postUseAction` because here the
      // Hope has not been charged yet — the press simply doesn't happen. Note
      // there is deliberately no *target* check: nothing is targeted at this
      // point, by design. The target is chosen after the weapon, against the
      // weapon's range, by the attack's own targeting.
      if (equippedAttacks(action["actor"] as AnyObject).length === 0) {
        ui.notifications?.warn(game.i18n.localize("EE.Features.RangersFocus.NoWeapon"));
        return false;
      }
    } catch (error) {
      // Never `false` from here: a broken check must let the action through, not
      // silently swallow the player's button press.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not take over the card's action.`, error);
    }
  });

  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject) => {
    try {
      if (!enabled()) return;

      const item = focusCardAction(action);
      if (!item) return;

      // Started, not awaited: the hook is synchronous, and nothing after it
      // depends on the attack — the same shape `crimson-rite.ts` uses. The `void`
      // also guarantees this listener returns `undefined` rather than a Promise.
      void makeFocusAttack(action["actor"] as AnyObject);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not start the Focus attack.`, error);
    }
  });
}

/**
 * Pick a weapon and swing it, marked so the roll window knows what it is.
 *
 * ## Where the target comes from
 *
 * Nowhere, on purpose. The attack is launched with nothing targeted, which is
 * exactly the condition `daggerheart-target-helper`'s targeting guard exists for:
 * it cancels the attack before anything is rolled or spent, offers the scene's
 * candidates **filtered by that weapon's range**, applies the choice and replays
 * the attack. That is the whole reason the weapon is chosen first — the range to
 * filter by is not known until it is.
 *
 * Without that module the attack simply resolves untargeted, which raises no
 * prompt, sets no Focus, and matches what any other untargeted attack does. It is
 * an optional integration, not a dependency, and nothing here calls into it.
 *
 * From the point the target is settled it is a completely ordinary attack — its
 * own roll dialog, advantage, Experiences, damage — because this hands over to
 * the system rather than reimplementing an attack. See {@link FOCUS_ATTACK} for
 * why the marker travels on the event object and not in `configOptions`.
 */
async function makeFocusAttack(ranger: AnyObject): Promise<void> {
  try {
    const weapons = equippedAttacks(ranger);

    // One equipped weapon is not a choice; two is. Re-read rather than trusted
    // from `preUseAction`, since the action's own dialog may have sat open since.
    const chosen = weapons.length === 1 ? weapons[0] : await chooseWeapon(weapons);

    if (!chosen) {
      // The Hope has gone by now — `use()` flushed the resource updates before
      // this hook — so say so rather than failing quietly.
      ui.notifications?.warn(game.i18n.localize("EE.Features.RangersFocus.NoWeaponChosen"));
      return;
    }

    await chosen.attack["use"]?.({ [FOCUS_ATTACK]: true });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not make the Focus attack.`, error);
  }
}

/** Which equipped weapon is this attack made with? Null if the player backed out. */
async function chooseWeapon(weapons: EquippedAttack[]): Promise<EquippedAttack | null> {
  const answer = await chooseOne({
    title: game.i18n.localize("EE.Features.RangersFocus.Title"),
    intro: game.i18n.localize("EE.Features.RangersFocus.ChooseWeapon"),
    options: weapons.map(({ weapon }) => weaponOption(String(weapon["id"] ?? ""), weapon)),
  });

  return weapons.find(({ weapon }) => String(weapon["id"] ?? "") === answer) ?? null;
}

/**
 * "When you deal damage to them, they must mark a Stress."
 *
 * Registered on the shared `applyDamage` seam in `damage-landing.ts`, which is
 * the one moment damage actually lands: the action workflow calls it at order 75,
 * and the chat card's *Apply* button calls the very same entry
 * (`workflow.get('applyDamage')`), so one seam covers both the automated and the
 * by-hand route. An `after` rule, because this reacts to damage having been dealt
 * rather than changing it.
 *
 * ## Why not somewhere cheaper
 *
 * - **Adding a `stress` resource to the damage** (the way Blood Spike's card
 *   declares one natively) applies it to *every* target the damage reaches.
 *   `applyDamage` clones the damage per target but not the resources, so a Hold
 *   Them Off swing that caught two more adversaries would mark all three.
 * - **The damage roll's own seam** is before the damage is applied at all, so a
 *   table with apply-automation off would see the Stress marked for damage
 *   nobody ever took.
 *
 * ## Why the write is safe from a player's client
 *
 * `Actor#modifyResource` routes its updates through the system's own
 * `emitGMUpdate` relay, so a player marking Stress on an adversary is applied by
 * the GM's client. That is also why this is the only benefit that touches the
 * target at all — see the header on where the Focus is kept.
 */
function registerFocusStress(): void {
  onDamageLanding({
    id: FEATURE_ID,
    after: async (config, targets, applying) => {
      if (!applying) return;
      await markFocusStress(config, targets);
    },
  });
}

/** Mark the Stress, if this damage was dealt by a ranger to their own Focus. */
async function markFocusStress(config: AnyObject, targets: AnyObject[] | null): Promise<void> {
  if (!enabled()) return;
  // "When you deal *damage* to them" — a healing action reaching the Focus is not
  // the trigger, and `applyDamage` handles both.
  if (config["hasHealing"] === true) return;

  const ranger = rollingCharacter(config);
  if (!ranger) return;

  const focus = focusOn(ranger);
  if (!focus) return;

  const damaged = damagedTargets(config, targets);
  if (!damaged.some((target) => String(target["actorId"] ?? "") === focus.mark.actorUuid)) return;

  const focusActor = fromUuidSync(focus.mark.actorUuid);
  if (!focusActor) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the Focus no longer exists; no Stress marked.`);
    return;
  }

  // `resourceUpdatesFor` reads the resource's own `isReversed`, so "mark 1" is a
  // positive value here and a negative one for something you hold — the same
  // convention the system's `CostField` uses.
  await focusActor["modifyResource"]?.(
    resourceUpdatesFor(focusActor, [{ key: STRESS, value: STRESS_MARK }]),
  );

  await announce(
    config,
    ranger,
    game.i18n.format("EE.Features.RangersFocus.Stress", {
      ranger: String(ranger["name"] ?? ""),
      target: focus.mark.name,
    }),
  );
}

/**
 * Install the window, the damage wrapper and the card takeover.
 *
 * Registered **before** `registerHoldThemOff`, and the order matters for once:
 * both are Ranger features that fire on the same weapon attack, and this one may
 * *replace* the roll. Running it first means Hold Them Off offers its extra
 * adversaries against whichever roll ends up being the real one — and that the
 * declaration prompt, which must be answered before the dice are shown, is not
 * queued behind a prompt that shows them.
 */
export function registerRangersFocus(): void {
  registerRollWindow({
    id: FEATURE_ID,
    // Cheap and total: `rollTypeOf` reads the type captured at `preRoll`, before
    // the system overwrites it with the action type. An adversary's attack is the
    // same roll type and reaches `run`, where it resolves to no character and
    // stops immediately.
    matches: (_roll, config) => {
      const type = rollTypeOf(config);
      return type !== null && ATTACK_ROLLS.includes(type);
    },
    run: (roll, config, message) => runRangersFocusWindow(roll, config, message),
  });

  registerFocusStress();
  registerFocusCard();

  // The card declares `target.type: "any"` from what it used to do — see
  // `card-targeting.ts`, whose shared patch blanks it for the duration of one
  // press so the target is chosen after the weapon, against the weapon's range.
  untargetAction((action) => enabled() && focusCardAction(action) !== null);
}
