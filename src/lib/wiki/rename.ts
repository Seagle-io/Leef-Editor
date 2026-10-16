import type { NoteIndex } from "./noteIndex";
import { NOTE_FILE, noteKey, scanWikiRefs, type WikiRef } from "./parse";

export interface RenameResult {
  renamed: boolean;
  updated: string[];
  failed: { path: string; message: string }[];
}

export function rewriteRefs(
  content: string,
  isTarget: (r: WikiRef) => boolean,
  newInner: (r: WikiRef) => string,
): { content: string; count: number } {
  let out = "";
  let pos = 0;
  let count = 0;
  for (const r of scanWikiRefs(content)) {
    if (!isTarget(r)) continue;
    const next = `[[${newInner(r)}]]`;
    if (next === content.slice(r.from, r.to)) continue;
    out += content.slice(pos, r.from) + next;
    pos = r.to;
    count++;
  }
  return { content: count === 0 ? content : out + content.slice(pos), count };
}

export function planRename(
  index: NoteIndex,
  from: string,
  to: string,
  toRel: string,
): { files: { path: string; count: number }[]; total: number } {
  if (!index.get(from)) throw new Error(`Note inconnue : ${from}`);
  const full = toRel.replace(NOTE_FILE, "");
  const name = full.slice(full.lastIndexOf("/") + 1);
  const ambiguous = index.all().some((e) => e.path !== from && e.path !== to && e.key === noteKey(name));
  const newInner = (r: WikiRef): string => {
    const target = noteKey(r.target).includes("/") || ambiguous ? full : name;
    return target + (r.heading === null ? "" : `#${r.heading}`) + (r.alias === null ? "" : `|${r.alias}`);
  };
  const sources = new Set([from, ...index.backlinks(from).map((b) => b.source)]);
  const files: { path: string; count: number }[] = [];
  for (const e of index.all()) {
    if (!sources.has(e.path)) continue;
    const isTarget = (r: WikiRef) => noteKey(r.target) !== "" && index.resolve(r.target, e.path) === from;
    const { count } = rewriteRefs(e.content, isTarget, newInner);
    if (count > 0) files.push({ path: e.path, count });
  }
  return { files, total: files.reduce((n, f) => n + f.count, 0) };
}
