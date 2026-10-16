import type { Result } from "./types";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchableNote {
  path: string;
  rel: string;
  content: string;
  headings: readonly string[];
}

/** line, column: 1-based; previewStart: 0-based offset of `preview` in its line. */
export interface SearchHit {
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
}

export interface FileResult {
  path: string;
  rel: string;
  titleMatch: boolean;
  hits: SearchHit[];
  truncated: boolean;
}

export interface SearchSummary {
  files: number;
  hits: number;
  truncated: boolean;
  aborted: boolean;
  ms: number;
}

const MIN_QUERY = 2;
const PREVIEW_MAX = 200;
const PREVIEW_LEAD = 40;
const HITS_PER_FILE = 100;
const HITS_TOTAL = 2000;
const BATCH = 50;
/** Notes longer than this are not text worth scanning. */
const MAX_CONTENT = 2_000_000;

export function compileQuery(q: string, o: SearchOptions): Result<RegExp, { code: "invalid-regex" | "too-short"; message: string }> {
  if (q.length < MIN_QUERY) return { ok: false, error: { code: "too-short", message: `Saisissez au moins ${MIN_QUERY} caractères.` } };
  const body = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body;
  try {
    return { ok: true, value: new RegExp(source, o.caseSensitive ? "gu" : "giu") };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: "invalid-regex", message: `Expression régulière invalide : ${reason}` } };
  }
}

/** Steps past an empty match by one code point: landing inside a surrogate pair sends a /u regex back to the pair start, forever. */
function skipEmpty(re: RegExp, text: string): void {
  re.lastIndex += (text.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
}

function matches(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length > 0) return true;
    skipEmpty(re, text);
  }
  return false;
}

function preview(line: string, column: number): { preview: string; previewStart: number } {
  if (line.length <= PREVIEW_MAX) return { preview: line, previewStart: 0 };
  let start = Math.max(0, column - PREVIEW_LEAD);
  // Do not start inside a surrogate pair.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(line[start])) start -= 1;
  return { preview: line.slice(start, start + PREVIEW_MAX), previewStart: start };
}

/** Scans one note; `room` caps the hits kept (global budget); truncated = a hit beyond the cap exists. */
function scan(note: SearchableNote, re: RegExp, room: number): FileResult {
  const cap = Math.min(HITS_PER_FILE, room);
  const hits: SearchHit[] = [];
  let truncated = false;
  // Same line breaks as CodeMirror 6: \r\n, \r and \n.
  const lines = note.content.split(/\r\n?|\n/);

  scanning: for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0].length === 0) {
        skipEmpty(re, line);
        continue;
      }
      if (hits.length >= cap) {
        truncated = true;
        break scanning;
      }
      hits.push({ line: i + 1, column: m.index + 1, length: m[0].length, ...preview(line, m.index) });
    }
  }

  const name = note.rel.slice(note.rel.lastIndexOf("/") + 1);
  const titleMatch = matches(re, name) || note.headings.some((h) => matches(re, h));
  return { path: note.path, rel: note.rel, titleMatch, hits, truncated };
}

export async function searchNotes(
  notes: readonly SearchableNote[],
  re: RegExp,
  onBatch: (b: FileResult[]) => void,
  signal: AbortSignal,
): Promise<SearchSummary> {
  const started = performance.now();
  const ordered = [...notes].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  let files = 0;
  let hits = 0;
  let truncated = false;
  let aborted = false;
  let batch: FileResult[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (signal.aborted) {
      aborted = true;
      break;
    }
    const note = ordered[i];
    if (note.content.length <= MAX_CONTENT && !note.content.includes("\0")) {
      // Once the budget is spent, room 0: notes are still scanned until one proves there are more than HITS_TOTAL hits.
      const result = scan(note, re, HITS_TOTAL - hits);
      if (result.hits.length > 0 || result.titleMatch) {
        batch.push(result);
        files += 1;
        hits += result.hits.length;
      }
      if (result.truncated && hits >= HITS_TOTAL) {
        truncated = true;
        break;
      }
    }
    if ((i + 1) % BATCH === 0) {
      if (batch.length > 0) onBatch(batch);
      batch = [];
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  if (batch.length > 0) onBatch(batch);

  return { files, hits, truncated, aborted, ms: performance.now() - started };
}

export interface SearchOutcome {
  results: FileResult[];
  summary: SearchSummary;
}

/** What search.worker.ts receives; a RegExp survives structured clone (source and flags). */
export interface WorkerRequest {
  re: RegExp;
  notes: readonly SearchableNote[];
}

export const INTERRUPTED = "Recherche interrompue : expression trop coûteuse";
const WORKER_TIMEOUT = 5000;
const TIMEOUT_MAX = 2 ** 31 - 1; // setTimeout's ceiling: beyond it (Infinity included) the timer fires at once

/**
 * The interface's search: searchNotes in a Web Worker, terminated on abort or after timeoutMs.
 * A catastrophic regex blocks inside exec, out of reach of any signal: only killing its thread frees the page.
 */
export function searchInWorker(
  query: RegExp,
  files: readonly SearchableNote[],
  signal: AbortSignal,
  { timeoutMs = WORKER_TIMEOUT }: { timeoutMs?: number } = {},
): Promise<SearchOutcome> {
  if (signal.aborted) return Promise.reject(new Error(INTERRUPTED));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    const interrupt = () => settle(() => reject(new Error(INTERRUPTED)));
    const delay = Number.isNaN(timeoutMs) ? WORKER_TIMEOUT : Math.min(Math.max(Math.floor(timeoutMs), 1), TIMEOUT_MAX);
    const timer = setTimeout(interrupt, delay);
    function settle(done: () => void): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", interrupt);
      worker.terminate();
      done();
    }
    signal.addEventListener("abort", interrupt, { once: true });
    worker.onmessage = (e: MessageEvent<SearchOutcome>) => settle(() => resolve(e.data));
    worker.onerror = (e: ErrorEvent) => settle(() => reject(new Error(`Recherche impossible : ${e.message}`)));
    worker.postMessage({ re: query, notes: files } satisfies WorkerRequest);
  });
}
