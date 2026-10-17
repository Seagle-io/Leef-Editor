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
// Règles inline de markdown-it 14 recopiées (autolink.mjs), maxNesting de son preset par défaut, celui de l'aperçu.
const AUTOLINK_RE = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;
const EMAIL_RE = /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
const MAX_NESTING = 100;

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

// Phase de blocs seule : la phase inline de markdown-it est quadratique sur certaines notes (T043 K1), scanInline la remplace.
// Les définitions de notes de bas de page restent en place : scanNote garde celles que l'aperçu rend.
const md = blockParser();
// normalize est refait dans scanNote, seulement s'il change le texte ; text_join ne touche que les jetons inline.
md.core.ruler.disable(["normalize", "inline", "footnote_tail", "text_join"]);

interface Env {
  references?: Record<string, unknown>;
  footnotes?: { refs?: Record<string, number> };
}

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

/** Lecture inline d'un jeton : ce que la phase inline de l'aperçu (linkify, notes, règle wikilink du contrat §1.4) y rend. */
interface Scan {
  src: string;
  env: Env;
  called: Set<string>; // libellés de notes appelés, dans l'ordre de l'aperçu
  hits: number[]; // [début, fin) de chaque lien wiki rendu, dans le src lu à ce moment
  targets: WikiTarget[];
  inNotes: boolean[]; // lien d'une note en ligne ^[…] : l'aperçu la rend toujours, même dans une définition non appelée
  lastInner: string; // dernier parseWikiInner, relu sans copie : une note cite souvent la même cible
  lastTarget: WikiTarget | null;
  budget: number;
  lastBracket: number;
  closeFrom: number;
  closeAt: number;
  stopFrom: number;
  stopAt: number;
}

/** StateInline de markdown-it sur src[start, end) : une note en ligne ou le texte d'une image est relu dans un état neuf. */
interface Inline {
  s: Scan;
  start: number;
  end: number;
  pos: number;
  max: number;
  level: number;
  linkLevel: number;
  pend: number; // texte en attente src[pend, pendEnd), où linkify cherche son schéma
  pendEnd: number;
  keep: boolean; // false dans le texte d'une image : l'aperçu n'y rend aucun lien
  inNote: boolean; // dans une note en ligne ^[…]
  cache: Int32Array | null;
  ticks: number[] | null;
  ticksScanned: boolean;
}

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09;
// Blancs de String.prototype.trim, qu'applique rules_block/table aux cellules.
const isTrimmed = (c: number): boolean => (c <= 0x20 ? c === 0x20 || (c >= 0x09 && c <= 0x0d) : c > 0x7e && /\s/.test(String.fromCharCode(c)));

function inlineState(s: Scan, start: number, end: number, keep: boolean, inNote: boolean): Inline {
  return { s, start, end, pos: start, max: end, level: 0, linkLevel: 0, pend: start, pendEnd: start, keep, inNote, cache: null, ticks: null, ticksScanned: false };
}

function tokenize(st: Inline): void {
  const end = st.max;
  while (st.pos < end) {
    st.pendEnd = st.pos;
    if (rule(st, false)) st.pend = st.pos;
    else st.pos++;
  }
}

/** Règles inline de l'aperçu, dans l'ordre de markdown-it ; celles sans effet sur les liens (texte, emphase, entités) se lisent comme du texte. */
function rule(st: Inline, silent: boolean): boolean {
  switch (st.s.src.charCodeAt(st.pos)) {
    case 0x3a:
      return linkify(st);
    case 0x5c:
      return escape(st);
    case 0x60:
      return backticks(st);
    case 0x5b:
      return wikilink(st, silent) || link(st, silent) || footnoteRef(st, silent);
    case 0x21:
      return image(st, silent);
    case 0x5e:
      return footnoteInline(st, silent);
    case 0x3c:
      return autolink(st);
    default:
      return false;
  }
}

/** inline.skipToken de markdown-it : fin du jeton qui commence ici, mémorisée par position. */
function skipToken(st: Inline): void {
  const at = st.pos - st.start;
  const cache = (st.cache ??= new Int32Array(st.end - st.start));
  if (cache[at] !== 0) {
    st.pos = st.start + cache[at] - 1;
    return;
  }
  let ok = false;
  if (st.level < MAX_NESTING) {
    st.level++;
    ok = rule(st, true);
    st.level--;
  } else {
    st.pos = st.max;
  }
  if (!ok) st.pos++;
  cache[at] = st.pos - st.start + 1;
}

/**
 * helpers.parseLinkLabel de markdown-it. Sans « ] » plus loin, pas de libellé : « [ » ou « ^[ » répétés restent linéaires.
 * Repli : budget épuisé (crochets imbriqués hostiles), plus aucun libellé, la suite se lit comme du texte.
 */
function parseLinkLabel(st: Inline, start: number, disableNested: boolean): number {
  const s = st.s;
  if (s.lastBracket <= start) return -1;
  const max = st.max;
  const oldPos = st.pos;
  let level = 1;
  let end = -1;
  st.pos = start + 1;
  while (st.pos < max && --s.budget >= 0) {
    const marker = s.src.charCodeAt(st.pos);
    if (marker === 0x5d && --level === 0) {
      end = st.pos;
      break;
    }
    const prev = st.pos;
    skipToken(st);
    if (marker === 0x5b) {
      if (prev === st.pos - 1) level++;
      else if (disableNested) break;
    }
  }
  st.pos = oldPos;
  return end;
}

/** « \ » et le caractère échappé (markdown-it saute aussi les blancs après un saut de ligne forcé : sans effet sur les liens). */
function escape(st: Inline): boolean {
  if (st.pos + 1 >= st.max) return false;
  st.pos += 2;
  return true;
}

function backticks(st: Inline): boolean {
  const src = st.s.src;
  const start = st.pos;
  const max = st.max;
  let pos = start + 1;
  while (pos < max && src.charCodeAt(pos) === 0x60) pos++;
  const size = pos - start;
  const ticks = (st.ticks ??= []);
  if (!st.ticksScanned || (ticks[size] ?? -1) > start) {
    for (let end = pos, at = src.indexOf("`", end); at !== -1 && at < st.end; at = src.indexOf("`", end)) {
      end = at + 1;
      while (end < max && src.charCodeAt(end) === 0x60) end++;
      if (end - at === size) {
        st.pos = end;
        return true;
      }
      ticks[end - at] = at;
    }
    st.ticksScanned = true;
  }
  st.pos = pos;
  return true;
}

function linkify(st: Inline): boolean {
  const src = st.s.src;
  const pos = st.pos;
  if (st.linkLevel > 0 || pos + 3 > st.max || src.charCodeAt(pos + 1) !== 0x2f || src.charCodeAt(pos + 2) !== 0x2f) return false;
  // SCHEME_RE de markdown-it sur le texte en attente
  let scheme = st.pendEnd;
  while (scheme > st.pend && /[a-z0-9.+-]/i.test(src[scheme - 1])) scheme--;
  const proto = st.pendEnd - scheme;
  if (proto === 0 || !/[a-z]/i.test(src[scheme])) return false;
  const found = md.linkify.matchAtStart(src.slice(pos - proto, st.end));
  if (found === null || found.url.length <= proto) return false;
  const url = found.url.replace(/\*+$/, "");
  if (!md.validateLink(md.normalizeLink(url))) return false;
  st.pos += url.length - proto;
  return true;
}

/** Premier « ]] » à partir de from, mémorisé : « [[ » répété ne relit pas la suite. */
function closeAt(s: Scan, from: number): number {
  if (from < s.closeFrom || (s.closeAt !== -1 && from > s.closeAt)) {
    s.closeFrom = from;
    s.closeAt = s.src.indexOf("]]", from);
  }
  return s.closeAt;
}

/** Règle wikilink du contrat §1.4, avant « link » ; refusée juste après « ! ». */
function wikilink(st: Inline, silent: boolean): boolean {
  const s = st.s;
  const pos = st.pos;
  if (s.src.charCodeAt(pos + 1) !== 0x5b || (pos > st.start && s.src.charCodeAt(pos - 1) === 0x21)) return false;
  const close = closeAt(s, pos + 2);
  if (close === -1 || close >= st.max || close - pos - 2 > INNER_MAX) return false;
  if (close - pos - 2 !== s.lastInner.length || !s.src.startsWith(s.lastInner, pos + 2)) {
    s.lastInner = s.src.slice(pos + 2, close);
    s.lastTarget = parseWikiInner(s.lastInner);
  }
  const target = s.lastTarget;
  if (target === null) return false;
  if (!silent && st.keep) {
    s.hits.push(pos, close + 2);
    s.targets.push(target);
    s.inNotes.push(st.inNote);
  }
  st.pos = close + 2;
  return true;
}

function skipBlank(src: string, pos: number, max: number): number {
  while (pos < max && (isSpace(src.charCodeAt(pos)) || src.charCodeAt(pos) === 0x0a)) pos++;
  return pos;
}

/** Lien ou image par référence ([x][ref], [x][], [x]) : position après, -1 si la référence n'est pas définie. */
function referenceEnd(st: Inline, pos: number, labelStart: number, labelEnd: number): number {
  const src = st.s.src;
  const refs = st.s.env.references;
  if (refs === undefined) return -1;
  const end = pos < st.max && src.charCodeAt(pos) === 0x5b ? parseLinkLabel(st, pos, false) : -1;
  let label = end >= 0 ? src.slice(pos + 1, end) : "";
  if (label === "") label = src.slice(labelStart, labelEnd);
  return refs[md.utils.normalizeReference(label)] ? (end >= 0 ? end + 1 : labelEnd + 1) : -1;
}

function link(st: Inline, silent: boolean): boolean {
  const src = st.s.src;
  const max = st.max;
  const labelStart = st.pos + 1;
  const labelEnd = parseLinkLabel(st, st.pos, true);
  if (labelEnd < 0) return false;
  let pos = labelEnd + 1;
  let reference = true;
  if (pos < max && src.charCodeAt(pos) === 0x28) {
    reference = false;
    pos = skipBlank(src, pos + 1, max);
    if (pos >= max) return false;
    const dest = md.helpers.parseLinkDestination(src, pos, max);
    if (dest.ok) {
      if (md.validateLink(md.normalizeLink(dest.str))) pos = dest.pos;
      const start = pos;
      pos = skipBlank(src, pos, max);
      const title = md.helpers.parseLinkTitle(src, pos, max);
      if (pos < max && start !== pos && title.ok) pos = skipBlank(src, title.pos, max);
    }
    if (pos >= max || src.charCodeAt(pos) !== 0x29) reference = true;
    pos++;
  }
  if (reference) pos = referenceEnd(st, pos, labelStart, labelEnd);
  if (pos < 0) return false;
  if (!silent) {
    // Texte du lien relu dans le même état, borné au libellé : linkify s'y tait.
    st.pos = st.pend = labelStart;
    st.max = labelEnd;
    st.level++;
    st.linkLevel++;
    tokenize(st);
    st.level--;
    st.linkLevel--;
    st.max = max;
  }
  st.pos = pos;
  return true;
}

function image(st: Inline, silent: boolean): boolean {
  const src = st.s.src;
  const max = st.max;
  if (src.charCodeAt(st.pos + 1) !== 0x5b) return false;
  const labelStart = st.pos + 2;
  const labelEnd = parseLinkLabel(st, st.pos + 1, false);
  if (labelEnd < 0) return false;
  let pos = labelEnd + 1;
  if (pos < max && src.charCodeAt(pos) === 0x28) {
    pos = skipBlank(src, pos + 1, max);
    if (pos >= max) return false;
    const dest = md.helpers.parseLinkDestination(src, pos, max);
    if (dest.ok && md.validateLink(md.normalizeLink(dest.str))) pos = dest.pos;
    const start = pos;
    pos = skipBlank(src, pos, max);
    const title = md.helpers.parseLinkTitle(src, pos, max);
    if (pos < max && start !== pos && title.ok) pos = skipBlank(src, title.pos, max);
    if (pos >= max || src.charCodeAt(pos) !== 0x29) return false;
    pos++;
  } else {
    pos = referenceEnd(st, pos, labelStart, labelEnd);
    if (pos < 0) return false;
  }
  if (!silent) tokenize(inlineState(st.s, labelStart, labelEnd, false, false));
  st.pos = pos;
  return true;
}

function footnoteInline(st: Inline, silent: boolean): boolean {
  const start = st.pos;
  if (start + 2 >= st.max || st.s.src.charCodeAt(start + 1) !== 0x5b) return false;
  const labelEnd = parseLinkLabel(st, start + 1, false);
  if (labelEnd < 0) return false;
  if (!silent) tokenize(inlineState(st.s, start + 2, labelEnd, true, true));
  st.pos = labelEnd + 1;
  return true;
}

/** Premier blanc, saut de ligne ou « ] » à partir de from (fin d'un appel [^…]), mémorisé. */
function labelStop(s: Scan, from: number): number {
  if (from < s.stopFrom || (s.stopAt !== -1 && from > s.stopAt)) {
    let pos = from;
    while (pos < s.src.length && !/[ \n\]]/.test(s.src[pos])) pos++;
    s.stopFrom = from;
    s.stopAt = pos < s.src.length ? pos : -1;
  }
  return s.stopAt;
}

function footnoteRef(st: Inline, silent: boolean): boolean {
  const s = st.s;
  const start = st.pos;
  const notes = s.env.footnotes?.refs;
  if (notes === undefined || start + 3 > st.max || s.src.charCodeAt(start + 1) !== 0x5e) return false;
  const end = labelStop(s, start + 2);
  if (end === -1 || end >= st.max || end === start + 2 || s.src.charCodeAt(end) !== 0x5d) return false;
  const label = s.src.slice(start + 2, end);
  if (notes[`:${label}`] === undefined) return false;
  if (!silent) s.called.add(label);
  st.pos = end + 1;
  return true;
}

function autolink(st: Inline): boolean {
  const src = st.s.src;
  let pos = st.pos;
  for (;;) {
    if (++pos >= st.max) return false;
    const c = src.charCodeAt(pos);
    if (c === 0x3c) return false;
    if (c === 0x3e) break;
  }
  const url = src.slice(st.pos + 1, pos);
  const href = AUTOLINK_RE.test(url) ? url : EMAIL_RE.test(url) ? `mailto:${url}` : null;
  if (href === null || !md.validateLink(md.normalizeLink(href))) return false;
  st.pos = pos + 1;
  return true;
}

/** Liens wiki que l'aperçu rend dans src, ajoutés à s.hits et s.targets ; note les appels de notes. L'état top sert à tous les jetons. */
function scanInline(top: Inline, src: string): void {
  const s = top.s;
  s.src = src;
  s.budget = 4 * src.length + 64;
  s.lastBracket = src.lastIndexOf("]");
  s.closeFrom = Infinity;
  s.stopFrom = Infinity;
  top.pos = top.pend = top.pendEnd = 0;
  top.end = top.max = src.length;
  top.cache = null;
  top.ticks = null;
  top.ticksScanned = false;
  tokenize(top);
}

/** Indice dans la ligne source d'un indice du contenu d'une cellule : chaque « | » du contenu y est « \| ». */
function cellSource(c: string, p: number): number {
  let n = p;
  for (let j = c.indexOf("|"); j !== -1 && j < p; j = c.indexOf("|", j + 1)) n++;
  return n;
}

/**
 * Titres et liens wiki d'une note tels que l'aperçu les rend : une lecture de blocs markdown-it (D9, mêmes jetons
 * heading_open que la table des matières) et une lecture inline linéaire de chaque jeton qui peut porter un lien.
 */
export function scanNote(content: string): { headings: string[]; refs: WikiRef[] } {
  const env: Env = {};
  const tokens = md.parse(/[\r\0]/.test(content) ? content.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD") : content, env);
  const notes = env.footnotes?.refs !== undefined;
  const s: Scan = { src: "", env, called: new Set(), hits: [], targets: [], inNotes: [], lastInner: "", lastTarget: null, budget: 0, lastBracket: -1, closeFrom: Infinity, closeAt: -1, stopFrom: Infinity, stopAt: -1 };
  const top = inlineState(s, 0, 0, true, false);
  // Ligne courante du texte d'origine, fins comptées comme markdown-it (\r\n, \r ou \n) : les jetons suivent l'ordre des lignes.
  let lf = content.indexOf("\n");
  let cr = content.indexOf("\r");
  const stopAt = (): number => (lf === -1 ? (cr === -1 ? content.length : cr) : cr === -1 || lf < cr ? lf : cr);
  let lineNo = 0;
  let lineStart = 0;
  let lineStop = stopAt();
  const seek = (line: number): void => {
    while (lineNo < line) {
      lineStart = lineStop + (content.charCodeAt(lineStop) === 0x0d && content.charCodeAt(lineStop + 1) === 0x0a ? 2 : 1);
      lineNo++;
      if (lf !== -1 && lf < lineStart) lf = content.indexOf("\n", lineStart);
      if (cr !== -1 && cr < lineStart) cr = content.indexOf("\r", lineStart);
      lineStop = stopAt();
    }
  };
  const blankEnd = (end: number): number => {
    while (end > lineStart && isSpace(content.charCodeAt(end - 1))) end--;
    return end;
  };
  const lineEnd = (): number => lineStop;
  const textEnd = (): number => blankEnd(lineStop);
  // Fin du titre ATX dans la ligne : sans la suite de « # » finale, comme rules_block/heading.
  const headingEnd = (): number => {
    const end = textEnd();
    let hashes = end;
    while (hashes > lineStart && content.charCodeAt(hashes - 1) === 0x23) hashes--;
    return hashes > lineStart && isSpace(content.charCodeAt(hashes - 1)) ? blankEnd(hashes) : end;
  };

  const headings: string[] = [];
  const headingDefs: number[] = [];
  const refs: WikiRef[] = [];
  const refDefs: number[] = [];
  const labels = [""]; // libellé de chaque définition de note, 0 : le corps de la note
  const last = new Map<string, number>(); // l'aperçu rend la dernière définition d'un libellé
  let def = 0;
  // Le lien est relu dans le texte d'origine (« \| » d'une cellule, NUL que markdown-it remplace par U+FFFD).
  const add = (from: number, to: number, line: number, h: number): void => {
    const read = s.targets[h >> 1];
    const same = to - from - 4 === read.raw.length && content.startsWith(read.raw, from + 2);
    const t = same ? read : parseWikiInner(content.slice(from + 2, to - 2));
    if (t === null) return;
    refs.push({ raw: t.raw, target: t.target, heading: t.heading, alias: t.alias, from, to, line });
    refDefs.push(s.inNotes[h >> 1] ? 0 : def);
  };
  // Une ligne de contenu inline finit où finit sa ligne source (marqueurs et retrait en moins au début) ; la dernière, à lastEnd.
  const inLines = (c: string, h0: number, first: number, lastEnd: () => number): void => {
    let line = first;
    let eol = c.indexOf("\n");
    for (let h = h0; h < s.hits.length; h += 2) {
      const p = s.hits[h];
      while (eol !== -1 && p > eol) {
        line++;
        eol = c.indexOf("\n", eol + 1);
      }
      seek(line);
      const from = (eol === -1 ? lastEnd() - c.length : lineStop - eol) + p;
      add(from, from + s.hits[h + 1] - p, line, h);
    }
  };

  // Cellules découpées comme escapedSplit de rules_block/table : « | » non échappé sépare, « \| » devient « | ».
  // Tableaux réutilisés d'une ligne à l'autre, remplis jusqu'à leur compteur.
  let row = 0;
  const cuts: number[] = []; // cellule k de la ligne : content[cuts[k] + 1, cuts[k + 1])
  let ncuts = 0;
  const cells: string[] = [];
  const cellHits: number[] = []; // début des liens de chaque cellule dans s.hits ; cellHits[ncells] : la fin
  let ncells = 0;
  let header = false;
  const cellEnd = (k: number): number => {
    let y = cuts[k + 1];
    while (y > cuts[k] + 1 && isTrimmed(content.charCodeAt(y - 1))) y--;
    return y;
  };
  // La cellule k donne-t-elle le contenu c ? La 1re peut porter en tête un marqueur de liste ou de citation.
  const fits = (c: string, k: number): boolean => {
    if (k + 1 >= ncuts) return c === "";
    const y = cellEnd(k);
    if (c.includes("|")) {
      const text = content.slice(cuts[k] + 1, y).replace(/\\\|/g, "|").trim();
      return k === 0 ? text.endsWith(c) : text === c;
    }
    let x = y - c.length;
    if (x < cuts[k] + 1 || !content.startsWith(c, x)) return false;
    while (k > 0 && x > cuts[k] + 1 && isTrimmed(content.charCodeAt(x - 1))) x--;
    return k === 0 || x === cuts[k] + 1;
  };
  // Les cellules (celles qui portent un lien, ou toutes) donnent-elles leur contenu avec ce décalage ?
  const rowFits = (shift: number, linked: boolean): boolean => {
    for (let i = 0; i < ncells; i++) if ((!linked || cellHits[i] < cellHits[i + 1]) && !fits(cells[i], i + shift)) return false;
    return true;
  };
  const inRow = (): void => {
    seek(row);
    let end = lineStop;
    while (end > lineStart && isTrimmed(content.charCodeAt(end - 1))) end--;
    cuts[0] = lineStart - 1;
    ncuts = 1;
    for (let p = content.indexOf("|", lineStart); p !== -1 && p < end; p = content.indexOf("|", p + 1)) if (content.charCodeAt(p - 1) !== 0x5c) cuts[ncuts++] = p;
    if (cuts[ncuts - 1] + 1 < end) cuts[ncuts++] = end; // sinon la ligne finit par « | » : pas de cellule vide en plus
    // Une ligne qui commence par « | » perd sa 1re cellule vide. Dans le corps, seuls des blancs ou les « > » d'une citation
    // précèdent ce « | » ; l'en-tête peut porter un marqueur de liste ou de note : toutes ses cellules disent où la ligne commence.
    let lead = lineStart;
    while (lead < cuts[1] && (isTrimmed(content.charCodeAt(lead)) || content.charCodeAt(lead) === 0x3e)) lead++;
    let shift = !header && lead === cuts[1] && content.charCodeAt(lead) === 0x7c ? 1 : 0;
    if (header || !rowFits(shift, true)) shift = rowFits(0, false) ? 0 : rowFits(1, false) ? 1 : -1;
    if (shift === -1) return; // libellé de note contenant « | » en tête de ligne : lien non réécrit plutôt que mal placé
    for (let i = 0; i < ncells; i++) {
      if (cellHits[i] === cellHits[i + 1]) continue;
      const c = cells[i];
      const x = cellEnd(i + shift) - cellSource(c, c.length);
      for (let h = cellHits[i]; h < cellHits[i + 1]; h += 2) add(x + cellSource(c, s.hits[h]), x + cellSource(c, s.hits[h + 1]), row, h);
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case "inline": {
        const c = token.content;
        const h0 = s.hits.length;
        if (c.includes("[[") || (notes && c.includes("[^"))) scanInline(top, c);
        const open = tokens[i - 1];
        if (open.type === "th_open" || open.type === "td_open") {
          cells[ncells] = c;
          cellHits[ncells++] = h0;
        } else if (s.hits.length > h0) {
          const line = token.map![0];
          if (open.type === "admonition_title_open") inLines(c, h0, line, lineEnd);
          else if (open.type === "heading_open" && open.markup[0] === "#") inLines(c, h0, line, headingEnd);
          else inLines(c, h0, line, textEnd); // paragraphe, titre souligné
        }
        break;
      }
      case "thead_open":
      case "tbody_open":
        header = token.type === "thead_open";
        break;
      case "tr_open":
        row = token.map![0];
        ncells = 0;
        break;
      case "tr_close":
        cellHits[ncells] = s.hits.length;
        if (cellHits[0] < s.hits.length) inRow();
        break;
      case "heading_open":
        if (tokens[i + 1].content === "") break;
        headings.push(tokens[i + 1].content);
        headingDefs.push(def);
        break;
      case "footnote_reference_open":
        def = labels.push(token.meta.label) - 1;
        last.set(token.meta.label, def);
        break;
      case "footnote_reference_close":
        def = 0;
        break;
    }
  }
  if (labels.length === 1) return { headings, refs };
  // Notes de bas de page : seules les appelées sont rendues, en fin de document, dans l'ordre des appels.
  const rendered = (d: number): boolean => d === 0 || (s.called.has(labels[d]) && last.get(labels[d]) === d);
  return {
    headings: [0, ...[...s.called].map((l) => last.get(l))].flatMap((d) => headings.filter((_, k) => headingDefs[k] === d)),
    refs: refs.filter((_, k) => rendered(refDefs[k])),
  };
}

export function scanWikiRefs(content: string): WikiRef[] {
  return scanNote(content).refs;
}

export function scanHeadings(content: string): string[] {
  return scanNote(content).headings;
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
