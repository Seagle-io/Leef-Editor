<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Icon from "./icons/Icon.svelte";
  import TreeItem from "./TreeItem.svelte";
  import { workspace, workspaceSupported } from "./workspace";

  export let currentPath: string | null = null;

  const dispatch = createEventDispatcher<{ openFolder: void; openPath: string; refresh: void; close: void }>();

  const supported = workspaceSupported();
</script>

<aside class="explorer" aria-label="Explorateur de fichiers">
  <div class="explorer-head">
    <span class="explorer-title">{$workspace?.name ?? "Explorateur"}</span>
    {#if $workspace}
      <button on:click={() => dispatch("refresh")} title="Actualiser" aria-label="Actualiser">
        <Icon name="refresh" size="0.9rem" />
      </button>
      <button on:click={() => dispatch("close")} title="Fermer le dossier" aria-label="Fermer le dossier">
        <Icon name="close" size="0.9rem" />
      </button>
    {/if}
  </div>

  {#if !supported}
    <p class="explorer-empty">L'ouverture d'un dossier n'est disponible que dans l'application de bureau.</p>
  {:else if !$workspace}
    <button class="open-folder" on:click={() => dispatch("openFolder")}>
      <Icon name="folderOpen" size="1rem" /> Ouvrir un dossier…
    </button>
  {:else if $workspace.tree.length === 0}
    <p class="explorer-empty">Aucun fichier Markdown dans ce dossier.</p>
  {:else}
    <div class="explorer-tree">
      <TreeItem nodes={$workspace.tree} onOpen={(path) => dispatch("openPath", path)} {currentPath} />
    </div>
  {/if}
</aside>

<style>
  .explorer {
    width: 15rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--toolbar-bg);
  }
  .explorer-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.4rem 0.4rem 0.7rem;
  }
  .explorer-title {
    flex: 1;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .explorer-head button {
    display: inline-flex;
    padding: 0.2rem;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--muted-fg);
    cursor: pointer;
  }
  .explorer-head button:hover {
    background: var(--button-hover-bg);
    color: var(--fg);
  }
  .explorer-tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 0.3rem 0.5rem;
  }
  .explorer-empty {
    margin: 0;
    padding: 0.2rem 0.7rem;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--muted-fg);
  }
  .open-folder {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.2rem 0.5rem;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--button-bg);
    color: var(--toolbar-fg);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .open-folder:hover {
    background: var(--button-hover-bg);
  }
</style>
