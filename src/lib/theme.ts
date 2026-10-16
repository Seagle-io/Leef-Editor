import { derived, type Readable } from "svelte/store";
import { effacerErreur, signalerErreur } from "./draft";
import { activeTheme, scheme, selectTheme } from "./themes/store";

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

/** Built-in themes the toolbar names; leef-auto and user themes follow the scheme the store applied. */
const BUILTIN_IDS: Record<string, ThemeId> = {
  "leef-light": "light",
  "leef-dark": "dark",
  "leef-dracula": "dracula",
  "leef-solarized": "solarized",
};

/** Facade of the themes store, its only source: the system scheme and the stored choice are the store's. */
export const theme: Readable<ThemeId> = derived([activeTheme, scheme], ([active, current]) =>
  Object.hasOwn(BUILTIN_IDS, active.id) ? BUILTIN_IDS[active.id] : current,
);

export function setTheme(id: ThemeId): void {
  const selected = selectTheme(`leef-${id}`);
  if (selected.ok) effacerErreur("theme");
  else signalerErreur("theme", "Thème non enregistré", selected.error.message);
}
