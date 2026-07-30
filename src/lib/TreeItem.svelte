<script lang="ts">
  import Icon from "./icons/Icon.svelte";
  import type { TreeNode } from "./workspace";

  export let nodes: TreeNode[] = [];
  export let depth = 0;
  /** Callback rather than an event so it doesn't need forwarding at each level. */
  export let onOpen: (path: string) => void;
  export let currentPath: string | null = null;

  // Folders start collapsed except at the root, where an empty-looking panel
  // would be confusing.
  let expanded: Record<string, boolean> = {};
  $: isExpanded = (node: TreeNode) => expanded[node.path] ?? depth === 0;
</script>

<ul class="tree" style="--depth: {depth}">
  {#each nodes as node (node.path)}
    <li>
      {#if node.children}
        <button class="row" on:click={() => (expanded[node.path] = !isExpanded(node))}>
          <Icon name={isExpanded(node) ? "chevronDown" : "chevronRight"} size="0.9rem" />
          <Icon name={isExpanded(node) ? "folderOpen" : "folder"} size="0.9rem" />
          <span class="label">{node.name}</span>
        </button>
        {#if isExpanded(node)}
          <svelte:self nodes={node.children} depth={depth + 1} {onOpen} {currentPath} />
        {/if}
      {:else}
        <button class="row" class:current={node.path === currentPath} on:click={() => onOpen(node.path)} title={node.path}>
          <span class="spacer"></span>
          <Icon name="file" size="0.9rem" />
          <span class="label">{node.name}</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
    padding: 0.2rem 0.4rem 0.2rem calc(0.3rem + var(--depth) * 0.7rem);
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--fg);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--button-hover-bg);
  }
  .row.current {
    background: var(--button-hover-bg);
    color: var(--toolbar-fg);
    font-weight: 600;
  }
  .spacer {
    width: 0.9rem;
    flex-shrink: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
