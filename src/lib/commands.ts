/**
 * The single command registry: the palette, the toolbar and the keyboard
 * shortcuts all read the same list, so a command is declared once.
 */
import { get, writable, type Readable } from "svelte/store";
import type { IconName } from "./icons";

export type CommandGroup = "Fichier" | "Édition" | "Insertion" | "Affichage" | "Thème" | "Dossier" | "Note" | "Export";

export interface Shortcut {
  keys: string; // CodeMirror syntax, "Mod-Shift-s"
  scope: "global" | "editor"; // editor = display only
}

export interface AppCommand {
  id: string;
  title: string;
  group: CommandGroup;
  keywords?: string;
  shortcut?: Shortcut;
  icon?: IconName;
  enabled: () => boolean;
  run: () => void | Promise<void>;
}

const RECENT_KEY = "leef-recent-commands";
const RECENT_MAX = 8;

/** Shortcuts decided by the human (D2): only these ids may use these keys. */
export const reservedShortcuts: Readonly<Record<string, string>> = {
  "palette.open": "Mod-k",
  "insert.link": "Mod-Shift-k",
  "folder.search": "Mod-Alt-f",
};

const list = writable<AppCommand[]>([]);
export const commands: Readable<AppCommand[]> = { subscribe: list.subscribe };

const storageError = writable<string | null>(null);
/** Last storage failure (blocked, full, corrupt): recent commands then live in memory for this session. */
export const recentStorageError: Readable<string | null> = { subscribe: storageError.subscribe };

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string").slice(0, RECENT_MAX);
  } catch (e) {
    storageError.set(`Commandes récentes illisibles : ${reason(e)}`);
    return [];
  }
}

const recent = writable<string[]>(loadRecent());
export const recentCommands: Readable<string[]> = { subscribe: recent.subscribe };

let writeFailed = false;
recent.subscribe((value) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(value));
    // A successful write clears a write failure only: an unreadable list stays reported (its content is lost).
    if (writeFailed) storageError.set(null);
    writeFailed = false;
  } catch (e) {
    writeFailed = true;
    storageError.set(`Commandes récentes non enregistrées : ${reason(e)}`);
  }
});

export function getCommand(id: string): AppCommand | undefined {
  return get(list).find((command) => command.id === id);
}

/** The chord as matchShortcut reads it: Mod, Shift, Alt as a set, key case-insensitive. */
function chord(keys: string): string {
  const parts = keys.split("-");
  const key = (parts.pop() ?? "").toLowerCase();
  return [...["Mod", "Shift", "Alt"].filter((part) => parts.includes(part)), key].join("-");
}

export function registerCommands(added: AppCommand[]): () => void {
  const known = new Set(get(list).map((command) => command.id));
  for (const command of added) {
    if (known.has(command.id)) throw new Error(`Commande en double : ${command.id}`);
    known.add(command.id);
    const keys = command.shortcut === undefined ? undefined : chord(command.shortcut.keys);
    const owner = Object.keys(reservedShortcuts).find((id) => chord(reservedShortcuts[id]) === keys);
    if (owner !== undefined && owner !== command.id) throw new Error(`Raccourci réservé : ${command.shortcut?.keys}`);
  }
  list.update((current) => [...current, ...added]);
  const mine = new Set(added);
  let done = false;
  // Acts once: called again after the same objects were re-registered, it must not remove them.
  return () => {
    if (done) return;
    done = true;
    list.update((current) => current.filter((command) => !mine.has(command)));
  };
}

export async function runCommand(id: string): Promise<boolean> {
  const command = getCommand(id);
  if (!command || !command.enabled()) return false;
  await command.run();
  recent.update((current) => [id, ...current.filter((other) => other !== id)].slice(0, RECENT_MAX));
  return true;
}

function isMac(): boolean {
  return /Mac/.test(navigator.platform);
}

export function matchShortcut(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split("-");
  const key = parts.pop() ?? "";
  if (key === "") return false;
  const wantMod = parts.includes("Mod");
  const mac = isMac();
  if ((mac ? e.metaKey : e.ctrlKey) !== wantMod) return false;
  if ((mac ? e.ctrlKey : e.metaKey) !== false) return false;
  if (e.shiftKey !== parts.includes("Shift") || e.altKey !== parts.includes("Alt")) return false;
  // A single letter also matches on e.code when e.key is no ASCII letter: Alt rewrites it on macOS ("ƒ" for Alt-f),
  // non-Latin layouts give "ы" for Ctrl+S. An ASCII letter is trusted: e.code is the physical QWERTY key (AZERTY Mod-z is code KeyW).
  // With Alt off macOS, a printable non-letter is what Windows AltGr (Ctrl+Alt) types, "[" for Hungarian AltGr+F: never a shortcut.
  // macOS has no AltGr: ⌘⌥F stays Mod-Alt-f whatever ⌥F types ("[" on Apple Hungarian).
  const fallback = e.altKey && !mac ?!/^\P{L}$/u.test(e.key) : !/^[a-z]$/i.test(e.key);
  return e.key.toLowerCase() === key.toLowerCase() || (fallback && key.length === 1 && e.code === `Key${key.toUpperCase()}`);
}

export function handleGlobalKeydown(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false;
  for (const command of get(list)) {
    if (command.shortcut?.scope !== "global" || !matchShortcut(e, command.shortcut.keys)) continue;
    if (!command.enabled()) continue;
    e.preventDefault();
    void runCommand(command.id);
    return true;
  }
  return false;
}

export function formatShortcut(keys: string, mac: boolean): string {
  const parts = keys.split("-");
  const key = (parts.pop() ?? "").toUpperCase();
  const symbols: Record<string, [string, string]> = {
    Mod: ["⌘", "Ctrl"],
    Shift: ["⇧", "Maj"],
    Alt: ["⌥", "Alt"],
  };
  const labels = parts.map((part) => symbols[part]?.[mac ? 0 : 1] ?? part);
  return mac ? [...labels, key].join("") : [...labels, key].join("+");
}
