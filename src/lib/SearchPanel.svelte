<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import type { NotesStatus } from "./Backlinks.svelte";
  import type { FileResult, SearchableNote, SearchHit, SearchSummary } from "./folder/search";
  import { icons } from "./icons";

  export let status: NotesStatus = "ready";
  /** Notes lues par le lot notes (L12) ; le panneau ne lit aucun fichier lui-même. */
  export let notes: readonly SearchableNote[] = [];

  const dispatch = createEventDispatcher<{ open: { path: string; line: number; column: number } }>();
  const DEBOUNCE_MS = 200;

  let query = "";
  let caseSensitive = false;
  let wholeWord = false;
  let regex = false;
  let results: FileResult[] = [];
  let summary: SearchSummary | null = null;
  let message: string | null = null;
  let searching = false;
  let collapsed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let inputEl: HTMLInputElement | undefined;
  let treeEl: HTMLElement | undefined;

  $: ready = status === "ready" || status === "too-large" || status === "read-error";
  $: if (ready) schedule(query, caseSensitive, wholeWord, regex, notes);
  $: hitCount = results.reduce((n, r) => n + r.hits.length, 0);

  export function focus(): void {
    inputEl?.focus();
    inputEl?.select();
  }

  function schedule(..._deps: unknown[]): void {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    if (query.trim() === "") {
      results = [];
      summary = null;
      message = null;
      searching = false;
      return;
    }
    searching = true;
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  }

  async function run(): Promise<void> {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    try {
      const search = await import("./folder/search");
      const compiled = search.compileQuery(query, { caseSensitive, wholeWord, regex });
      if (mine.signal.aborted) return;
      if (!compiled.ok) {
        results = [];
        summary = null;
        message = compiled.error.code === "too-short" ? "Saisissez au moins 2 caractères." : compiled.error.message.slice(0, 160);
        searching = false;
        return;
      }
      message = null;
      results = [];
      collapsed = new Set();
      const found: FileResult[] = [];
      const done = await search.searchNotes(
        notes,
        compiled.value,
        (batch) => {
          if (mine.signal.aborted) return;
          found.push(...batch);
          results = [...found].sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch));
        },
        mine.signal,
      );
      if (mine.signal.aborted) return;
      summary = done;
    } catch (e) {
      if (mine.signal.aborted) return;
      results = [];
      summary = null;
      message = `La recherche a échoué : ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    }
    if (controller === mine) {
      searching = false;
      controller = null;
    }
  }

  function toggle(path: string): void {
    const next = new Set(collapsed);
    if (!next.delete(path)) next.add(path);
    collapsed = next;
  }

  function openHit(path: string, hit: SearchHit | null): void {
    dispatch("open", { path, line: hit?.line ?? 1, column: hit?.column ?? 1 });
  }

  function onHeaderActivate(result: FileResult): void {
    if (result.hits.length > 0) toggle(result.path);
    else openHit(result.path, null);
  }

  function focusables(): HTMLElement[] {
    return treeEl ? Array.from(treeEl.querySelectorAll<HTMLElement>("[data-nav]")) : [];
  }

  function onTreeKeydown(e: KeyboardEvent): void {
    const items = focusables();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const header = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.header : undefined;
    if (e.key === "ArrowDown") items[Math.min(items.length - 1, at + 1)]?.focus();
    else if (e.key === "ArrowUp") {
      if (at <= 0) inputEl?.focus();
      else items[at - 1]?.focus();
    } else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else if (e.key === "ArrowRight" && header !== undefined && collapsed.has(header)) toggle(header);
    else if (e.key === "ArrowLeft" && header !== undefined && !collapsed.has(header)) toggle(header);
    else return;
    e.preventDefault();
  }

  function onInputKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      focusables()[0]?.focus();
      e.preventDefault();
    } else if (e.key === "Enter") {
      const first = results[0]?.hits[0];
      if (results[0]) openHit(results[0].path, first ?? null);
    }
  }

  /** Découpe l'aperçu autour de la correspondance (indices dans la ligne → indices dans l'aperçu). */
  function parts(hit: SearchHit): { before: string; match: string; after: string } {
    const start = Math.max(0, Math.min(hit.preview.length, hit.column - 1 - hit.previewStart));
    const end = Math.max(start, Math.min(hit.preview.length, start + hit.length));
    return { before: hit.preview.slice(0, start), match: hit.preview.slice(start, end), after: hit.preview.slice(end) };
  }

  function nameOf(rel: string): string {
    return rel.slice(rel.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
  }

  function dirOf(rel: string): string {
    const at = rel.lastIndexOf("/");
    return at < 0 ? "" : rel.slice(0, at);
  }

  onDestroy(() => {
    clearTimeout(timer);
    controller?.abort();
  });
</script>

<section class="search" aria-label="Recherche dans le dossier">
  {#if status === "unsupported"}
    <p class="note">Recherche dans un dossier indisponible dans ce navigateur.</p>
  {:else if status === "off"}
    <p class="note">Ouvrez un dossier pour chercher dans ses notes.</p>
  {:else}
    <div class="bar">
      <label class="field">
        <span class="i" aria-hidden="true">{@html icons.search}</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="search"
          maxlength="256"
          aria-label="Rechercher dans le dossier"
          placeholder="Rechercher dans le dossier"
          spellcheck="false"
          autocomplete="off"
          on:keydown={onInputKeydown}
        />
      </label>
      <div class="toggles" role="group" aria-label="Options de recherche">
        <button type="button" class="toggle" aria-pressed={caseSensitive} title="Respecter la casse" aria-label="Respecter la casse" on:click={() => (caseSensitive = !caseSensitive)}>Aa</button>
        <button type="button" class="toggle" aria-pressed={wholeWord} title="Mot entier" aria-label="Mot entier" on:click={() => (wholeWord = !wholeWord)}><span class="word">ab</span></button>
        <button type="button" class="toggle" aria-pressed={regex} title="Expression régulière" aria-label="Expression régulière" on:click={() => (regex = !regex)}>.*</button>
      </div>
    </div>
    {#if status === "loading"}
      <p class="note" role="status">Lecture des notes en cours…</p>
    {:else if status === "too-large" || status === "read-error"}
      <p class="note" role="alert">Certaines notes n'ont pas pu être lues : la recherche peut être incomplète.</p>
    {/if}
    <p class="status" role="status" aria-live="polite">
      {#if message}{message}
      {:else if searching}Recherche…
      {:else if summary}
        {#if summary.hits === 0 && results.length === 0}Aucun résultat pour « {query.trim()} ».
        {:else}{hitCount} {hitCount > 1 ? "résultats" : "résultat"} dans {summary.files} {summary.files > 1 ? "notes" : "note"}{#if summary.truncated} · liste limitée aux premiers résultats{/if}{/if}
      {/if}
    </p>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div class="tree" role="group" aria-label="Résultats" bind:this={treeEl} on:keydown={onTreeKeydown}>
      {#each results as result (result.path)}
        {@const open = !collapsed.has(result.path)}
        <div>
          <button type="button" class="file" data-nav data-header={result.path} aria-expanded={result.hits.length > 0 ? open : undefined} on:click={() => onHeaderActivate(result)}>
            <span class="chev" class:open aria-hidden="true">{@html icons.chevronRight}</span>
            <span class="name" title={result.rel}>{nameOf(result.rel)}</span>
            {#if dirOf(result.rel) !== ""}<span class="dir">{dirOf(result.rel)}</span>{/if}
            {#if result.hits.length > 0}<span class="count">{result.hits.length}{result.truncated ? "+" : ""}</span>{/if}
          </button>
          {#if open}
            <div>
              {#each result.hits as hit, i (`${hit.line}:${hit.column}:${i}`)}
                {@const p = parts(hit)}
                <button type="button" class="hit" data-nav on:click={() => openHit(result.path, hit)}>
                  <span class="line">{hit.line}</span>
                  <span class="preview">{p.before}<mark>{p.match}</mark>{p.after}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .search {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    font-size: var(--leef-text-13);
    color: var(--leef-text);
  }
  .bar {
    display: flex;
    flex-direction: column;
    gap: var(--leef-space-2);
    padding: 0 var(--leef-space-3) var(--leef-space-2);
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--leef-space-1);
    height: var(--leef-control-h-sm);
    padding: 0 var(--leef-space-2);
    border-radius: var(--leef-radius-sm);
    background: var(--leef-bg-hover);
    color: var(--leef-text-secondary);
    box-shadow: inset 0 0 0 var(--leef-hairline) var(--leef-separator);
  }
  .field:focus-within {
    background: var(--leef-bg-content);
    box-shadow: var(--leef-shadow-focus);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font: inherit;
    color: var(--leef-text);
  }
  input::placeholder {
    color: var(--leef-text-tertiary);
  }
  .toggles {
    display: flex;
    gap: 2px;
  }
  .toggle {
    min-width: var(--leef-control-h-sm);
    height: var(--leef-control-h-sm);
    padding: 0 var(--leef-space-2);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: none;
    color: var(--leef-text-secondary);
    font: inherit;
    font-size: var(--leef-text-12);
    cursor: default;
    transition: background-color var(--leef-dur-fast) var(--leef-ease-out);
  }
  .toggle:hover {
    background: var(--leef-bg-hover);
    color: var(--leef-text);
  }
  .toggle[aria-pressed="true"] {
    background: var(--leef-bg-pressed);
    color: var(--leef-text);
    font-weight: var(--leef-weight-semibold);
  }
  .word {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button:focus-visible {
    outline: 2px solid var(--leef-focus-ring);
    outline-offset: 1px;
  }
  .note {
    margin: var(--leef-space-2) var(--leef-space-3);
    font-size: var(--leef-text-12);
    line-height: 1.45;
    color: var(--leef-text-secondary);
  }
  .status {
    margin: 0;
    padding: 0 var(--leef-space-3) var(--leef-space-1);
    min-height: 1.3em;
    font-size: var(--leef-text-11);
    font-weight: var(--leef-weight-semibold);
    color: var(--leef-text-secondary);
    overflow-wrap: anywhere;
  }
  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 var(--leef-space-2) var(--leef-space-3);
  }
  .file,
  .hit {
    display: flex;
    align-items: center;
    gap: var(--leef-space-2);
    width: 100%;
    min-height: var(--leef-row-h);
    padding: 0 var(--leef-space-2);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: default;
  }
  .file:hover,
  .hit:hover {
    background: var(--leef-bg-hover);
  }
  .file:focus-visible,
  .hit:focus-visible {
    background: var(--leef-accent-fill);
    color: var(--leef-text-on-accent);
  }
  .chev {
    display: inline-flex;
    flex: none;
    width: var(--leef-icon-sm);
    height: var(--leef-icon-sm);
    color: var(--leef-text-tertiary);
    transition: transform var(--leef-dur-base) var(--leef-ease-out);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .file:focus-visible .chev,
  .file:focus-visible .dir,
  .file:focus-visible .count,
  .hit:focus-visible .line {
    color: var(--leef-text-on-accent);
  }
  .i {
    display: inline-flex;
    flex: none;
    width: var(--leef-icon-sm);
    height: var(--leef-icon-sm);
  }
  .i :global(svg),
  .chev :global(svg) {
    width: 100%;
    height: 100%;
  }
  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--leef-weight-medium);
  }
  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--leef-text-11);
    color: var(--leef-text-secondary);
  }
  .count {
    margin-left: auto;
    font-size: var(--leef-text-11);
    font-variant-numeric: tabular-nums;
    color: var(--leef-text-secondary);
  }
  .hit {
    padding-left: calc(var(--leef-space-2) + var(--leef-icon-sm) + var(--leef-space-2));
    align-items: flex-start;
    padding-top: var(--leef-space-1);
    padding-bottom: var(--leef-space-1);
    font-size: var(--leef-text-12);
  }
  .line {
    flex: none;
    min-width: 2.5ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--leef-text-secondary);
  }
  .preview {
    min-width: 0;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  mark {
    padding: 0 1px;
    border-radius: 2px;
    background: var(--leef-text-selection);
    color: var(--leef-text);
  }
</style>
