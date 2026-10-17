import { derived, get, type Readable } from "svelte/store";
import { activeTheme, editTheme } from "./themes/store";
import { effacerErreur, reportStorageError } from "./draft";

export type FontId = "inter" | "georgia" | "jetbrains-mono";

export interface FontOption {
  id: FontId;
  label: string;
  stack: string;
}

export const fonts: FontOption[] = [
  { id: "inter", label: "Système", stack: "var(--leef-font-ui)" },
  { id: "georgia", label: "Serif", stack: "var(--leef-font-serif)" },
  { id: "jetbrains-mono", label: "Monospace", stack: "var(--leef-font-mono)" },
];

/** Préréglage `contentFont` du thème porté par chaque police de la barre. */
const PRESET: Record<FontId, string> = { inter: "ui", georgia: "serif", "jetbrains-mono": "mono" };

/** Police de l'aperçu lue dans le thème actif (seule source) ; pile CSS libre → "custom" (aucune option de la barre). */
export const font: Readable<FontId | "custom"> = derived(activeTheme, (t) => fonts.find((f) => PRESET[f.id] === t.contentFont)?.id ?? "custom");

/** Thème intégré actif → copie « <nom> personnalisé » activée (editTheme) ; échec → alerte unique (reportStorageError), police inchangée ; réussite → alerte police effacée. */
export function setFont(id: FontId): void {
  const theme = get(activeTheme);
  if (theme.contentFont === PRESET[id]) return;
  try {
    editTheme(theme.id, { contentFont: PRESET[id] });
  } catch (e) {
    reportStorageError("Police non enregistrée", e);
    return;
  }
  effacerErreur("police");
}
