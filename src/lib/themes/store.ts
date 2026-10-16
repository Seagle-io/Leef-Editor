import { derived, writable, type Readable } from "svelte/store";
import { applyTheme, resolveScheme } from "./apply";
import { AUTO_ID, BUILTIN_THEMES, NAME_MAX, type Result, type Scheme, type Theme, type ThemeError, type ThemeFile } from "./model";
import { checkName, parseTheme, parseThemeFile } from "./validate";

interface ThemeState {
  themes: Theme[];
  activeId: string;
  scheme: Scheme;
  error: string | null;
}

const CACHE_KEY = "leef-themes-v1";
const FILE_NAME = "themes.json";
const PERSIST_DELAY_MS = 300;
const MAX_IMPORT_BYTES = 64 * 1024;
const LEGACY_THEMES = ["light", "dark", "dracula", "solarized"];
const LEGACY_FONTS: Record<string, string> = { georgia: "serif", "jetbrains-mono": "mono" };

const isTauri = "__TAURI_INTERNALS__" in window;
const builtinAuto = BUILTIN_THEMES.find((t) => t.id === AUTO_ID) as Theme;

function userThemes(s: ThemeState): Theme[] {
  return s.themes.filter((t) => !t.builtin);
}

function toFile(s: ThemeState): string {
  const file: ThemeFile = { version: 1, active: s.activeId, themes: userThemes(s) };
  return JSON.stringify(file);
}

function fromFile(file: ThemeFile, error: string | null): ThemeState {
  const themes = [...BUILTIN_THEMES, ...file.themes];
  const activeId = themes.some((t) => t.id === file.active) ? file.active : AUTO_ID;
  return { themes, activeId, scheme: "light", error };
}

function show(s: ThemeState): ThemeState {
  const active = s.themes.find((t) => t.id === s.activeId) ?? builtinAuto;
  return { ...s, scheme: applyTheme(active, document.documentElement) };
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name} : ${e.message}` : String(e);
}

/** Lecture synchrone du cache ; stockage indisponible (SecurityError…) → `storageOk` faux, mémoire seule. */
function readCache(): string | null {
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch (e) {
    storageOk = false;
    startError = `Stockage local indisponible (${errorText(e)}) : thème par défaut, réglages non conservés.`;
    return null;
  }
}

function loadCache(cached: string | null): ThemeState {
  if (cached === null) return fromFile({ version: 1, active: AUTO_ID, themes: [] }, startError);
  const parsed = parseThemeFile(cached);
  if (parsed.ok) return fromFile(parsed.value, null);
  return fromFile({ version: 1, active: AUTO_ID, themes: [] }, `Réglages de thème illisibles (${parsed.error.message}) : thème par défaut.`);
}

let storageOk = true;
let startError: string | null = null;
/** Dernier cache lu ou écrit par cet onglet : différent du stockage = écrit par un autre onglet. */
let lastSync = readCache();
let current = show(loadCache(lastSync));
const state = writable<ThemeState>(current);
let fileReady = !isTauri;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function setError(message: string | null): void {
  current = { ...current, error: message };
  state.set(current);
}

async function writeFile(): Promise<void> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppConfig;
    if (!(await fs.exists("", { baseDir }))) await fs.mkdir("", { baseDir, recursive: true });
    await fs.writeTextFile(FILE_NAME, toFile(current), { baseDir });
  } catch (e) {
    setError(`Écriture du fichier de thèmes impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}

function schedulePersist(): void {
  if (!isTauri || !fileReady) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void writeFile(), PERSIST_DELAY_MS);
}

/** Écrit le cache ; échec (QuotaExceededError…) → Result io. Stockage indisponible → mémoire seule. */
function writeCache(s: ThemeState): Result<void, ThemeError> {
  if (!storageOk) return { ok: true, value: undefined };
  const file = toFile(s);
  try {
    localStorage.setItem(CACHE_KEY, file);
  } catch (e) {
    return fail("io", `Enregistrement des thèmes impossible (${errorText(e)}) : modification annulée.`);
  }
  lastSync = file;
  return { ok: true, value: undefined };
}

/** Le stockage d'abord : en cas d'échec, mémoire et page restent celles du cache. */
function commit(next: ThemeState): Result<void, ThemeError> {
  const written = writeCache(next);
  if (!written.ok) return written;
  current = show(next);
  state.set(current);
  schedulePersist();
  return written;
}

/** Adopte le cache écrit par un autre onglet ; illisible → ignoré, la prochaine écriture le remplace. */
function sync(): void {
  if (!storageOk) return;
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached === null || cached === lastSync) return;
  lastSync = cached;
  const parsed = parseThemeFile(cached);
  if (!parsed.ok) return;
  current = show(fromFile(parsed.value, current.error));
  state.set(current);
}

async function loadFile(): Promise<void> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppConfig;
    if (!(await fs.exists(FILE_NAME, { baseDir }))) {
      fileReady = true;
      await writeFile();
      return;
    }
    const parsed = parseThemeFile(await fs.readTextFile(FILE_NAME, { baseDir }));
    fileReady = true;
    if (parsed.ok) {
      if (toFile(fromFile(parsed.value, null)) !== toFile(current)) {
        current = show(fromFile(parsed.value, current.error));
        state.set(current);
        const cached = writeCache(current);
        if (!cached.ok) setError(cached.error.message);
      }
      return;
    }
    const moved = `${FILE_NAME}.corrompu-${Date.now()}`;
    await fs.rename(FILE_NAME, moved, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
    setError(`Fichier de thèmes corrompu (${parsed.error.message}) : conservé sous ${moved}.`);
  } catch (e) {
    fileReady = true;
    setError(`Lecture du fichier de thèmes impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}

function find(id: string): Theme {
  const theme = current.themes.find((t) => t.id === id);
  if (!theme) throw new Error(`Thème introuvable : ${id}`);
  return theme;
}

function nameTaken(name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  return current.themes.some((t) => t.id !== exceptId && t.name.toLowerCase() === key);
}

/** `base` si libre, sinon `base 2`, `base 3`… ; le nom est tronqué pour tenir en 60 caractères. */
function uniqueName(base: string): string {
  const fit = (suffix: string): string => `${[...base.trim()].slice(0, NAME_MAX - [...suffix].length).join("")}${suffix}`;
  let name = fit("");
  for (let n = 2; nameTaken(name); n++) name = fit(` ${n}`);
  return name;
}

function newId(): string {
  let id: string;
  do {
    id = `user-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  } while (current.themes.some((t) => t.id === id));
  return id;
}

function fail(code: ThemeError["code"], message: string): Result<never, ThemeError> {
  return { ok: false, error: { code, message } };
}

export const themeState: Readable<ThemeState> = { subscribe: state.subscribe };
export const activeTheme: Readable<Theme> = derived(state, (s) => s.themes.find((t) => t.id === s.activeId) ?? builtinAuto);
export const scheme: Readable<Scheme> = derived(state, (s) => s.scheme);

export function selectTheme(id: string): Result<void, ThemeError> {
  sync();
  find(id);
  return commit({ ...current, activeId: id });
}

function commitOrThrow(next: ThemeState): void {
  const written = commit(next);
  if (!written.ok) throw new Error(written.error.message);
}

export function editTheme(id: string, patch: Partial<Omit<Theme, "id" | "builtin" | "version">>): string {
  sync();
  const source = find(id);
  const parsed = parseTheme({ ...source, ...patch });
  if (!parsed.ok) throw new Error(parsed.error.message);
  if (source.builtin) {
    const copy: Theme = { ...parsed.value, id: newId(), builtin: false, name: uniqueName(patch.name ?? `${source.name} personnalisé`) };
    commitOrThrow({ ...current, themes: [...current.themes, copy], activeId: copy.id });
    return copy.id;
  }
  if (nameTaken(parsed.value.name, id)) throw new Error("Un thème porte déjà ce nom.");
  const edited: Theme = { ...parsed.value, id, builtin: false };
  commitOrThrow({ ...current, themes: current.themes.map((t) => (t.id === id ? edited : t)) });
  return id;
}

export function duplicateTheme(id: string): string {
  sync();
  const source = find(id);
  const copy: Theme = { ...structuredClone(source), id: newId(), builtin: false, name: uniqueName(`${source.name} copie`) };
  commitOrThrow({ ...current, themes: [...current.themes, copy] });
  return copy.id;
}

export function renameTheme(id: string, name: string): Result<void, ThemeError> {
  sync();
  const source = current.themes.find((t) => t.id === id);
  if (!source) return fail("not-found", `Thème introuvable : ${id}`);
  if (source.builtin) return fail("builtin", "Un thème intégré ne se renomme pas.");
  const bad = checkName(name);
  if (bad) return { ok: false, error: bad };
  if (nameTaken(name, id)) return fail("name-taken", "Un thème porte déjà ce nom.");
  return commit({ ...current, themes: current.themes.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)) });
}

export function deleteTheme(id: string): Result<void, ThemeError> {
  sync();
  const source = current.themes.find((t) => t.id === id);
  if (!source) return fail("not-found", `Thème introuvable : ${id}`);
  if (source.builtin) return fail("builtin", "Un thème intégré ne se supprime pas.");
  return commit({
    ...current,
    themes: current.themes.filter((t) => t.id !== id),
    activeId: current.activeId === id ? AUTO_ID : current.activeId,
  });
}

export function exportTheme(id: string): string {
  const { id: _id, builtin: _builtin, ...theme } = find(id);
  return JSON.stringify({ format: "leef-theme", version: 1, theme }, null, 2);
}

export function importTheme(json: string): Result<string, ThemeError> {
  if (json.length > MAX_IMPORT_BYTES || new TextEncoder().encode(json).length > MAX_IMPORT_BYTES) {
    return fail("too-large", "Fichier de thème trop volumineux (64 Kio maximum).");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return fail("invalid-json", `JSON invalide : ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== "leef-theme") {
    return { ok: false, error: { code: "invalid-field", field: "format", message: "Ce fichier n'est pas un thème Leef (format « leef-theme » attendu)." } };
  }
  const parsed = parseTheme((raw as { theme?: unknown }).theme);
  if (!parsed.ok) return parsed;
  sync();
  const theme: Theme = { ...parsed.value, id: newId(), builtin: false, name: uniqueName(parsed.value.name) };
  const written = commit({ ...current, themes: [...current.themes, theme] });
  return written.ok ? { ok: true, value: theme.id } : written;
}

function migrateLegacy(): void {
  const legacy = localStorage.getItem("gmd-theme");
  const id = legacy !== null && LEGACY_THEMES.includes(legacy) ? `leef-${legacy}` : AUTO_ID;
  const written = commit({ ...current, activeId: id });
  // Cache non écrit : gmd-* gardées, la migration se rejoue au prochain démarrage.
  if (!written.ok) {
    setError(written.error.message);
    return;
  }
  const font = localStorage.getItem("gmd-font");
  if (font !== null && Object.hasOwn(LEGACY_FONTS, font)) {
    try {
      editTheme(id, { contentFont: LEGACY_FONTS[font] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
  }
  localStorage.removeItem("gmd-theme");
  localStorage.removeItem("gmd-font");
}

if (storageOk && lastSync === null) migrateLegacy();
window.addEventListener("storage", (e) => {
  if (e.key === CACHE_KEY) sync();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const next = resolveScheme((current.themes.find((t) => t.id === current.activeId) ?? builtinAuto).base);
  if (next !== current.scheme) {
    current = { ...current, scheme: next };
    state.set(current);
  }
});
if (isTauri) void loadFile();
