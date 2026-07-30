import { writable } from "svelte/store";

export type FontId = "inter" | "georgia" | "jetbrains-mono";

export interface FontOption {
  id: FontId;
  label: string;
  stack: string;
}

export const fonts: FontOption[] = [
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
  { id: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  { id: "jetbrains-mono", label: "JetBrains Mono", stack: '"JetBrains Mono", "Fira Code", Consolas, monospace' },
];

const FONT_IDS = fonts.map((f) => f.id);
const STORAGE_KEY = "gmd-font";

function isFontId(value: string | null): value is FontId {
  return value !== null && (FONT_IDS as string[]).includes(value);
}

function initialFont(): FontId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isFontId(stored) ? stored : "inter";
}

export const font = writable<FontId>(initialFont());

font.subscribe((value) => {
  const stack = fonts.find((f) => f.id === value)?.stack ?? fonts[0].stack;
  document.documentElement.style.setProperty("--content-font", stack);
  localStorage.setItem(STORAGE_KEY, value);
});

export function setFont(id: FontId): void {
  font.set(id);
}
