/**
 * Whether the rendered preview is editable. On by default — the preview is a
 * writing surface, not a read-only render — with a padlock to freeze it.
 */
import { writable } from "svelte/store";

const STORAGE_KEY = "gmd-preview-editable";

function load(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export const previewEditable = writable<boolean>(load());

previewEditable.subscribe((value) => {
  localStorage.setItem(STORAGE_KEY, String(value));
});

export function togglePreviewEditable(): void {
  previewEditable.update((value) => !value);
}
