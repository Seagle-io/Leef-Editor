import { derived, writable, type Readable } from "svelte/store";
import { createDoc, type Doc } from "./documents";

const STORAGE_KEY = "gmd-draft";
const SESSION_KEY = "gmd-session";

interface StoredSession {
  docs: { path: string | null; content: string; dirty: boolean }[];
  activeIndex: number;
}

/** What a local storage failure concerns: each one keeps its own message, cleared by its next successful write. */
export type Source = "onglets" | "page" | "volets" | "apercu" | "police" | "theme";

let errors: Record<Source, string | null> = { onglets: null, page: null, volets: null, apercu: null, police: null, theme: null };
const lastErrors = writable(errors);
/** Last local storage failure of each source: the setting then lives in memory for this session. */
export const storageErrors: Readable<Record<Source, string | null>> = { subscribe: lastErrors.subscribe };

function setError(source: Source, message: string | null): void {
  if (errors[source] === message) return;
  errors = { ...errors, [source]: message };
  lastErrors.set(errors);
}

export function signalerErreur(source: Source, action: string, e: unknown): void {
  setError(source, `${action} (${e instanceof Error ? `${e.name} : ${e.message}` : String(e)}).`);
}

export function effacerErreur(source: Source): void {
  setError(source, null);
}

/** Compatibility (font.ts): the "police" source. */
export const storageError: Readable<string | null> = derived(lastErrors, (e) => e.police);

export function reportStorageError(action: string, e: unknown): void {
  signalerErreur("police", action, e);
}

/**
 * Restores the tabs that were open last time. Falls back to the single-document
 * draft written by earlier versions, so an existing draft isn't lost.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage blocked: start with no restored tabs.
    return null;
  }
}

function isStoredDoc(d: unknown): d is StoredSession["docs"][number] {
  if (typeof d !== "object" || d === null) return false;
  const { path, content, dirty } = d as Record<string, unknown>;
  return typeof content === "string" && (path === null || typeof path === "string") && typeof dirty === "boolean";
}

export function loadSession(): { docs: Doc[]; activeIndex: number } | null {
  const raw = read(SESSION_KEY);
  if (raw) {
    try {
      const session: unknown = JSON.parse(raw);
      const stored = (session as { docs?: unknown } | null)?.docs;
      if (!Array.isArray(stored) || !stored.every(isStoredDoc)) throw new TypeError("onglets mal formés");
      const docs = stored.map((d) => {
        const doc = createDoc(d.content, d.path);
        doc.dirty = d.dirty;
        return doc;
      });
      const index = (session as { activeIndex?: unknown }).activeIndex;
      const activeIndex = typeof index === "number" && Number.isInteger(index) && index >= 0 && index < docs.length ? index : 0;
      if (docs.length > 0) return { docs, activeIndex };
    } catch (e) {
      // Corrupted session: fall through to the legacy draft.
      signalerErreur("onglets", "Onglets de la dernière session illisibles, session ignorée", e);
    }
  }

  const legacy = read(STORAGE_KEY);
  return legacy === null ? null : { docs: [createDoc(legacy)], activeIndex: 0 };
}

export function saveSession(docs: Doc[], activeIndex: number): void {
  const session: StoredSession = {
    docs: docs.map(({ path, content, dirty }) => ({ path, content, dirty })),
    activeIndex,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    signalerErreur("onglets", "Enregistrement des onglets impossible : les dernières modifications ne seront pas restaurées au prochain démarrage", e);
    return;
  }
  effacerErreur("onglets");
}
