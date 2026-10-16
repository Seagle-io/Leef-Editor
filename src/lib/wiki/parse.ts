export interface WikiTarget {
  raw: string;
  target: string;
  heading: string | null;
  alias: string | null;
}

export interface WikiRef extends WikiTarget {
  from: number;
  to: number;
  line: number;
}

export const NOTE_FILE = /\.(md|markdown)$/i;

const INNER_MAX = 512;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;
const BLANK = /^[ \t\r]*$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+([^\n]*))?$/;
const HEADING_CLOSE = /(?:^|[ \t]+)#+[ \t]*$/;
const TOKEN = /[`\\[]/g;
const LINE_START = /^([ \t]*)(?:([-+*]|\d{1,9}[.)])([ \t]+|$))?/;

export function noteKey(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/\\/g, "/")
    .trim()
    .replace(/^(\.\/)+/, "")
    .replace(NOTE_FILE, "")
    .trim();
}

export function parseWikiInner(inner: string): WikiTarget | null {
  if (inner.length > INNER_MAX || /[\n[\]]/.test(inner)) return null;
  const text = inner.trim();
  if (text === "") return null;
  const bar = text.indexOf("|");
  // Dans un tableau GFM, le séparateur d'alias s'écrit "\|".
  const head = bar === -1 ? text : text.slice(0, text[bar - 1] === "\\" ? bar - 1 : bar);
  const hash = head.indexOf("#");
  const target = (hash === -1 ? head : head.slice(0, hash)).trim().replace(NOTE_FILE, "");
  const heading = hash === -1 ? "" : head.slice(hash + 1).trim();
  const alias = bar === -1 ? "" : text.slice(bar + 1).trim();
  if (target === "" && heading === "") return null;
  return { raw: inner, target, heading: heading || null, alias: alias || null };
}

interface Line {
  text: string;
  start: number;
  fenced: boolean;
}

function* lines(content: string): Generator<Line> {
  let fence: { char: string; size: number } | null = null;
  let start = 0;
  while (start <= content.length) {
    let end = content.indexOf("\n", start);
    if (end === -1) end = content.length;
    const text = content.slice(start, end);
    let fenced = false;
    if (fence) {
      fenced = true;
      const close = FENCE_CLOSE.exec(text);
      if (close && close[1][0] === fence.char && close[1].length >= fence.size) fence = null;
    } else {
      const open = FENCE_OPEN.exec(text);
      if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
        fence = { char: open[1][0], size: open[1].length };
        fenced = true;
      }
    }
    yield { text, start, fenced };
    start = end + 1;
  }
}

/** Colonne atteinte après `s` depuis `col` (tabulation : multiple de 4 suivant). */
function column(s: string, col = 0): number {
  for (const ch of s) col = ch === "\t" ? col + 4 - (col % 4) : col + 1;
  return col;
}

/** Liens d'un bloc de paragraphe hors fences : saute code inline et échappements. */
function scanBlock(s: string, offset: number, lineAt: (pos: number) => number, out: WikiRef[]): void {
  const noCloser = new Set<number>();
  let closeAt = -2;
  let i = 0;
  while (i < s.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (!m) return;
    i = m.index;
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === "`") {
      let j = i;
      while (s[j] === "`") j++;
      const size = j - i;
      let end = -1;
      if (!noCloser.has(size)) {
        for (let k = j; end === -1; ) {
          const p = s.indexOf("`", k);
          if (p === -1) {
            noCloser.add(size);
            break;
          }
          let q = p;
          while (s[q] === "`") q++;
          if (q - p === size) end = q;
          k = q;
        }
      }
      i = end === -1 ? j : end;
    } else if (s[i + 1] !== "[") {
      i += 1;
    } else if (s[i - 1] === "!") {
      i += 2;
    } else {
      if (closeAt < i + 2) closeAt = s.indexOf("]]", i + 2);
      if (closeAt === -1) return;
      const target = parseWikiInner(s.slice(i + 2, closeAt));
      if (target) {
        out.push({ ...target, from: offset + i, to: offset + closeAt + 2, line: lineAt(offset + i) });
        i = closeAt + 2;
      } else {
        i += 1;
      }
    }
  }
}

export function scanWikiRefs(content: string): WikiRef[] {
  const starts: number[] = [];
  const blocks: { from: number; to: number }[] = [];
  let block: { from: number; to: number } | null = null;
  const items: number[] = []; // retrait du contenu des items de liste ouverts
  for (const line of lines(content)) {
    starts.push(line.start);
    if (line.fenced || BLANK.test(line.text)) {
      block = null;
      continue;
    }
    const m = LINE_START.exec(line.text);
    const lead = m?.[1] ?? "";
    const indent = column(lead);
    if (!block || m?.[2] !== undefined) while (items.length > 0 && indent < items[items.length - 1]) items.pop();
    const base = items.length > 0 ? items[items.length - 1] : 0;
    if (indent >= base + 4) {
      if (!block) continue; // bloc de code indenté (§1.1) : ne coupe pas un paragraphe
    } else if (m?.[2] !== undefined) {
      const marker = column(lead + m[2]);
      const gap = column(m[3], marker) - marker;
      items.push(gap === 0 || gap > 4 ? marker + 1 : marker + gap);
    }
    if (block) {
      block.to = line.start + line.text.length;
    } else {
      block = { from: line.start, to: line.start + line.text.length };
      blocks.push(block);
    }
  }
  const lineAt = (pos: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out: WikiRef[] = [];
  for (const b of blocks) scanBlock(content.slice(b.from, b.to), b.from, lineAt, out);
  return out;
}

export function scanHeadings(content: string): string[] {
  const out: string[] = [];
  for (const line of lines(content)) {
    if (line.fenced) continue;
    const m = HEADING.exec(line.text);
    const title = (m?.[1] ?? "").replace(HEADING_CLOSE, "").trim();
    if (title !== "") out.push(title);
  }
  return out;
}

export function wikiDisplay(t: WikiTarget): string {
  return t.alias ?? (t.heading ? (t.target ? `${t.target} › ${t.heading}` : t.heading) : t.target);
}

export function wikiFromEdited(raw: string, visible: string): string {
  const t = parseWikiInner(raw);
  if (visible === "" || t === null || visible === wikiDisplay(t)) return raw;
  const head = `${t.target}${t.heading ? `#${t.heading}` : ""}|`;
  // L'inner refuse \n, [, ] et plus de INNER_MAX unités : texte visible assaini, sinon le lien serait perdu.
  let alias = visible.replace(/\r?\n|\r/g, " ").replace(/[[\]]/g, "");
  let end = Math.max(0, INNER_MAX - head.length);
  if (alias.length > end && end > 0 && /[\ud800-\udbff]/.test(alias[end - 1])) end--;
  alias = alias.slice(0, end);
  return alias.trim() === "" ? raw : head + alias;
}
