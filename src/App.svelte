<script lang="ts">
  import Editor from "./lib/Editor.svelte";
  import Preview from "./lib/Preview.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import Outline from "./lib/Outline.svelte";
  import Tabs from "./lib/Tabs.svelte";
  import Explorer from "./lib/Explorer.svelte";
  import { openFile, saveFile, exportHtml, exportOffice, type ExportContext } from "./lib/fileio";
  import { renderDocument, generateTocMarkdown } from "./lib/markdown";
  import { loadSession, saveSession, storageErrors } from "./lib/draft";
  import { themeState } from "./lib/themes/store";
  import { recentStorageError } from "./lib/commands";
  import { theme } from "./lib/theme";
  import { panes, showPane } from "./lib/panes";
  import { previewEditable } from "./lib/previewEdit";
  import { pageMode, pageFormat, pageHeader, pageFooter, getPageFormat, PAGE_MARGIN_MM } from "./lib/page";
  import {
    activeDoc,
    activeId,
    addDoc,
    closeDoc,
    createDoc,
    docName,
    docTitle,
    documents,
    focusByPath,
    moveDoc,
    setDocuments,
    updateDoc,
  } from "./lib/documents";
  import { closeWorkspace, openWorkspace, readWorkspaceFile, refreshWorkspace, workspace } from "./lib/workspace";
  import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleCodeBlock,
    toggleBlockquote,
    toggleBulletList,
    toggleOrderedList,
    insertHorizontalRule,
    insertLink,
    insertFootnote,
    insertAdmonition,
    insertPageBreak,
    insertTable,
    setHeading1,
    setHeading2,
    setHeading3,
  } from "./lib/markdownCommands";
  import type { Command } from "@codemirror/view";

  const formatCommands: Record<string, Command> = {
    bold: toggleBold,
    italic: toggleItalic,
    strikethrough: toggleStrikethrough,
    code: toggleInlineCode,
    codeBlock: toggleCodeBlock,
    quote: toggleBlockquote,
    bulletList: toggleBulletList,
    orderedList: toggleOrderedList,
    hr: insertHorizontalRule,
    link: insertLink,
    footnote: insertFootnote,
    admonition: insertAdmonition,
    pageBreak: insertPageBreak,
    h1: setHeading1,
    h2: setHeading2,
    h3: setHeading3,
  };

  const initial = `# Bienvenue dans GMD

Un éditeur **Markdown** léger, avec preview en direct.

- Écris à gauche
- Vois le rendu à droite

\`\`\`js
console.log("hello gmd");
\`\`\`
`;

  const restored = loadSession();
  const startupDocs = restored?.docs ?? [createDoc(initial)];
  setDocuments(startupDocs, startupDocs[restored?.activeIndex ?? 0]?.id);

  let error: string | null = null;
  let editorRef: Editor;
  let previewRef: Preview;
  let sessionSaveHandle: ReturnType<typeof setTimeout> | undefined;
  let activeHeadingLevel: number | null = null;
  let focusMode = false;
  /** Per alert source: last message and its occurrence (a message appearing or changing counts one more). */
  const storageOccurrences = new Map<string, { message: string | null; n: number }>();
  /** Occurrence closed by the user, per source: hidden until that source fails again. */
  let dismissedStorage: Record<string, number> = {};

  function toggleFocusMode() {
    focusMode = !focusMode;
  }

  $: content = $activeDoc?.content ?? "";
  $: ({ html, toc } = renderDocument(content));
  $: documentTitle = $activeDoc ? docTitle($activeDoc) : "Sans titre";
  $: wordCount = content.trim() === "" ? 0 : content.trim().split(/\s+/).length;
  $: readingMinutes = Math.max(1, Math.round(wordCount / 200));
  $: storageLines = countOccurrences([["themes", $themeState.error], ...Object.entries($storageErrors), ["recentes", $recentStorageError]]);
  $: visibleStorage = storageLines.filter((line) => dismissedStorage[line.source] !== line.n);

  function countOccurrences(sources: [string, string | null][]): { source: string; message: string; n: number }[] {
    const lines = [];
    for (const [source, message] of sources) {
      const last = storageOccurrences.get(source);
      const n = (last?.n ?? 0) + (message !== null && message !== last?.message ? 1 : 0);
      storageOccurrences.set(source, { message, n });
      if (message !== null) lines.push({ source, message, n });
    }
    return lines;
  }

  function dismissStorage() {
    dismissedStorage = { ...dismissedStorage, ...Object.fromEntries(visibleStorage.map((line) => [line.source, line.n])) };
  }

  function persistSession() {
    clearTimeout(sessionSaveHandle);
    sessionSaveHandle = setTimeout(() => {
      const docs = $documents;
      const index = docs.findIndex((doc) => doc.id === $activeId);
      saveSession(docs, Math.max(0, index));
    }, 500);
  }

  function applyContent(next: string) {
    if (!$activeDoc) return;
    updateDoc($activeDoc.id, { content: next, dirty: true });
    persistSession();
  }

  function handleChange(event: CustomEvent<string>) {
    applyContent(event.detail);
  }

  /** Edit made directly in the rendered preview, converted back to markdown. */
  function handlePreviewEdit(event: CustomEvent<string>) {
    applyContent(event.detail);
  }

  function handleCursorLine(event: CustomEvent<string>) {
    const match = event.detail.match(/^(#{1,3})\s/);
    activeHeadingLevel = match ? match[1].length : null;
  }

  function handleKeydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      handleSave(event.shiftKey);
    } else if (key === "o") {
      event.preventDefault();
      handleOpen();
    } else if (key === "p") {
      event.preventDefault();
      handlePrint();
    } else if (key === "t") {
      event.preventDefault();
      handleNew();
    } else if (key === "w") {
      event.preventDefault();
      if ($activeDoc) closeById($activeDoc.id);
    } else if (key === "f" && event.shiftKey) {
      event.preventDefault();
      toggleFocusMode();
    }
  }

  function handleJump(event: CustomEvent<string>) {
    document.getElementById(event.detail)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleEditorScroll(event: CustomEvent<number>) {
    previewRef?.setScrollRatio(event.detail);
  }

  function handleInsertToc() {
    editorRef?.insertAtCursor(generateTocMarkdown(toc));
  }

  function handleFormat(event: CustomEvent<string>) {
    const command = formatCommands[event.detail];
    if (command) editorRef?.applyCommand(command);
  }

  function handleInsertTable(event: CustomEvent<{ rows: number; cols: number }>) {
    editorRef?.applyCommand(insertTable(event.detail.rows, event.detail.cols));
  }

  // --- Tabs ------------------------------------------------------------------

  function handleNew() {
    error = null;
    addDoc(createDoc(""));
    persistSession();
  }

  function handleSelect(event: CustomEvent<string>) {
    activeId.set(event.detail);
    persistSession();
  }

  function closeById(id: string) {
    const doc = $documents.find((d) => d.id === id);
    if (!doc) return;
    if (doc.dirty && !confirm(`« ${docName(doc)} » a des modifications non enregistrées. Fermer quand même ?`)) return;

    closeDoc(id);
    // Never leave the window without a document.
    if ($documents.length === 0) addDoc(createDoc(""));
    persistSession();
  }

  function handleClose(event: CustomEvent<string>) {
    closeById(event.detail);
  }

  function handleReorder(event: CustomEvent<{ from: number; to: number }>) {
    moveDoc(event.detail.from, event.detail.to);
    persistSession();
  }

  // --- Files -----------------------------------------------------------------

  async function handleOpen() {
    error = null;
    try {
      const result = await openFile();
      if (!result) return;
      if (result.path && focusByPath(result.path)) return;
      addDoc(createDoc(result.content, result.path));
      persistSession();
    } catch (err) {
      error = `Impossible d'ouvrir le fichier : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Title and page layout (format, margins, header / footer) for Word / Excel output. */
  function exportContext(): ExportContext {
    const format = getPageFormat($pageFormat);
    return {
      title: documentTitle,
      page: { widthMm: format.width, heightMm: format.height, marginMm: PAGE_MARGIN_MM, header: $pageHeader, footer: $pageFooter },
    };
  }

  async function handleSave(saveAs = false) {
    error = null;
    const doc = $activeDoc;
    if (!doc) return;
    try {
      const saved = await saveFile(doc.content, doc.path, exportContext(), saveAs);
      if (saved) {
        updateDoc(doc.id, { path: saved, dirty: false });
        persistSession();
      }
    } catch (err) {
      error = `Impossible d'enregistrer le fichier : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function handlePrint() {
    // Both the browser and the Tauri WebView open their native print dialog,
    // from which the user can print or save as PDF.
    window.print();
  }

  async function handleExport() {
    error = null;
    try {
      await exportHtml(html, `${documentTitle}.html`);
    } catch (err) {
      error = `Impossible d'exporter en HTML : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function handleExportOffice(format: "docx" | "xlsx") {
    error = null;
    const doc = $activeDoc;
    if (!doc) return;
    try {
      await exportOffice(format, doc.content, doc.path, exportContext());
    } catch (err) {
      const label = format === "docx" ? "Word" : "Excel";
      error = `Impossible d'exporter en ${label} : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Workspace -------------------------------------------------------------

  async function handleOpenFolder() {
    error = null;
    try {
      if (await openWorkspace()) showPane("explorer");
    } catch (err) {
      error = `Impossible d'ouvrir le dossier : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Opens a workspace file in a tab, or focuses the tab already showing it. */
  async function handleOpenPath(event: CustomEvent<string>) {
    error = null;
    const path = event.detail;
    if (focusByPath(path)) return;
    try {
      addDoc(createDoc(await readWorkspaceFile(path), path));
      persistSession();
    } catch (err) {
      error = `Impossible de lire ${path} : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function handleRefreshWorkspace() {
    if (!$workspace) return;
    try {
      await refreshWorkspace($workspace);
    } catch (err) {
      error = `Impossible d'actualiser le dossier : ${err instanceof Error ? err.message : String(err)}`;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<main>
  {#if !focusMode}
    <Tabs
      docs={$documents}
      activeId={$activeId}
      on:select={handleSelect}
      on:close={handleClose}
      on:new={handleNew}
      on:reorder={handleReorder}
    />
    <Toolbar
      fileName={$activeDoc?.path ?? null}
      dirty={$activeDoc?.dirty ?? false}
      {toc}
      {wordCount}
      {readingMinutes}
      {activeHeadingLevel}
      on:new={handleNew}
      on:open={handleOpen}
      on:openFolder={handleOpenFolder}
      on:save={() => handleSave()}
      on:saveAs={() => handleSave(true)}
      on:export={handleExport}
      on:exportDocx={() => handleExportOffice("docx")}
      on:exportXlsx={() => handleExportOffice("xlsx")}
      on:print={handlePrint}
      on:format={handleFormat}
      on:jump={handleJump}
      on:insertToc={handleInsertToc}
      on:insertTable={handleInsertTable}
      on:search={() => editorRef?.openSearch()}
      on:focus={toggleFocusMode}
    />
  {:else}
    <button
      class="focus-exit"
      on:click={toggleFocusMode}
      title="Quitter le mode focus (Ctrl/Cmd+Shift+F)"
      aria-label="Quitter le mode focus"
    >
      ✕
    </button>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if visibleStorage.length > 0}
    <div class="error storage-alert" role="alert">
      <div>
        {#each visibleStorage as line (line.source)}
          <p>{line.message}</p>
        {/each}
      </div>
      <button class="storage-alert-close" on:click={dismissStorage} aria-label="Fermer l'alerte">✕</button>
    </div>
  {/if}
  <div class="panes">
    {#if $panes.explorer && !focusMode}
      <Explorer
        currentPath={$activeDoc?.path ?? null}
        on:openFolder={handleOpenFolder}
        on:openPath={handleOpenPath}
        on:refresh={handleRefreshWorkspace}
        on:close={closeWorkspace}
      />
    {/if}
    {#if $panes.editor}
      <section class="pane">
        <!-- Keyed on the document: each tab gets its own editor state, so undo
             history and scroll position don't leak from one tab to another. -->
        {#key $activeId}
          <Editor
            bind:this={editorRef}
            value={content}
            themeId={$theme}
            on:change={handleChange}
            on:cursorLine={handleCursorLine}
            on:scroll={handleEditorScroll}
          />
        {/key}
      </section>
    {/if}
    {#if $panes.preview}
      <section class="pane preview-pane">
        <Preview
          bind:this={previewRef}
          {html}
          source={content}
          dark={$theme === "dark" || $theme === "dracula"}
          paged={$pageMode}
          formatId={$pageFormat}
          header={$pageHeader}
          footer={$pageFooter}
          title={documentTitle}
          editable={$previewEditable}
          on:edit={handlePreviewEdit}
        />
      </section>
    {/if}
    {#if $panes.outline && toc.length > 0 && !focusMode}
      <Outline {toc} on:jump={handleJump} />
    {/if}
  </div>
</main>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    font-family: var(--leef-font-ui);
    background: var(--leef-bg-content);
    color: var(--leef-text);
  }
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .pane {
    flex: 1;
    min-width: 0;
    border-right: 1px solid var(--leef-separator);
  }
  .pane:last-child {
    border-right: none;
  }
  /* Narrow window: the outline's fixed width left the editor a few pixels and covered its lines; the toolbar's table of contents stays. */
  @media (max-width: 640px) {
    .panes :global(nav.outline) {
      display: none;
    }
  }
  /* Printing targets the preview only: the editor, the toolbar, the tab bar,
     the explorer and the outline are chrome, not document. */
  @media print {
    :global(html, body) {
      height: auto;
      background: none;
    }
    main {
      display: block;
      height: auto;
    }
    .panes {
      display: block;
    }
    .pane {
      border: none;
    }
    .pane:not(.preview-pane),
    :global(.toolbar),
    :global(.outline),
    :global(.explorer),
    .focus-exit,
    .error {
      display: none !important;
    }
  }
  .error {
    margin: 0;
    padding: 0.4rem 0.75rem;
    background: var(--leef-danger-bg);
    color: var(--leef-danger);
    font-size: 0.85rem;
  }
  .storage-alert {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .storage-alert div {
    flex: 1;
  }
  .storage-alert p {
    margin: 0;
  }
  .storage-alert-close {
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .focus-exit {
    position: fixed;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 20;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid var(--leef-separator);
    border-radius: var(--leef-radius-full);
    background: var(--leef-bg-control);
    color: var(--leef-accent);
    cursor: pointer;
    opacity: 0.5;
  }
  .focus-exit:hover {
    opacity: 1;
    background: var(--leef-bg-hover);
  }
</style>
