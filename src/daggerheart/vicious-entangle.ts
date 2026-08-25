/**
 * **Vicious Entangle** (Sage domain, SRD) — "Make a Spellcast Roll against a
 * target within Far range. On a success, roots and vines reach out from the
 * ground, dealing 1d8+1 physical damage and temporarily *Restraining* the
 * target. Additionally on a success, you can **spend a Hope** to temporarily
 * *Restrain* another adversary within Very Close range of your target."
 *
 * ## What the SRD ships, and what it leaves undone
 *
 * `Compendium.daggerheart.domains.Item.qvpvTnkAoRn9vYO4` — and unlike the Void's
 * Blighting Strike, this card is built correctly. It carries two actions:
 *
 * - **Cast**, an `attack` action: Spellcast roll, 1d8+1 physical, with an
 *   embedded *Restrained* ActiveEffect that `EffectsField.execute` copies onto
 *   every target whose `hitResult.success` is true. The whole first sentence is
 *   therefore already automatic, and nothing here touches it.
 * - **Restrain Another**, an `effect` action charging 1 Hope and carrying a
 *   second copy of the same *Restrained* effect.
 *
 * What is missing is everything that joins the two. "Restrain Another" is a
 * free-standing button: it does not know whether the Cast succeeded, it does not
 * know who the Cast hit, and it will restrain someone on the far side of the map
 * — "within Very Close range of your target" is printed in its description and
 * enforced nowhere. It is also offered as a *peer* of the Cast in the action
 * chooser, so pressing the card asks which of the two you meant before you have
 * rolled the one that gates the other.
 *
 * ## What this adds
 *
 * Two things, both narrow:
 *
 * 1. **The card casts.** The chooser is answered for this card — see
 *    {@link patchActionChooser} — so pressing it from the hotbar goes straight to
 *    the Spellcast roll. "Restrain Another" is still listed on the card sheet for
 *    a table that wants to press it by hand, which is also the escape hatch for
 *    everything this file declines to guess at.
 * 2. **The follow-up is offered where the rule allows it.** After a successful
 *    Cast, the caster is shown every *other* adversary within Very Close of
 *    someone the Cast hit; picking one presses the card's own "Restrain Another"
 *    against them.
 *
 * ## Why the follow-up is *not* a second `use()`
 *
 * The obvious implementation is to press the card's own "Restrain Another" with
 * `action.use(event, { targetUuid })` — `TargetField.prepareConfig` honours
 * `config.targetUuid` ahead of `game.user.targets`, so one call aims the printed
 * action at the picked adversary and the system does the rest. That was the first
 * version of this file, and it was wrong for the same reason the chained version
 * of `blighting-strike.ts` was wrong: **a second `use()` is a second action, and
 * the table is watching for actions.**
 *
 * `daggerheart.preUseAction` is where `daggerheart-spotlight-tracker`'s guard
 * sits. By the time the follow-up runs, the cast has resolved and the spotlight
 * has already left the caster — so the guard sees a player acting out of turn,
 * cancels the action and raises a "request the spotlight?" prompt in the middle
 * of a card the player is still resolving. Tagging the config
 * `actionType: "reaction"` would silence both the guard and the tracker's
 * `action-watch`, but it would be a lie told to get the right behaviour by
 * accident: this is not a reaction, it is the back half of one action, and any
 * module that later tells the two apart would break.
 *
 * So the workflow is skipped and the two things it would have done are done
 * directly — but **read off the card**, never assumed:
 *
 * - the cost comes from the follow-up action's own `cost` array, so a table that
 *   house-rules it to 2 Hope is charged 2 Hope;
 * - the effect comes from its own `effects` array, resolved against the Item, and
 *   applied through the system's `EffectsField.applyEffect` — which is the static
 *   `gm-action-effects.ts` wraps, so it still reaches an adversary the casting
 *   player does not own.
 *
 * The card stays the source of truth for *what* happens. Only the workflow around
 * it — the chooser, the cost dialog, `preUseAction`, `postUseAction`, the second
 * chat card — is what gets dropped, and every one of those is a thing this
 * situation does not want. What replaces the chat card is one line saying who was
 * caught and what it cost.
 *
 * An action whose cost consumes an *item* (`cost.itemId`) is declined outright
 * rather than approximated: see {@link readCard}.
 *
 * ## Reading the conditions
 *
 * - **"On a success"** — `config.roll.success`, which `D20Roll.buildEvaluate` has
 *   already set. Only populated when the roll had targets or a set difficulty, so
 *   a Spellcast rolled at nobody offers nothing, which is the silence every
 *   window in this module keeps.
 * - **"another adversary"** — `actor.type === "adversary"`, excluding everyone the
 *   Cast already targeted. One, never more.
 * - **"within Very Close range of your target"** — measured from the *target*,
 *   not from the caster. That is the whole content of the clause and the thing
 *   hardest to judge by eye, since the caster may be a Far range away from both.
 *   Where the Cast hit more than one, Very Close of *any* of them qualifies, and
 *   the picker says which. An adversary whose distance cannot be measured is not
 *   offered, for the reason the rest of this module gives: a Hope must not be
 *   spent on an assumed range.
 * - **"you can spend a Hope"** — optional, so the picker carries a Decline and
 *   dismissing it means the same thing. Affordability is checked twice: before
 *   the prompt, because an offer that cannot be taken is worse than no offer, and
 *   again after it, because the picker is untimed and the Hope can go while the
 *   player is thinking.
 *
 * Deliberately **not** done: nothing here re-checks or re-applies the *Restrained*
 * effect on the primary target. That one is the Cast's own, applied by the system
 * on the ordinary path — including through `gm-action-effects.ts`, which is what
 * gets it onto an adversary the casting player does not own.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, FLAGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { chooseUpTo, type PromptChoice } from "./feature-prompt.js";
import { canAfford, resourceUpdatesFor, type FeatureCost } from "./feature-registry.js";
import { withinBand, type RangeBand } from "./range-bands.js";
import { rollVisibility } from "./roll-pipeline.js";

/** Where the card comes from, checked before its name. */
const VICIOUS_ENTANGLE_SOURCE = "Compendium.daggerheart.domains.Item.qvpvTnkAoRn9vYO4";

/** The card's printed name, the last resort for recognising a hand-built copy. */
const VICIOUS_ENTANGLE_NAME = "Vicious Entangle";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "viciousEntangle";

/** Prefix for this feature's console lines. */
const LABEL = "Vicious Entangle";

/** `CONFIG.DH.ACTOR.actorTypes` — the only kind of actor the second clause reaches. */
const ADVERSARY = "adversary";

/** "another adversary" — one, and the picker enforces it. */
const EXTRA_TARGETS = 1;

/** "within Very Close range of your target". */
const BAND: RangeBand = "veryClose";

/**
 * The card's two actions, plus what the second one costs.
 *
 * The costs are read here rather than at the point of charging so that a shape
 * this cannot pay for correctly — an item-consuming cost — disqualifies the card
 * before anything is offered, instead of halfway through.
 */
interface CardShape {
  cast: AnyObject;
  restrain: AnyObject;
  costs: FeatureCost[];
}

/** One adversary the follow-up could reach, and which hit target put it in range. */
interface Candidate {
  token: Token;
  distance: number;
  anchor: Token;
}

/** Is this feature switched on? Read per use, so the toggle is live. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.viciousEntangleRestrain) === true;
}

/** Is this the Vicious Entangle card? Flag first, then compendium, then name. */
function isViciousEntangle(item: AnyObject | null | undefined): boolean {
  if (!item) return false;

  // The homebrew escape hatch the feature registry uses, honoured here for the
  // same reason: a table that rewrote the card should still get the automation.
  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return true;

  if (String(item["_stats"]?.["compendiumSource"] ?? "") === VICIOUS_ENTANGLE_SOURCE) return true;

  return String(item["name"] ?? "").trim().toLowerCase() === VICIOUS_ENTANGLE_NAME.toLowerCase();
}

/**
 * Read the card, or null if it is not the two-action shape this drives.
 *
 * Matched on action `type`, never on names, the same way `blighting-strike.ts`
 * reads its card: one `attack` and one effect-only action carrying effects is the
 * shape, whatever a table has renamed them to. A card that has been split further
 * — two follow-ups, or none — is left entirely alone, chooser included, because
 * at that point this file no longer knows which button the rule means.
 *
 * The follow-up's costs are read here too, and a cost this cannot charge honestly
 * disqualifies the whole card. Since the workflow is skipped (see the header),
 * charging is this file's own job, and it can only do the plain
 * `actor.system.resources` kind. `cost.itemId` means "consume a charge of some
 * Item", which `CostField.getItemIdCostUpdate` resolves against a path this
 * knows nothing about — so a card carrying one keeps its chooser and its manual
 * button, and gets no automation at all.
 */
function readCard(item: AnyObject): CardShape | null {
  const attacks: AnyObject[] = [];
  const followUps: AnyObject[] = [];

  for (const action of (item["system"]?.["actions"] ?? []) as Iterable<AnyObject>) {
    const type = String(action?.["type"] ?? "");
    if (type === "attack") attacks.push(action);
    else if (type === "effect" && ((action?.["effects"] ?? []) as AnyObject[]).length > 0) {
      followUps.push(action);
    }
  }

  if (attacks.length !== 1 || followUps.length !== 1) return null;

  const restrain = followUps[0]!;
  const costs: FeatureCost[] = [];
  for (const cost of (restrain["cost"] ?? []) as AnyObject[]) {
    if (cost["itemId"]) {
      console.debug(`${LOG_PREFIX} ${LABEL}: the follow-up consumes an item; leaving the card alone.`);
      return null;
    }

    const key = String(cost["key"] ?? "");
    const value = Number(cost["value"] ?? 0);
    if (key !== "" && Number.isFinite(value) && value > 0) costs.push({ key, value });
  }

  return { cast: attacks[0]!, restrain, costs };
}

/**
 * Is this token fair game as a target for whoever is choosing?
 *
 * `document.hidden` only, and only for the people it is hidden from — the same
 * filter `hold-them-off.ts` applies, for the reasons set out at length there.
 * Notably *not* `token.visible` and *not* this module's `invisibleToPlayers`
 * flag: at this table every GM-dropped token carries the latter, and the whole
 * point of it is that such tokens stay targetable and measurable.
 */
function targetable(token: Token): boolean {
  if (game.user?.isGM === true) return true;

  return token.document.hidden !== true;
}

/** The tokens the Cast actually hit — the points "your target" measures from. */
function hitTokens(config: AnyObject): Token[] {
  const found: Token[] = [];

  for (const target of (config["targets"] ?? []) as AnyObject[]) {
    if (target["hit"] !== true) continue;
    const token = canvas.tokens?.get(String(target["id"] ?? ""));
    if (token) found.push(token);
  }

  return found;
}

/**
 * Every adversary the follow-up could still reach, nearest first.
 *
 * Nearest first because that is the order the player is thinking in when the rule
 * says "within Very Close", and because it keeps the list stable between two
 * casts from the same spot.
 */
function candidatesNear(anchors: Token[], config: AnyObject): Candidate[] {
  // Both keys, because either can identify an existing target: the token id for
  // the one that was clicked, the actor uuid for a uuid-targeted action that
  // formatted a prototype token with no placeable behind it. Empties are dropped
  // so a target missing one of them cannot match a token missing it too.
  const taken = new Set(
    ((config["targets"] ?? []) as AnyObject[])
      .flatMap((target) => [String(target["id"] ?? ""), String(target["actorId"] ?? "")])
      .filter((key) => key !== ""),
  );

  const found: Candidate[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || actor["type"] !== ADVERSARY) continue;
    // "*another* adversary" — whoever the Cast already went at is not one.
    if (taken.has(token.id) || taken.has(String(actor["uuid"] ?? ""))) continue;
    if (!targetable(token)) continue;

    let nearest: Candidate | null = null;
    for (const anchor of anchors) {
      if (anchor === token) continue;

      let distance: number;
      try {
        distance = anchor.distanceTo(token);
      } catch {
        continue;
      }

      // Null from `withinBand` means the thresholds or the distance could not be
      // read, which this treats as "no" — never as "probably close enough".
      if (!Number.isFinite(distance) || withinBand(distance, BAND) !== true) continue;
      if (!nearest || distance < nearest.distance) nearest = { token, distance, anchor };
    }

    if (!nearest) {
      // Traced, because by here the cast has landed and the player may reasonably
      // be wondering why somebody they can see was not on the list.
      console.debug(
        `${LOG_PREFIX} ${LABEL}: ${token.document.name} is outside Very Close of the target.`,
      );
      continue;
    }

    found.push(nearest);
  }

  return found.sort((a, b) => a.distance - b.distance);
}

/** The picker's row: portrait, token name, and which target it is standing by. */
function choiceFor(candidate: Candidate): PromptChoice {
  const actor = candidate.token.actor as AnyObject;
  const units = String(canvas.scene?.["grid"]?.["units"] ?? "");

  return {
    id: candidate.token.id,
    // The *token's* name, so an unlinked "Jagged Knife Lackey #2" reads as itself
    // rather than as its statblock — the choice `TargetField.formatTarget` makes.
    name: String(candidate.token.document.name ?? actor["name"] ?? ""),
    img: actor["img"] ? String(actor["img"]) : undefined,
    detail: game.i18n.format("EE.Features.ViciousEntangle.Distance", {
      distance: Math.round(candidate.distance),
      units,
      anchor: String(candidate.anchor.document.name ?? ""),
    }),
  };
}

/**
 * The price as a phrase — "1 Hope", or whatever the card actually charges.
 *
 * Built from `CONFIG.DH.GENERAL.healingTypes`, which is the system's own table of
 * resource ids to localized names and the one the cost editor uses. A key that
 * isn't in it falls back to the raw id, which is at least honest about what is
 * being taken.
 */
function priceOf(costs: readonly FeatureCost[]): string {
  const types = (CONFIG?.["DH"] as AnyObject | undefined)?.["GENERAL"]?.["healingTypes"] as
    | AnyObject
    | undefined;

  return costs
    .map((cost) => {
      const label = types?.[cost.key]?.["label"];
      const name = typeof label === "string" ? game.i18n.localize(label) : cost.key;
      return `${cost.value} ${name}`;
    })
    .join(", ");
}

/** The sentence at the top of the picker: what the vines caught, and the price. */
function introFor(anchors: Token[], costs: readonly FeatureCost[]): string {
  return game.i18n.format("EE.Features.ViciousEntangle.Intro", {
    targets: anchors.map((token) => String(token.document.name ?? "")).join(", "),
    cost: priceOf(costs),
    // The system's own name for the band, so it reads as the card does and stays
    // translated in a world that isn't in English. Same exception as
    // `hold-them-off.ts`: this is the *system's* string, and a copy under `EE.`
    // would be a worse one.
    range: game.i18n.localize(`DAGGERHEART.CONFIG.Range.${BAND}.name`),
  });
}

/**
 * Copy the follow-up's declared effects onto one actor. Returns how many landed.
 *
 * Deliberately routed through the system's own `EffectsField.applyEffect` rather
 * than `ActiveEffect.create`: that static is what sets `disabled: false`,
 * `transfer: false` and the `origin`, and — more to the point — it is the seam
 * `gm-action-effects.ts` wraps, so a player's copy still reaches an adversary
 * they do not own. The `item.applyEffects ?? item.effects` lookup mirrors
 * `EffectsField.applyEffects` field for field.
 */
async function applyDeclaredEffects(
  item: AnyObject,
  action: AnyObject,
  actor: AnyObject,
): Promise<number> {
  const field = game.system?.api?.fields?.ActionFields?.EffectsField as AnyObject | undefined;
  const applyEffect = field?.["applyEffect"];

  if (typeof applyEffect !== "function") {
    console.warn(`${LOG_PREFIX} ${LABEL}: no EffectsField.applyEffect; nothing can be applied.`);
    return 0;
  }

  const source = (item["applyEffects"] ?? item["effects"]) as AnyObject | undefined;
  let applied = 0;

  for (const entry of (action["effects"] ?? []) as AnyObject[]) {
    const effect = source?.["get"]?.(String(entry["_id"] ?? "")) as AnyObject | undefined;
    if (!effect) continue;

    await applyEffect.call(field, effect, actor);
    applied += 1;
  }

  return applied;
}

/**
 * Say what happened, in the visibility the cast itself was rolled at.
 *
 * This is what stands in for the chat card the skipped workflow would have
 * posted. Failure is swallowed: the effect is already applied and the cost
 * already charged, and losing the announcement must not undo either.
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
    console.warn(`${LOG_PREFIX} ${LABEL}: could not announce the second restraint.`, error);
  }
}

/**
 * Offer the second adversary and, if one is picked, press the card's own
 * "Restrain Another" against them.
 *
 * Runs on the casting client, which is where `postUseAction` fires and where the
 * player who owns the choice is sitting, so the prompt is raised locally rather
 * than over the feature-ask socket.
 */
async function runFollowUp(action: AnyObject, config: AnyObject): Promise<void> {
  if (!enabled()) return;

  // Silent gate: almost every action in the world is nothing to do with this
  // card. Past here every exit says why, because past here a player might
  // reasonably have expected the prompt.
  if (String(action?.["type"] ?? "") !== "attack") return;
  const item = action["item"] as AnyObject | undefined;
  if (!isViciousEntangle(item)) return;

  const shape = readCard(item!);
  if (!shape) {
    console.debug(
      `${LOG_PREFIX} ${LABEL}: the card is not the shape this drives; nothing offered.`,
    );
    return;
  }

  // Only populated when the roll had targets or a set difficulty. Without it
  // nothing here knows whether it succeeded — see the header note.
  if (config["roll"]?.["success"] !== true) {
    console.debug(`${LOG_PREFIX} ${LABEL}: the cast did not succeed (or had no target).`);
    return;
  }

  const caster = action["actor"] as AnyObject | undefined;
  if (!caster) return;

  // Checked before the prompt rather than after it: an offer the player cannot
  // take is worse than no offer. No notification — a caster below the price casts
  // this card just as often as one above it, and one per cast would be noise.
  if (!canAfford(caster, shape.costs)) {
    console.debug(
      `${LOG_PREFIX} ${LABEL}: ${String(caster["name"] ?? "")} cannot pay ${priceOf(shape.costs)}.`,
    );
    return;
  }

  if (!canvas.ready) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no canvas; cannot measure Very Close.`);
    return;
  }

  const anchors = hitTokens(config);
  if (anchors.length === 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no hit target has a token to measure from.`);
    return;
  }

  const candidates = candidatesNear(anchors, config);
  if (candidates.length === 0) {
    console.debug(`${LOG_PREFIX} ${LABEL}: no other adversary within Very Close of the target.`);
    return;
  }

  const price = priceOf(shape.costs);

  const picked = await chooseUpTo({
    title: game.i18n.localize("EE.Features.ViciousEntangle.Title"),
    // No portrait banner: the choices below carry portraits of their own, and a
    // second row of them would compete with the one being read.
    intro: introFor(anchors, shape.costs),
    choices: candidates.map(choiceFor),
    max: EXTRA_TARGETS,
    confirmLabel: game.i18n.format("EE.Features.ViciousEntangle.Confirm", { cost: price }),
    declineLabel: game.i18n.localize("EE.Features.ViciousEntangle.Decline"),
    // The cast has already resolved and its card has already posted, so this
    // prompt is holding nothing back. Expiring it would only throw away a choice
    // the player can no longer make — see `ChoiceRequest.untimed`.
    untimed: true,
  });

  if (picked.length === 0) return;

  // The answer came from a dialog this client built a moment ago, but it is still
  // re-checked against that list rather than trusted to name a token.
  const token = candidates.find((candidate) => candidate.token.id === picked[0])?.token;
  const victim = token?.actor as AnyObject | undefined;
  if (!token || !victim) return;

  // Re-checked here because the picker is untimed: a player can sit on it while
  // something else spends the Hope out from under them.
  if (!canAfford(caster, shape.costs)) {
    ui.notifications?.warn(
      game.i18n.format("EE.Features.ViciousEntangle.CannotPay", { cost: price }),
    );
    return;
  }

  // Effects first, cost second — the system's own workflow order (effects at 100,
  // cost at 150), and the safer of the two here: the charge is a local write to
  // the caster's own sheet and effectively cannot fail, while the effect may have
  // to travel to the GM to land. Nothing is charged for an effect that found
  // nothing to apply.
  const applied = await applyDeclaredEffects(item!, shape.restrain, victim);
  if (applied === 0) {
    console.warn(`${LOG_PREFIX} ${LABEL}: the follow-up declares no effect this Item holds.`);
    return;
  }

  await caster["modifyResource"]?.(resourceUpdatesFor(caster, shape.costs));

  await announce(
    config,
    caster,
    game.i18n.format("EE.Features.ViciousEntangle.Announced", {
      name: String(caster["name"] ?? ""),
      target: String(token.document.name ?? ""),
      cost: price,
    }),
  );
}

/**
 * Answer the action chooser for this card, so pressing it goes straight to the
 * Spellcast roll.
 *
 * `Item#use` opens `ActionSelectionDialog.create` whenever an item has more than
 * one action, and this card's second action is a *follow-up* rather than an
 * alternative — offering the two as peers asks which you meant before the roll
 * that decides whether the second one exists. The dialog's `create` is the
 * surgical seam: `Item#use` performs its `isDomainTouchedSuppressed` check and
 * builds `actionsList` before reaching it, so wrapping `use` itself would mean
 * reproducing both.
 *
 * The system's `applications.dialogs` namespace is `Object.freeze`d, so the class
 * is reached through it and patched on the class itself.
 */
function patchActionChooser(): void {
  const dialogs = game.system?.api?.applications?.dialogs as AnyObject | undefined;
  const dialog = dialogs?.["ActionSelectionDialog"] as AnyObject | undefined;
  const original = dialog?.["create"];

  if (typeof original !== "function") {
    console.warn(
      `${LOG_PREFIX} ${LABEL}: no action chooser to answer — the card keeps its selection dialog.`,
    );
    return;
  }

  dialog!["create"] = function (
    this: AnyObject,
    item: AnyObject,
    event: AnyObject,
    options?: AnyObject,
  ): unknown {
    try {
      if (enabled() && isViciousEntangle(item)) {
        const cast = readCard(item)?.cast;
        // Resolved rather than returned raw: `Item#use` awaits this.
        if (cast) return Promise.resolve(cast);
      }
    } catch (error) {
      // A card this cannot read must still open its ordinary chooser.
      console.warn(`${LOG_PREFIX} ${LABEL}: could not answer the action chooser.`, error);
    }

    return original.call(this, item, event, options);
  };
}

export function registerViciousEntangle(): void {
  Hooks.on("daggerheart.postUseAction", (action: AnyObject, config: AnyObject) => {
    // Floated rather than awaited: hook callbacks are synchronous, and the cast's
    // chat card has already posted by here, so nothing downstream is waiting on
    // the answer. Failures are the runner's own to report.
    void runFollowUp(action, config).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} ${LABEL}: the follow-up could not be offered.`, error);
    });
  });

  // At `setup` rather than `init`: the dialog class is read off `game.system.api`,
  // which the system only fills inside its own `init`. Early enough — nobody can
  // press a card before the canvas exists.
  Hooks.once("setup", patchActionChooser);
}
