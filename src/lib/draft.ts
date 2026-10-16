import { writable, type Readable } from "svelte/store";
import { createDoc, type Doc } from "./documents";

const STORAGE_KEY = "gmd-draft";
const SESSION_KEY = "gmd-session";

interface StoredSession {
  docs: { path: string | null; content: string; dirty: boolean }[];
  activeIndex: number;
}

const lastError = writable<string | null>(null);
/** Last local storage failure outside themes (tabs, page, panes, preview): the setting then lives in memory for this session. */
export const storageError: Readable<string | null> = { subscribe: lastError.subscribe };

export function reportStorageError(action: string, e: unknown): void {
  lastError.set(`${action} (${e instanceof Error ? `${e.name} : ${e.message}` : String(e)}).`);
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
      reportStorageError("Onglets de la dernière session illisibles, session ignorée", e);
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
    reportStorageError("Enregistrement des onglets impossible : les dernières modifications ne seront pas restaurées au prochain démarrage", e);
  }
}
