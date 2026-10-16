import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import admonition from "markdown-it-admonition";

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
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+([^\n]*))?$/;
const HEADING_CLOSE = /(?:^|[ \t]+)#+[ \t]*$/;
const TOKEN = /[`\\[]/g;
const EOL = /\r\n?|\n/g;

/** Mêmes règles de bloc que l'aperçu (markdown.ts) : markdown-it seul juge de ce qui est du code (D9). */
function blockParser(): MarkdownIt {
  const md = new MarkdownIt().use(footnote).use(admonition);
  // Saut de page de markdown.ts : un bloc, le code indenté qui suit reste du code.
  md.block.ruler.before("hr", "pagebreak", (state, startLine, _endLine, silent) => {
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
    if (line !== "\\pagebreak" && line !== "\\newpage") return false;
    if (!silent) state.line = startLine + 1;
    return true;
  });
  return md;
}

const md = blockParser();
// Sans phase inline, 3 fois plus rapide ; elle ne sert qu'à savoir quelles notes de bas de page sont appelées (les autres ne sont pas rendues).
const blocksOnly = blockParser();
blocksOnly.core.ruler.disable("inline");

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
  if (inner.length > INNER_MAX || /[\r\n[\]]/.test(inner)) return null;
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

/** Séparateur d'alias à ré-émettre pour ce raw : "\|" s'il était échappé (cellule de tableau GFM), sinon "|". */
export function aliasBar(raw: string): string {
  return raw[raw.indexOf("|") - 1] === "\\" ? "\\|" : "|";
}

interface Line {
  text: string;
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
    yield { text, fenced };
    start = end + 1;
  }
}

/** Liens d'un bloc de texte inline : saute code inline et échappements. */
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
  // Débuts de ligne comptés comme markdown-it (\r\n, \r ou \n), décalages dans le texte d'origine.
  const starts = [0];
  for (const m of content.matchAll(EOL)) starts.push(m.index + m[0].length);
  // Lignes de chaque jeton inline rendu ; une cellule de tableau prend celles de sa ligne.
  const blocks: [number, number][] = [];
  const maps: ([number, number] | null)[] = [];
  const env: { footnotes?: unknown } = {};
  const tokens = blocksOnly.parse(content, env);
  for (const token of env.footnotes === undefined ? tokens : md.parse(content, {})) {
    if (token.nesting === -1) maps.pop();
    const map = token.map ?? maps[maps.length - 1] ?? null;
    if (token.nesting === 1) maps.push(map);
    // markdown-it-admonition donne au titre la plage [ligne, ligne - 1].
    if (token.type === "inline" && map) blocks.push([map[0], Math.max(map[1], map[0] + 1)]);
  }
  blocks.sort((a, b) => a[0] - b[0]); // les notes de bas de page sont rendues en fin de document
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
  let done = 0;
  for (const [from, to] of blocks) {
    if (from < done) continue; // cellules d'une même ligne de tableau
    scanBlock(content.slice(starts[from], starts[to] ?? content.length), starts[from], lineAt, out);
    done = to;
  }
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
  const head = `${t.target}${t.heading ? `#${t.heading}` : ""}${aliasBar(raw)}`;
  // L'inner refuse \n, [, ] et plus de INNER_MAX unités : texte visible assaini, sinon le lien serait perdu.
  let alias = visible.replace(/\r?\n|\r/g, " ").replace(/[[\]]/g, "");
  let end = Math.max(0, INNER_MAX - head.length);
  if (alias.length > end && end > 0 && /[\ud800-\udbff]/.test(alias[end - 1])) end--;
  alias = alias.slice(0, end);
  return alias.trim() === "" ? raw : head + alias;
}
