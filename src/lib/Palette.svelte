<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { commands, recentCommands, runCommand } from "./commands";
  import { icons, type IconName } from "./icons";
  import type { TocItem } from "./markdown";
  import { highlightSegments, paletteGroups, parsePaletteInput, type PaletteEntry, type PaletteFile, type PaletteMode } from "./paletteModel";

  export let files: PaletteFile[] = [];
  export let headings: TocItem[] = [];

  const dispatch = createEventDispatcher<{ openFile: string; jump: string; create: string }>();
  const PAGE = 10;
  const QUOTE_MAX = 80;
  const listId = "palette-list";
  const VERB: Record<PaletteEntry["kind"], string> = { note: "ouvrir", heading: "aller au titre", command: "exécuter", create: "créer" };

  let open = false;
  let input = "";
  let active = 0;
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLElement | undefined;
  let origin: HTMLElement | null = null;

  $: parsed = parsePaletteInput(input);
  $: mac = /Mac/.test(navigator.platform);
  $: groups = open ? paletteGroups(input, { commands: $commands, recent: $recentCommands, files, headings, mac }) : [];
  $: entries = groups.flatMap((g) => g.entries);
  $: offsets = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.entries.length, 0));
  $: hasCommands = groups.some((g) => g.title === "Commandes");
  $: if (active >= entries.length) active = Math.max(0, entries.length - 1);
  $: if (open && listEl) scrollActive(active);

  export function show(prefix: ">" | "#" | ""): void {
    origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input = prefix;
    active = 0;
    open = true;
    void tick().then(() => inputEl?.focus());
  }

  function scrollActive(index: number): void {
    listEl?.querySelector(`#palette-opt-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  /** Ferme et rend le focus ; l'action part ensuite, une fois le focus revenu à l'éditeur. */
  async function close(): Promise<void> {
    open = false;
    await tick();
    if (origin && origin.isConnected) origin.focus();
    origin = null;
  }

  async function choose(entry: PaletteEntry | undefined): Promise<void> {
    if (!entry || (entry.kind !== "create" && entry.row.disabled)) return;
    await close();
    if (entry.kind === "create") dispatch("create", entry.name);
    else if (entry.kind === "command") await runCommand(entry.row.id);
    else if (entry.kind === "note") dispatch("openFile", entry.row.id);
    else dispatch("jump", entry.row.id);
  }

  function move(delta: number, wrap: boolean): void {
    if (entries.length === 0) return;
    const next = active + delta;
    active = wrap ? (next + entries.length) % entries.length : Math.min(entries.length - 1, Math.max(0, next));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") move(1, true);
    else if (e.key === "ArrowUp") move(-1, true);
    else if (e.key === "PageDown") move(PAGE, false);
    else if (e.key === "PageUp") move(-PAGE, false);
    else if (e.key === "Enter") void choose(entries[active]);
    else if (e.key === "Escape") void close();
    else if (e.key !== "Tab") return; // Tab : focus piégé sur le champ, seul élément tabulable
    e.preventDefault();
  }

  function quote(text: string): string {
    const chars = [...text.trim()];
    return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join("")}…` : chars.join("");
  }

  function iconFor(entry: PaletteEntry): IconName | null {
    if (entry.kind === "create") return "new";
    if (entry.kind === "note") return "file";
    if (entry.kind === "heading") {
      const level = headings.find((h) => h.id === entry.row.id)?.level ?? 1;
      return level <= 1 ? "h1" : level === 2 ? "h2" : "h3";
    }
    return $commands.find((c) => c.id === entry.row.id)?.icon ?? null;
  }

  function emptyText(mode: PaletteMode, query: string): string {
    const q = quote(query);
    if (mode === "commands") return q === "" ? "Aucune commande disponible." : `Aucune commande pour « ${q} ».`;
    if (mode === "headings") return q === "" ? "Ce document n'a pas de titre." : `Aucun titre pour « ${q} ».`;
    return q === "" ? "Aucune note ni commande. Ouvrez un dossier pour retrouver vos notes ici." : `Aucune note ni commande pour « ${q} ».`;
  }
</script>

{#if open}
  <!-- Voile : mousedown|preventDefault, sinon l'action par défaut reprend le focus rendu par close() (→ body). -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="scrim" on:mousedown|preventDefault={() => void close()}></div>
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="palette" role="dialog" aria-modal="true" aria-label="Rechercher et commandes" on:keydown={onKeydown}>
    <div class="input">
      <span class="i" aria-hidden="true">{@html icons.search}</span>
      <input
        bind:this={inputEl}
        bind:value={input}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={entries.length > 0 ? `palette-opt-${active}` : undefined}
        aria-label="Rechercher des notes et des commandes"
        placeholder="Chercher une note, > commande, # titre"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      />
    </div>
    <div class="list" id={listId} role="listbox" aria-label="Résultats" bind:this={listEl}>
      {#each groups as group, gi (group.title)}
        <div role="group" aria-labelledby="palette-g-{gi}">
          <div class="group" id="palette-g-{gi}" role="presentation">{group.title}</div>
          {#each group.entries as entry, j (`${j}:${entry.kind === "create" ? "+" : entry.row.id}`)}
            {@const i = offsets[gi] + j}
            {@const icon = iconFor(entry)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              class="option"
              id="palette-opt-{i}"
              role="option"
              tabindex="-1"
              aria-selected={i === active}
              aria-disabled={entry.kind !== "create" && entry.row.disabled}
              class:disabled={entry.kind !== "create" && entry.row.disabled}
              on:mousemove={() => (active = i)}
              on:mousedown|preventDefault
              on:click={() => void choose(entry)}
            >
              <span class="i" aria-hidden="true">{#if icon}{@html icons[icon]}{/if}</span>
              <span class="text">
                {#if entry.kind === "create"}
                  <span class="label">Créer la note « {entry.name} »</span>
                  {#if group.entries.length > 1}
                    <span class="hint">Aucune note nommée « {quote(entry.name)} »</span>
                  {:else}
                    <span class="hint">{hasCommands ? "Aucune note" : "Aucune note ni commande"} pour « {quote(entry.name)} »</span>
                  {/if}
                {:else}
                  <span class="label">{#each highlightSegments(entry.row.label, entry.row.positions) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                  {#if entry.kind !== "command" && entry.row.detail !== ""}<span class="hint">{entry.row.detail}</span>{/if}
                {/if}
              </span>
              {#if entry.kind === "command" && entry.row.shortcut}<kbd>{entry.row.shortcut}</kbd>{/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty" role="presentation">{emptyText(parsed.mode, parsed.query)}</p>
      {/each}
    </div>
    <div class="foot" aria-hidden="true">
      <span><kbd>↑↓</kbd> choisir</span>
      <span><kbd>↵</kbd> {entries[active] ? VERB[entries[active].kind] : "ouvrir"}</span>
      <span><kbd>{mac ? "esc" : "Échap"}</kbd> fermer</span>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--leef-z-palette);
    background: var(--leef-scrim);
  }
  .palette {
    position: fixed;
    z-index: var(--leef-z-palette);
    top: 96px;
    left: 50%;
    width: min(640px, calc(100vw - 2 * var(--leef-space-4)));
    transform: translateX(-50%);
    border-radius: var(--leef-radius-xl);
    background: var(--leef-material-elevated);
    -webkit-backdrop-filter: var(--leef-material-filter);
    backdrop-filter: var(--leef-material-filter);
    box-shadow: var(--leef-shadow-window);
    color: var(--leef-text);
    font-size: var(--leef-text-13);
    overflow: hidden;
    animation: leef-palette var(--leef-dur-slow) var(--leef-ease-spring);
  }
  @keyframes leef-palette {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-8px) scale(0.98);
    }
  }
  .input {
    display: flex;
    align-items: center;
    gap: var(--leef-space-3);
    height: 52px;
    padding: 0 var(--leef-space-4);
    border-bottom: var(--leef-hairline) solid var(--leef-separator);
    color: var(--leef-text-secondary);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font: inherit;
    font-size: var(--leef-text-17);
    color: var(--leef-text);
  }
  input::placeholder {
    color: var(--leef-text-tertiary);
  }
  .group {
    padding: var(--leef-space-2) var(--leef-space-2) var(--leef-space-1);
    font-size: var(--leef-text-11);
    font-weight: var(--leef-weight-semibold);
    color: var(--leef-text-secondary);
  }
  .list {
    padding: var(--leef-space-2);
    max-height: min(420px, calc(100vh - 240px));
    overflow: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--leef-space-3);
    min-height: 36px;
    padding: var(--leef-space-1) var(--leef-space-2);
    border-radius: var(--leef-radius-sm);
  }
  .option.disabled {
    opacity: 0.5;
  }
  .option[aria-selected="true"] {
    background: var(--leef-accent-fill);
    color: var(--leef-text-on-accent);
  }
  .i {
    display: inline-flex;
    flex: none;
    width: var(--leef-icon);
    height: var(--leef-icon);
    color: var(--leef-text-secondary);
  }
  .i :global(svg) {
    width: 100%;
    height: 100%;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .label,
  .hint {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: var(--leef-text-11);
    color: var(--leef-text-secondary);
  }
  mark {
    background: none;
    color: inherit;
    font-weight: var(--leef-weight-semibold);
  }
  kbd {
    font: inherit;
    font-size: var(--leef-text-12);
    color: var(--leef-text-secondary);
    white-space: nowrap;
  }
  .option[aria-selected="true"] .i,
  .option[aria-selected="true"] .hint,
  .option[aria-selected="true"] kbd {
    color: var(--leef-text-on-accent);
  }
  .empty {
    margin: 0;
    padding: var(--leef-space-3) var(--leef-space-2);
    color: var(--leef-text-secondary);
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--leef-space-4);
    justify-content: flex-end;
    padding: var(--leef-space-2) var(--leef-space-4);
    border-top: var(--leef-hairline) solid var(--leef-separator);
    font-size: var(--leef-text-11);
    color: var(--leef-text-secondary);
  }
</style>
