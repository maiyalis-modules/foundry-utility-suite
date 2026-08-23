/**
 * **Adaptability** (Human ancestry, SRD p.30) — "When you fail a roll that
 * utilized one of your Experiences, you can **mark a Stress** to reroll."
 *
 * ## What the system ships
 *
 * A `feature` Item carrying one action — "Mark Stress", type `effect`, cost one
 * Stress, no effects and no triggers. Pressing it charges the Stress and stops.
 * The reroll is left to be done by hand: the system does have one, on the chat
 * log's context menu ("Reroll Action"), but it is a GM tool that knows nothing
 * about this card and charges nothing for it. Both halves exist and nothing
 * joins them, which is the same shape Blood Maledict and the Companion card
 * arrive in.
 *
 * ## A prompt, and a card button behind it
 *
 * `D20Roll.buildEvaluate` fills in `config.roll.success` only when the roll had a
 * target or a difficulty typed into the dialog. Anything else leaves it
 * `undefined`, because in Daggerheart the GM sets the difficulty and often says
 * so only once the dice have been read out. So the card's trigger — "when you
 * fail a roll" — is knowable for most rolls and unknowable for the rest, and the
 * two cases want different answers:
 *
 * - **Scored as a failure** → the ordinary prompt at the pipeline seam, like
 *   every other feature here. Dice shown, one question, done before the chat
 *   card is posted. This is the overwhelming majority of rolls.
 * - **Not scored at all** → a control on the posted card. No honest prompt can
 *   be raised for a roll nobody has adjudicated yet; asking anyway would put a
 *   modal in front of the player on *every* Experience roll, before they know
 *   whether it failed, which is the "unusable at the table" failure the registry
 *   header warns about.
 *
 * They **overlap deliberately**: a scored failure raises the prompt *and* leaves
 * the button. The rule is retroactive by nature — "when you fail a roll … you
 * can" — so a player who let the prompt go and then heard the GM narrate the
 * miss should still be able to spend the Stress. Only a scored *success*
 * withdraws the button, because there is then nothing to have failed.
 *
 * The two reroll *differently*, and have to — see {@link reroll} against
 * {@link runWindow}.
 *
 * ## What counts as "utilized one of your Experiences"
 *
 * The roll dialog records the Experiences the player picked in
 * `config.experiences` — an array of keys — and charges a Hope for each through
 * `config.costs`. `config` **is** the roll's `options` (every roll is built as
 * `new this(config.roll.formula, config.data, config)`), so the array survives
 * into the chat message and can still be read off it a session later.
 *
 * Checked the way the system's own `configureModifiers` checks it: a key only
 * counts if it names an Experience the actor actually has, since a key left over
 * from a since-deleted Experience adds nothing to the total and so cannot have
 * been "utilized". A `companionRoll` is excluded outright — those spend Hope on
 * the *companion's* Experiences, and this card says one of **your** Experiences.
 *
 * ## What the reroll is, and why the Experience survives it
 *
 * `Roll#reroll` clones the roll and evaluates the clone, and the clone is built
 * from `this._formula` — by then fully resolved, `1d12 + 1d12 + 2 + 1 + 2`, with
 * every modifier already a number in the string. New dice, the same bonuses, and
 * nothing charged twice: the Hope was paid by the workflow that made the first
 * roll, which finished long before this button was pressed.
 *
 * **The two paths reroll differently, and the difference is the Hope and Fear.**
 * From the posted card, `DualityRoll#reroll({liveRoll: true})` is right: the
 * first result has already handed out its Hope or Fear, and that call reconciles
 * it — a miss with Fear rerolled into a miss with Hope takes the Fear back off
 * the GM's tracker and puts a Hope on the sheet — through the system's own
 * automation settings and countdown handling. Reimplementing that would be
 * copying policy rather than automating a card. From the *prompt*, at the
 * pipeline seam, `dualityUpdate` has not run yet, so there is nothing to
 * reconcile and that same call would double-count; there the reroll is
 * `rebuildRoll`, which is the same choice `rangers-focus.ts` makes and for the
 * same reason.
 *
 * ## Why the roll's snapshot is rewritten afterwards
 *
 * `config.roll` is a plain-object *record* of the evaluated roll, written by the
 * three `buildEvaluate` overrides and persisted with the message. Most of the
 * card renders from the live Roll object and needs no help, but the difficulty
 * badge reads `roll.options.roll.success` for its "miss" styling and a
 * result-based damage part reads `roll.options.roll.result.duality` — and the
 * system's own context-menu reroll leaves both describing the discarded dice.
 * {@link refreshSnapshot} brings them back into step, mirroring `buildEvaluate`
 * (Daggerheart 2.7.2) rather than inventing a second set of rules. Target hits
 * need nothing: `ChatMessage#_getCurrentTargets` recomputes those from the Roll
 * object on every render, which is what makes replacing `message.rolls[0]`
 * enough on its own.
 *
 * ## What is not automated
 *
 * **Whether you failed**, on a roll the system did not score. There the button
 * is simply offered and the player decides. Nothing here can see the difficulty
 * in the GM's head.
 *
 * **How many times.** The card sets no limit, so a reroll that fails again may
 * be rerolled again for another Stress while there is Stress left to mark — via
 * the prompt each time, since a rebuilt roll is scored afresh. Each card-button
 * reroll announces itself in chat, so a table reading the rule more strictly can
 * see it happen.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { confirmChoice } from "./feature-prompt.js";
import {
  canAfford,
  chargeCosts,
  findGrantingItem,
  resourceUpdatesFor,
  type FeatureCost,
  type FeatureMatch,
} from "./feature-registry.js";
import {
  rebuildRoll,
  registerRollWindow,
  rollVisibility,
  showDiceEarly,
} from "./roll-pipeline.js";

/** Registry id, so a homebrew rewrite can opt in with the usual flag. */
const FEATURE_ID = "adaptability";
const LABEL = "Adaptability";

/** How the granting Item is recognised — see {@link FeatureMatch}. */
const MATCH: FeatureMatch = {
  compendiumSources: ["Compendium.daggerheart.ancestries.Item.BNofV1UC4ZbdFTkb"],
  names: ["Adaptability"],
};

/** The printed price: mark one Stress. */
const STRESS = "stress";
const COST: readonly FeatureCost[] = [{ key: STRESS, value: 1 }];

/** The system's duality encoding, shared by `config.roll.result.duality`. */
const WITH_HOPE = 1;
const WITH_FEAR = -1;

/**
 * Dataset key marking a card this has already decorated. Per-render rather than
 * persisted: each re-render builds fresh DOM, and the button has to come back
 * with it.
 */
const DECORATED = "eeAdaptability";

/**
 * Messages with a reroll in flight. A second click during the await would mark a
 * second Stress and throw the first reroll away unseen.
 */
const inFlight = new Set<string>();

function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.adaptabilityReroll) === true;
}

/**
 * The Duality roll on this message, or null.
 *
 * Asked of the rolls themselves rather than through `message.type` and the
 * system's `system.roll` getter. Both of those would work and neither is free:
 * the first is a subtype string this file would have to keep in step with the
 * system, and the second needs `game.system.api` to be populated. An
 * `instanceof` against `CONFIG.Dice.daggerheart` — assigned at script load, the
 * same class `duality-outcome.ts` matches on — asks the question directly.
 */
function dualityRollOf(message: AnyObject): AnyObject | null {
  const DualityRoll = CONFIG["Dice"]?.daggerheart?.DualityRoll as
    | (new () => unknown)
    | undefined;
  if (!DualityRoll) return null;

  const rolls = (message["rolls"] ?? []) as AnyObject[];
  return rolls.find((roll) => roll instanceof DualityRoll) ?? null;
}

/**
 * Did this roll actually use one of the *roller's* own Experiences?
 *
 * Both halves matter. `options.experiences` is what the player ticked, and
 * `options.data.experiences` is the actor's own list as it stood when the dice
 * were thrown — the same pairing `configureModifiers` filters on before it will
 * add anything to the total.
 */
function usedOwnExperience(roll: AnyObject): boolean {
  const options = roll["options"] as AnyObject | undefined;

  // A companion's roll offers the companion's Experiences, not yours; the card
  // is about your own. See `daggerheart/companion.ts` for who sets this.
  if (options?.["roll"]?.["companionRoll"] === true) return false;

  const picked = options?.["experiences"];
  if (!Array.isArray(picked) || picked.length === 0) return false;

  const owned = (options?.["data"]?.["experiences"] ?? {}) as AnyObject;
  return picked.some((key) => Boolean(owned[String(key)]));
}

/**
 * The Experiences this roll actually used, for the prompt to name back.
 *
 * The player picked them minutes ago in a dialog that is long gone, and "you
 * failed a roll" is not enough to decide a Stress on — *which* roll matters. The
 * same own-Experience filter as {@link usedOwnExperience}, so a name can never
 * appear here that did not add to the total.
 */
function experienceNames(roll: AnyObject): string {
  const owned = (roll["options"]?.["data"]?.["experiences"] ?? {}) as AnyObject;
  const picked = (roll["options"]?.["experiences"] ?? []) as unknown[];

  const names = picked
    .map((key) => String((owned[String(key)] as AnyObject | undefined)?.["name"] ?? "").trim())
    .filter((name) => name.length > 0);

  // Falls back to the generic word rather than an empty gap in the sentence: an
  // Experience with no name yet is the table's to fix, not a reason to withhold
  // the offer. `listFormatter` is core's, so "a and b" localizes with the rest.
  if (names.length === 0) return game.i18n.localize("EE.Features.Adaptability.AnExperience");
  return game.i18n.getListFormatter({ type: "conjunction" }).format(names);
}

/** The character that made the roll, or null. */
function rollActor(roll: AnyObject): AnyObject | null {
  const uuid = roll["options"]?.["source"]?.["actor"];
  if (!uuid) return null;

  const actor = fromUuidSync(String(uuid)) as AnyObject | null;
  return actor?.["type"] === "character" ? actor : null;
}

/** An eligible card: the roll to replace, and who pays for replacing it. */
interface Offer {
  roll: AnyObject;
  actor: AnyObject;
}

/**
 * Say why the button was withheld, at `console.debug`.
 *
 * Every gate past the first two announces itself. Without this the feature is
 * undebuggable at the table — a player who expected a button and did not get one
 * has no way to find out which condition disagreed, which is exactly how Hold
 * Them Off's visibility bug presented. The first two gates stay quiet because
 * they decline on nearly every message in the world.
 */
function decline(reason: string, detail?: unknown): null {
  console.debug(`${LOG_PREFIX} ${LABEL}: no reroll offered — ${reason}`, detail ?? "");
  return null;
}

/**
 * Should this message carry the button, for *this* client?
 *
 * Cheapest gate first, because this runs on every chat message every client
 * renders.
 */
function offerFor(message: AnyObject): Offer | null {
  if (!enabled()) return null;

  const roll = dualityRollOf(message);
  if (!roll) return null;

  if (!usedOwnExperience(roll)) {
    // Not silent, unlike the two above: "I spent a Hope on an Experience and got
    // no button" is the report this feature will actually receive.
    return decline("the roll used none of this character's own Experiences", {
      experiences: roll["options"]?.["experiences"],
      companionRoll: roll["options"]?.["roll"]?.["companionRoll"],
      owned: Object.keys((roll["options"]?.["data"]?.["experiences"] ?? {}) as AnyObject),
    });
  }

  // A critical is a success in Daggerheart whatever the difficulty was, so there
  // is nothing here that could have failed.
  if (roll["isCritical"] === true) return decline("the roll was a critical success");

  // The only outcome that rules the card out. `undefined` — the roll whose
  // difficulty lives in the GM's head — deliberately does not.
  //
  // Note this deliberately *overlaps* the prompt rather than partitioning
  // against it: a scored failure raises the prompt and still leaves the button.
  // The rule is retroactive by nature ("when you fail a roll… you can"), so a
  // player who let the prompt go and then heard the GM narrate the miss should
  // still be able to spend the Stress. Declining the prompt is not a decision
  // the card needs to enforce.
  if (roll["options"]?.["roll"]?.["success"] === true) return decline("the roll succeeded");

  const actor = rollActor(roll);
  if (!actor) return decline("no character behind the roll", roll["options"]?.["source"]);
  if (!actor["isOwner"]) return decline("you do not own", actor["name"]);

  // The reroll rewrites the message, so the gate is also whoever the system
  // would let rewrite one: owning the actor is not enough on someone else's card.
  if (message["isAuthor"] !== true && game.user?.isGM !== true) {
    return decline("this is someone else's message and you are not the GM");
  }

  if (!canAfford(actor, COST)) {
    return decline("no Stress left to mark", actor["system"]?.["resources"]?.["stress"]);
  }

  // Last, because it walks the actor's items: everything above is a field read.
  if (!findGrantingItem(actor, FEATURE_ID, MATCH)) {
    return decline(`${String(actor["name"] ?? "")} has no Adaptability feature`);
  }

  return { roll, actor };
}

/**
 * Bring `roll.options.roll` back into step with the dice that were just thrown.
 *
 * Mirrors the three `buildEvaluate` overrides (`DHRoll`, `D20Roll`,
 * `DualityRoll`, Daggerheart 2.7.2) over the fields that describe an outcome.
 * `extra` is deliberately left alone: it is derived from `roll.baseTerms`, which
 * only `configureModifiers` fills in and a cloned roll never runs, so computing
 * it here would report every die as an extra one.
 */
function refreshSnapshot(roll: AnyObject): void {
  const snapshot = roll["options"]?.["roll"] as AnyObject | undefined;
  if (!snapshot) return;

  const rerolledOf = (die: AnyObject | undefined): AnyObject => {
    const results = (die?.["results"] ?? []) as AnyObject[];
    return {
      any: results.some((result) => result["rerolled"]),
      rerolls: results.filter((result) => result["rerolled"]),
    };
  };

  const dieRecord = (die: AnyObject | undefined): AnyObject => ({
    dice: die?.["denomination"],
    value: Number(die?.["total"] ?? 0),
    rerolled: rerolledOf(die),
  });

  const hope = roll["dHope"] as AnyObject | undefined;
  const fear = roll["dFear"] as AnyObject | undefined;
  const advantage = roll["dAdvantage"] as AnyObject | undefined;
  const critical = roll["isCritical"] === true;
  const total = Number(roll["total"] ?? 0);

  snapshot["total"] = total;
  snapshot["formula"] = roll["formula"];
  snapshot["isCritical"] = critical;
  snapshot["modifierTotal"] = roll["modifierTotal"];
  snapshot["dice"] = ((roll["dice"] ?? []) as AnyObject[]).map((die) => ({
    dice: die["denomination"],
    total: die["total"],
    formula: die["formula"],
    results: ((die["results"] ?? []) as AnyObject[]).filter((result) => !result["rerolled"]),
    rerolled: rerolledOf(die),
  }));
  snapshot["hope"] = dieRecord(hope);
  snapshot["fear"] = dieRecord(fear);
  snapshot["result"] = {
    duality: roll["withHope"] ? WITH_HOPE : roll["withFear"] ? WITH_FEAR : 0,
    total: Number(hope?.["total"] ?? 0) + Number(fear?.["total"] ?? 0),
    label: roll["totalLabel"],
  };

  // The advantage *mode* was chosen before the dice and does not change; only
  // the die that mode called for was thrown again.
  snapshot["advantage"] = {
    type: (snapshot["advantage"] as AnyObject | undefined)?.["type"],
    dice: advantage?.["denomination"],
    value: advantage?.["total"],
  };

  // Success and each target's hit, derived exactly as `D20Roll.buildEvaluate`
  // derives them: a difficulty typed into the dialog wins, then the target's
  // own, then its Evasion. A roll with neither keeps `success` as it was —
  // undefined — so the card goes on saying nothing about an outcome it cannot
  // know.
  const targets = (roll["options"]?.["targets"] ?? []) as AnyObject[];
  if (targets.length > 0) {
    for (const target of targets) {
      const difficulty = snapshot["difficulty"] ?? target["difficulty"] ?? target["evasion"];
      target["hit"] = critical || total >= Number(difficulty);
    }
    snapshot["success"] = targets.some((target) => target["hit"] === true);
  } else if (snapshot["difficulty"]) {
    snapshot["success"] = critical || total >= Number(snapshot["difficulty"]);
  }
}

/**
 * Say what happened, to whoever the original roll was visible to.
 *
 * A public note rather than a silent swap: the dice on the card change under the
 * table's eyes, and a Stress marked for a reason nobody announced is the kind of
 * thing that gets argued about later.
 */
async function announce(roll: AnyObject, actor: AnyObject): Promise<void> {
  try {
    const { whisper, blind } = rollVisibility((roll["options"] ?? {}) as AnyObject);
    const text = game.i18n.format("EE.Features.Adaptability.Announce", {
      actor: String(actor["name"] ?? ""),
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>${escapeHtml(text)}</em></p>`,
      // Omitted rather than passed as null: core reads the presence of the field.
      ...(whisper ? { whisper } : {}),
      blind,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the reroll.`, error);
  }
}

/**
 * Mark the Stress and throw the dice again, in that order.
 *
 * Paid first and awaited, for the reason Ranger's Focus pays first: the Stress
 * *is* the price of the reroll, and a failed write must not leave the player
 * with the reroll and none of the cost.
 */
async function reroll(message: AnyObject, offer: Offer): Promise<void> {
  const id = String(message["id"] ?? "");
  if (inFlight.has(id)) return;
  inFlight.add(id);

  try {
    // Both re-read at the moment of paying rather than trusted from render time:
    // the card may have sat in the log while the switch was turned off or the
    // Stress track filled up.
    if (!enabled()) return;
    if (!canAfford(offer.actor, COST)) {
      ui.notifications?.warn(
        game.i18n.format("EE.Features.Adaptability.NoStress", {
          actor: String(offer.actor["name"] ?? ""),
        }),
      );
      return;
    }

    await offer.actor["modifyResource"]?.(resourceUpdatesFor(offer.actor, COST));

    // The system's own reroll: fresh dice on the same resolved formula, the 3D
    // dice thrown for the table, and whatever the first result already did to
    // Hope, Fear and the countdowns put back.
    const rerolled = (await offer.roll["reroll"]?.({ liveRoll: true })) as AnyObject | undefined;
    if (!rerolled) {
      console.warn(`${LOG_PREFIX} ${LABEL}: the roll would not reroll; the card is unchanged.`);
      return;
    }

    refreshSnapshot(rerolled);
    await message["update"]?.({ rolls: [rerolled] });
    await announce(rerolled, offer.actor);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${LABEL}: the reroll failed.`, error);
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Build the control and hang it under the roll — after `anchor`, or inside it
 * when `within` says the anchor is the container rather than a sibling.
 */
function addButton(
  message: AnyObject,
  anchor: HTMLElement,
  offer: Offer,
  within = false,
): void {
  const row = document.createElement("div");
  row.className = "ee-adaptability";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ee-adaptability-button";
  button.dataset["tooltip"] = game.i18n.localize("EE.Features.Adaptability.Tooltip");

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-dice";
  icon.toggleAttribute("inert", true);

  // `textContent`, not markup: the label is ours, but building it as HTML would
  // invite the next person to interpolate an actor name into it.
  button.append(
    icon,
    document.createTextNode(game.i18n.localize("EE.Features.Adaptability.Button")),
  );

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    // Re-enabled when the reroll declines to happen; a reroll that *does* happen
    // re-renders the message and rebuilds this button anyway.
    button.disabled = true;
    void reroll(message, offer).finally(() => {
      button.disabled = false;
    });
  });

  row.append(button);
  if (within) anchor.append(row);
  else anchor.after(row);
}

/**
 * Decorate one rendered chat message, if it is one of ours.
 *
 * The anchor is chosen from most to least specific and **nothing is required**:
 * below the card's own buttons where it has them ("Roll Damage" and friends,
 * rendered only for the author), else below the roll, else at the end of the
 * message content, else at the end of the message. A control the player was
 * promised must not go missing because the system reshuffled its template — the
 * worst outcome of a missing anchor should be a button in a slightly odd place.
 */
function decorate(message: AnyObject, html: HTMLElement): void {
  const offer = offerFor(message);
  if (!offer) return;

  const host = html.querySelector<HTMLElement>(".message-content") ?? html;
  if (host.dataset[DECORATED]) return;
  host.dataset[DECORATED] = "1";

  const anchor =
    host.querySelector<HTMLElement>(".roll-buttons") ??
    host.querySelector<HTMLElement>(".chat-roll") ??
    host.lastElementChild;

  if (anchor) addButton(message, anchor as HTMLElement, offer);
  else addButton(message, host, offer, true);
}

/**
 * The prompt, for a roll the system scored as a failure.
 *
 * Runs at the pipeline seam, so the dice are evaluated and the chat message does
 * not exist yet — which is why the reroll here is {@link rebuildRoll} rather than
 * the card's `DualityRoll#reroll`: no Hope or Fear has been handed out to take
 * back, and doing it that way would double-count.
 *
 * The dice are shown first. "When you fail a roll" is a condition the player has
 * to be able to *see* before deciding what to give up for it — the same
 * judgement Ranger's Focus's reroll makes.
 */
async function runWindow(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
): Promise<AnyObject | void> {
  if (!enabled()) return;

  // One line per Duality roll, at Verbose. Deliberate: without it, "the window
  // declined" and "the window never ran" look identical from the console, and
  // telling those two apart is the first question worth asking.
  console.debug(`${LOG_PREFIX} ${LABEL}: considering a Duality roll.`, {
    experiences: roll["options"]?.["experiences"],
    success: config["roll"]?.["success"],
  });

  // Logged from here down, for the reason `decline` exists: a prompt that never
  // appears is otherwise indistinguishable from a feature that is switched off.
  if (!usedOwnExperience(roll)) {
    return void decline("the roll used none of this character's own Experiences", {
      experiences: roll["options"]?.["experiences"],
      companionRoll: roll["options"]?.["roll"]?.["companionRoll"],
      owned: Object.keys((roll["options"]?.["data"]?.["experiences"] ?? {}) as AnyObject),
    });
  }

  const actor = rollActor(roll);
  if (!actor) return void decline("no character behind the roll", roll["options"]?.["source"]);
  if (!actor["isOwner"]) return void decline("you do not own", actor["name"]);
  if (!findGrantingItem(actor, FEATURE_ID, MATCH)) {
    return void decline(`${String(actor["name"] ?? "")} has no Adaptability feature`);
  }

  let current = roll;

  // Loops because the card sets no limit: a reroll that fails again may be
  // rerolled again. A window runs once per roll, and a rebuilt roll never
  // re-enters the pipeline, so offering more than once has to happen here.
  // Every exit is a real stop — it succeeded, the Stress ran out, the player
  // said no, or the system's shape moved — so this cannot spin.
  for (let marked = 0; ; marked += 1) {
    // Only a failure the system actually scored. An unknown outcome is the chat
    // card's job: asking here would mean a modal on every Experience roll,
    // raised before anyone at the table knows whether it failed.
    if (config["roll"]?.["success"] !== false) {
      decline("the system did not score this roll as a failure — the chat card carries it", {
        success: config["roll"]?.["success"],
        difficulty: config["roll"]?.["difficulty"],
        targets: ((config["targets"] ?? []) as AnyObject[]).length,
        marked,
      });
      break;
    }

    // Checked against the *cumulative* price, because the marks so far are
    // sitting in `config.resourceUpdates` unflushed and so are invisible to the
    // actor's current value. Asking whether `marked + 1` is payable is what
    // stops a second reroll being sold on Stress the first one already spent —
    // the system clamps on write, so the shortfall would otherwise be silent.
    if (!canAfford(actor, [{ key: STRESS, value: marked + 1 }])) {
      console.debug(`${LOG_PREFIX} ${LABEL}: no Stress left to mark; not offering again.`);
      break;
    }

    await showDiceEarly(current, config);

    const rerolling = await confirmChoice({
      title: game.i18n.localize("EE.Features.Adaptability.Title"),
      intro: game.i18n.format("EE.Features.Adaptability.Intro", {
        experience: experienceNames(current),
      }),
      confirmLabel: game.i18n.localize("EE.Features.Adaptability.Confirm"),
      declineLabel: game.i18n.localize("EE.Features.Adaptability.Decline"),
    });

    if (!rerolling) break;

    // Folded into the roll's own pending update rather than written separately:
    // this roll is about to queue its own Hope or Fear into the same map, and
    // two writes would race where one merged write nets them correctly.
    chargeCosts(actor, config, COST);

    const next = await rebuildRoll(current, config, message, LABEL);
    if (!next) break;
    current = next;
  }

  return current === roll ? undefined : current;
}

/**
 * Install both halves.
 *
 * They partition the problem rather than overlapping. The **prompt** takes every
 * roll the system scored as a failure, which is the overwhelming majority. The
 * **card button** takes the rest — the roll whose difficulty only the GM knows,
 * where `success` is left `undefined` and no honest prompt could be raised. A
 * table that has declined the prompt has decided; the button does not re-offer.
 *
 * Every gate in both is re-read per event, so the switch is live and a card left
 * in the log overnight cannot pay a price that is no longer there.
 */
export function registerAdaptability(): void {
  const DualityRoll = CONFIG["Dice"]?.daggerheart?.DualityRoll as
    | (new () => unknown)
    | undefined;

  if (DualityRoll) {
    registerRollWindow({
      id: FEATURE_ID,
      matches: (roll) => roll instanceof DualityRoll,
      run: async (roll, config, message) => await runWindow(roll, config, message),
    });
  } else {
    console.warn(`${LOG_PREFIX} ${LABEL}: DualityRoll not found — the prompt is off.`);
  }

  Hooks.on("renderChatMessageHTML", (message: AnyObject, html: HTMLElement) => {
    try {
      decorate(message, html);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not decorate a roll card.`, error);
    }
  });
}
