<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let value: number;
  export let min: number;
  export let max: number;
  export let label: string;
  /** Volet à droite de la poignée (inspecteur) : tirer vers la gauche l'élargit, ← aussi. */
  export let reverse = false;

  const STEP = 16;
  const STEP_LARGE = 64;
  const dispatch = createEventDispatcher<{ change: number; reset: void }>();

  let dragging = false;
  let startX = 0;
  let startValue = 0;

  function clamp(v: number): number {
    return Math.min(max, Math.max(min, Math.round(v)));
  }

  function propose(v: number): void {
    const next = clamp(v);
    if (next !== value) dispatch("change", next);
  }

  function onKeydown(e: KeyboardEvent): void {
    const step = (e.shiftKey ? STEP_LARGE : STEP) * (reverse ? -1 : 1);
    if (e.key === "ArrowRight") propose(value + step);
    else if (e.key === "ArrowLeft") propose(value - step);
    else if (e.key === "Home") propose(min);
    else if (e.key === "End") propose(max);
    else return;
    e.preventDefault();
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startValue = value;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragging) propose(startValue + (e.clientX - startX) * (reverse ? -1 : 1));
  }

  function onPointerEnd(): void {
    dragging = false;
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-no-noninteractive-element-interactions -->
<div
  class="splitter"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  on:keydown={onKeydown}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerEnd}
  on:pointercancel={onPointerEnd}
  on:dblclick={() => dispatch("reset")}
></div>

<style>
  /* Poignée de 6 px posée sur le filet ; la zone de prise fait 24 px (cible minimale). */
  .splitter {
    position: relative;
    flex: none;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }
  .splitter::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 50%;
    width: var(--leef-hairline);
    transform: translateX(-50%);
    background: var(--leef-separator);
    transition: background-color var(--leef-dur-fast) var(--leef-ease-out), width var(--leef-dur-fast) var(--leef-ease-out);
  }
  .splitter::after {
    content: "";
    position: absolute;
    inset: 0 -9px;
  }
  .splitter:hover::before,
  .splitter.dragging::before {
    width: 2px;
    background: var(--leef-accent);
  }
  .splitter:focus-visible::before {
    width: 3px;
    background: var(--leef-focus-ring);
  }
</style>
