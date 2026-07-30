import { writable } from "svelte/store";

export type ThemeId = "light" | "dark" | "dracula" | "solarized";

export interface ThemeOption {
  id: ThemeId;
  label: string;
}

export const themes: ThemeOption[] = [
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
  { id: "dracula", label: "Dracula" },
  { id: "solarized", label: "Solarized" },
];

const THEME_IDS = themes.map((t) => t.id);
const STORAGE_KEY = "gmd-theme";

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && (THEME_IDS as string[]).includes(value);
}

function initialTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isThemeId(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const theme = writable<ThemeId>(initialTheme());

theme.subscribe((value) => {
  document.documentElement.dataset.theme = value;
  localStorage.setItem(STORAGE_KEY, value);
});

export function setTheme(id: ThemeId): void {
  theme.set(id);
}
