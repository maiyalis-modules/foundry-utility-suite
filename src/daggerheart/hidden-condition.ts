/**
 * **Hidden** — making the condition mean what its own tooltip says.
 *
 * ## The gap this fills
 *
 * Daggerheart ships three conditions (`CONFIG.DH.GENERAL.conditions()`):
 * *Vulnerable*, *Hidden* and *Restrained*. Each has an id, an icon, a name and a
 * printed description. Hidden's reads:
 *
 * > While Hidden, attacks cannot be made directly targeting them and any rolls
 * > against them are at disadvantage. When a Hidden creature moves or attacks,
 * > they are no longer Hidden. However, if a creature is Hidden when they begin
 * > making an attack, the roll has advantage; the Hidden condition isn't cleared
 * > until after the attack is resolved.
 *
 * **Nothing in the system reads it.** Outside the config block above, the only
 * occurrences of `'hidden'` in the 2.7.2 bundle are CSS class toggles on
 * unrelated widgets. The same is true of *Vulnerable*: its `vulnerableAutomation`
 * setting decides when the condition is *applied* (at max Stress) and the one
 * place that inspects `statuses.has('vulnerable')` is asking whether the
 * auto-applied copy may be removed — never whether a roll should gain advantage.
 * *Restrained*'s "cannot move" is likewise a sentence and nothing more.
 *
 * So the conditions are stickers. A GM who clicks the fog icon onto three tokens
 * has told the table something and told the software nothing, and every roll for
 * the rest of the scene is applied by hand or forgotten.
 *
 * This is the half that was missing: the two clauses of Hidden that are about
 * *dice* are applied to the dice.
 *
 * ## The seam
 *
 * `daggerheart.preRoll`, fired for every roll at the top of `DHRoll.buildConfigure`
 * — `config.hooks` always ends in `''`, which is what produces the unsuffixed
 * name. Three things make it the right place and not merely an early one:
 *
 * 1. **The targets are already resolved.** `Action#use` calls `prepareConfig`,
 *    which runs *every* field's `prepareConfig` — `TargetField`'s included —
 *    before `executeWorkflow` runs any of them. The `order` numbers those fields
 *    carry govern `execute`, not `prepare`. So `config.targets` is populated by
 *    the time the roll is built, even though `TargetField.order` (20) is larger
 *    than `RollField.order` (10).
 * 2. **The system has its own door for exactly this.** `D20Roll.applyKeybindings`
 *    runs on the very next line after these hooks, and reads two loose booleans
 *    the config may carry:
 *    ```js
 *    const advantage    = config.roll.advantage === ADVANTAGE    || keys.advantage    || config.advantage;
 *    const disadvantage = config.roll.advantage === DISADVANTAGE || keys.disadvantage || config.disadvantage;
 *    if (advantage && !disadvantage) config.roll.advantage = ADV_MODE.ADVANTAGE;
 *    else if (!advantage && disadvantage) config.roll.advantage = ADV_MODE.DISADVANTAGE;
 *    else config.roll.advantage = ADV_MODE.NORMAL;
 *    ```
 *    `config.advantage` and `config.disadvantage` are that door: a place for a
 *    source of advantage that is neither a held key nor a pre-set mode. Writing
 *    them rather than `config.roll.advantage` also buys the cancelling rule for
 *    free — a Hidden creature attacking a Hidden creature rolls flat, which is
 *    what Daggerheart says happens when both apply, and what a module setting the
 *    mode directly would have had to reimplement.
 * 3. **The player still decides.** `applyKeybindings` runs *before* the roll
 *    dialog, so the dialog opens with the die already lit and the player can
 *    click it off. This lights a button; it does not hold it down. That is the
 *    difference between a rule the table forgot and a rule the table cannot
 *    overrule, and only the first is this module's business.
 *
 * `DualityRoll extends D20Roll` and does not override `applyKeybindings`, so one
 * seam covers both an adversary's flat d20 attack and a character's Duality roll.
 *
 * ## Which clauses are applied, and which are not
 *
 * - **"any rolls against them are at disadvantage"** — applied, to every roll
 *   type that can have a target (`attack`, `spellcast`, `trait`). Taken at its
 *   printed word: *any* roll, not merely a hostile one. A rolled effect aimed at
 *   an ally who is Hidden is still a roll made against a creature nobody can see.
 * - **"if a creature is Hidden when they begin making an attack, the roll has
 *   advantage"** — applied, but only to `attack` and `spellcast`, because the
 *   clause says *attack* where the other says *rolls*. A Hidden character rolling
 *   Instinct to notice something gains nothing.
 * - **"attacks cannot be made directly targeting them"** — **not** applied.
 *   Refusing to build a roll is a different kind of act from tilting one: it
 *   cancels a thing the player has already committed to, at a moment when the
 *   fiction may well justify it (they heard you, they're swinging into the fog).
 *   Disadvantage is the half of the sentence that a die can express.
 * - **"When a Hidden creature moves or attacks, they are no longer Hidden"** —
 *   **not** applied, and this is the most deliberate silence in the file. It is a
 *   stealth rule, phrased for a creature whose Hidden-ness is *their own doing*,
 *   and it is simply false of the other things that make a creature Hidden: fog
 *   does not thin because you swung through it. Clearing the condition here would
 *   make {@link file://./mysterious-mist.ts} wrong, and there is nothing on the
 *   condition to say which kind it is. So the condition is never removed by this
 *   module — it goes when the GM takes it off, exactly as it does today.
 *
 * ## Why the roller's own advantage is read off the *roller*
 *
 * `config.source.actor` is stamped by `prepareBaseConfig` and is the acting
 * actor's uuid, whoever pressed the button. Reading the condition from there
 * rather than from `game.user.character` means a GM rolling a Hidden adversary
 * gets the advantage too, which the rule does not restrict to players.
 *
 * ## Self-targeting
 *
 * A self-targeted action puts the roller in its own `config.targets`. Without a
 * guard, a Hidden creature would roll at disadvantage against itself and at
 * advantage for the same roll, cancel the two, and end up flat — the right answer
 * reached by an accident that would break the moment either clause changed. The
 * roller is therefore skipped when reading the target side.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/** The Daggerheart condition id, as it appears in `actor.statuses`. */
const HIDDEN = "hidden";

/** For log lines, matching the rest of the module. */
const LABEL = "Hidden";

/**
 * Roll types that can be *made against* a creature.
 *
 * `diceSet` is the odd one out: it is the system's bucket for rolling a pool of
 * dice with no target and no difficulty, so nothing it produces is a roll against
 * anybody.
 */
const TARGETED_ROLLS: readonly string[] = ["attack", "spellcast", "trait"];

/**
 * Roll types that count as *making an attack*.
 *
 * Narrower than {@link TARGETED_ROLLS} on purpose — the advantage clause says
 * "attack" where the disadvantage clause says "rolls". A Spellcast Roll against a
 * creature is an attack in every sense the rule cares about; a trait roll is not.
 */
const ATTACK_ROLLS: readonly string[] = ["attack", "spellcast"];

/** Whether the table wants the condition enforced at all. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.hiddenConditionRolls) === true;
}

/** Does this actor currently carry the Hidden condition? */
function isHidden(actor: AnyObject | null | undefined): boolean {
  const statuses = actor?.["statuses"] as { has?(id: string): boolean } | undefined;
  return statuses?.has?.(HIDDEN) === true;
}

/**
 * The roll type this config declares.
 *
 * Read straight off `config.roll.type` rather than through
 * `roll-pipeline.ts`'s `rollTypeOf`, because at `preRoll` the field still holds
 * the truth: the overwrite that helper exists to survive happens later, in
 * `buildEvaluate`. Going through the helper would also make this depend on which
 * of two listeners on the same hook was registered first.
 */
function rollType(config: AnyObject): string {
  return String(config?.["roll"]?.["type"] ?? "");
}

/**
 * Is this config a roll still being built, rather than an evaluated one being
 * carried along?
 *
 * The damage step reuses the action's config, by which point `buildEvaluate` has
 * replaced `config.roll` with the finished result — a `total` is the tell. Same
 * test `hex.ts` uses on the same hook, for the same reason.
 */
function stillBuilding(config: AnyObject): boolean {
  const roll = config["roll"] as AnyObject | undefined;
  return Boolean(roll) && !Number.isFinite(roll?.["total"]);
}

/** The uuid of the actor making this roll, or "" when the config does not say. */
function rollerUuid(config: AnyObject): string {
  return String(config["source"]?.["actor"] ?? "");
}

/**
 * Is anybody this roll is aimed at Hidden?
 *
 * `config.targets` entries come from `TargetField.formatTarget`, whose `actorId`
 * is an actor **uuid** despite the name — an ActorDelta's for an unlinked token,
 * so two Hidden goblins are two different answers rather than one shared
 * statblock.
 */
function anyTargetHidden(config: AnyObject, roller: string): boolean {
  for (const target of (config["targets"] ?? []) as AnyObject[]) {
    const uuid = String(target?.["actorId"] ?? "");
    // See the header: a self-targeted action lists the roller as its own target,
    // and "rolls against them" was never meant to include those.
    if (!uuid || uuid === roller) continue;
    if (isHidden(fromUuidSync(uuid) as AnyObject | null)) return true;
  }

  return false;
}

/**
 * Set whichever of the two loose flags this roll has earned.
 *
 * Never clears them: another feature may have set one for its own reasons, and
 * "the target is not Hidden" is not a statement about that. Only ever adds, and
 * `applyKeybindings` resolves the pair a line later.
 */
function applyHidden(config: AnyObject): void {
  if (!stillBuilding(config)) return;

  const type = rollType(config);
  const targets = (config["targets"] ?? []) as AnyObject[];
  if (targets.length === 0) return;

  const roller = rollerUuid(config);

  if (TARGETED_ROLLS.includes(type) && anyTargetHidden(config, roller)) {
    config["disadvantage"] = true;
  }

  // The roller's own clause. Gated on there being a target as well as on the
  // roll type: "when they begin making an attack" is not "whenever they roll".
  if (ATTACK_ROLLS.includes(type) && roller) {
    if (isHidden(fromUuidSync(roller) as AnyObject | null)) config["advantage"] = true;
  }
}

/**
 * Wire the condition up. Called once during `init`.
 *
 * Must never return `false` from the hook: on `preRoll` that cancels the roll
 * outright, so a bug in here would stop the table rolling dice rather than merely
 * miss a die.
 */
export function registerHiddenCondition(): void {
  Hooks.on("daggerheart.preRoll", (config: AnyObject): void => {
    try {
      if (enabled()) applyHidden(config);
    } catch (error) {
      console.warn(`${LOG_PREFIX} ${LABEL}: could not read the condition.`, error);
    }
  });
}
