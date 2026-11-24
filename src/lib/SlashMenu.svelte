<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Icon from "./icons/Icon.svelte";
  import type { SlashItem } from "./slashItems";

  export let items: SlashItem[] = [];
  export let activeIndex = 0;
  /** Viewport coordinates of the caret the menu hangs from. */
  export let x = 0;
  export let y = 0;

  const dispatch = createEventDispatcher<{ select: SlashItem }>();

  let menu: HTMLElement | undefined;

  // Keeps the keyboard-selected row in view while arrowing through a long list.
  $: if (menu && items.length > 0) {
    menu.querySelectorAll<HTMLElement>(".slash-item")[activeIndex]?.scrollIntoView({ block: "nearest" });
  }
</script>

<!-- Fixed positioning: the caret coordinates come from the viewport, so the
     menu doesn't have to care which scrolling container it sits above. -->
<div class="slash-menu" bind:this={menu} style="left: {x}px; top: {y}px" role="listbox" aria-label="Insérer un bloc">
  {#if items.length === 0}
    <p class="slash-empty">Aucun bloc</p>
  {:else}
    {#each items as item, index (item.id)}
      <button
        class="slash-item"
        class:active={index === activeIndex}
        role="option"
        aria-selected={index === activeIndex}
        on:mousedown|preventDefault={() => dispatch("select", item)}
        on:mouseenter={() => (activeIndex = index)}
      >
        <Icon name={item.icon} size="1rem" />
        {item.label}
      </button>
    {/each}
  {/if}
</div>

<style>
  .slash-menu {
    position: fixed;
    z-index: 40;
    min-width: 13rem;
    max-height: 15rem;
    overflow-y: auto;
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--leef-radius-lg);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  }
  .slash-item {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.5rem;
    border: none;
    border-radius: var(--leef-radius-md);
    background: none;
    color: var(--fg);
    font-size: 0.85rem;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .slash-item.active {
    background: var(--button-hover-bg);
    color: var(--toolbar-fg);
  }
  .slash-empty {
    margin: 0;
    padding: 0.35rem 0.5rem;
    font-size: 0.8rem;
    color: var(--muted-fg);
  }
</style>
