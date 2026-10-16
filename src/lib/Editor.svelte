<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, type Command } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
  import { markdown } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode, insertLink } from "./markdownCommands";
  import { lightTheme } from "./lightHighlight";
  import Icon from "./icons/Icon.svelte";
  import SlashMenu from "./SlashMenu.svelte";
  import { filterSlashItems, type SlashItem } from "./slashItems";
  import type { ThemeId } from "./theme";
  import type { IconName } from "./icons";

  // Non-default themes are dynamically imported so they don't inflate the
  // initial bundle for users who never switch away from the light theme.
  const themeCache = new Map<ThemeId, Extension>([["light", lightTheme]]);

  async function loadThemeExtension(id: ThemeId): Promise<Extension> {
    const cached = themeCache.get(id);
    if (cached) return cached;

    let extension: Extension;
    switch (id) {
      case "dark": {
        const { oneDark } = await import("@codemirror/theme-one-dark");
        extension = oneDark;
        break;
      }
      case "dracula": {
        const { dracula } = await import("thememirror");
        extension = dracula;
        break;
      }
      case "solarized": {
        const { solarizedLight } = await import("thememirror");
        extension = solarizedLight;
        break;
      }
      default:
        extension = lightTheme;
    }
    themeCache.set(id, extension);
    return extension;
  }

  export let value = "";
  export let themeId: ThemeId = "light";

  const dispatch = createEventDispatcher<{ change: string; cursorLine: string; scroll: number }>();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let scrollRaf: number | undefined;
  const themeCompartment = new Compartment();

  const quickCommands: { icon: IconName; label: string; run: Command }[] = [
    { icon: "bold", label: "Gras", run: toggleBold },
    { icon: "italic", label: "Italique", run: toggleItalic },
    { icon: "strikethrough", label: "Barré", run: toggleStrikethrough },
    { icon: "code", label: "Code en ligne", run: toggleInlineCode },
    { icon: "link", label: "Lien", run: insertLink },
  ];

  let quickMenuPos: { x: number; y: number } | null = null;

  function runQuickCommand(command: Command): void {
    applyCommand(command);
    quickMenuPos = null;
  }

  function closeQuickMenu(): void {
    quickMenuPos = null;
  }

  function handleEditorScroll(scrollDOM: HTMLElement) {
    if (scrollRaf !== undefined) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = undefined;
      const max = scrollDOM.scrollHeight - scrollDOM.clientHeight;
      dispatch("scroll", max > 0 ? scrollDOM.scrollTop / max : 0);
    });
  }

  function emitChange(doc: string) {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => dispatch("change", doc), 120);
  }

  // --- Notion-style "/" insert menu ----------------------------------------

  /** Open only while the caret sits right after a `/` on an otherwise empty line. */
  let slash: { from: number; query: string; x: number; y: number } | null = null;
  let slashIndex = 0;
  $: slashMatches = slash ? filterSlashItems(slash.query) : [];
  $: if (slashMatches.length <= slashIndex) slashIndex = 0;

  function syncSlashMenu(view: EditorView): void {
    const range = view.state.selection.main;
    if (!range.empty) {
      slash = null;
      return;
    }
    const line = view.state.doc.lineAt(range.head);
    const before = line.text.slice(0, range.head - line.from);
    const after = line.text.slice(range.head - line.from);
    const match = /^\/([\p{L}\p{N}-]*)$/u.exec(before);
    if (!match || after.trim() !== "") {
      slash = null;
      return;
    }
    const coords = view.coordsAtPos(line.from);
    if (!coords) {
      slash = null;
      return;
    }
    if (slash === null) slashIndex = 0;
    slash = { from: line.from, query: match[1], x: coords.left, y: coords.bottom + 4 };
  }

  function applySlashItem(item: SlashItem): void {
    if (!view || !slash) return;
    const head = view.state.selection.main.head;
    // Drop the "/query" the user typed, then let the item act on the now-empty line.
    view.dispatch({ changes: { from: slash.from, to: head, insert: "" }, userEvent: "input" });
    slash = null;
    item.command(view);
    view.focus();
  }

  /** Arrow keys, Enter and Escape belong to the menu while it is open. */
  const slashKeymap = Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: () => slashNavigate(1) },
      { key: "ArrowUp", run: () => slashNavigate(-1) },
      {
        key: "Enter",
        run: () => {
          if (!slash || slashMatches.length === 0) return false;
          applySlashItem(slashMatches[slashIndex]);
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          if (!slash) return false;
          slash = null;
          return true;
        },
      },
    ]),
  );

  function slashNavigate(delta: number): boolean {
    if (!slash || slashMatches.length === 0) return false;
    slashIndex = (slashIndex + delta + slashMatches.length) % slashMatches.length;
    return true;
  }

  /**
   * Cells copied from Excel / Calc / Sheets or a Word table arrive as an HTML
   * table plus tab-separated text: paste them as a Markdown table, not as
   * tab-mangled lines. The converter is loaded on first use (bundle size).
   */
  function pasteTable(event: ClipboardEvent, target: EditorView): boolean {
    const html = event.clipboardData?.getData("text/html") ?? "";
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!/<table[\s>]/i.test(html) || !text.includes("\t")) return false;
    event.preventDefault();
    const { from, to } = target.state.selection.main;
    const line = target.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from).trim() ? "\n\n" : "";
    import("./office/tsv")
      .then(({ tsvToMarkdownTable }) => {
        const table = tsvToMarkdownTable(text);
        const insert = table ? `${before}${table}\n` : text;
        target.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          scrollIntoView: true,
          userEvent: "input.paste",
        });
      })
      .catch(() => {
        // Converter unavailable (offline chunk load failure): paste as plain text.
        target.dispatch({ changes: { from, to, insert: text }, userEvent: "input.paste" });
      });
    return true;
  }

  onMount(() => {
    const extensions = [
      slashKeymap,
      lineNumbers(),
      highlightActiveLine(),
      history(),
      search(),
      keymap.of([
        { key: "Mod-b", run: toggleBold, preventDefault: true },
        { key: "Mod-i", run: toggleItalic, preventDefault: true },
        { key: "Mod-k", run: insertLink, preventDefault: true },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      markdown({ codeLanguages: languages }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emitChange(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          const line = update.state.doc.lineAt(update.state.selection.main.head);
          dispatch("cursorLine", line.text);
          syncSlashMenu(update.view);
        }
      }),
      EditorView.domEventHandlers({ paste: pasteTable }),
      EditorView.theme({ "&": { height: "100%", fontSize: "14px" } }),
      themeCompartment.of([]),
    ];

    view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: container,
    });

    const scrollDOM = view.scrollDOM;
    const onScroll = () => handleEditorScroll(scrollDOM);
    scrollDOM.addEventListener("scroll", onScroll, { passive: true });

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      quickMenuPos = { x: event.clientX, y: event.clientY };
    };
    view.dom.addEventListener("contextmenu", onContextMenu);

    return () => {
      scrollDOM.removeEventListener("scroll", onScroll);
      view?.dom.removeEventListener("contextmenu", onContextMenu);
      if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
      view?.destroy();
    };
  });

  let themeRequestId = 0;

  async function applyTheme(id: ThemeId) {
    const requestId = ++themeRequestId;
    const extension = await loadThemeExtension(id);
    // Discard this result if a newer theme switch was requested while the
    // (possibly slower, first-time) dynamic import was still in flight —
    // otherwise an out-of-order resolution can overwrite a later theme's
    // styles with a stale one's.
    if (requestId !== themeRequestId) return;
    view?.dispatch({ effects: themeCompartment.reconfigure(extension) });
  }

  $: if (view) applyTheme(themeId);

  $: if (view && value !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }

  onDestroy(() => {
    clearTimeout(debounceHandle);
  });

  export function applyCommand(command: Command): void {
    if (view) {
      command(view);
      view.focus();
    }
  }

  export function openSearch(): void {
    if (view) openSearchPanel(view);
  }

  export function insertAtCursor(text: string): void {
    if (!view) return;
    const pos = view.state.selection.main.to;
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: EditorSelection.cursor(pos + text.length),
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
  }
</script>

<svelte:window
  on:click={closeQuickMenu}
  on:keydown={(e) => e.key === "Escape" && closeQuickMenu()}
/>

<div class="editor" bind:this={container}></div>

{#if slash}
  <SlashMenu items={slashMatches} bind:activeIndex={slashIndex} x={slash.x} y={slash.y} on:select={(e) => applySlashItem(e.detail)} />
{/if}

{#if quickMenuPos}
  <!-- Contains only real <button>s; stopping propagation here just keeps
       clicks inside the popup from closing it via the window listener above. -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="quick-menu"
    style="left: {quickMenuPos.x}px; top: {quickMenuPos.y}px;"
    on:click|stopPropagation
    on:contextmenu|preventDefault
  >
    {#each quickCommands as cmd (cmd.icon)}
      <button title={cmd.label} aria-label={cmd.label} on:click={() => runQuickCommand(cmd.run)}>
        <Icon name={cmd.icon} />
      </button>
    {/each}
  </div>
{/if}

<style>
  .editor {
    height: 100%;
    overflow: auto;
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
  .quick-menu {
    position: fixed;
    z-index: 50;
    display: flex;
    gap: 0.15rem;
    padding: 0.3rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    transform: translate(-8px, -8px);
  }
  .quick-menu button {
    width: 1.9rem;
    height: 1.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--toolbar-fg);
    cursor: pointer;
  }
  .quick-menu button:hover {
    background: var(--button-hover-bg);
  }
</style>
