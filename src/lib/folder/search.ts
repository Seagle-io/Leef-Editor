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

function matches(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length > 0) return true;
    re.lastIndex += 1;
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

/** Scans one note; `room` caps the hits kept (global budget). */
function scan(note: SearchableNote, re: RegExp, room: number): FileResult | null {
  const cap = Math.min(HITS_PER_FILE, room);
  const hits: SearchHit[] = [];
  let truncated = false;
  const lines = note.content.split("\n");

  scanning: for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
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
  return hits.length > 0 || titleMatch ? { path: note.path, rel: note.rel, titleMatch, hits, truncated } : null;
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
    if (hits >= HITS_TOTAL) {
      truncated = true;
      break;
    }
    const note = ordered[i];
    if (note.content.length <= MAX_CONTENT && !note.content.includes("\0")) {
      const result = scan(note, re, HITS_TOTAL - hits);
      if (result) {
        batch.push(result);
        files += 1;
        hits += result.hits.length;
        if (result.truncated && hits >= HITS_TOTAL) truncated = true;
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
