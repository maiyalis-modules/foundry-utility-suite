/**
 * The one patch on the system's roll pipeline, and the dice-timing machinery
 * every feature window shares.
 *
 * ## Why one patch and not one per window
 *
 * Both feature windows so far need the same seam — after the roll is evaluated,
 * before the chat message exists — and that seam is `DHRoll.buildPost`. Two
 * modules each wrapping it independently would work, but the order in which they
 * ran would depend on the order `module.ts` happened to call them, and a window
 * that *replaces* the roll (see {@link RollWindow.run}) would have to hand the
 * replacement to whatever wrapped it next by accident rather than by design. One
 * patch with an explicit handler list makes that ordering visible.
 *
 * ## Why `DHRoll.buildPost` is the seam
 *
 * `DHRoll.build` runs `buildConfigure` → `buildEvaluate` → `buildPost`, and
 * `buildPost` is the step that fires the system's `postRoll*` hooks and then
 * creates the chat message. Everything a feature might want to pre-empt happens
 * at or after that message:
 *
 * - the card the table reads,
 * - the Fear, the Hope and the countdown updates (`DualityRoll.buildPost`),
 * - the `fearRoll` and `dualityRoll` triggers on every other feature,
 * - `TargetField.execute`, which turns `config.roll.total` into each target's
 *   `hitResult`, and the damage that follows from it.
 *
 * Sitting at the *bottom* of the class chain also matters. `DualityRoll` defines
 * its own `buildPost`, which stamps the Hope/Fear 3D dice presets and only then
 * calls `super.buildPost` — and `super` resolves past `D20Roll` (which defines no
 * `buildPost` at all) to here. So a window installed here runs after the presets
 * are in place but before the message, which is what makes {@link showDiceEarly}
 * possible. `D20Roll` having no `buildPost` is also why adversary attack rolls
 * arrive here directly.
 */
import { LOG_PREFIX } from "../constants.js";

/**
 * The system version these seams were read against. Everything here reaches into
 * unexported internals with no stability guarantee, so a mismatch is worth one
 * loud line in the console — silently wrong behaviour at the table is far worse
 * than a warning nobody needed.
 */
const VERIFIED_SYSTEM_VERSION = "2.7.2";

/**
 * Marks a roll whose 3D dice this module has already rolled by hand, so the chat
 * message it eventually produces does not roll them a second time.
 *
 * Deliberately dot-free. Foundry's object helpers (`expandObject`, `mergeObject`)
 * treat a dot in a key as a path, and roll options pass through `mergeObject` on
 * construction — a namespaced `module-id.key` would risk being silently expanded
 * into a nested object and never read back.
 */
const DSN_SHOWN = "eeDiceShown";

/** Dice So Nice's own "do not animate this message" flag. */
const DSN_SKIP_FLAG = "flags.dice-so-nice.skip";

/**
 * Where the roll's *declared* type is kept, because the system throws it away.
 *
 * `RollField.prepareConfig` sets `config.roll.type` to the action's roll type —
 * `attack`, `spellcast`, `trait`, `diceSet`. But `D20Roll.buildEvaluate` then
 * overwrites it:
 *
 * ```js
 * await super.buildEvaluate(roll, config, message);  // config.roll = { ...old, total, formula, dice }
 * const data = config.roll;
 * data.type = config.actionType;                     // 'action' | 'reaction'
 * ```
 *
 * `config.actionType` is a different taxonomy entirely (whether the action is
 * taken on your turn or in reaction to something), so from `buildPost` onwards
 * there is no longer anything on the config that says "this was an attack". The
 * value is captured at `daggerheart.preRoll` — the first line of
 * `buildConfigure`, long before the overwrite — and parked on the config itself
 * rather than on `config.roll`, which `buildEvaluate` replaces wholesale.
 *
 * Dot-free for the same reason as {@link DSN_SHOWN}.
 */
const ROLL_TYPE = "eeRollType";

/**
 * One interception point on the roll pipeline.
 *
 * Split into {@link matches} and {@link run} so the pipeline can tell "this
 * window is not interested" (the overwhelmingly common case, and free) from "this
 * window ran and chose to do nothing".
 */
export interface RollWindow {
  /** Stable id, used only in logs. */
  id: string;
  /** Is this roll one this window handles? Must be cheap and must not throw. */
  matches(roll: AnyObject, config: AnyObject): boolean;
  /**
   * Do the work. Returning a Roll **replaces** the one the rest of `buildPost`
   * will post and act on — which is how a reroll is delivered without the
   * original ever reaching a chat message. Returning nothing keeps the roll as
   * it is; mutating `config` in place is the other way to change the outcome.
   */
  run(roll: AnyObject, config: AnyObject, message: AnyObject): Promise<AnyObject | void>;
}

/** Installed windows, in the order they were registered. */
const windows: RollWindow[] = [];

/**
 * Add a window. Registration order is execution order, so a window that rewrites
 * a roll outright should be registered before one that merely reads it.
 */
export function registerRollWindow(window: RollWindow): void {
  windows.push(window);
}

/** Who is going to be able to see the chat message this roll produces. */
export interface RollVisibility {
  /** User ids it is whispered to, or null when the whole table sees it. */
  whisper: string[] | null;
  /** Whether even those recipients are kept from the result. */
  blind: boolean;
}

/**
 * Work out that visibility ahead of the message existing.
 *
 * `DHRoll.toMessage` creates the message with `{ messageMode:
 * config.selectedMessageMode }`, which core turns into `whisper`/`blind` via
 * `ChatMessage.applyMode`. Anything this module does *before* the message —
 * animating dice, most of all — has to respect the same decision, so it asks
 * core the same question rather than reimplementing the mapping. An absent mode
 * falls back to the client's `core.messageMode` setting inside `applyMode`,
 * which is exactly what `toMessage` does with its own `??=`.
 *
 * A `speaker` is supplied because `applyMode` reads one for in-character modes.
 */
export function rollVisibility(config: AnyObject): RollVisibility {
  try {
    const mode = config["selectedMessageMode"];
    const applied = ChatMessage.applyMode(
      { speaker: {} },
      typeof mode === "string" && mode ? mode : undefined,
    );
    const whisper = Array.isArray(applied["whisper"]) ? applied["whisper"].map(String) : [];

    return { whisper: whisper.length > 0 ? whisper : null, blind: applied["blind"] === true };
  } catch (error) {
    // Showing dice to everyone is what the system does for an ordinary public
    // roll, so it is the least surprising thing to fall back to — but say so,
    // because it is also the answer that leaks a private one.
    console.warn(`${LOG_PREFIX} Roll pipeline: could not read the roll's visibility.`, error);
    return { whisper: null, blind: false };
  }
}

/**
 * Roll the 3D dice now, ahead of a prompt, and mark the roll so the chat message
 * does not roll them again.
 *
 * Dice So Nice animates off the *chat message*, which is exactly the thing a
 * window holds back — so without this a player would be asked to react to a
 * result they had not yet watched arrive. Only safe from inside `buildPost`,
 * where the dice already carry whatever appearance presets the roll type stamped
 * onto them, so the manual animation is indistinguishable from the automatic one.
 *
 * Call it only when a prompt is actually going to appear: a roll nobody is asked
 * about should keep the system's ordinary timing.
 *
 * Returns whether the animation actually played.
 */
export async function showDiceEarly(roll: AnyObject, config: AnyObject): Promise<boolean> {
  // Idempotent, because more than one window can hold the same roll: a Blood
  // Spike cast is a character's Duality roll, so Fearless and Blood Spike may
  // both want to ask about it. The table watches the dice land once, before the
  // first question; the second must not throw them again.
  if (roll["options"]?.[DSN_SHOWN] === true) return true;

  const dice3d = game["dice3d"];
  if (typeof dice3d?.showForRoll !== "function") return false;

  try {
    // `synchronize: true` so the rest of the table watches the same dice, but
    // only the people the message itself will reach: on a GM's private or blind
    // roll, animating for everyone would show the table dice the chat card is
    // about to hide. `showForRoll(roll, user, synchronize, users, blind)` is the
    // same call the system's own `DamageRoll.buildPost` makes, with the whisper
    // list and blind flag taken off the message it is about to create.
    const { whisper, blind } = rollVisibility(config);
    const shown = await dice3d.showForRoll(roll, game.user, true, whisper, blind);
    // Resolves false when Dice So Nice declines (a blind roll, or its visibility
    // setting) — in which case the message path would not have animated either,
    // so leave both the marker and the sound alone.
    if (shown === false) return false;

    if (roll["options"]) roll["options"][DSN_SHOWN] = true;
    // The system's own convention when it has already rolled dice by hand
    // (`DamageRoll.buildPost` does the same): mute the message so the dice sound
    // does not play twice.
    config["mute"] = true;
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Roll pipeline: could not roll the dice early.`, error);
    return false;
  }
}

/**
 * Undo {@link showDiceEarly} for a roll that is about to be thrown away.
 *
 * A window that *replaces* the roll has to call this: the dice the table watched
 * belong to the discarded roll, while the replacement's dice have never been seen
 * and must animate normally. Both flags have to be cleared through `config`
 * rather than the roll, because the system builds every roll with the config
 * object *as* its `options` (`createRollInstance` passes `config` straight
 * through), so the old roll and the new one share one object.
 */
export function clearEarlyDice(config: AnyObject): void {
  // Only undo what we actually set. A window may replace a roll whose dice were
  // never shown early — sometimes because Dice So Nice declined — and `mute` is a
  // field the system sets for its own reasons elsewhere.
  if (config[DSN_SHOWN] !== true) return;

  delete config[DSN_SHOWN];
  config["mute"] = false;
}

/**
 * Build a fresh roll of the same kind and evaluate it — the reroll a window
 * returns to replace the one the rest of `buildPost` would have posted.
 *
 * Rebuilding rather than re-rolling the dice in place, for the reason
 * `adversary-attack.ts` sets out: `config` **is** the roll's `options` (the
 * system's `createRollInstance` passes it straight through), and re-running
 * `buildEvaluate` is what makes `config.roll.total`, `config.roll.result.duality`
 * and every target's `hit` describe the new roll before anything reads them.
 * Nothing is rewritten by hand; the modifiers come back by recomputation from
 * `config.roll.baseModifiers` and the roll's active effects — which is also why
 * a bonus the player paid for, an Experience among them, survives the reroll.
 *
 * **Deliberately not `DualityRoll#reroll({liveRoll: true})`.** That path also
 * runs `updateResourcesForDualityReroll`, which reconciles the Hope or Fear the
 * first result handed out — correct only *after* `dualityUpdate` has applied it,
 * and at this seam it has not. A reroll acting on an already-posted message is
 * the opposite case and does want it; see `adaptability.ts`.
 *
 * The dice *appearance* is carried across by hand. `DualityRoll.buildPost`
 * stamps the Hope/Fear presets onto `roll.dice[0..2]` before it calls
 * `super.buildPost` — which is where windows run — so the replacement's dice
 * have never been through that and would animate as plain dice. Copying the
 * options across is exactly what the system's own `DualityRoll#reroll` does for
 * the same reason.
 *
 * **One known edge.** `DualityRoll.buildPost` calls `handleTriggers(roll, …)`
 * *after* `super.buildPost` — using its own local `roll`, which is still the
 * original. So a registered `dualityRoll`/`fearRoll` trigger that inspects the
 * Roll object sees the discarded one. What it is *gated* on is fine, because that
 * is `config.roll.result.duality` and `buildEvaluate` has rewritten it, and so is
 * the chat card, the Hope/Fear update and every target's `hit`. Closing it
 * properly would mean patching `DualityRoll.buildPost` as well as `DHRoll`'s,
 * which is a second seam for a case no shipped trigger currently reads.
 *
 * Lives here rather than in the one feature that first needed it: it is the
 * counterpart of {@link clearEarlyDice}, which it has to call, and there are now
 * two callers (Ranger's Focus and Adaptability). `label` only names the caller in
 * the warnings.
 *
 * Returns null if the system's shape has moved, in which case the pipeline posts
 * the original untouched.
 */
export async function rebuildRoll(
  roll: AnyObject,
  config: AnyObject,
  message: AnyObject,
  label: string,
): Promise<AnyObject | null> {
  const rollClass = roll["constructor"] as AnyObject | undefined;
  if (
    typeof rollClass?.["createRollInstance"] !== "function" ||
    typeof rollClass?.["buildEvaluate"] !== "function"
  ) {
    console.warn(`${LOG_PREFIX} ${label}: cannot rebuild this roll — leaving it alone.`);
    return null;
  }

  // The dice the table watched belong to the roll being discarded; the
  // replacement's have never been seen and must animate normally. Cleared
  // through `config`, which the old roll and the new one share as their options.
  clearEarlyDice(config);

  const rerolled = rollClass["createRollInstance"](config) as AnyObject;
  await rollClass["buildEvaluate"](rerolled, config, message);

  try {
    const from = (roll["dice"] ?? []) as AnyObject[];
    const to = (rerolled["dice"] ?? []) as AnyObject[];
    for (let index = 0; index < to.length; index += 1) {
      const options = from[index]?.["options"];
      if (options && to[index]) to[index]!["options"] = options;
    }
  } catch (error) {
    // Cosmetic only: without this the reroll animates in default colours.
    console.warn(`${LOG_PREFIX} ${label}: could not carry the dice presets over.`, error);
  }

  return rerolled;
}

/**
 * The roll type a window should match on — `attack`, `spellcast`, `trait`,
 * `diceSet` — or null when it is not knowable.
 *
 * Null rather than falling back to the live `config.roll.type`: after
 * `buildEvaluate` that field holds an `actionType`, so the fallback would answer
 * a different question with the same confidence. A window that cannot tell what
 * kind of roll this was should decline, not guess.
 */
export function rollTypeOf(config: AnyObject | null | undefined): string | null {
  const type = config?.[ROLL_TYPE];
  return typeof type === "string" && type ? type : null;
}

/**
 * Record each roll's declared type before the system overwrites it.
 *
 * `daggerheart.preRoll` is fired for every roll at the top of
 * `DHRoll.buildConfigure` (`config.hooks` always ends in `''`, which is what
 * produces the unsuffixed name), so this sees every roll the system makes —
 * including ones a dialog later reconfigures, since the dialog cannot change the
 * type. Returning nothing keeps the roll going: only an explicit `false` from a
 * `preRoll` listener would cancel it.
 */
function registerRollTypeCapture(): void {
  Hooks.on("daggerheart.preRoll", (config: AnyObject) => {
    try {
      const type = config?.["roll"]?.["type"];
      if (typeof type === "string" && type) config[ROLL_TYPE] = type;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Roll pipeline: could not read the roll type.`, error);
    }
  });
}

/**
 * Stop Dice So Nice animating a message whose dice we already rolled by hand.
 *
 * A `preCreateChatMessage` hook, because the flag has to be on the document
 * *before* it is created — DSN decides in its own create hook, and its
 * `shouldInterceptMessage` bails on `flags.dice-so-nice.skip`. The marker is read
 * off the roll rather than tracked in a variable, so nothing can go stale or
 * attach itself to an unrelated message created in between.
 */
function registerDiceSuppression(): void {
  Hooks.on("preCreateChatMessage", (document: AnyObject) => {
    try {
      const rolls = document["rolls"] ?? [];
      const alreadyShown = rolls.some((entry: unknown) => {
        // Prepared documents hold Roll instances; fall back to the stored JSON in
        // case this ever runs before `prepareDerivedData`.
        const roll = typeof entry === "string" ? JSON.parse(entry) : (entry as AnyObject);
        return roll?.["options"]?.[DSN_SHOWN] === true;
      });
      if (!alreadyShown) return;

      document["updateSource"]?.({ [DSN_SKIP_FLAG]: true });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Roll pipeline: could not suppress a duplicate dice roll.`, error);
    }
  });
}

/**
 * Install the patch. Call once during `init`, after every window has registered.
 *
 * The original is always called, and a throw from any window is swallowed: a
 * broken feature must degrade to an ordinary, unmodified roll rather than eat the
 * chat card and the resource updates behind it.
 */
export function installRollPipeline(): void {
  const DHRoll = CONFIG["Dice"]?.daggerheart?.DHRoll as AnyObject | undefined;
  if (!DHRoll) {
    console.warn(`${LOG_PREFIX} Roll pipeline: DHRoll not found — feature automation is off.`);
    return;
  }

  if (game.system?.version && game.system.version !== VERIFIED_SYSTEM_VERSION) {
    console.warn(
      `${LOG_PREFIX} Roll pipeline: verified against Daggerheart ${VERIFIED_SYSTEM_VERSION}, ` +
        `running ${game.system.version}. Re-check DHRoll.buildPost if rolls misbehave.`,
    );
  }

  const original = DHRoll["buildPost"];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} Roll pipeline: no buildPost to wrap — feature automation is off.`);
    return;
  }

  registerRollTypeCapture();
  registerDiceSuppression();

  DHRoll["buildPost"] = async function (
    this: AnyObject,
    roll: AnyObject,
    config: AnyObject,
    message: AnyObject,
  ): Promise<unknown> {
    let current = roll;

    for (const window of windows) {
      try {
        if (!window.matches(current, config)) continue;
        const replacement = await window.run(current, config, message);
        if (replacement) current = replacement;
      } catch (error) {
        console.warn(
          `${LOG_PREFIX} Roll window "${window.id}" failed; leaving the roll alone.`,
          error,
        );
      }
    }

    return original.call(this, current, config, message);
  };
}
