/**
 * "Which creatures?" — a searchable, multi-select picker over every actor the
 * table can reach.
 *
 * Built for Gifted Tracker, where the GM has to name the creatures a ranger has
 * been tracking, and those creatures may not exist yet: they can be tokens
 * already on the scene, actors sitting in the world directory, or statblocks
 * still in a compendium that nothing has imported.
 *
 * ## Why it isn't `chooseUpTo`
 *
 * That prompt renders every choice as a checkbox row, which is right for "which
 * of these three adversaries standing next to you". Here the candidate list is
 * the whole installation — the SRD adversary pack alone is a few hundred entries,
 * before any third-party content — and rendering them all would mean hundreds of
 * portrait requests for a list nobody reads top to bottom.
 *
 * So the shape is inverted: **the compendiums are searched, not listed.** With an
 * empty box you see what is on this scene and what is in the world, which is the
 * answer most of the time and is small enough to render honestly. Type, and the
 * search reaches into every Actor compendium as well.
 *
 * ## Why selection lives in JavaScript rather than in the DOM
 *
 * Because filtering destroys rows. Tick a treant, search for "goblin", and the
 * treant's row is no longer in the document — so reading the answer off the form
 * at submit time would silently drop everything the GM picked before their last
 * search. The picked set is therefore held in a `Map` and re-rendered as chips
 * above the results, which doubles as the running total of what confirming does.
 */
import { LOG_PREFIX } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";

/** One actor the GM can pick, flattened to the parts that survive a socket hop. */
export interface ActorChoice {
  /** Actor or compendium-entry uuid. What the answer is identified by. */
  uuid: string;
  name: string;
  img?: string;
  /** Where it was found, shown as the row's chip. Already localized. */
  source?: string;
}

/** Everything needed to raise a {@link chooseActors} prompt. */
export interface ActorPickRequest {
  title: string;
  /** The question as a sentence. */
  intro: string;
  /**
   * Free text written by *another player*, quoted above the search box. Escaped
   * on the way into the DOM like everything else here.
   */
  note?: string;
  /** Localized confirm button. */
  confirmLabel: string;
  /** Localized cancel button. */
  cancelLabel: string;
  /** Actor types worth offering. */
  types: readonly string[];
}

/** Stand-in artwork, matching the rest of the prompts. */
const PLACEHOLDER_PORTRAIT = "icons/svg/mystery-man.svg";

/**
 * How many search results to render at once.
 *
 * A cap rather than a scroll: searching "g" across every pack matches hundreds,
 * and the useful response to that is a narrower search, not a longer list. The
 * count of what was left out is shown so the GM knows to keep typing.
 */
const RESULT_LIMIT = 40;

/** Below this, compendiums aren't searched — one letter matches most of them. */
const MIN_QUERY = 2;

/** Is this actor one of the types the caller asked for? */
function wanted(type: unknown, types: readonly string[]): boolean {
  return types.length === 0 || types.includes(String(type ?? ""));
}

/**
 * The base Actor behind a token's synthetic one.
 *
 * An unlinked token's actor is an ActorDelta whose uuid names the scene and the
 * token, which would pin the pick to *that one token* — wrong for a rule about a
 * kind of creature. The delta keeps the base actor's `_id`, so this recovers the
 * world actor, and falls back to the delta when the base is gone.
 */
function baseActorOf(actor: AnyObject): AnyObject {
  if (actor["isToken"] !== true) return actor;
  return (game.actors?.get(String(actor["id"] ?? "")) as AnyObject | undefined) ?? actor;
}

/** Everything with a token on this scene. Deduplicated by the actor behind it. */
function sceneChoices(types: readonly string[]): ActorChoice[] {
  const seen = new Set<string>();
  const found: ActorChoice[] = [];
  const source = game.i18n.localize("EE.Picker.SourceScene");

  for (const token of canvas?.tokens?.placeables ?? []) {
    const actor = (token as AnyObject)["actor"] as AnyObject | null;
    if (!actor) continue;

    const base = baseActorOf(actor);
    const uuid = String(base["uuid"] ?? "");
    if (!uuid || seen.has(uuid) || !wanted(base["type"], types)) continue;

    seen.add(uuid);
    found.push({ uuid, name: String(base["name"] ?? ""), img: String(base["img"] ?? ""), source });
  }

  return found;
}

/** Everything in the world directory. */
function worldChoices(types: readonly string[]): ActorChoice[] {
  const source = game.i18n.localize("EE.Picker.SourceWorld");

  return ((game.actors?.contents ?? []) as AnyObject[])
    .filter((actor) => wanted(actor["type"], types))
    .map((actor) => ({
      uuid: String(actor["uuid"] ?? ""),
      name: String(actor["name"] ?? ""),
      img: String(actor["img"] ?? ""),
      source,
    }));
}

/** Every Actor compendium the table has, whoever shipped it. */
function actorPacks(): AnyObject[] {
  return ((game.packs?.contents ?? []) as AnyObject[]).filter(
    (pack) => pack["documentName"] === "Actor",
  );
}

/**
 * Load every Actor pack's index once, so searching is synchronous afterwards.
 *
 * Foundry caches the index on the pack, so this is a no-op on the second call and
 * usually already done — the compendium sidebar loads them. A pack that refuses
 * to index is skipped rather than taking the dialog down with it.
 */
async function loadPackIndexes(): Promise<void> {
  await Promise.all(
    actorPacks().map(async (pack) => {
      try {
        await pack["getIndex"]?.();
      } catch (error) {
        console.warn(
          `${LOG_PREFIX} Actor picker: could not index ${String(pack["collection"] ?? "?")}.`,
          error,
        );
      }
    }),
  );
}

/** Compendium entries matching `query`. Indexes must already be loaded. */
function packChoices(types: readonly string[], query: string): ActorChoice[] {
  const found: ActorChoice[] = [];

  for (const pack of actorPacks()) {
    const label = String(pack["title"] ?? pack["metadata"]?.["label"] ?? "");

    for (const entry of (pack["index"] ?? []) as Iterable<AnyObject>) {
      if (!wanted(entry["type"], types)) continue;

      const name = String(entry["name"] ?? "");
      if (!name.toLowerCase().includes(query)) continue;

      // The index carries a uuid in current Foundry; the fallback builds the same
      // string from the pack's collection so an older index shape still works.
      const uuid = String(
        entry["uuid"] ??
          `Compendium.${String(pack["collection"] ?? "")}.Actor.${String(entry["_id"] ?? "")}`,
      );

      found.push({ uuid, name, img: String(entry["img"] ?? ""), source: label });
    }
  }

  return found;
}

/**
 * What to show for `query`, and how many matches were cut.
 *
 * Scene first, then world, then compendiums — nearest to hand first. Duplicates
 * are dropped by uuid, so an actor standing on the scene appears once, labelled
 * as being on the scene.
 */
function resultsFor(types: readonly string[], query: string): { rows: ActorChoice[]; more: number } {
  const needle = query.trim().toLowerCase();

  const matches = (choice: ActorChoice): boolean =>
    needle.length === 0 || choice.name.toLowerCase().includes(needle);

  const pool = [
    ...sceneChoices(types).filter(matches),
    ...worldChoices(types).filter(matches),
    // One letter matches most of the SRD, so the compendiums stay out of it until
    // the query says something.
    ...(needle.length >= MIN_QUERY ? packChoices(types, needle) : []),
  ];

  const seen = new Set<string>();
  const rows: ActorChoice[] = [];
  for (const choice of pool) {
    if (!choice.uuid || seen.has(choice.uuid)) continue;
    seen.add(choice.uuid);
    rows.push(choice);
  }

  return { rows: rows.slice(0, RESULT_LIMIT), more: Math.max(0, rows.length - RESULT_LIMIT) };
}

/** One result row. Shares the row styling the other prompts use. */
function renderResult(choice: ActorChoice, picked: boolean): string {
  const tag = choice.source
    ? `<span class="ee-feature-row-tag">${escapeHtml(choice.source)}</span>`
    : "";

  return `<button type="button" class="ee-feature-row ee-picker-result${
    picked ? " is-picked" : ""
  }" data-ee-pick="${escapeHtml(choice.uuid)}" aria-pressed="${picked}">
    <img class="ee-feature-row-art" src="${escapeHtml(
      choice.img || PLACEHOLDER_PORTRAIT,
    )}" alt="" draggable="false">
    <span class="ee-feature-row-label">
      <span class="ee-feature-row-name">${escapeHtml(choice.name)}</span>
      ${tag}
    </span>
    <i class="ee-picker-mark fa-solid ${picked ? "fa-circle-check" : "fa-plus"}"></i>
  </button>`;
}

/** One chip in the chosen strip. Clicking it takes that choice back off. */
function renderChip(choice: ActorChoice): string {
  return `<button type="button" class="ee-picker-chip" data-ee-drop="${escapeHtml(choice.uuid)}">
    <img src="${escapeHtml(choice.img || PLACEHOLDER_PORTRAIT)}" alt="" draggable="false">
    <span>${escapeHtml(choice.name)}</span>
    <i class="fa-solid fa-xmark"></i>
  </button>`;
}

/**
 * Ask for any number of actors. Returns what was picked, in the order it was
 * picked; empty for a cancelled or dismissed dialog.
 *
 * No timeout, for the same reason as `chooseOne`: nothing is held open behind
 * this. The action that raised it has already resolved and its cost is paid, so
 * an unattended dialog costs only the follow-through, and closing it after thirty
 * seconds would take the answer away from a GM who looked down at their notes.
 */
export async function chooseActors(request: ActorPickRequest): Promise<ActorChoice[]> {
  const { title, intro, note, confirmLabel, cancelLabel, types } = request;

  await loadPackIndexes();

  const picked = new Map<string, ActorChoice>();
  // The rows currently on screen, so a click resolves against what was actually
  // rendered rather than against whatever a `data-` attribute claims.
  let showing: ActorChoice[] = [];

  const { DialogV2 } = foundry.applications.api;

  const answer = await DialogV2.wait({
    classes: ["ee-feature-prompt", "ee-picker-prompt"],
    window: { title },
    content: `<p>${escapeHtml(intro)}</p>
      ${note ? `<blockquote class="ee-picker-note">${escapeHtml(note)}</blockquote>` : ""}
      <div class="ee-picker">
        <input type="search" class="ee-picker-search" autocomplete="off"
          placeholder="${escapeHtml(game.i18n.localize("EE.Picker.SearchPlaceholder"))}">
        <div class="ee-picker-chosen"></div>
        <div class="ee-picker-results"></div>
      </div>`,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: () => ({ picked: [...picked.values()] }),
      },
      { action: "cancel", label: cancelLabel },
    ],
    rejectClose: false,
    render: (_event: Event, instance: AnyObject) => {
      try {
        const root = instance?.["element"] as HTMLElement | undefined;
        if (!root) return;

        const search = root.querySelector<HTMLInputElement>(".ee-picker-search");
        const results = root.querySelector<HTMLElement>(".ee-picker-results");
        const chosen = root.querySelector<HTMLElement>(".ee-picker-chosen");
        if (!search || !results || !chosen) return;

        const draw = (): void => {
          const { rows, more } = resultsFor(types, search.value);
          showing = rows;

          const overflow =
            more > 0
              ? `<p class="hint">${escapeHtml(game.i18n.format("EE.Picker.More", { count: more }))}</p>`
              : "";

          results.innerHTML =
            rows.length === 0
              ? `<p class="hint">${escapeHtml(game.i18n.localize("EE.Picker.NoMatches"))}</p>`
              : rows.map((row) => renderResult(row, picked.has(row.uuid))).join("") + overflow;

          chosen.innerHTML =
            picked.size === 0
              ? `<p class="hint">${escapeHtml(game.i18n.localize("EE.Picker.NothingChosen"))}</p>`
              : [...picked.values()].map(renderChip).join("");
        };

        search.addEventListener("input", draw);

        // One delegated listener for both halves: a result row toggles the
        // choice, a chip drops it. Resolved against `showing` and `picked` rather
        // than trusted from the DOM, the way the other prompts do it.
        root.addEventListener("click", (event: Event) => {
          const target = event.target as HTMLElement | null;

          const add = target?.closest?.("[data-ee-pick]")?.getAttribute("data-ee-pick");
          if (add) {
            const choice = showing.find((row) => row.uuid === add);
            if (!choice) return;

            if (picked.has(add)) picked.delete(add);
            else picked.set(add, choice);
            draw();
            return;
          }

          const drop = target?.closest?.("[data-ee-drop]")?.getAttribute("data-ee-drop");
          if (drop) {
            picked.delete(drop);
            draw();
          }
        });

        draw();
      } catch (error) {
        console.warn(`${LOG_PREFIX} Actor picker: could not wire up the dialog.`, error);
      }
    },
  }).catch(() => null);

  const chosen = (answer as AnyObject | null)?.["picked"];
  return Array.isArray(chosen) ? (chosen as ActorChoice[]) : [];
}
