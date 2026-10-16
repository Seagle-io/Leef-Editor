import { NoteIndex, type NoteEntry } from "./noteIndex";
import { aliasBar, NOTE_FILE, noteKey, parseWikiInner, scanWikiRefs, type WikiRef } from "./parse";

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
  const files = renameRewrites(index, from, to, toRel).map(({ path, count }) => ({ path, count }));
  return { files, total: files.reduce((n, f) => n + f.count, 0) };
}

/** Le plan de planRename avec le contenu réécrit de chaque fichier touché : ce que le renommage écrira. */
export function renameRewrites(
  index: NoteIndex,
  from: string,
  to: string,
  toRel: string,
): { path: string; count: number; content: string }[] {
  const moved = index.get(from);
  if (!moved) throw new Error(`Note inconnue : ${from}`);
  const full = toRel.replace(NOTE_FILE, "");
  const name = full.slice(full.lastIndexOf("/") + 1);
  const key = noteKey(name);
  const ambiguous = index.all().some((e) => e.path !== from && e.path !== to && e.key === key);
  const lastKey = (r: WikiRef): string => {
    const k = noteKey(r.target);
    return k.slice(k.lastIndexOf("/") + 1);
  };
  // Une ref peut changer de cible au déplacement si elle visait `from`, si son dernier segment est le nouveau nom,
  // ou si elle part de `from` (son dossier change). `after` rejoue la résolution sur l'état déplacé
  // (seules les entrées utiles à resolve, sans contenu). Pas index.backlinks : son contexte relit la ligne
  // entière à chaque ref, quadratique sur une longue ligne.
  const targetsFrom = (e: NoteEntry, r: WikiRef): boolean => lastKey(r) === moved.key && index.resolve(r.target, e.path) === from;
  const sources = new Set(
    index
      .all()
      .filter((e) => e.path === from || e.refs.some((r) => lastKey(r) === key || targetsFrom(e, r)))
      .map((e) => e.path),
  );
  const keys = new Set([key, ...moved.refs.map(lastKey)]);
  const after = NoteIndex.build(
    index
      .all()
      .filter((e) => keys.has(e.key) || sources.has(e.path))
      .map((e) => (e.path === from ? { path: to, rel: toRel, content: "" } : { path: e.path, rel: e.rel, content: "" })),
  );
  const files: { path: string; count: number; content: string }[] = [];
  for (const e of index.all()) {
    if (!sources.has(e.path)) continue;
    const home = e.path === from ? to : e.path;
    /** Note que la ref doit viser après le déplacement, si la résolution la détournerait ; sinon null. */
    const goal = (r: WikiRef): string | null => {
      if (noteKey(r.target) === "") return null;
      const was = index.resolve(r.target, e.path);
      if (was === null || (e.path !== from && was !== from && lastKey(r) !== key)) return null;
      const want = was === from ? to : was;
      return after.resolve(r.target, home) === want ? null : want;
    };
    const newInner = (r: WikiRef): string => {
      const want = goal(r);
      if (want === null) return r.raw;
      const path = want === to ? full : (index.get(want)?.rel ?? "").replace(NOTE_FILE, "");
      const short = want === to && !noteKey(r.target).includes("/") && !ambiguous ? name : path;
      const rest = (r.heading === null ? "" : `#${r.heading}`) + (r.alias === null ? "" : `${aliasBar(r.raw)}${r.alias}`);
      // D7 : [[/chemin]] part de la racine, quand le nom ou le chemin se ferait capturer ; le nom seul, si le chemin ne s'écrit pas.
      // Chaque candidat est relu comme le lira scanWikiRefs : [[C#]] vise « C », un « ] » ou plus de 512 unités ne se lisent pas.
      const inner = [short, path, `/${path}`, name]
        .map((t) => t + rest)
        .find((s) => {
          const t = parseWikiInner(s);
          return t !== null && t.heading === r.heading && t.alias === r.alias && after.resolve(t.target, home) === want;
        });
      if (inner === undefined) {
        const rel = want === to ? toRel : (index.get(want)?.rel ?? want);
        throw new Error(`Renommage refusé : un lien vers « ${rel} » ne s'écrirait plus en [[…]] (#, [, ] ou plus de 512 caractères)`);
      }
      return inner;
    };
    const { count, content } = rewriteRefs(e.content, () => true, newInner);
    if (count > 0) files.push({ path: e.path, count, content });
  }
  return files;
}
