/**
 * Which panes are showing. Persisted, like the theme and the page settings, so
 * a chosen layout survives a restart.
 */
import { writable } from "svelte/store";

export type PaneId = "explorer" | "editor" | "preview" | "outline";

const STORAGE_KEY = "gmd-panes";

const defaults: Record<PaneId, boolean> = {
  explorer: false,
  editor: true,
  preview: true,
  outline: true,
};

function load(): Record<PaneId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Record<PaneId, boolean>>) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export const panes = writable<Record<PaneId, boolean>>(load());

panes.subscribe((value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the layout stays in memory for this session.
  }
});

export function togglePane(id: PaneId): void {
  panes.update((current) => {
    const next = { ...current, [id]: !current[id] };
    // The editor and the preview can't both be hidden — that would leave an
    // empty window with no way back other than the toolbar.
    if (!next.editor && !next.preview) return current;
    return next;
  });
}

export function showPane(id: PaneId): void {
  panes.update((current) => ({ ...current, [id]: true }));
}
