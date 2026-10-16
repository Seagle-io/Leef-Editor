<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import Icon from "./icons/Icon.svelte";
  import { htmlToMarkdown } from "./htmlToMarkdown";
  import SlashMenu from "./SlashMenu.svelte";
  import { filterSlashItems, type SlashItem } from "./slashItems";
  import {
    fillTemplate,
    getPageFormat,
    mmToPx,
    PAGE_FOOTER_MM,
    PAGE_HEADER_MM,
    PAGE_MARGIN_MM,
    type PageFormatId,
  } from "./page";

  export let html = "";
  export let dark = false;
  export let paged = false;
  export let formatId: PageFormatId = "a4";
  export let header = "";
  export let footer = "";
  export let title = "";
  /** Unlocked preview: the rendered output is edited directly (continuous mode only). */
  export let editable = false;

  const dispatch = createEventDispatcher<{ edit: string }>();

  let container: HTMLDivElement;
  let flow: HTMLDivElement;
  let pagesEl: HTMLDivElement;
  let mermaidTheme: string | null = null;

  export function setScrollRatio(ratio: number): void {
    if (!container) return;
    const max = container.scrollHeight - container.clientHeight;
    container.scrollTop = max > 0 ? ratio * max : 0;
  }

  async function renderMermaidDiagrams() {
    if (!flow) return;
    const nodes = flow.querySelectorAll<HTMLElement>(".mermaid");
    if (nodes.length === 0) return;

    // Loaded on demand: mermaid is heavy and most documents never use it.
    const mermaid = (await import("mermaid")).default;
    const wantedTheme = dark ? "dark" : "default";
    if (mermaidTheme !== wantedTheme) {
      mermaid.initialize({ startOnLoad: false, theme: wantedTheme });
      mermaidTheme = wantedTheme;
    }
    try {
      await mermaid.run({ nodes });
    } catch (err) {
      console.error("Erreur de rendu Mermaid :", err);
    }
  }

  // Blocks whose children can be dealt out over several pages when the block
  // itself is taller than one page. Anything else (a table, an image, a huge
  // code block) stays whole and gets a page to itself.
  const SPLITTABLE = new Set(["UL", "OL", "DIV", "BLOCKQUOTE", "SECTION", "DL"]);

  function outerHeight(el: HTMLElement): number {
    const style = getComputedStyle(el);
    return el.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }

  /**
   * Deals the rendered blocks out into fixed-height page boxes. Nodes are
   * *moved* (not cloned) out of the offscreen flow container, so the copy
   * buttons and the Mermaid SVGs keep working. `flow` has exactly the width of
   * a page's text area, so the heights measured there stay valid once moved.
   */
  function paginate(): void {
    if (!flow || !pagesEl) return;

    const format = getPageFormat(formatId);
    const hasHeader = header.trim() !== "";
    const hasFooter = footer.trim() !== "";
    const contentPx = mmToPx(
      format.height -
        2 * PAGE_MARGIN_MM -
        (hasHeader ? PAGE_HEADER_MM : 0) -
        (hasFooter ? PAGE_FOOTER_MM : 0),
    );
    pagesEl.replaceChildren();

    let body!: HTMLElement;
    let used = 0;

    /** A header / footer band, split into left / centre / right on `|`. */
    function band(className: string): HTMLElement {
      const el = document.createElement("div");
      el.className = className;
      for (let i = 0; i < 3; i += 1) el.appendChild(document.createElement("span"));
      return el;
    }

    function newPage(): void {
      const page = document.createElement("div");
      page.className = "page";
      body = document.createElement("div");
      body.className = "page-body leef-content";
      page.append(...(hasHeader ? [band("page-header")] : []), body, ...(hasFooter ? [band("page-footer")] : []));
      pagesEl.appendChild(page);
      used = 0;
    }

    function place(node: HTMLElement): void {
      const height = outerHeight(node);

      if (used > 0 && used + height > contentPx) newPage();

      if (height <= contentPx) {
        body.appendChild(node);
        used += height;
        return;
      }

      const children = Array.from(node.children) as HTMLElement[];
      if (!SPLITTABLE.has(node.tagName) || children.length < 2) {
        // Doesn't fit anywhere and can't be broken up: give it its own page
        // and let it run over. Rare, and better than dropping content.
        body.appendChild(node);
        used = contentPx;
        return;
      }

      let index = 0;
      let chunk = node.cloneNode(false) as HTMLElement;
      body.appendChild(chunk);
      for (const child of children) {
        const childHeight = outerHeight(child);
        if (used > 0 && used + childHeight > contentPx) {
          newPage();
          chunk = node.cloneNode(false) as HTMLElement;
          if (chunk.tagName === "OL") chunk.setAttribute("start", String(index + 1));
          body.appendChild(chunk);
        }
        chunk.appendChild(child);
        used += childHeight;
        index += 1;
      }
    }

    newPage();
    for (const node of Array.from(flow.children) as HTMLElement[]) {
      if (node.classList.contains("page-break")) {
        // Manual `\pagebreak`: the marker itself isn't rendered.
        node.remove();
        if (used > 0) newPage();
        continue;
      }
      place(node);
    }

    const pages = Array.from(pagesEl.children) as HTMLElement[];
    pages.forEach((page, index) => {
      const context = { page: index + 1, pages: pages.length, title };
      fillBand(page.querySelector(".page-header"), header, context);
      fillBand(page.querySelector(".page-footer"), footer, context);
    });
  }

  function fillBand(el: Element | null, template: string, context: Parameters<typeof fillTemplate>[1]): void {
    if (!el) return;
    const parts = fillTemplate(template, context).split("|");
    // One part is centred, two are pushed to the edges, three fill all slots.
    const slots =
      parts.length === 1 ? ["", parts[0], ""] : parts.length === 2 ? [parts[0], "", parts[1]] : parts.slice(0, 3);
    Array.from(el.children).forEach((span, i) => {
      span.textContent = (slots[i] ?? "").trim();
    });
  }

  // The flow container is filled by hand rather than with `{@html}`: in page
  // mode its children are moved into the page boxes, which would leave Svelte's
  // view of that subtree out of sync.
  async function update(): Promise<void> {
    await tick();
    if (!flow) return;
    // The html we're being handed is the round-trip of an edit made *in* the
    // preview: re-rendering it would throw away the caret mid-typing.
    if (selfEdited) {
      selfEdited = false;
      return;
    }
    flow.innerHTML = html;
    await renderMermaidDiagrams();
    if (paged) paginate();
  }

  // Re-runs on content, page mode, format and header / footer changes.
  $: html, paged, formatId, header, footer, title, update();

  // --- Editing the rendered output -----------------------------------------

  let selfEdited = false;
  let editHandle: ReturnType<typeof setTimeout> | undefined;

  // Page mode moves nodes into the page boxes, so editing only makes sense in
  // continuous mode.
  $: canEdit = editable && !paged;

  function handleInput(): void {
    if (!canEdit) return;
    syncSlashMenu();
    clearTimeout(editHandle);
    editHandle = setTimeout(async () => {
      try {
        const markdown = await htmlToMarkdown(flow.innerHTML);
        selfEdited = true;
        dispatch("edit", markdown);
      } catch (err) {
        console.error("Impossible de convertir le rendu en Markdown :", err);
      }
    }, 400);
  }

  // --- Notion-style "/" insert menu ----------------------------------------

  let slash: { block: HTMLElement; query: string; x: number; y: number } | null = null;
  let slashIndex = 0;
  $: slashMatches = slash ? filterSlashItems(slash.query) : [];
  $: if (slashMatches.length <= slashIndex) slashIndex = 0;

  /** The top-level rendered block the caret currently sits in. */
  function caretBlock(): HTMLElement | null {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0 || !flow) return null;

    let node: Node | null = selection.getRangeAt(0).startContainer;
    while (node && node !== flow) {
      if (node.parentNode === flow && node.nodeType === Node.ELEMENT_NODE) return node as HTMLElement;
      node = node.parentNode;
    }
    return null;
  }

  function syncSlashMenu(): void {
    if (!canEdit) {
      slash = null;
      return;
    }
    const block = caretBlock();
    const match = block && /^\/([\p{L}\p{N}-]*)$/u.exec(block.textContent ?? "");
    if (!block || !match) {
      slash = null;
      return;
    }
    const rect = block.getBoundingClientRect();
    if (slash === null) slashIndex = 0;
    slash = { block, query: match[1], x: rect.left, y: rect.bottom + 4 };
  }

  /**
   * Replaces the `/query` block with the item's rendered HTML. The block is
   * swapped whole rather than going through `insertHTML`, which would nest the
   * new block inside the paragraph being replaced.
   */
  function applySlashItem(item: SlashItem): void {
    if (!slash) return;
    const { block } = slash;
    slash = null;

    const template = document.createElement("template");
    template.innerHTML = item.html;
    const inserted = Array.from(template.content.childNodes);
    block.replaceWith(template.content);

    const last = inserted[inserted.length - 1];
    if (last instanceof HTMLElement) {
      // Caret at the end of what was just inserted, ready to type over it.
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    flow.focus();
    handleInput();
  }

  function handleFlowKeydown(event: KeyboardEvent): void {
    if (!slash || slashMatches.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      slashIndex = (slashIndex + delta + slashMatches.length) % slashMatches.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      applySlashItem(slashMatches[slashIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      slash = null;
    }
  }

  // --- Quick toolbar --------------------------------------------------------

  let quickBar = { visible: false, top: 0, left: 0 };

  function updateQuickBar(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) {
      quickBar = { ...quickBar, visible: false };
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      quickBar = { ...quickBar, visible: false };
      return;
    }
    const rect = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    quickBar = {
      visible: true,
      // Positioned relative to the scrolling preview container.
      top: rect.top - box.top + container.scrollTop - 2.6 * 16,
      left: Math.max(0, rect.left - box.left + rect.width / 2),
    };
  }

  function selectedText(): string {
    return window.getSelection()?.toString() ?? "";
  }

  async function quickCopy(): Promise<void> {
    const text = selectedText();
    if (text) await navigator.clipboard.writeText(text);
  }

  async function quickCut(): Promise<void> {
    await quickCopy();
    document.execCommand("delete");
    handleInput();
  }

  async function quickPaste(): Promise<void> {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand("insertText", false, text);
    handleInput();
  }

  function quickFormat(command: "bold" | "italic" | "strikeThrough"): void {
    document.execCommand(command);
    handleInput();
  }

  function quickCode(): void {
    const text = selectedText();
    if (!text) return;
    document.execCommand("insertHTML", false, `<code>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</code>`);
    handleInput();
  }

  function quickLink(): void {
    const url = prompt("URL du lien :");
    if (!url) return;
    document.execCommand("createLink", false, url);
    handleInput();
  }

  let copiedFeedback: HTMLElement | null = null;

  async function handlePreviewClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLElement>(".copy-code-btn");
    if (!button) return;

    const code = button.parentElement?.querySelector("code");
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      if (copiedFeedback && copiedFeedback !== button) copiedFeedback.classList.remove("copied");
      button.classList.add("copied");
      copiedFeedback = button;
      setTimeout(() => button.classList.remove("copied"), 1500);
    } catch (err) {
      console.error("Impossible de copier le code :", err);
    }
  }
</script>

<!-- The click handler only delegates to real <button> elements rendered
     inside {@html html} (the copy-code buttons); those remain independently
     keyboard-accessible, so this container isn't itself an interactive control. -->
<svelte:document on:selectionchange={updateQuickBar} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="preview" class:paged bind:this={container} on:click={handlePreviewClick} on:scroll={updateQuickBar}>
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div
    class="flow leef-content"
    class:editing={canEdit}
    bind:this={flow}
    contenteditable={canEdit}
    role={canEdit ? "textbox" : undefined}
    aria-multiline={canEdit ? "true" : undefined}
    tabindex={canEdit ? 0 : undefined}
    on:input={handleInput}
    on:keydown={handleFlowKeydown}
  ></div>
  <div class="pages" bind:this={pagesEl}></div>

  {#if slash}
    <SlashMenu items={slashMatches} bind:activeIndex={slashIndex} x={slash.x} y={slash.y} on:select={(e) => applySlashItem(e.detail)} />
  {/if}

  {#if quickBar.visible}
    <!-- preventDefault on mousedown: clicking a button must not drop the
         selection the action is about to operate on. -->
    <div
      class="quick-bar"
      style="top: {quickBar.top}px; left: {quickBar.left}px"
      role="toolbar"
      tabindex="-1"
      aria-label="Actions rapides"
      on:mousedown|preventDefault
    >
      <button on:click={quickCopy} title="Copier" aria-label="Copier"><Icon name="copy" /></button>
      {#if canEdit}
        <button on:click={quickCut} title="Couper" aria-label="Couper"><Icon name="cut" /></button>
        <button on:click={quickPaste} title="Coller" aria-label="Coller"><Icon name="paste" /></button>
        <span class="quick-sep"></span>
        <button on:click={() => quickFormat("bold")} title="Gras" aria-label="Gras"><Icon name="bold" /></button>
        <button on:click={() => quickFormat("italic")} title="Italique" aria-label="Italique"><Icon name="italic" /></button>
        <button on:click={() => quickFormat("strikeThrough")} title="Barré" aria-label="Barré"><Icon name="strikethrough" /></button>
        <button on:click={quickCode} title="Code" aria-label="Code"><Icon name="code" /></button>
        <button on:click={quickLink} title="Lien" aria-label="Lien"><Icon name="link" /></button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .preview {
    position: relative;
    height: 100%;
    overflow: auto;
    padding: 0 1rem;
  }

  /* Unlocked preview: a subtle frame so it's obvious the rendering is live. */
  .flow.editing {
    outline: 1px dashed var(--leef-accent);
    outline-offset: 0.4rem;
    border-radius: 2px;
    min-height: 4rem;
  }
  .flow.editing:focus {
    outline-style: solid;
  }

  .quick-bar {
    position: absolute;
    z-index: 15;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.2rem;
    background: var(--leef-bg-elevated);
    border: 1px solid var(--leef-separator);
    border-radius: 6px;
    box-shadow: var(--leef-shadow-popover);
  }
  .quick-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--leef-accent);
    cursor: pointer;
  }
  .quick-bar button:hover {
    background: var(--leef-bg-hover);
  }
  .quick-sep {
    width: 1px;
    align-self: stretch;
    margin: 0 0.15rem;
    background: var(--leef-separator);
  }
  @media print {
    .quick-bar {
      display: none !important;
    }
    .flow.editing {
      outline: none;
    }
  }

  /* Page mode: the flow container becomes an offscreen measuring area of
     exactly one text-column wide, and the visible content is the page boxes. */
  .preview.paged {
    padding: 1.5rem 0;
    background: var(--leef-page-canvas);
  }
  .preview.paged .flow {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    top: 0;
    left: -10000px;
    width: calc(var(--page-width, 210mm) - 2 * var(--page-margin, 20mm));
  }
  .pages {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }
  .preview.paged .pages {
    display: flex;
  }
  .preview :global(.page) {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: var(--page-width, 210mm);
    height: var(--page-height, 297mm);
    padding: var(--page-margin, 20mm);
    overflow: hidden;
    background: var(--leef-page-paper);
    border: 1px solid var(--leef-separator);
    box-shadow: var(--leef-shadow-page);
  }
  .preview :global(.page-body) {
    flex: 1;
    min-height: 0;
  }
  .preview :global(.page-body > :first-child) {
    margin-top: 0;
  }
  .preview :global(.page-header),
  .preview :global(.page-footer) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-shrink: 0;
    height: var(--page-band, 10mm);
    font-size: 0.75rem;
    color: var(--leef-text-secondary);
  }
  /* Left / centre / right slots: the middle one takes the slack so the outer
     two stay pinned to the text edges. */
  .preview :global(.page-header span:nth-child(2)),
  .preview :global(.page-footer span:nth-child(2)) {
    flex: 1;
    text-align: center;
  }
  .preview :global(.page-header) {
    border-bottom: 1px solid var(--leef-separator);
    align-items: flex-start;
    padding-bottom: 0.3rem;
  }
  .preview :global(.page-footer) {
    border-top: 1px solid var(--leef-separator);
    align-items: flex-end;
    padding-top: 0.3rem;
  }

  /* Manual page break: invisible in page mode (it becomes a real break),
     shown as a labelled separator in continuous mode. */
  .preview :global(.page-break) {
    position: relative;
    height: 0;
    border-top: 1px dashed var(--leef-accent);
    margin: 1.75rem 0;
    opacity: 0.6;
  }
  .preview :global(.page-break)::after {
    content: "saut de page";
    position: absolute;
    top: -0.65em;
    left: 50%;
    transform: translateX(-50%);
    padding: 0 0.4rem;
    background: var(--leef-page-paper);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--leef-accent);
  }
  /* Printing: one .page box per sheet. The `@page` rule (size + zero margin)
     is injected by page.ts; the box's own padding provides the margins. The
     hair taken off the height keeps rounding from spilling into blank sheets. */
  @media print {
    .preview,
    .preview.paged {
      height: auto;
      overflow: visible;
      padding: 0;
      background: none;
    }
    .preview.paged .pages {
      gap: 0;
      display: block;
    }
    /* Outside page mode there are no page boxes to carry the margins, so the
       flow container provides them (the `@page` rule has margin: 0). */
    .preview:not(.paged) .flow {
      padding: var(--page-margin, 20mm);
    }
    .preview:not(.paged) :global(.page-break) {
      border: none;
      margin: 0;
      break-after: page;
    }
    .preview:not(.paged) :global(.page-break)::after {
      content: none;
    }
    .preview :global(.page) {
      height: calc(var(--page-height, 297mm) - 0.5mm);
      border: none;
      box-shadow: none;
      background: none;
      break-after: page;
    }
    .preview :global(.page:last-child) {
      break-after: auto;
    }
  }
</style>
