import { NoteIndex } from "./noteIndex";
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
  const key = noteKey(name);
  const ambiguous = index.all().some((e) => e.path !== from && e.path !== to && e.key === key);
  const lastKey = (r: WikiRef): string => {
    const k = noteKey(r.target);
    return k.slice(k.lastIndexOf("/") + 1);
  };
  // Une ref dont le dernier segment est le nouveau nom peut basculer vers `to` après le déplacement :
  // `after` rejoue la résolution sur l'état déplacé (seules les entrées utiles à resolve, sans contenu).
  const captured = new Set(index.all().filter((e) => e.refs.some((r) => lastKey(r) === key)).map((e) => e.path));
  const after = NoteIndex.build(
    index
      .all()
      .filter((e) => e.key === key || e.path === from || captured.has(e.path))
      .map((e) => (e.path === from ? { path: to, rel: toRel, content: "" } : { path: e.path, rel: e.rel, content: "" })),
  );
  const sources = new Set([from, ...index.backlinks(from).map((b) => b.source), ...captured]);
  const files: { path: string; count: number }[] = [];
  for (const e of index.all()) {
    if (!sources.has(e.path)) continue;
    const home = e.path === from ? to : e.path;
    /** Chemin (sans ext) de la note visée aujourd'hui, si le renommage détournerait la ref ; sinon null. */
    const kept = (r: WikiRef): string | null => {
      if (lastKey(r) !== key) return null;
      const was = index.resolve(r.target, e.path);
      if (was === null || was === from || after.resolve(r.target, home) === was) return null;
      return index.get(was)?.rel.replace(NOTE_FILE, "") ?? null;
    };
    const isTarget = (r: WikiRef) => (noteKey(r.target) !== "" && index.resolve(r.target, e.path) === from) || kept(r) !== null;
    const newInner = (r: WikiRef): string => {
      const target = kept(r) ?? (noteKey(r.target).includes("/") || ambiguous ? full : name);
      return target + (r.heading === null ? "" : `#${r.heading}`) + (r.alias === null ? "" : `|${r.alias}`);
    };
    const { count } = rewriteRefs(e.content, isTarget, newInner);
    if (count > 0) files.push({ path: e.path, count });
  }
  return { files, total: files.reduce((n, f) => n + f.count, 0) };
}
