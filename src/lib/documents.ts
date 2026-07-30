/**
 * Open-documents state. GMD used to hold a single `content` / `filePath` pair
 * in `App.svelte`; the tab bar needs a collection, so it lives here.
 */
import { derived, get, writable } from "svelte/store";

export interface Doc {
  id: string;
  /** Absolute path on desktop, file name in the browser, null for a new doc. */
  path: string | null;
  content: string;
  dirty: boolean;
}

let nextId = 1;

function makeId(): string {
  return `doc-${nextId++}`;
}

export function docName(doc: Doc): string {
  return doc.path?.split(/[\\/]/).pop() ?? "Sans titre";
}

export function docTitle(doc: Doc): string {
  return docName(doc).replace(/\.[^.]+$/, "");
}

export function createDoc(content = "", path: string | null = null): Doc {
  return { id: makeId(), path, content, dirty: false };
}

export const documents = writable<Doc[]>([]);
export const activeId = writable<string>("");

export const activeDoc = derived([documents, activeId], ([docs, id]) => docs.find((d) => d.id === id) ?? docs[0]);

/** Replaces the whole set — used when restoring a session at startup. */
export function setDocuments(docs: Doc[], active?: string): void {
  documents.set(docs);
  activeId.set(active && docs.some((d) => d.id === active) ? active : (docs[0]?.id ?? ""));
}

export function addDoc(doc: Doc): string {
  documents.update((docs) => [...docs, doc]);
  activeId.set(doc.id);
  return doc.id;
}

/** Focuses the tab already showing `path`, if any — no duplicate tabs. */
export function focusByPath(path: string): boolean {
  const existing = get(documents).find((d) => d.path === path);
  if (!existing) return false;
  activeId.set(existing.id);
  return true;
}

export function updateDoc(id: string, patch: Partial<Omit<Doc, "id">>): void {
  documents.update((docs) => docs.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)));
}

export function closeDoc(id: string): void {
  const docs = get(documents);
  const index = docs.findIndex((d) => d.id === id);
  if (index === -1) return;

  const remaining = docs.filter((d) => d.id !== id);
  documents.set(remaining);
  if (get(activeId) === id) {
    // Focus falls to the neighbour on the right, or the new last tab.
    activeId.set(remaining[Math.min(index, remaining.length - 1)]?.id ?? "");
  }
}

export function moveDoc(from: number, to: number): void {
  documents.update((docs) => {
    if (from === to || from < 0 || to < 0 || from >= docs.length || to >= docs.length) return docs;
    const next = [...docs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}
