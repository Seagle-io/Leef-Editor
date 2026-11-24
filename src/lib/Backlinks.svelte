<script context="module" lang="ts">
  import { normalizeForSearch } from "./fuzzy";
  import type { WikiRef } from "./wiki/parse";

  /** État du chargement des notes du dossier (L12) ; "unsupported" = navigateur sans accès aux dossiers. */
  export type NotesStatus = "off" | "loading" | "ready" | "too-large" | "read-error" | "unsupported";
  /** Contenu de l'inspecteur = `Layout.right` (contrat §6.5). */
  export type InspectorPanel = "outline" | "backlinks";

  export interface ExcerptPart {
    text: string;
    hit: boolean;
  }

  const WIKI = /\[\[([^\]\n]*)\]\]/gu;

  function shown(inner: string): string {
    const bar = inner.indexOf("|");
    return (bar < 0 ? inner : inner.slice(bar + 1)).trim();
  }

  function markFirst(text: string, name: string): ExcerptPart[] {
    const hay = [...normalizeForSearch(text)];
    const needle = [...normalizeForSearch(name.trim())];
    if (needle.length === 0) return [{ text, hit: false }];
    const chars = [...text];
    for (let i = 0; i + needle.length <= hay.length; i++) {
      if (needle.every((c, k) => hay[i + k] === c)) {
        return [
          { text: chars.slice(0, i).join(""), hit: false },
          { text: chars.slice(i, i + needle.length).join(""), hit: true },
          { text: chars.slice(i + needle.length).join(""), hit: false },
        ];
      }
    }
    return [{ text, hit: false }];
  }

  /**
   * Extrait d'un rétrolien : les `[[liens]]` sont affichés sans crochets (alias si présent) et
   * le lien vers la note courante est surligné. Mention sans lien : 1re occurrence du nom, casse et accents ignorés.
   */
  export function excerptParts(context: string, ref: WikiRef, linked: boolean): ExcerptPart[] {
    const parts: ExcerptPart[] = [];
    let last = 0;
    let marked = false;
    for (const m of context.matchAll(WIKI)) {
      const at = m.index ?? 0;
      if (at > last) parts.push({ text: context.slice(last, at), hit: false });
      const hit: boolean = linked && !marked && m[1].trim() === ref.raw.trim();
      marked ||= hit;
      parts.push({ text: shown(m[1]), hit });
      last = at + m[0].length;
    }
    if (last < context.length) parts.push({ text: context.slice(last), hit: false });
    if (linked) return parts.filter((p) => p.text !== "");
    const name = ref.alias ?? ref.target.slice(ref.target.lastIndexOf("/") + 1);
    return parts
      .flatMap((p) => {
        if (marked) return [p];
        const split = markFirst(p.text, name);
        marked = split.length > 1;
        return split;
      })
      .filter((p) => p.text !== "");
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { icons } from "./icons";
  import type { Backlink } from "./wiki/noteIndex";

  export let items: Backlink[] = [];
  export let status: NotesStatus = "ready";
  /** Mentions du nom de la note sans `[[lien]]` (calcul L12). */
  export let unlinked: Backlink[] = [];
  export let panel: InspectorPanel = "backlinks";

  const dispatch = createEventDispatcher<{ open: { path: string; line: number }; panel: InspectorPanel }>();
  const NOTE_EXT = /\.(md|markdown)$/i;
  const PANELS: { value: InspectorPanel; label: string }[] = [
    { value: "outline", label: "Plan" },
    { value: "backlinks", label: "Rétroliens" },
  ];

  let segmentsEl: HTMLElement | undefined;
  let showUnlinked = false;

  $: folder = status !== "off" && status !== "unsupported";
  $: linkedGroups = bySource(items);
  $: unlinkedGroups = bySource(unlinked);

  function bySource(list: Backlink[]): { source: string; rel: string; refs: Backlink[] }[] {
    const map = new Map<string, { source: string; rel: string; refs: Backlink[] }>();
    for (const b of list) {
      const group = map.get(b.source);
      if (group) group.refs.push(b);
      else map.set(b.source, { source: b.source, rel: b.rel, refs: [b] });
    }
    return [...map.values()];
  }

  function title(rel: string): string {
    return rel.slice(rel.lastIndexOf("/") + 1).replace(NOTE_EXT, "");
  }

  function choosePanel(value: InspectorPanel): void {
    if (value !== panel) dispatch("panel", value);
  }

  /** Segmenté = radiogroup : flèches = changer + déplacer le focus (tabindex itinérant). */
  function onSegmentKeydown(e: KeyboardEvent): void {
    const at = PANELS.findIndex((p) => p.value === panel);
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % PANELS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (at - 1 + PANELS.length) % PANELS.length;
    else return;
    e.preventDefault();
    choosePanel(PANELS[next].value);
    segmentsEl?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  }
</script>

<div class="inspector-content">
  <div class="segmented" role="radiogroup" aria-label="Contenu de l'inspecteur" bind:this={segmentsEl}>
    {#each PANELS as p (p.value)}
      <button
        type="button"
        role="radio"
        aria-checked={panel === p.value}
        tabindex={panel === p.value ? 0 : -1}
        on:click={() => choosePanel(p.value)}
        on:keydown={onSegmentKeydown}>{p.label}</button
      >
    {/each}
  </div>

  {#if panel === "outline"}
    <div class="panel" role="region" aria-label="Plan"><slot /></div>
  {:else}
    <section class="panel" aria-label="Rétroliens">
      {#if !folder}
        <p class="note">Ouvrez un dossier pour voir les rétroliens.</p>
      {:else if status === "loading"}
        <p class="note" role="status">Lecture des notes en cours…</p>
      {:else if status === "too-large" || status === "read-error"}
        <p class="note" role="alert">Certaines notes n'ont pas pu être lues : les rétroliens peuvent être incomplets.</p>
      {/if}
      {#if folder}
        {#if linkedGroups.length === 0}
          {#if status === "ready"}<p class="note">Aucune note ne pointe ici.</p>{/if}
        {:else}
          <p class="count">{linkedGroups.length} {linkedGroups.length > 1 ? "notes renvoient" : "note renvoie"} ici</p>
          {#each linkedGroups as group (group.source)}
            {#each group.refs as item, i (`${item.ref.from}:${i}`)}
              <button class="backlink" type="button" on:click={() => dispatch("open", { path: item.source, line: item.ref.line })}>
                {#if i === 0}<span class="title"><span class="i" aria-hidden="true">{@html icons.file}</span><span class="name">{title(group.rel)}</span></span>{/if}
                <span class="excerpt">{#each excerptParts(item.context, item.ref, true) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
              </button>
            {/each}
          {/each}
        {/if}
        <div class="more">
          <button
            type="button"
            class="more-toggle"
            aria-expanded={unlinkedGroups.length > 0 ? showUnlinked : undefined}
            aria-controls={unlinkedGroups.length > 0 ? "backlinks-unlinked" : undefined}
            disabled={unlinkedGroups.length === 0}
            on:click={() => (showUnlinked = !showUnlinked)}
          >
            <span class="more-label">Mentions sans lien</span>
            <span class="more-count">{unlinkedGroups.length}</span>
            <span class="chev" class:open={showUnlinked} aria-hidden="true">{@html icons.chevronRight}</span>
          </button>
          {#if showUnlinked && unlinkedGroups.length > 0}
            <div id="backlinks-unlinked">
              {#each unlinkedGroups as group (group.source)}
                {#each group.refs as item, i (`${item.ref.from}:${i}`)}
                  <button class="backlink" type="button" on:click={() => dispatch("open", { path: item.source, line: item.ref.line })}>
                    {#if i === 0}<span class="title"><span class="i" aria-hidden="true">{@html icons.file}</span><span class="name">{title(group.rel)}</span></span>{/if}
                    <span class="excerpt">{#each excerptParts(item.context, item.ref, false) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
                  </button>
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .inspector-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: var(--leef-text-13);
    color: var(--leef-text);
  }
  .segmented {
    display: flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--leef-radius-md);
    background: var(--leef-bg-control);
  }
  .segmented button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: var(--leef-control-h-sm);
    padding: 0 var(--leef-space-2);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: none;
    color: var(--leef-text-secondary);
    font: inherit;
    font-size: var(--leef-text-12);
    cursor: default;
    transition: background-color var(--leef-dur-base) var(--leef-ease-out);
  }
  .segmented button[aria-checked="true"] {
    background: var(--leef-bg-control-thumb);
    color: var(--leef-text);
    font-weight: var(--leef-weight-medium);
    box-shadow: var(--leef-shadow-thumb);
  }
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .note {
    margin: var(--leef-space-4) var(--leef-space-1) 0;
    font-size: var(--leef-text-12);
    line-height: 1.45;
    color: var(--leef-text-secondary);
  }
  .count {
    margin: var(--leef-space-4) var(--leef-space-1) var(--leef-space-2);
    font-size: var(--leef-text-11);
    font-weight: var(--leef-weight-semibold);
    color: var(--leef-text-secondary);
  }
  .backlink {
    display: block;
    width: 100%;
    padding: var(--leef-space-2);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: default;
  }
  .backlink:hover {
    background: var(--leef-bg-hover);
  }
  .backlink:active {
    background: var(--leef-bg-pressed);
  }
  button:focus-visible {
    outline: 2px solid var(--leef-focus-ring);
    outline-offset: 1px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--leef-space-2);
    min-width: 0;
    margin-bottom: var(--leef-space-1);
    font-weight: var(--leef-weight-semibold);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .i,
  .chev {
    display: inline-flex;
    flex: none;
    width: var(--leef-icon-sm);
    height: var(--leef-icon-sm);
    color: var(--leef-text-secondary);
  }
  .i :global(svg),
  .chev :global(svg) {
    width: 100%;
    height: 100%;
  }
  .excerpt {
    display: block;
    font-size: var(--leef-text-12);
    line-height: 1.45;
    color: var(--leef-text-secondary);
    overflow-wrap: anywhere;
  }
  mark {
    padding: 0 2px;
    border-radius: var(--leef-radius-sm);
    background: var(--leef-text-selection);
    color: var(--leef-text);
  }
  .more {
    margin-top: var(--leef-space-3);
    padding-top: var(--leef-space-2);
    border-top: var(--leef-hairline) solid var(--leef-separator);
  }
  .more-toggle {
    display: flex;
    align-items: center;
    gap: var(--leef-space-1);
    width: 100%;
    min-height: var(--leef-control-h-sm);
    padding: 0 var(--leef-space-2);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: none;
    color: var(--leef-text-secondary);
    font: inherit;
    font-size: var(--leef-text-12);
    text-align: left;
    cursor: default;
  }
  .more-toggle:hover:not(:disabled) {
    background: var(--leef-bg-hover);
  }
  .more-label {
    flex: 1;
  }
  .more-count {
    font-size: var(--leef-text-11);
    font-variant-numeric: tabular-nums;
  }
  .chev {
    color: var(--leef-text-tertiary);
    transition: transform var(--leef-dur-base) var(--leef-ease-out);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .more-toggle:disabled .chev {
    visibility: hidden;
  }
</style>
