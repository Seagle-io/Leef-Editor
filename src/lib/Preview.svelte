<script lang="ts">
  import { createEventDispatcher, onMount, tick } from "svelte";
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
  import { planSheets, type MeasuredUnit, type SheetGeometry } from "./sheetLayout";

  export let html = "";
  /** The markdown `html` was rendered from. */
  export let source = "";
  export let dark = false;
  export let paged = false;
  export let formatId: PageFormatId = "a4";
  export let header = "";
  export let footer = "";
  export let title = "";
  /** Unlocked preview: the rendered output is edited directly, in both modes. */
  export let editable = false;

  const dispatch = createEventDispatcher<{ edit: string }>();

  let container: HTMLDivElement;
  let flow: HTMLDivElement;
  let pagesEl: HTMLDivElement;
  let mermaidTheme: string | null = null;
  let containerWidth = 0;

  // Display zoom: a sheet wider than the pane shrinks to fit instead of
  // overflowing on both sides. Printing ignores it (see @media print).
  const PAGE_FIT_GUTTER_PX = 32;
  $: scale = Math.min(
    1,
    containerWidth > 0
      ? (containerWidth - PAGE_FIT_GUTTER_PX) / mmToPx(getPageFormat(formatId).width)
      : 1,
  );

  onMount(() => {
    const observer = new ResizeObserver(() => {
      containerWidth = container.clientWidth;
    });
    observer.observe(container);
    // Images and Mermaid diagrams change the flow's height after the fact.
    const flowObserver = new ResizeObserver(scheduleLayout);
    flowObserver.observe(flow);
    return () => {
      observer.disconnect();
      flowObserver.disconnect();
      cancelAnimationFrame(layoutFrame);
    };
  });

  export function setScrollRatio(ratio: number): void {
    if (!container) return;
    // Typing in the preview: following the editor's scroll would yank the page away.
    if (container.contains(document.activeElement)) return;
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

  /** Text height, sheet height and text offset of one sheet for the current format and bands. */
  function sheetGeometry(): SheetGeometry {
    const format = getPageFormat(formatId);
    const hasHeader = header.trim() !== "";
    const hasFooter = footer.trim() !== "";
    return {
      contentPx: mmToPx(
        format.height -
          2 * PAGE_MARGIN_MM -
          (hasHeader ? PAGE_HEADER_MM : 0) -
          (hasFooter ? PAGE_FOOTER_MM : 0),
      ),
      sheetPx: mmToPx(format.height),
      bodyOffsetPx: mmToPx(PAGE_MARGIN_MM + (hasHeader ? PAGE_HEADER_MM : 0)),
    };
  }

  /**
   * Printing only: deals the blocks of `source` — a copy of the flow, laid out
   * at the width of a page's text area — out into fixed-height page boxes.
   * Nodes are *moved* out of `source`, measured before they leave it.
   */
  function paginate(source: HTMLElement): void {
    if (!pagesEl) return;

    const hasHeader = header.trim() !== "";
    const hasFooter = footer.trim() !== "";
    const { contentPx } = sheetGeometry();
    pagesEl.replaceChildren();

    let body!: HTMLElement;
    let used = 0;
    // Margin under the last block placed: it collapses with the next block's
    // top margin and needs no room at the foot of a page — as on screen
    // (planSheets), so the printed pages break where the sheets do.
    let trailing = 0;

    /** Bottom of `el`'s border box if it went next on the current page. */
    function bottomIfPlaced(el: HTMLElement): number {
      return (used > 0 ? used + Math.max(trailing, parseFloat(getComputedStyle(el).marginTop)) : 0) + el.offsetHeight;
    }

    function append(parent: HTMLElement, el: HTMLElement): void {
      used = bottomIfPlaced(el);
      trailing = parseFloat(getComputedStyle(el).marginBottom);
      parent.appendChild(el);
    }

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
      if (used > 0 && bottomIfPlaced(node) > contentPx) newPage();

      if (node.offsetHeight <= contentPx) {
        append(body, node);
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
        if (used > 0 && bottomIfPlaced(child) > contentPx) {
          newPage();
          chunk = node.cloneNode(false) as HTMLElement;
          if (chunk.tagName === "OL") chunk.setAttribute("start", String(index + 1));
          body.appendChild(chunk);
        }
        append(chunk, child);
        index += 1;
      }
    }

    newPage();
    for (const node of Array.from(source.children) as HTMLElement[]) {
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

  /** Left / centre / right texts of a band: one part is centred, two are pushed to the edges, three fill all slots. */
  function bandSlots(template: string, context: Parameters<typeof fillTemplate>[1]): string[] {
    const parts = fillTemplate(template, context).split("|");
    const slots =
      parts.length === 1 ? ["", parts[0], ""] : parts.length === 2 ? [parts[0], "", parts[1]] : parts.slice(0, 3);
    return [0, 1, 2].map((i) => (slots[i] ?? "").trim());
  }

  function fillBand(el: Element | null, template: string, context: Parameters<typeof fillTemplate>[1]): void {
    if (!el) return;
    const slots = bandSlots(template, context);
    Array.from(el.children).forEach((span, i) => {
      span.textContent = slots[i];
    });
  }

  // --- Page mode on screen: sheets painted behind the flow -----------------

  interface SheetView {
    top: number;
    height: number;
    header: string[] | null;
    footer: string[] | null;
  }

  let sheets: SheetView[] = [];
  let layoutFrame = 0;
  $: lastSheet = sheets[sheets.length - 1];

  function scheduleLayout(): void {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      if (paged) layoutSheets();
    });
  }

  /** Top of `el` relative to the flow, whatever positioned blocks lie in between. */
  function offsetInFlow(el: HTMLElement): number {
    let top = 0;
    for (let node: HTMLElement | null = el; node && node !== flow; node = node.offsetParent as HTMLElement | null) {
      top += node.offsetTop;
    }
    return top;
  }

  /** Drops the sheet margins under `root` — Chrome also copies them onto a block split with Enter. */
  function clearPushes(root: HTMLElement): void {
    for (const el of root.querySelectorAll<HTMLElement>("[data-leef-push]")) {
      el.style.marginTop = "";
      el.removeAttribute("data-leef-push");
      if (!el.getAttribute("style")) el.removeAttribute("style");
    }
  }

  function isUnbreakable(el: HTMLElement): boolean {
    return !SPLITTABLE.has(el.tagName) || el.classList.contains("mermaid");
  }

  /**
   * The flow's blocks as layout units. A block taller than a sheet that can be
   * dealt out (as in `paginate`) gives its children instead, one level deep;
   * its first child moves the block itself.
   */
  function measureUnits(contentPx: number): { units: MeasuredUnit[]; targets: HTMLElement[] } {
    const units: MeasuredUnit[] = [];
    const targets: HTMLElement[] = [];
    let prevBottom = parseFloat(getComputedStyle(flow).paddingTop);
    let forcedBreak = false;
    for (const node of Array.from(flow.children) as HTMLElement[]) {
      if (node.classList.contains("page-break")) {
        forcedBreak = true;
        continue;
      }
      const top = offsetInFlow(node);
      const children = Array.from(node.children) as HTMLElement[];
      if (node.offsetHeight > contentPx && SPLITTABLE.has(node.tagName) && children.length >= 2) {
        const parent = targets.push(node) - 1;
        children.forEach((child, i) => {
          const childTop = offsetInFlow(child);
          const previous = children[i - 1];
          units.push({
            top: childTop,
            height: child.offsetHeight,
            // The margin of a first child goes on its parent, which sits that much higher.
            prevBottom: i === 0 ? prevBottom + childTop - top : offsetInFlow(previous) + previous.offsetHeight,
            forcedBreak: i === 0 && forcedBreak,
            target: i === 0 ? parent : targets.push(child) - 1,
            unbreakable: isUnbreakable(child),
          });
        });
      } else {
        units.push({ top, height: node.offsetHeight, prevBottom, forcedBreak, target: targets.push(node) - 1, unbreakable: isUnbreakable(node) });
      }
      forcedBreak = false;
      prevBottom = top + node.offsetHeight;
    }
    return { units, targets };
  }

  /** Index of the sheet a flow position falls on. */
  function sheetAt(list: SheetView[], y: number): number {
    let index = 0;
    list.forEach((sheet, i) => {
      if (sheet.top <= y) index = i;
    });
    return index;
  }

  /**
   * Starts each sheet's first block on its sheet with a `margin-top` and paints
   * the sheets behind the flow. Only style / data attributes are written: no
   * content node is ever added, removed or moved, so the caret, the native
   * undo and the "/" menu are left alone.
   */
  function layoutSheets(): void {
    if (!flow) return;
    const caret = caretBlock();
    const caretSheet = caret ? sheetAt(sheets, caret.offsetTop) : -1;

    const geometry = sheetGeometry();
    clearPushes(flow);
    flow.style.paddingTop = `${geometry.bodyOffsetPx}px`;
    const { units, targets } = measureUnits(geometry.contentPx);
    const plan = planSheets(units, geometry);
    for (const push of plan.pushes) {
      targets[push.target].style.marginTop = `${push.marginTop}px`;
      targets[push.target].setAttribute("data-leef-push", "");
    }

    const hasHeader = header.trim() !== "";
    const hasFooter = footer.trim() !== "";
    sheets = plan.sheets.map((sheet, index) => {
      const context = { page: index + 1, pages: plan.sheets.length, title };
      return {
        top: sheet.contentTop - geometry.bodyOffsetPx,
        height: sheet.height,
        header: hasHeader ? bandSlots(header, context) : null,
        footer: hasFooter ? bandSlots(footer, context) : null,
      };
    });

    // Enter at the bottom of a sheet sent the caret's block to the next one: follow it.
    if (caret && sheetAt(sheets, caret.offsetTop) !== caretSheet) caret.scrollIntoView({ block: "nearest" });
  }

  function clearSheets(): void {
    clearPushes(flow);
    flow.style.paddingTop = "";
    sheets = [];
  }

  // --- Rendering ------------------------------------------------------------

  /** The markdown the flow's DOM stands for: the last one rendered, or the last edit sent. */
  let renderedSource: string | null = null;

  function layout(): void {
    if (paged) layoutSheets();
    else clearSheets();
  }

  // The flow container is filled by hand rather than with `{@html}`: it is
  // edited in place, and a re-render would throw away the caret mid-typing.
  async function update(): Promise<void> {
    await tick();
    if (!flow) return;
    // Same markdown as the flow already shows (typically the echo of an edit
    // made here): only the sheets may need laying out again.
    if (source === renderedSource) {
      layout();
      return;
    }
    const scrollTop = container.scrollTop;
    clearTimeout(editHandle);
    editHandle = undefined;
    flow.innerHTML = html;
    renderedSource = source;
    // Edited from the markdown only.
    for (const el of flow.querySelectorAll(".page-break, pre.mermaid")) el.setAttribute("contenteditable", "false");
    await renderMermaidDiagrams();
    layout();
    // A change made on the markdown side leaves the reader where they were.
    await tick();
    container.scrollTop = scrollTop;
  }

  // Re-runs on content, page mode, format and header / footer changes.
  $: source, html, paged, formatId, header, footer, title, update();

  // --- Editing the rendered output -----------------------------------------

  let editHandle: ReturnType<typeof setTimeout> | undefined;
  let composing = false;

  $: canEdit = editable;

  async function sendEdit(): Promise<void> {
    editHandle = undefined;
    const rendered = renderedSource;
    try {
      const markdown = await htmlToMarkdown(flow.innerHTML);
      // Re-rendered from the markdown side meanwhile (another tab): this DOM is gone.
      if (renderedSource !== rendered) return;
      renderedSource = markdown;
      dispatch("edit", markdown);
    } catch (err) {
      console.error("Impossible de convertir le rendu en Markdown :", err);
    }
  }

  function handleInput(): void {
    if (!canEdit || composing) return;
    syncSlashMenu();
    scheduleLayout();
    clearTimeout(editHandle);
    editHandle = setTimeout(sendEdit, 400);
  }

  function handleCompositionEnd(): void {
    composing = false;
    handleInput();
  }

  /** Leaving the preview: send the pending edit now rather than in 400 ms. */
  function handleFocusOut(): void {
    if (editHandle === undefined) return;
    clearTimeout(editHandle);
    sendEdit();
  }

  // --- Printing -------------------------------------------------------------

  /** Page mode prints real page boxes, dealt out from a copy so the edited flow is never touched. */
  function handleBeforePrint(): void {
    if (!paged) return;
    const copy = flow.cloneNode(true) as HTMLElement;
    clearPushes(copy);
    container.appendChild(copy);
    paginate(copy);
    copy.remove();
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
    if (!slash || slashMatches.length === 0) {
      leaveBlock(event);
      return;
    }
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

  // --- Word-like caret placement and block exits ---------------------------

  /** Collapsed caret at the start or the end of `el`. */
  function putCaret(el: HTMLElement, atEnd: boolean): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /**
   * Opens an empty paragraph after `block` (or in an empty flow) and puts the
   * caret in it. Only ever on a user gesture, never while laying out sheets;
   * left empty, it converts to nothing and the markdown is unchanged.
   */
  function openParagraphAfter(block: HTMLElement | undefined): void {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    if (block) block.after(paragraph);
    else flow.appendChild(paragraph);
    putCaret(paragraph, false);
  }

  /** Text of `range`, a `<br>` counted as the newline it shows. */
  function rangeText(range: Range): string {
    const contents = range.cloneContents();
    for (const br of contents.querySelectorAll("br")) br.replaceWith("\n");
    return contents.textContent ?? "";
  }

  /** The caret sits on an empty line of `pre` with nothing after it but the closing newline. */
  function onEmptyLastLine(pre: HTMLElement, caret: Range): boolean {
    const before = document.createRange();
    before.setStart(pre, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    const after = document.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(pre, pre.childNodes.length);
    return rangeText(before).endsWith("\n") && /^\n?$/.test(rangeText(after));
  }

  /** Nothing of `block` after the caret goes below the caret's line. */
  function onLastLine(block: HTMLElement, caret: Range): boolean {
    const rest = document.createRange();
    rest.setStart(caret.endContainer, caret.endOffset);
    rest.setEnd(block, block.childNodes.length);
    const line = caret.getClientRects()[0] ?? rest.getClientRects()[0];
    if (!line) return true;
    return Array.from(rest.getClientRects()).every((rect) => rect.top < line.bottom);
  }

  /**
   * The only keys taken over besides the "/" menu: a second Enter on the empty
   * last line of a code block, or Down on the last line of a document that
   * doesn't end with a paragraph, opens a paragraph after the block.
   */
  function leaveBlock(event: KeyboardEvent): void {
    if (!canEdit || event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== "Enter" && event.key !== "ArrowDown") return;
    const block = caretBlock();
    if (!block) return;
    const caret = window.getSelection()!.getRangeAt(0);
    if (event.key === "Enter") {
      const start = caret.startContainer;
      const pre = (start instanceof Element ? start : start.parentElement)?.closest("pre");
      if (!pre || !onEmptyLastLine(pre, caret)) return;
      event.preventDefault();
      // Drops the empty line the first Enter made, on the native undo stack.
      document.execCommand("delete");
      openParagraphAfter(block);
      return;
    }
    if (block !== flow.lastElementChild || block.tagName === "P" || !onLastLine(block, caret)) return;
    event.preventDefault();
    openParagraphAfter(block);
  }

  /**
   * A press on a sheet but off the text — under it, between two blocks, in a
   * margin, on a header or footer — puts the caret in the nearest block of that
   * sheet; under the last block, at the end of the document, in a new paragraph
   * if it doesn't end with one.
   */
  function handlePaperPointerDown(event: PointerEvent): void {
    if (!paged || !canEdit || event.button !== 0) return;
    const target = event.target as Node;
    if (target !== flow && flow.contains(target)) return;
    event.preventDefault();
    flow.focus({ preventScroll: true });

    const blocks = Array.from(flow.children) as HTMLElement[];
    const last = blocks[blocks.length - 1];
    const y = event.clientY;
    if (!last || y > last.getBoundingClientRect().bottom) {
      if (last?.tagName === "P") putCaret(last, true);
      else openParagraphAfter(last);
      return;
    }

    // Page breaks and Mermaid diagrams take no caret.
    const editable = blocks.filter((el) => el.isContentEditable);
    const sheet = Array.from(container.querySelectorAll(".sheet"), (el) => el.getBoundingClientRect()).find(
      (rect) => rect.top <= y && y <= rect.bottom,
    );
    const onSheet = sheet
      ? editable.filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.bottom > sheet.top && rect.top < sheet.bottom;
        })
      : [];
    const distance = (el: HTMLElement): number => {
      const rect = el.getBoundingClientRect();
      return Math.max(rect.top - y, y - rect.bottom, 0);
    };
    let nearest: HTMLElement | undefined;
    for (const el of onSheet.length > 0 ? onSheet : editable) {
      if (!nearest || distance(el) < distance(nearest)) nearest = el;
    }
    if (!nearest) return;
    const rect = nearest.getBoundingClientRect();
    putCaret(nearest, y > (rect.top + rect.bottom) / 2);
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
<svelte:window on:beforeprint={handleBeforePrint} on:afterprint={() => pagesEl.replaceChildren()} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="preview" class:paged bind:this={container} on:click={handlePreviewClick} on:scroll={updateQuickBar}>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="paper"
    style:zoom={paged ? scale : null}
    style:min-height={lastSheet ? `${lastSheet.top + lastSheet.height}px` : null}
    on:pointerdown={handlePaperPointerDown}
  >
    <!-- Painted behind the flow: headers and footers are never part of what is edited. -->
    <div class="sheets" aria-hidden="true">
      {#each sheets as sheet}
        <div class="sheet" style:top="{sheet.top}px" style:height="{sheet.height}px">
          {#if sheet.header}
            <div class="page-header">{#each sheet.header as slot}<span>{slot}</span>{/each}</div>
          {/if}
          <div class="sheet-body"></div>
          {#if sheet.footer}
            <div class="page-footer">{#each sheet.footer as slot}<span>{slot}</span>{/each}</div>
          {/if}
        </div>
      {/each}
    </div>
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
      on:compositionstart={() => (composing = true)}
      on:compositionend={handleCompositionEnd}
      on:focusout={handleFocusOut}
    ></div>
  </div>
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
    box-sizing: border-box;
    height: 100%;
    overflow: auto;
    padding: 0 1rem;
  }

  /* Unlocked preview: a subtle frame so it's obvious the rendering is live. */
  .flow.editing {
    outline: 1px dashed var(--leef-accent);
    outline-offset: 0.4rem;
    border-radius: var(--leef-radius-sm);
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
    border-radius: var(--leef-radius-lg);
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
    border-radius: var(--leef-radius-sm);
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

  /* Page mode: the flow stays the one editable surface, one text column wide,
     laid over sheets painted behind it (see layoutSheets). */
  .preview.paged {
    padding: 1.5rem 0;
    background: var(--leef-page-canvas);
  }
  .preview.paged .paper {
    position: relative;
    width: var(--page-width, 210mm);
    margin: 0 auto;
  }
  .sheets {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    user-select: none;
  }
  .sheet {
    position: absolute;
    left: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    padding: var(--page-margin, 20mm);
    background: var(--leef-page-paper);
    border: 1px solid var(--leef-separator);
    box-shadow: var(--leef-shadow-page);
  }
  .sheet-body {
    flex: 1;
  }
  .preview.paged .flow {
    position: relative;
    z-index: 1;
    margin-left: var(--page-margin, 20mm);
    width: calc(var(--page-width, 210mm) - 2 * var(--page-margin, 20mm));
  }
  .preview.paged .flow > :global(:first-child) {
    margin-top: 0;
  }
  /* The sheets already frame the text. */
  .preview.paged .flow.editing {
    outline: none;
  }
  .preview.paged :global(.page-break) {
    margin: 0;
    border: none;
  }
  .preview.paged :global(.page-break)::after {
    content: none;
  }
  /* Filled only while printing (page mode). */
  .pages {
    display: none;
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
    .preview.paged .paper {
      display: none;
    }
    .preview.paged .pages {
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
