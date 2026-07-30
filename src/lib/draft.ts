import { createDoc, type Doc } from "./documents";

const STORAGE_KEY = "gmd-draft";
const SESSION_KEY = "gmd-session";

interface StoredSession {
  docs: { path: string | null; content: string; dirty: boolean }[];
  activeIndex: number;
}

/**
 * Restores the tabs that were open last time. Falls back to the single-document
 * draft written by earlier versions, so an existing draft isn't lost.
 */
export function loadSession(): { docs: Doc[]; activeIndex: number } | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      const session = JSON.parse(raw) as StoredSession;
      const docs = session.docs.map((d) => {
        const doc = createDoc(d.content, d.path);
        doc.dirty = d.dirty;
        return doc;
      });
      if (docs.length > 0) return { docs, activeIndex: session.activeIndex };
    } catch {
      // Corrupted session: fall through to the legacy draft.
    }
  }

  const legacy = localStorage.getItem(STORAGE_KEY);
  return legacy === null ? null : { docs: [createDoc(legacy)], activeIndex: 0 };
}

export function saveSession(docs: Doc[], activeIndex: number): void {
  const session: StoredSession = {
    docs: docs.map(({ path, content, dirty }) => ({ path, content, dirty })),
    activeIndex,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
