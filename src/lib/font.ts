import { derived, get, type Readable } from "svelte/store";
import { activeTheme, editTheme } from "./themes/store";

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

/** Préréglage `contentFont` du thème porté par chaque police de la barre. */
const PRESET: Record<FontId, string> = { inter: "ui", georgia: "serif", "jetbrains-mono": "mono" };

/** Police de l'aperçu lue dans le thème actif (seule source) ; pile CSS libre → Inter. */
export const font: Readable<FontId> = derived(activeTheme, (t) => fonts.find((f) => PRESET[f.id] === t.contentFont)?.id ?? "inter");

/** Thème intégré actif → copie « <nom> personnalisé » activée (editTheme) ; échec d'écriture → l'erreur remonte. */
export function setFont(id: FontId): void {
  const theme = get(activeTheme);
  if (theme.contentFont === PRESET[id]) return;
  editTheme(theme.id, { contentFont: PRESET[id] });
}
