/**
 * Markdown serialization shared by the Word and Excel importers: formatted
 * text runs in, valid and minimal Markdown out.
 */

export interface Link {
  href: string;
  title?: string;
}

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: Link;
}

export type Segment =
  | { kind: "text"; text: string; marks: Marks }
  /** Already-Markdown content (footnote reference, image…), kept verbatim. */
  | { kind: "raw"; markdown: string; marks: Marks }
  | { kind: "break" };

type MarkKey = "link" | "strike" | "bold" | "italic";
/** Nesting order when several marks open at once: link outermost. */
const MARK_ORDER: MarkKey[] = ["link", "strike", "bold", "italic"];
const MARK_SYNTAX: Record<Exclude<MarkKey, "link">, string> = { strike: "~~", bold: "**", italic: "*" };

function sameLink(a?: Link, b?: Link): boolean {
  return a?.href === b?.href && a?.title === b?.title;
}

function sameMarks(a: Marks, b: Marks): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    sameLink(a.link, b.link)
  );
}

function hasMark(marks: Marks, key: MarkKey): boolean {
  return key === "link" ? !!marks.link : !!marks[key];
}

/** Escapes characters Markdown would otherwise read as syntax. */
export function escapeInline(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*[\]<])/g, "\\$1")
    .replace(/~~/g, "\\~\\~")
    .replace(/&(?=#?\w+;)/g, "\\&")
    .replace(/_/g, (match, offset: number, whole: string) => {
      // Intraword underscores (snake_case) are never emphasis: leave them readable.
      const before = whole[offset - 1] ?? "";
      const after = whole[offset + 1] ?? "";
      return /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after) ? match : "\\_";
    });
}

/** Escapes what would turn a plain line into a block construct. */
export function escapeLineStart(line: string): string {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^>/, "\\>")
    .replace(/^([-+])(?=\s|$)/, "\\$1")
    .replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2")
    .replace(/^([=-])(?=\1*\s*$)/, "\\$1")
    .replace(/^!!!/, "\\!!!")
    .replace(/^\|/, "\\|");
}

function codeSpan(value: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") || /^ .* $/.test(value) ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function linkTarget(link: Link): string {
  const href = /[\s()<>]/.test(link.href) ? `<${link.href.replace(/[<>]/g, encodeURIComponent)}>` : link.href;
  return link.title ? `${href} "${link.title.replace(/"/g, '\\"')}"` : href;
}

/** A bare URL whose text is the URL itself is re-linked by linkify: no need for `[x](x)`. */
function isAutolink(segments: Segment[], start: number, link: Link): number {
  let textValue = "";
  let end = start;
  while (end < segments.length) {
    const seg = segments[end];
    if (seg.kind !== "text" || !sameLink(seg.marks.link, link)) break;
    if (seg.marks.bold || seg.marks.italic || seg.marks.strike || seg.marks.code) return -1;
    textValue += seg.text;
    end++;
  }
  if (link.title) return -1;
  const matches =
    (/^https?:\/\/\S+$/.test(link.href) && textValue === link.href) ||
    (link.href.startsWith("mailto:") && textValue === link.href.slice(7) && /^\S+@\S+\.\S+$/.test(textValue));
  return matches ? end : -1;
}

function normalize(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "text") {
      if (seg.text === "") continue;
      if (seg.marks.link) {
        const end = isAutolink(segments, i, seg.marks.link);
        if (end !== -1) {
          const value = segments.slice(i, end).map((s) => (s.kind === "text" ? s.text : "")).join("");
          out.push({ kind: "raw", markdown: value, marks: {} });
          i = end - 1;
          continue;
        }
      }
      const prev = out[out.length - 1];
      if (prev?.kind === "text" && sameMarks(prev.marks, seg.marks)) {
        out[out.length - 1] = { ...prev, text: prev.text + seg.text };
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/**
 * Serializes formatted runs. Marks are opened and closed like a stack so that
 * overlapping formatting nests correctly (`**a *b***`), and whitespace is kept
 * outside of delimiters (`** a**` isn't emphasis in CommonMark).
 */
export function serializeInline(input: Segment[], hardBreak = "\\\n"): string {
  const segments = normalize(input);
  let out = "";
  const stack: { key: MarkKey; link?: Link }[] = [];

  const closeTo = (depth: number) => {
    const trailing = /\s*$/.exec(out)?.[0] ?? "";
    out = out.slice(0, out.length - trailing.length);
    while (stack.length > depth) {
      const mark = stack.pop()!;
      out += mark.key === "link" ? `](${linkTarget(mark.link!)})` : MARK_SYNTAX[mark.key];
    }
    out += trailing;
  };

  const transition = (marks: Marks) => {
    let keep = 0;
    while (
      keep < stack.length &&
      hasMark(marks, stack[keep].key) &&
      (stack[keep].key !== "link" || sameLink(stack[keep].link, marks.link))
    ) {
      keep++;
    }
    closeTo(keep);
    for (const key of MARK_ORDER) {
      if (!hasMark(marks, key) || stack.some((m) => m.key === key)) continue;
      stack.push(key === "link" ? { key, link: marks.link } : { key });
      out += key === "link" ? "[" : MARK_SYNTAX[key];
    }
  };

  for (const seg of segments) {
    if (seg.kind === "break") {
      closeTo(0);
      out = out.replace(/\s+$/, "") + hardBreak;
      continue;
    }
    if (seg.kind === "raw") {
      transition(seg.marks);
      out += seg.markdown;
      continue;
    }
    // Formatting on whitespace alone is invisible: don't open/close around it.
    if (!seg.marks.code && seg.text.trim() === "") {
      out += seg.text;
      continue;
    }
    // Leading whitespace goes before any opening delimiter; trailing whitespace
    // is moved after closing ones by `closeTo`.
    const leading = seg.marks.code ? "" : (/^\s*/.exec(seg.text)?.[0] ?? "");
    out += leading;
    transition(seg.marks);
    const body = seg.text.slice(leading.length);
    out += seg.marks.code ? codeSpan(body) : escapeInline(body);
  }
  closeTo(0);
  return out;
}

export type Align = "left" | "center" | "right" | null;

export function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/(^|[^\\])\|/g, "$1\\|").trim();
}

/** GFM table; the first row is the header. Columns are padded for a readable source. */
export function markdownTable(rows: string[][], align: Align[]): string {
  const cols = Math.max(1, align.length, ...rows.map((r) => r.length));
  const grid = rows.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? ""));
  if (grid.length === 0) grid.push(Array.from({ length: cols }, () => ""));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...grid.map((row) => row[i].length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
  const rule = widths.map((w, i) => {
    const a = align[i] ?? null;
    const dashes = "-".repeat(Math.max(1, w - (a === "center" ? 2 : a ? 1 : 0)));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  });
  return [line(grid[0]), `| ${rule.join(" | ")} |`, ...grid.slice(1).map(line)].join("\n");
}
