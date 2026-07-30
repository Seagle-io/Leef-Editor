<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { TocItem } from "./markdown";

  export let toc: TocItem[] = [];

  const dispatch = createEventDispatcher<{ jump: string }>();
</script>

<nav class="outline" aria-label="Plan du document">
  <p class="outline-title">Plan</p>
  {#each toc as item (item.id)}
    <button
      class="outline-item"
      style="padding-left: {0.6 + (item.level - 1) * 0.7}rem"
      on:click={() => dispatch("jump", item.id)}
      title={item.text}
    >
      {item.text}
    </button>
  {/each}
</nav>

<style>
  .outline {
    width: 14rem;
    flex-shrink: 0;
    overflow-y: auto;
    padding: 0.75rem 0.5rem;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .outline-title {
    margin: 0 0 0.4rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-fg);
  }
  .outline-item {
    text-align: left;
    background: none;
    border: none;
    border-radius: 4px;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    padding-right: 0.5rem;
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--muted-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .outline-item:hover {
    background: var(--button-hover-bg);
    color: var(--fg);
  }
</style>
