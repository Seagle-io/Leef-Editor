/**
 * Whether the rendered preview is editable. On by default — the preview is a
 * writing surface, not a read-only render — with a padlock to freeze it.
 */
import { writable } from "svelte/store";
import { effacerErreur, signalerErreur } from "./draft";

const STORAGE_KEY = "gmd-preview-editable";

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    // Storage blocked: editable, the default.
    return true;
  }
}

export const previewEditable = writable<boolean>(load());

previewEditable.subscribe((value) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch (e) {
    signalerErreur("apercu", "Enregistrement du verrou de l'aperçu impossible : réglage gardé pour cette session seulement", e);
    return;
  }
  effacerErreur("apercu");
});

export function togglePreviewEditable(): void {
  previewEditable.update((value) => !value);
}
