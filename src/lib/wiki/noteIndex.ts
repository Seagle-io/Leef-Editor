import { fuzzyFilter } from "../fuzzy";
import { noteKey, scanHeadings, scanWikiRefs, NOTE_FILE, type WikiRef } from "./parse";

export interface NoteFile {
  path: string;
  rel: string;
  content: string;
}

export interface NoteEntry extends NoteFile {
  key: string;
  headings: string[];
  refs: WikiRef[];
}

export interface Backlink {
  source: string;
  rel: string;
  ref: WikiRef;
  context: string;
}

export interface Suggestion {
  insert: string;
  label: string;
  detail: string;
}

const CONTEXT_MAX = 160;
const collator = new Intl.Collator("fr");

const compareText = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel: string): string => rel.slice(0, rel.lastIndexOf("/") + 1);
const depth = (rel: string): number => rel.split("/").length;

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function drop(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}

export class NoteIndex {
  private entries = new Map<string, NoteEntry>();
  private byKey = new Map<string, Set<string>>();
  private incoming = new Map<string, Set<string>>();
  private refsByKey = new Map<string, Set<string>>();
  private outgoing = new Map<string, Set<string>>();
  private refKeys = new Map<string, Set<string>>();

  static build(files: NoteFile[]): NoteIndex {
    const index = new NoteIndex();
    const last = new Map(files.map((f) => [f.path, f]));
    for (const f of last.values()) index.attach(f);
    for (const path of last.keys()) index.relink(path);
    return index;
  }

  upsert(f: NoteFile): void {
    const old = this.detach(f.path);
    const entry = this.attach(f);
    this.relink(f.path);
    this.relinkKeys(old ? [old.key, entry.key] : [entry.key]);
  }

  remove(path: string): void {
    const old = this.detach(path);
    if (old) this.relinkKeys([old.key]);
  }

  move(from: string, to: string, toRel: string): void {
    const old = this.entries.get(from);
    if (!old) throw new Error(`Note inconnue : ${from}`);
    this.remove(from);
    this.upsert({ path: to, rel: toRel, content: old.content });
  }

  get(path: string): NoteEntry | undefined {
    return this.entries.get(path);
  }

  all(): NoteEntry[] {
    return [...this.entries.values()].sort((a, b) => compareText(a.rel, b.rel) || compareText(a.path, b.path));
  }

  resolve(target: string, fromPath: string | null): string | null {
    const t = noteKey(target);
    if (t === "") return fromPath;
    const paths = this.byKey.get(t.slice(t.lastIndexOf("/") + 1));
    if (!paths) return null;
    // D7 : un « / » initial part de la racine du dossier ([[/A]] vise A.md, jamais d1/A.md).
    const root = t.startsWith("/");
    const found: NoteEntry[] = [];
    for (const p of paths) {
      const e = this.entries.get(p);
      const rel = e ? noteKey(e.rel) : "";
      if (e && (root ? rel === t.slice(1) : !t.includes("/") || rel === t || rel.endsWith(`/${t}`))) found.push(e);
    }
    if (found.length === 0) return null;
    const home = fromPath === null ? undefined : this.entries.get(fromPath);
    const homeDir = home ? dirOf(home.rel) : null;
    const near = (e: NoteEntry): number => (homeDir !== null && dirOf(e.rel) === homeDir ? 0 : 1);
    found.sort((a, b) => near(a) - near(b) || depth(a.rel) - depth(b.rel) || compareText(a.rel, b.rel));
    return found[0].path;
  }

  backlinks(path: string): Backlink[] {
    const out: Backlink[] = [];
    for (const source of this.incoming.get(path) ?? []) {
      const e = this.entries.get(source);
      if (!e || source === path) continue;
      // Une ligne lue une fois, même si elle porte 20 000 refs : relue par ref, c'était quadratique.
      const contexts = new Map<number, string>();
      for (const ref of e.refs) {
        if (this.resolve(ref.target, source) === path) {
          let context = contexts.get(ref.line);
          if (context === undefined) {
            context = lineAround(e.content, ref);
            contexts.set(ref.line, context);
          }
          out.push({ source, rel: e.rel, ref, context });
        }
      }
    }
    return out.sort((a, b) => compareText(a.rel, b.rel) || a.ref.line - b.ref.line || a.ref.from - b.ref.from);
  }

  suggest(query: string, limit = 20): Suggestion[] {
    return fuzzyFilter(this.all(), query, (e) => e.rel, limit).map(({ item }) => {
      const name = baseName(item.rel).replace(NOTE_FILE, "");
      const unique = this.byKey.get(item.key)?.size === 1;
      return { insert: unique ? name : item.rel.replace(NOTE_FILE, ""), label: name, detail: item.rel };
    });
  }

  headings(path: string): string[] {
    return this.entries.get(path)?.headings ?? [];
  }

  private attach(f: NoteFile): NoteEntry {
    const entry: NoteEntry = {
      ...f,
      key: noteKey(baseName(f.rel)),
      headings: scanHeadings(f.content),
      refs: scanWikiRefs(f.content),
    };
    this.entries.set(f.path, entry);
    add(this.byKey, entry.key, f.path);
    const keys = new Set<string>();
    for (const ref of entry.refs) {
      const k = noteKey(ref.target);
      const last = k.slice(k.lastIndexOf("/") + 1);
      if (last !== "") keys.add(last);
    }
    for (const k of keys) add(this.refsByKey, k, f.path);
    this.refKeys.set(f.path, keys);
    return entry;
  }

  private detach(path: string): NoteEntry | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.entries.delete(path);
    drop(this.byKey, entry.key, path);
    for (const k of this.refKeys.get(path) ?? []) drop(this.refsByKey, k, path);
    this.refKeys.delete(path);
    for (const t of this.outgoing.get(path) ?? []) drop(this.incoming, t, path);
    this.outgoing.delete(path);
    return entry;
  }

  private relink(source: string): void {
    const entry = this.entries.get(source);
    const next = new Set<string>();
    for (const ref of entry?.refs ?? []) {
      const t = this.resolve(ref.target, source);
      if (t !== null) next.add(t);
    }
    const old = this.outgoing.get(source) ?? new Set<string>();
    for (const t of old) if (!next.has(t)) drop(this.incoming, t, source);
    for (const t of next) if (!old.has(t)) add(this.incoming, t, source);
    if (next.size > 0) this.outgoing.set(source, next);
    else this.outgoing.delete(source);
  }

  private relinkKeys(keys: string[]): void {
    for (const k of keys) for (const source of this.refsByKey.get(k) ?? []) this.relink(source);
  }
}

function lineAround(content: string, ref: WikiRef): string {
  const start = content.lastIndexOf("\n", ref.from - 1) + 1;
  const end = content.indexOf("\n", ref.to);
  const line = content.slice(start, end === -1 ? content.length : end).trim();
  return line.length > CONTEXT_MAX ? [...line].slice(0, CONTEXT_MAX).join("") : line;
}
