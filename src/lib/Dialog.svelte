<script lang="ts">
  import { answerConfirm, cancelDialog, dialogRequest, submitPrompt, validatePrompt, type DialogRequest } from "./dialog";

  let dialogEl: HTMLDialogElement | undefined;
  let inputEl: HTMLInputElement | undefined;
  let okEl: HTMLButtonElement | undefined;
  let value = "";
  let error: string | null = null;
  let origin: HTMLElement | null = null;
  let shown: DialogRequest | null = null;
  const id = "leef-dialog";

  $: open($dialogRequest);

  function open(request: DialogRequest | null): void {
    if (request === shown) return;
    const previous = shown;
    shown = request;
    if (previous && !request) restoreFocus();
    if (!request) return;
    if (!previous) origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    value = request.kind === "prompt" ? (request.options.value ?? "") : "";
    error = null;
    queueMicrotask(show);
  }

  function show(): void {
    if (!dialogEl) return;
    if (!dialogEl.open) dialogEl.showModal();
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    } else okEl?.focus();
  }

  function restoreFocus(): void {
    const target = origin;
    origin = null;
    if (target && target.isConnected) target.focus();
  }

  function onCancel(e: Event): void {
    e.preventDefault();
    cancelDialog();
  }

  function onSubmit(e: Event): void {
    e.preventDefault();
    error = submitPrompt(value);
  }

  function onInput(): void {
    if (shown?.kind === "prompt" && error !== null) error = validatePrompt(shown.options, value);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && shown?.kind === "confirm" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      answerConfirm(true);
      return;
    }
    if (e.key !== "Tab" || !dialogEl) return;
    const items = Array.from(dialogEl.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if $dialogRequest}
  {@const request = $dialogRequest}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <dialog bind:this={dialogEl} class="sheet" aria-labelledby="{id}-title" aria-describedby="{id}-body" on:cancel={onCancel} on:keydown={onKeydown}>
    {#if request.kind === "prompt"}
      <form on:submit={onSubmit}>
        <h2 id="{id}-title" class="sheet__title">{request.options.title}</h2>
        <label id="{id}-body" class="sheet__field">
          <span class="sheet__label">{request.options.label}</span>
          <input
            bind:this={inputEl}
            bind:value
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? `${id}-error` : undefined}
            on:input={onInput}
          />
        </label>
        {#if error !== null}<p id="{id}-error" class="sheet__error" role="alert">{error}</p>{/if}
        <div class="sheet__actions">
          <button type="button" class="sheet__btn" on:click={cancelDialog}>Annuler</button>
          <button type="submit" class="sheet__btn sheet__btn--primary">{request.options.okLabel ?? "OK"}</button>
        </div>
      </form>
    {:else}
      <h2 id="{id}-title" class="sheet__title">{request.options.title}</h2>
      <p id="{id}-body" class="sheet__message">{request.options.message}</p>
      <div class="sheet__actions">
        <button type="button" class="sheet__btn" on:click={cancelDialog}>{request.options.cancelLabel ?? "Annuler"}</button>
        <button
          bind:this={okEl}
          type="button"
          class="sheet__btn sheet__btn--primary"
          class:sheet__btn--danger={request.options.danger}
          on:click={() => answerConfirm(true)}
        >{request.options.okLabel}</button>
      </div>
    {/if}
  </dialog>
{/if}

<style>
  .sheet {
    width: min(420px, calc(100vw - 2 * var(--leef-space-4)));
    box-sizing: border-box;
    margin: calc(var(--leef-toolbar-h) + var(--leef-space-4)) auto auto;
    padding: var(--leef-space-5);
    border: 0;
    border-radius: var(--leef-radius-xl);
    background: var(--leef-bg-elevated);
    color: var(--leef-text);
    font: var(--leef-weight-regular) var(--leef-text-13) / var(--leef-leading-ui) var(--leef-font-ui);
    box-shadow: var(--leef-shadow-window);
    z-index: var(--leef-z-sheet);
    animation: sheet-in var(--leef-dur-slow) var(--leef-ease-spring);
  }
  .sheet::backdrop { background: var(--leef-scrim); }
  @keyframes sheet-in {
    from { opacity: 0; transform: translateY(calc(-1 * var(--leef-space-2))) scale(0.97); }
    to { opacity: 1; transform: none; }
  }
  .sheet__title {
    margin: 0 0 var(--leef-space-2);
    font-size: var(--leef-text-15);
    font-weight: var(--leef-weight-semibold);
    overflow-wrap: anywhere;
  }
  .sheet__message {
    margin: 0;
    color: var(--leef-text-secondary);
    overflow-wrap: anywhere;
  }
  .sheet__field { display: flex; flex-direction: column; gap: var(--leef-space-1); }
  .sheet__label { color: var(--leef-text-secondary); overflow-wrap: anywhere; }
  .sheet__field input {
    height: var(--leef-control-h);
    box-sizing: border-box;
    padding: 0 var(--leef-space-2);
    border: var(--leef-hairline) solid var(--leef-border-control);
    border-radius: var(--leef-radius-sm);
    background: var(--leef-bg-content);
    color: var(--leef-text);
    font: inherit;
    outline: 0;
  }
  .sheet__field input::placeholder { color: var(--leef-text-tertiary); }
  .sheet__field input:focus-visible { border-color: var(--leef-accent); box-shadow: var(--leef-shadow-focus); }
  .sheet__field input[aria-invalid="true"] { border-color: var(--leef-danger); }
  .sheet__error { margin: var(--leef-space-1) 0 0; color: var(--leef-danger); }
  .sheet__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--leef-space-2);
    margin-top: var(--leef-space-5);
  }
  .sheet__btn {
    min-height: var(--leef-control-h);
    padding: 0 var(--leef-space-3);
    border: 0;
    border-radius: var(--leef-radius-sm);
    background: var(--leef-bg-control);
    color: var(--leef-text);
    font: inherit;
    cursor: default;
    transition: background var(--leef-dur-fast) var(--leef-ease-out);
  }
  .sheet__btn:active { background: var(--leef-bg-pressed); }
  .sheet__btn:focus-visible { outline: 0; box-shadow: var(--leef-shadow-focus); }
  .sheet__btn--primary { background: var(--leef-accent-fill); color: var(--leef-text-on-accent); font-weight: var(--leef-weight-medium); }
  .sheet__btn--primary:active { filter: brightness(0.92); }
  .sheet__btn--danger { background: var(--leef-danger-bg); color: var(--leef-danger); }
</style>
