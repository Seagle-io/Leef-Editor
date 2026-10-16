/** Modèle pur de la palette ⌘K : entrée → mode, requête, lignes. */
import { formatShortcut, type AppCommand } from "./commands";
import { fuzzyFilter } from "./fuzzy";
import type { TocItem } from "./markdown";

export type PaletteMode = "commands" | "files" | "headings";

export interface PaletteFile {
  path: string;
  label: string;
  detail: string;
}

export interface PaletteRow {
  id: string;
  label: string;
  detail: string;
  shortcut: string | null;
  disabled: boolean;
  positions: number[];
}

export const PALETTE_MAX_ROWS = 50;

/** ">" commandes, "#" titres, sinon fichiers ; le préfixe n'est pas dans la requête. */
export function parsePaletteInput(input: string): { mode: PaletteMode; query: string } {
  const text = input.trimStart();
  if (text.startsWith(">")) return { mode: "commands", query: text.slice(1).trimStart() };
  if (text.startsWith("#")) return { mode: "headings", query: text.slice(1).trimStart() };
  return { mode: "files", query: input };
}

interface Candidate {
  row: PaletteRow;
  /** Texte filtré : le libellé d'abord, puis ce qui aide à retrouver la ligne. */
  text: string;
}

function ranked(candidates: Candidate[], query: string): PaletteRow[] {
  const labelLength = (c: Candidate): number => [...c.row.label].length;
  const hits = fuzzyFilter(candidates, query, (c) => c.text, candidates.length);
  return hits.map(({ item, match }) => ({
    ...item.row,
    positions: match.positions.filter((p) => p < labelLength(item)),
  }));
}

function activeFirst(rows: PaletteRow[]): PaletteRow[] {
  return [...rows.filter((r) => !r.disabled), ...rows.filter((r) => r.disabled)];
}

export interface PaletteSource {
  commands: AppCommand[];
  recent: string[];
  files: PaletteFile[];
  headings: TocItem[];
  mac: boolean;
}

export function paletteRows(mode: PaletteMode, query: string, src: PaletteSource): PaletteRow[] {
  const blank = query.replace(/\s+/gu, "") === "";
  let rows: PaletteRow[];
  if (mode === "commands") {
    const byId = new Map(src.commands.map((c) => [c.id, c]));
    const recents = blank ? src.recent.flatMap((id) => byId.get(id) ?? []) : [];
    const seen = new Set(recents.map((c) => c.id));
    const ordered = [...new Set(recents), ...src.commands.filter((c) => !seen.has(c.id))];
    const candidates: Candidate[] = ordered.map((c) => ({
      row: {
        id: c.id,
        label: c.title,
        detail: c.group,
        shortcut: c.shortcut ? formatShortcut(c.shortcut.keys, src.mac) : null,
        disabled: !c.enabled(),
        positions: [],
      },
      text: `${c.title} ${c.keywords ?? ""}`,
    }));
    rows = activeFirst(ranked(candidates, query));
  } else if (mode === "files") {
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const f of src.files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      candidates.push({
        row: { id: f.path, label: f.label, detail: f.detail, shortcut: null, disabled: false, positions: [] },
        text: `${f.label} ${f.detail}`,
      });
    }
    rows = ranked(candidates, query);
  } else {
    const candidates: Candidate[] = src.headings.map((h) => ({
      row: { id: h.id, label: h.text, detail: `Titre de niveau ${h.level}`, shortcut: null, disabled: false, positions: [] },
      text: h.text,
    }));
    rows = ranked(candidates, query);
  }
  return rows.slice(0, PALETTE_MAX_ROWS);
}

/** Sans préfixe, chaque groupe est borné (maquette T002 3 : 3 notes + 3 commandes). */
export const PALETTE_MIXED_MAX = 3;
/** Nom de note créable : borne du lien wiki (contrat §1.1). */
export const NOTE_NAME_MAX = 512;

export type PaletteEntry = { kind: "note" | "command" | "heading"; row: PaletteRow } | { kind: "create"; name: string };

export interface PaletteGroup {
  title: string;
  entries: PaletteEntry[];
}

/** Nom proposé à la création : caractères de contrôle remplacés par une espace ; null si vide ou trop long. */
function creatableName(query: string): string | null {
  const name = query.replace(/\p{Cc}+/gu, " ").replace(/\s+/gu, " ").trim();
  if (name === "" || [...name].length > NOTE_NAME_MAX) return null;
  return name;
}

/** Clé de comparaison de deux noms de note : espaces réduits, NFC, casse ignorée. */
function nameKey(name: string): string {
  return name.replace(/\s+/gu, " ").trim().normalize("NFC").toLowerCase();
}

/** Groupes affichés : ">" Commandes, "#" Titres, sinon Notes puis Commandes ; nom de note absent → entrée « créer » en fin de Notes. */
export function paletteGroups(input: string, src: PaletteSource): PaletteGroup[] {
  const { mode, query } = parsePaletteInput(input);
  const groups: PaletteGroup[] = [];
  const push = (title: string, entries: PaletteEntry[]): void => {
    if (entries.length > 0) groups.push({ title, entries });
  };
  if (mode === "commands") {
    push("Commandes", paletteRows("commands", query, src).map((row) => ({ kind: "command", row })));
  } else if (mode === "headings") {
    push("Titres", paletteRows("headings", query, src).map((row) => ({ kind: "heading", row })));
  } else {
    const notes: PaletteEntry[] = paletteRows("files", query, src)
      .slice(0, PALETTE_MIXED_MAX)
      .map((row) => ({ kind: "note", row }));
    // « Créer » dès qu'aucune note ne porte exactement ce nom, même si des notes approchantes sont listées.
    const name = creatableName(query);
    const key = name === null ? null : nameKey(name);
    const exists = key !== null && src.files.some((f) => nameKey(f.label) === key);
    push("Notes", name === null || exists ? notes : [...notes, { kind: "create", name }]);
    push("Commandes", paletteRows("commands", query, src).slice(0, PALETTE_MIXED_MAX).map((row) => ({ kind: "command", row })));
  }
  return groups;
}

/** Coupe `label` en segments, ceux qui portent une position (point de code) sont à surligner. */
export function highlightSegments(label: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  const hits = new Set(positions);
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (const ch of label) {
    const hit = hits.has(i++);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += ch;
    else out.push({ text: ch, hit });
  }
  return out;
}
