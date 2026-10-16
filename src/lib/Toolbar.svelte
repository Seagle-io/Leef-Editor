<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Icon from "./icons/Icon.svelte";
  import { theme, themes, setTheme, type ThemeId } from "./theme";
  import { font, fonts, setFont, type FontId } from "./font";
  import {
    pageMode,
    pageFormat,
    pageFormats,
    pageHeader,
    pageFooter,
    setPageFormat,
    togglePageMode,
    type PageFormatId,
  } from "./page";
  import { panes, togglePane, type PaneId } from "./panes";
  import { previewEditable, togglePreviewEditable } from "./previewEdit";
  import { workspaceSupported } from "./workspace";
  import type { TocItem } from "./markdown";

  export let fileName: string | null = null;
  export let dirty = false;
  export let toc: TocItem[] = [];
  export let wordCount = 0;
  export let readingMinutes = 0;
  export let activeHeadingLevel: number | null = null;

  const paneToggles: { id: PaneId; icon: "sidebar" | "split" | "page" | "toc"; label: string }[] = [
    { id: "explorer", icon: "sidebar", label: "Explorateur" },
    { id: "editor", icon: "split", label: "Éditeur" },
    { id: "preview", icon: "page", label: "Aperçu" },
    { id: "outline", icon: "toc", label: "Plan" },
  ];
  const canOpenFolder = workspaceSupported();

  const dispatch = createEventDispatcher<{
    new: void;
    open: void;
    save: void;
    saveAs: void;
    export: void;
    exportDocx: void;
    exportXlsx: void;
    format: string;
    jump: string;
    insertToc: void;
    search: void;
    focus: void;
    openFolder: void;
    print: void;
    insertTable: { rows: number; cols: number };
  }>();

  // Word-style size picker: hovering the grid previews the table dimensions.
  const TABLE_GRID = 6;
  let tableHover = { rows: 0, cols: 0 };

  function chooseTable(rows: number, cols: number): void {
    dispatch("insertTable", { rows, cols });
    openMenu = null;
    tableHover = { rows: 0, cols: 0 };
  }

  function chooseTheme(id: ThemeId): void {
    setTheme(id);
    openMenu = null;
  }

  function chooseFont(id: FontId): void {
    setFont(id);
    openMenu = null;
  }

  function choosePageFormat(id: PageFormatId): void {
    setPageFormat(id);
    openMenu = null;
  }

  let openMenu: "file" | "toc" | "theme" | "font" | "page" | "table" | null = null;
  let fileWrapper: HTMLDivElement;
  let tocWrapper: HTMLDivElement;
  let themeWrapper: HTMLDivElement;
  let fontWrapper: HTMLDivElement;
  let pageWrapper: HTMLDivElement;
  let tableWrapper: HTMLDivElement;

  function toggleMenu(menu: "file" | "toc" | "theme" | "font" | "page" | "table"): void {
    openMenu = openMenu === menu ? null : menu;
  }

  function fileAction(
    action: "new" | "open" | "save" | "saveAs" | "export" | "exportDocx" | "exportXlsx" | "print" | "openFolder",
  ): void {
    dispatch(action);
    openMenu = null;
  }

  function jumpTo(id: string): void {
    dispatch("jump", id);
    openMenu = null;
  }

  function insertToc(): void {
    dispatch("insertToc");
    openMenu = null;
  }

  function handleWindowClick(event: MouseEvent): void {
    const target = event.target as Node;
    if (openMenu === "file" && fileWrapper && !fileWrapper.contains(target)) openMenu = null;
    if (openMenu === "toc" && tocWrapper && !tocWrapper.contains(target)) openMenu = null;
    if (openMenu === "theme" && themeWrapper && !themeWrapper.contains(target)) openMenu = null;
    if (openMenu === "font" && fontWrapper && !fontWrapper.contains(target)) openMenu = null;
    if (openMenu === "page" && pageWrapper && !pageWrapper.contains(target)) openMenu = null;
    if (openMenu === "table" && tableWrapper && !tableWrapper.contains(target)) openMenu = null;
  }
</script>

<svelte:window on:click|capture={handleWindowClick} />

<div class="toolbar">
  <div class="menu-wrapper" bind:this={fileWrapper}>
    <button
      class="burger"
      on:click={() => toggleMenu("file")}
      aria-haspopup="true"
      aria-expanded={openMenu === "file"}
      aria-label="Menu fichier"
    >
      <Icon name="menu" />
    </button>
    {#if openMenu === "file"}
      <div class="menu-panel">
        <button class="menu-item" on:click={() => fileAction("new")}><Icon name="new" size="1rem" /> Nouveau</button>
        <button class="menu-item" on:click={() => fileAction("open")}><Icon name="open" size="1rem" /> Ouvrir</button>
        <button class="menu-item" on:click={() => fileAction("openFolder")} disabled={!canOpenFolder}>
          <Icon name="folderOpen" size="1rem" /> Ouvrir un dossier…
        </button>
        <button class="menu-item" on:click={() => fileAction("save")}><Icon name="save" size="1rem" /> Enregistrer</button>
        <button class="menu-item" on:click={() => fileAction("saveAs")} title="Markdown, Word (.docx) ou Excel (.xlsx) — Ctrl/Cmd+Shift+S">
          <Icon name="save" size="1rem" /> Enregistrer sous…
        </button>
        <button class="menu-item" on:click={() => fileAction("exportDocx")}><Icon name="export" size="1rem" /> Exporter Word (.docx)</button>
        <button class="menu-item" on:click={() => fileAction("exportXlsx")}><Icon name="export" size="1rem" /> Exporter Excel (.xlsx)</button>
        <button class="menu-item" on:click={() => fileAction("export")}><Icon name="export" size="1rem" /> Exporter HTML</button>
        <button class="menu-item" on:click={() => fileAction("print")}><Icon name="print" size="1rem" /> Imprimer / PDF…</button>
      </div>
    {/if}
  </div>
  <span class="separator"></span>
  <button
    class="format-btn"
    class:active={activeHeadingLevel === 1}
    on:click={() => dispatch("format", "h1")}
    title="Titre 1"
    aria-label="Titre 1"
  >
    <Icon name="h1" />
  </button>
  <button
    class="format-btn"
    class:active={activeHeadingLevel === 2}
    on:click={() => dispatch("format", "h2")}
    title="Titre 2"
    aria-label="Titre 2"
  >
    <Icon name="h2" />
  </button>
  <button
    class="format-btn"
    class:active={activeHeadingLevel === 3}
    on:click={() => dispatch("format", "h3")}
    title="Titre 3"
    aria-label="Titre 3"
  >
    <Icon name="h3" />
  </button>
  <span class="separator"></span>
  <button class="format-btn" on:click={() => dispatch("format", "bold")} title="Gras (Ctrl/Cmd+B)" aria-label="Gras">
    <Icon name="bold" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "italic")} title="Italique (Ctrl/Cmd+I)" aria-label="Italique">
    <Icon name="italic" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "strikethrough")} title="Barré" aria-label="Barré">
    <Icon name="strikethrough" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "code")} title="Code en ligne" aria-label="Code en ligne">
    <Icon name="code" />
  </button>
  <span class="separator"></span>
  <button class="format-btn" on:click={() => dispatch("format", "quote")} title="Citation" aria-label="Citation">
    <Icon name="quote" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "bulletList")} title="Liste à puces" aria-label="Liste à puces">
    <Icon name="bulletList" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "orderedList")} title="Liste numérotée" aria-label="Liste numérotée">
    <Icon name="orderedList" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "codeBlock")} title="Bloc de code" aria-label="Bloc de code">
    <Icon name="codeBlock" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "hr")} title="Ligne horizontale" aria-label="Ligne horizontale">
    <Icon name="hr" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "pageBreak")} title="Saut de page" aria-label="Saut de page">
    <Icon name="page" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "link")} title="Lien (Ctrl/Cmd+K)" aria-label="Lien">
    <Icon name="link" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "footnote")} title="Note de bas de page" aria-label="Note de bas de page">
    <Icon name="footnote" />
  </button>
  <button class="format-btn" on:click={() => dispatch("format", "admonition")} title="Admonition (note, warning...)" aria-label="Admonition">
    <Icon name="noteAdmonition" />
  </button>
  <div class="menu-wrapper" bind:this={tableWrapper}>
    <button
      class="format-btn"
      on:click={() => toggleMenu("table")}
      aria-haspopup="true"
      aria-expanded={openMenu === "table"}
      title="Insérer un tableau"
      aria-label="Insérer un tableau"
    >
      <Icon name="table" />
    </button>
    {#if openMenu === "table"}
      <div class="menu-panel table-panel">
        <p class="table-size">
          {tableHover.rows > 0 ? `${tableHover.rows} × ${tableHover.cols}` : "Taille du tableau"}
        </p>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="table-grid" aria-label="Taille du tableau" on:mouseleave={() => (tableHover = { rows: 0, cols: 0 })}>
          {#each Array(TABLE_GRID) as _, row}
            {#each Array(TABLE_GRID) as _, col}
              <button
                class="table-cell"
                class:on={row < tableHover.rows && col < tableHover.cols}
                on:mouseenter={() => (tableHover = { rows: row + 1, cols: col + 1 })}
                on:focus={() => (tableHover = { rows: row + 1, cols: col + 1 })}
                on:click={() => chooseTable(row + 1, col + 1)}
                aria-label={`Tableau ${row + 1} × ${col + 1}`}
              ></button>
            {/each}
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <button class="format-btn" on:click={() => dispatch("search")} title="Rechercher / remplacer (Ctrl/Cmd+F)" aria-label="Rechercher">
    <Icon name="search" />
  </button>
  <span class="separator"></span>
  <div class="menu-wrapper" bind:this={tocWrapper}>
    <button on:click={() => toggleMenu("toc")} disabled={toc.length === 0} aria-haspopup="true" aria-expanded={openMenu === "toc"}>
      <Icon name="toc" size="1rem" /> Sommaire {toc.length > 0 ? `(${toc.length})` : ""}
    </button>
    {#if openMenu === "toc"}
      <div class="menu-panel toc-panel">
        {#if toc.length === 0}
          <p class="toc-empty">Aucun titre</p>
        {:else}
          <button class="menu-item toc-insert" on:click={insertToc}><Icon name="check" size="1rem" /> Insérer dans le document</button>
          {#each toc as item (item.id)}
            <button
              class="menu-item toc-item"
              style="padding-left: {0.5 + (item.level - 1) * 0.75}rem"
              on:click={() => jumpTo(item.id)}
            >
              {item.text}
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
  {#each paneToggles as pane (pane.id)}
    <button
      class="format-btn"
      class:active={$panes[pane.id]}
      on:click={() => togglePane(pane.id)}
      title={`Afficher/masquer : ${pane.label}`}
      aria-label={`Afficher/masquer ${pane.label}`}
      aria-pressed={$panes[pane.id]}
    >
      <Icon name={pane.icon} />
    </button>
  {/each}
  <div class="menu-wrapper" bind:this={themeWrapper}>
    <button on:click={() => toggleMenu("theme")} aria-haspopup="true" aria-expanded={openMenu === "theme"} aria-label="Thème">
      <Icon name="theme" size="1rem" />
      {themes.find((t) => t.id === $theme)?.label}
    </button>
    {#if openMenu === "theme"}
      <div class="menu-panel">
        {#each themes as t (t.id)}
          <button class="menu-item choice-item" class:selected={t.id === $theme} on:click={() => chooseTheme(t.id)}>
            <Icon name="check" size="1rem" />
            {t.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="menu-wrapper" bind:this={fontWrapper}>
    <button on:click={() => toggleMenu("font")} aria-haspopup="true" aria-expanded={openMenu === "font"} aria-label="Police">
      <Icon name="font" size="1rem" />
      {fonts.find((f) => f.id === $font)?.label ?? ""}
    </button>
    {#if openMenu === "font"}
      <div class="menu-panel">
        {#each fonts as f (f.id)}
          <button class="menu-item choice-item" class:selected={f.id === $font} on:click={() => chooseFont(f.id)}>
            <Icon name="check" size="1rem" />
            {f.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="menu-wrapper" bind:this={pageWrapper}>
    <button
      class:active={$pageMode}
      on:click={() => toggleMenu("page")}
      aria-haspopup="true"
      aria-expanded={openMenu === "page"}
      title="Mode page (aperçu paginé)"
      aria-label="Mode page"
    >
      <Icon name="page" size="1rem" />
      {$pageMode ? pageFormats.find((f) => f.id === $pageFormat)?.label : "Page"}
    </button>
    {#if openMenu === "page"}
      <div class="menu-panel">
        <button class="menu-item choice-item" class:selected={$pageMode} on:click={() => { togglePageMode(); openMenu = null; }}>
          <Icon name="check" size="1rem" />
          Mode page
        </button>
        <span class="menu-sep"></span>
        {#each pageFormats as f (f.id)}
          <button class="menu-item choice-item" class:selected={f.id === $pageFormat} on:click={() => choosePageFormat(f.id)}>
            <Icon name="check" size="1rem" />
            {f.label}
          </button>
        {/each}
        <span class="menu-sep"></span>
        <label class="band-field">
          En-tête
          <input type="text" bind:value={$pageHeader} placeholder="vide" />
        </label>
        <label class="band-field">
          Pied de page
          <input type="text" bind:value={$pageFooter} placeholder="vide" />
        </label>
        <p class="band-help">
          <code>{"{page}"}</code> <code>{"{pages}"}</code> <code>{"{title}"}</code> <code>{"{date}"}</code><br />
          Séparer par <code>|</code> pour gauche / centre / droite.
        </p>
      </div>
    {/if}
  </div>
  <button on:click={() => dispatch("print")} title="Imprimer / exporter en PDF" aria-label="Imprimer">
    <Icon name="print" />
  </button>
  <button
    class:active={$previewEditable}
    on:click={togglePreviewEditable}
    disabled={$pageMode || !$panes.preview}
    title={$pageMode
      ? "Édition de l'aperçu indisponible en mode page"
      : $previewEditable
        ? "Verrouiller l'aperçu (lecture seule)"
        : "Déverrouiller l'aperçu (édition directe)"}
    aria-label="Verrouiller / déverrouiller l'édition de l'aperçu"
  >
    <Icon name={$previewEditable ? "unlock" : "lock"} />
  </button>
  <button on:click={() => dispatch("focus")} title="Mode focus (Ctrl/Cmd+Shift+F)" aria-label="Mode focus">
    <Icon name="focusEnter" />
  </button>
  <span class="stats">{wordCount} mots · {readingMinutes} min de lecture</span>
  <span class="filename">{fileName ?? "Sans titre"}{dirty ? " •" : ""}</span>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--toolbar-bg);
    flex-wrap: wrap;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--button-bg);
    color: var(--toolbar-fg);
    font-weight: 500;
    cursor: pointer;
  }
  button:hover {
    background: var(--button-hover-bg);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .burger {
    font-size: 1rem;
    padding: 0.25rem 0.6rem;
  }
  .format-btn {
    padding: 0.3rem 0.5rem;
    min-width: 1.8rem;
  }
  .format-btn.active,
  button.active {
    background: var(--toolbar-fg);
    color: var(--toolbar-bg);
  }
  .menu-wrapper {
    position: relative;
  }
  .menu-panel {
    position: absolute;
    top: calc(100% + 0.3rem);
    left: 0;
    min-width: 10rem;
    max-width: 20rem;
    max-height: 20rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10;
    padding: 0.25rem;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-align: left;
    background: none;
    border: none;
    border-radius: 4px;
    font-weight: 400;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu-item:hover {
    background: var(--button-hover-bg);
  }
  .choice-item :global(.icon) {
    visibility: hidden;
  }
  .choice-item.selected :global(.icon) {
    visibility: visible;
  }
  .toc-insert {
    font-weight: 500;
    color: var(--toolbar-fg);
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    margin-bottom: 0.2rem;
    padding-bottom: 0.4rem;
  }
  .toc-empty {
    margin: 0;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
    color: var(--muted-fg);
  }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0;
  }
  .band-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.75rem;
    color: var(--muted-fg);
  }
  .band-field input {
    width: 14rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 0.8rem;
  }
  .band-help {
    margin: 0.1rem 0 0.2rem;
    padding: 0 0.5rem;
    max-width: 15rem;
    font-size: 0.7rem;
    line-height: 1.5;
    color: var(--muted-fg);
    white-space: normal;
  }
  .band-help code {
    background: var(--code-bg);
    border-radius: 3px;
    padding: 0 0.2rem;
  }
  .table-panel {
    padding: 0.4rem;
  }
  .table-size {
    margin: 0 0 0.35rem;
    font-size: 0.75rem;
    color: var(--muted-fg);
    text-align: center;
  }
  .table-grid {
    display: grid;
    grid-template-columns: repeat(6, 1.1rem);
    gap: 2px;
  }
  .table-cell {
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg);
  }
  .table-cell.on {
    background: var(--toolbar-fg);
    border-color: var(--toolbar-fg);
  }
  .separator {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 0 0.15rem;
  }
  .stats {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--muted-fg);
    white-space: nowrap;
  }
  .filename {
    font-size: 0.8rem;
    color: var(--muted-fg);
  }
</style>
