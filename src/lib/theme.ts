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

/** Provisoire jusqu'à L04/L13 : les thèmes à palette propre se replient sur clair/sombre. */
const DATA_THEME: Record<ThemeId, "light" | "dark"> = {
  light: "light",
  dark: "dark",
  dracula: "dark",
  solarized: "light",
};

export function dataThemeOf(id: ThemeId): "light" | "dark" {
  return DATA_THEME[id];
}

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && (THEME_IDS as string[]).includes(value);
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked: no saved theme, fall back to the system scheme.
    return null;
  }
}

function initialTheme(): ThemeId {
  const stored = readStored();
  if (isThemeId(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const theme = writable<ThemeId>(initialTheme());

// gmd-theme is only read: the themes store migrates it (absent → leef-auto), so writing it here would pick the theme on first launch.
theme.subscribe((value) => {
  document.documentElement.dataset.theme = dataThemeOf(value);
});

export function setTheme(id: ThemeId): void {
  theme.set(id);
}
