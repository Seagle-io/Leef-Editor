/**
 * Which panes are showing. Persisted, like the theme and the page settings, so
 * a chosen layout survives a restart.
 */
import { writable } from "svelte/store";
import { effacerErreur, signalerErreur } from "./draft";

export type PaneId = "explorer" | "editor" | "preview" | "outline";

const STORAGE_KEY = "gmd-panes";

const defaults: Record<PaneId, boolean> = {
  explorer: false,
  editor: true,
  preview: true,
  outline: true,
};

/** Lecture illisible : son message survit à l'écriture des défauts au démarrage, la première écriture demandée l'efface. */
let unreadable = false;

function load(): Record<PaneId, boolean> {
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch (e) {
    signalerErreur("volets", "Disposition des volets illisible : disposition par défaut", e);
    unreadable = true;
    return { ...defaults };
  }
  const saved = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const value = { ...defaults };
  for (const id of Object.keys(defaults) as PaneId[]) {
    const shown = Object.hasOwn(saved, id) ? saved[id] : undefined;
    if (typeof shown === "boolean") value[id] = shown;
  }
  // Same rule as togglePane: never both the editor and the preview hidden.
  if (!value.editor && !value.preview) value.editor = true;
  return value;
}

export const panes = writable<Record<PaneId, boolean>>(load());

panes.subscribe((value) => {
  const keepUnreadable = unreadable;
  unreadable = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    signalerErreur("volets", "Enregistrement de la disposition des volets impossible : disposition gardée pour cette session seulement", e);
    return;
  }
  if (!keepUnreadable) effacerErreur("volets");
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
