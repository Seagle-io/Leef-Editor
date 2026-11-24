<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Icon from "./icons/Icon.svelte";
  import { docName, type Doc } from "./documents";

  export let docs: Doc[] = [];
  export let activeId = "";

  const dispatch = createEventDispatcher<{ select: string; close: string; new: void; reorder: { from: number; to: number } }>();

  let dragIndex: number | null = null;
  let overIndex: number | null = null;

  function handleDragStart(event: DragEvent, index: number): void {
    dragIndex = index;
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent, index: number): void {
    if (dragIndex === null) return;
    // Required for the drop to be accepted at all.
    event.preventDefault();
    overIndex = index;
  }

  function handleDrop(index: number): void {
    if (dragIndex !== null && dragIndex !== index) dispatch("reorder", { from: dragIndex, to: index });
    dragIndex = null;
    overIndex = null;
  }

  function handleDragEnd(): void {
    dragIndex = null;
    overIndex = null;
  }

  /** Middle-click closes, as in most editors. */
  function handleMouseDown(event: MouseEvent, id: string): void {
    if (event.button === 1) {
      event.preventDefault();
      dispatch("close", id);
    }
  }
</script>

<div class="tabs" role="tablist" aria-label="Documents ouverts">
  {#each docs as doc, index (doc.id)}
    <div
      class="tab"
      class:active={doc.id === activeId}
      class:drop-target={overIndex === index && dragIndex !== index}
      class:dragging={dragIndex === index}
      draggable="true"
      role="tab"
      tabindex={doc.id === activeId ? 0 : -1}
      aria-selected={doc.id === activeId}
      title={doc.path ?? "Sans titre"}
      on:click={() => dispatch("select", doc.id)}
      on:keydown={(e) => (e.key === "Enter" || e.key === " ") && dispatch("select", doc.id)}
      on:mousedown={(e) => handleMouseDown(e, doc.id)}
      on:dragstart={(e) => handleDragStart(e, index)}
      on:dragover={(e) => handleDragOver(e, index)}
      on:drop|preventDefault={() => handleDrop(index)}
      on:dragend={handleDragEnd}
    >
      <span class="tab-label">{docName(doc)}</span>
      {#if doc.dirty}<span class="tab-dirty" aria-label="Modifications non enregistrées">•</span>{/if}
      <button
        class="tab-close"
        on:click|stopPropagation={() => dispatch("close", doc.id)}
        title="Fermer"
        aria-label={`Fermer ${docName(doc)}`}
      >
        <Icon name="close" size="0.8rem" />
      </button>
    </div>
  {/each}
  <button class="tab-new" on:click={() => dispatch("new")} title="Nouveau document" aria-label="Nouveau document">
    <Icon name="new" size="0.9rem" />
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 0.25rem 0.4rem 0;
    background: var(--toolbar-bg);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 14rem;
    padding: 0.35rem 0.4rem 0.35rem 0.7rem;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: var(--leef-radius-md) var(--leef-radius-md) 0 0;
    font-size: 0.8rem;
    color: var(--muted-fg);
    cursor: pointer;
    user-select: none;
  }
  .tab:hover {
    background: var(--leef-bg-hover);
  }
  .tab.active {
    background: var(--bg);
    border-color: var(--border);
    color: var(--fg);
    /* Covers the strip's bottom border so the tab merges with the content. */
    margin-bottom: -1px;
    padding-bottom: calc(0.35rem + 1px);
  }
  .tab.dragging {
    opacity: 0.4;
  }
  .tab.drop-target {
    box-shadow: inset 2px 0 0 var(--toolbar-fg);
  }
  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-dirty {
    color: var(--toolbar-fg);
    font-size: 1.1rem;
    line-height: 0;
  }
  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border: none;
    border-radius: var(--leef-radius-sm);
    background: none;
    color: inherit;
    opacity: 0.5;
    cursor: pointer;
  }
  .tab-close:hover {
    opacity: 1;
    background: var(--button-hover-bg);
  }
  .tab-new {
    display: inline-flex;
    align-items: center;
    align-self: center;
    margin-left: 0.2rem;
    padding: 0.25rem 0.4rem;
    border: none;
    border-radius: var(--leef-radius-md);
    background: none;
    color: var(--muted-fg);
    cursor: pointer;
  }
  .tab-new:hover {
    background: var(--button-hover-bg);
    color: var(--fg);
  }
  @media print {
    .tabs {
      display: none !important;
    }
  }
  .tab:focus-visible,
  .tab-close:focus-visible,
  .tab-new:focus-visible {
    outline: 2px solid var(--leef-accent);
    outline-offset: -2px;
  }
</style>
