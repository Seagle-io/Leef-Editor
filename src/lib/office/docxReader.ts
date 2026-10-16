/**
 * Word (.docx) → Markdown.
 *
 * Reads any Word document (styles, real lists, tables, footnotes and endnotes,
 * hyperlinks and HYPERLINK fields, images, tracked changes), and reads back the
 * content-control tags Leef's exporter adds for Markdown-only constructs.
 *
 * `docxToMarkdown` first checks the bridge: a document Leef wrote and nobody
 * edited in Word comes back as its exact original Markdown.
 */
import { slugify } from "../markdown";
import { fingerprint, readBridge } from "./bridge";
import {
  escapeLineStart,
  escapeCell,
  markdownTable,
  serializeInline,
  type Align,
  type Link,
  type Marks,
  type Segment,
} from "./markdownOut";
import {
  attr,
  bytesToBase64,
  child,
  children,
  descendants,
  isOn,
  mimeOf,
  parseXml,
  readRels,
  text,
  unzipPackage,
  type PackageFiles,
  type Relationship,
} from "./xml";

interface StyleInfo {
  name: string;
  basedOn: string | null;
  outlineLevel: number | null;
  numId: string | null;
  ilvl: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

interface LevelInfo {
  format: string;
  start: number;
}

type Block =
  | { kind: "para"; md: string; quote: boolean }
  | { kind: "heading"; level: number; md: string }
  | { kind: "item"; list: string; level: number; ordered: boolean; start: number; md: string }
  | { kind: "cont"; md: string }
  /** `tagged`: delimited by a Leef content control, never merged with a neighbour. */
  | { kind: "code"; info: string; code: string; tagged?: boolean }
  | { kind: "table"; md: string }
  | { kind: "hr" }
  | { kind: "pagebreak" }
  | { kind: "admonition"; type: string; title: string; blocks: Block[] };

type InlinePart = Segment | { kind: "pagebreak" };

const MONO_FONTS = /^(consolas|courier|courier new|menlo|monaco|lucida console|source code pro|cascadia (code|mono)|fira (code|mono)|jetbrains mono|dejavu sans mono|liberation mono|roboto mono|sf mono)$/i;
const CODE_STYLE = /^(leef code|html preformatted|source code|plain text|macro text|code|code block|preformatted text)$/i;
const QUOTE_STYLE = /^(quote|intense quote|block text|citation|citation intense)$/i;

class DocxReader {
  private readonly styles = new Map<string, StyleInfo>();
  private readonly nums = new Map<string, { abstractId: string; starts: Map<number, number> }>();
  private readonly abstracts = new Map<string, Map<number, LevelInfo>>();
  private readonly rels: Map<string, Relationship>;
  private readonly notes = { footnote: new Map<string, Element>(), endnote: new Map<string, Element>() };
  private readonly noteRels = { footnote: new Map<string, Relationship>(), endnote: new Map<string, Relationship>() };
  private readonly anchors = new Map<string, string>();
  /** Footnote label per Word note (`footnote:3`), in first-reference order. */
  private readonly noteLabels = new Map<string, string>();
  private readonly definitions = new Map<string, string>();
  private currentRels: Map<string, Relationship>;
  private dry = false;

  constructor(private readonly files: PackageFiles) {
    this.rels = readRels(files, "word/document.xml");
    this.currentRels = this.rels;
    this.readStyles();
    this.readNumbering();
    for (const kind of ["footnote", "endnote"] as const) {
      const part = `word/${kind}s.xml`;
      const source = text(files, part);
      if (!source) continue;
      for (const note of descendants(parseXml(source, part), kind)) {
        const id = attr(note, "id");
        const type = attr(note, "type");
        if (id && (!type || type === "normal")) this.notes[kind].set(id, note);
      }
      this.noteRels[kind] = readRels(files, part);
    }
  }

  // --- Package metadata ------------------------------------------------------

  private readStyles(): void {
    const source = text(this.files, "word/styles.xml");
    if (!source) return;
    for (const style of descendants(parseXml(source, "styles.xml"), "style")) {
      const id = attr(style, "styleId");
      if (!id) continue;
      const pPr = child(style, "pPr");
      const rPr = child(style, "rPr");
      const numPr = pPr ? child(pPr, "numPr") : null;
      const outline = attr(pPr ? child(pPr, "outlineLvl") : null, "val");
      const font = attr(rPr ? child(rPr, "rFonts") : null, "ascii") ?? "";
      this.styles.set(id, {
        name: attr(child(style, "name"), "val") ?? id,
        basedOn: attr(child(style, "basedOn"), "val"),
        outlineLevel: outline !== null ? Number(outline) : null,
        numId: numPr ? attr(child(numPr, "numId"), "val") : null,
        ilvl: Number(attr(numPr ? child(numPr, "ilvl") : null, "val") ?? 0),
        bold: isOn(rPr ? child(rPr, "b") : null),
        italic: isOn(rPr ? child(rPr, "i") : null),
        mono: MONO_FONTS.test(font),
      });
    }
  }

  private readNumbering(): void {
    const source = text(this.files, "word/numbering.xml");
    if (!source) return;
    const doc = parseXml(source, "numbering.xml");
    for (const abstract of descendants(doc, "abstractNum")) {
      const id = attr(abstract, "abstractNumId");
      if (id === null) continue;
      const levels = new Map<number, LevelInfo>();
      for (const lvl of children(abstract, "lvl")) {
        levels.set(Number(attr(lvl, "ilvl") ?? 0), {
          format: attr(child(lvl, "numFmt"), "val") ?? "decimal",
          start: Number(attr(child(lvl, "start"), "val") ?? 1),
        });
      }
      this.abstracts.set(id, levels);
    }
    for (const num of descendants(doc, "num")) {
      const id = attr(num, "numId");
      const abstractId = attr(child(num, "abstractNumId"), "val");
      if (id === null || abstractId === null) continue;
      const starts = new Map<number, number>();
      for (const override of children(num, "lvlOverride")) {
        const start = attr(child(override, "startOverride"), "val");
        if (start !== null) starts.set(Number(attr(override, "ilvl") ?? 0), Number(start));
      }
      this.nums.set(id, { abstractId, starts });
    }
  }

  /** Walks a style and its `basedOn` ancestors until `pick` finds a value. */
  private styleChain<T>(styleId: string | null, pick: (s: StyleInfo) => T | null | undefined): T | null {
    const seen = new Set<string>();
    let id = styleId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const style = this.styles.get(id);
      if (!style) return null;
      const value = pick(style);
      if (value !== null && value !== undefined) return value;
      id = style.basedOn;
    }
    return null;
  }

  private styleNames(styleId: string | null): string[] {
    const names: string[] = [];
    this.styleChain(styleId, (s) => {
      names.push(s.name);
      return null;
    });
    return names;
  }

  // --- Document --------------------------------------------------------------

  convert(): string {
    const source = text(this.files, "word/document.xml");
    if (!source) throw new Error("Document Word invalide : word/document.xml manquant");
    const body = descendants(parseXml(source, "document.xml"), "body")[0];
    if (!body) return "";

    this.collectAnchors(body);
    const blocks = this.blocks(children(body));
    let markdown = serializeBlocks(blocks);

    const definitions = Array.from(this.definitions, ([label, md]) => `[^${label}]: ${md}`);
    if (definitions.length > 0) markdown += `${markdown ? "\n\n" : ""}${definitions.join("\n")}`;
    return markdown.trim() === "" ? "" : `${markdown.trim()}\n`;
  }

  /** Bookmarks on headings → the anchor id GMD's renderer gives that heading. */
  private collectAnchors(body: Element): void {
    const seen = new Map<string, number>();
    this.dry = true;
    for (const p of descendants(body, "p")) {
      if (this.headingLevel(p) === null) continue;
      const base = slugify(this.inlineMarkdown(p, " "));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const slug = count > 0 ? `${base}-${count}` : base;
      for (const bookmark of descendants(p, "bookmarkStart")) {
        const name = attr(bookmark, "name");
        if (name) this.anchors.set(name, slug);
      }
    }
    this.dry = false;
  }

  private blocks(elements: Element[]): Block[] {
    const out: Block[] = [];
    for (const el of elements) {
      switch (el.localName) {
        case "p":
          out.push(...this.paragraph(el, out[out.length - 1]));
          break;
        case "tbl":
          out.push({ kind: "table", md: this.table(el) });
          break;
        case "sdt":
          out.push(...this.blockSdt(el));
          break;
        case "customXml":
        case "ins":
        case "moveTo":
          out.push(...this.blocks(children(el)));
          break;
        default:
          break;
      }
    }
    // Code written by other tools is often one paragraph per line.
    const merged: Block[] = [];
    for (const block of out) {
      const prev = merged[merged.length - 1];
      if (block.kind === "code" && prev?.kind === "code" && !block.tagged && !prev.tagged) {
        merged[merged.length - 1] = { ...prev, code: `${prev.code}\n${block.code}` };
      } else {
        merged.push(block);
      }
    }
    return merged;
  }

  private blockSdt(sdt: Element): Block[] {
    const tag = attr(descendants(child(sdt, "sdtPr") ?? sdt, "tag")[0] ?? null, "val") ?? "";
    const content = child(sdt, "sdtContent");
    if (!content) return [];

    if (tag === "leef:mermaid" || tag.startsWith("leef:code:")) {
      const code = descendants(content, "p")
        .map((p) => this.rawText(p))
        .join("\n");
      return [{ kind: "code", info: tag === "leef:mermaid" ? "mermaid" : tag.slice("leef:code:".length), code, tagged: true }];
    }
    if (tag.startsWith("leef:admonition:")) {
      const inner = children(content);
      let title = "";
      const first = inner.find((el) => el.localName === "p");
      if (first && this.styleId(first) === "LeefAdmonitionTitle") {
        title = this.inlineMarkdown(first, " ");
        inner.splice(inner.indexOf(first), 1);
      }
      return [{ kind: "admonition", type: tag.slice("leef:admonition:".length) || "note", title, blocks: this.blocks(inner) }];
    }
    return this.blocks(children(content));
  }

  private styleId(p: Element): string | null {
    const pPr = child(p, "pPr");
    return attr(pPr ? child(pPr, "pStyle") : null, "val");
  }

  private headingLevel(p: Element): number | null {
    const styleId = this.styleId(p);
    if (!styleId) return null;
    if (styleId === "Title") return 1;
    for (const name of this.styleNames(styleId)) {
      const match = /^heading\s*([1-9])$/i.exec(name);
      if (match) return Math.min(6, Number(match[1]));
      if (/^title$/i.test(name)) return 1;
    }
    const outline = this.styleChain(styleId, (s) => s.outlineLevel);
    return outline !== null && outline < 9 ? Math.min(6, outline + 1) : null;
  }

  private paragraph(p: Element, previous: Block | undefined): Block[] {
    const pPr = child(p, "pPr");
    const styleId = this.styleId(p);
    const names = this.styleNames(styleId);
    const out: Block[] = [];
    if (pPr && isOn(child(pPr, "pageBreakBefore"))) out.push({ kind: "pagebreak" });

    if (styleId === "LeefCode" || names.some((n) => CODE_STYLE.test(n))) {
      out.push({ kind: "code", info: "", code: this.rawText(p) });
      return out;
    }

    const heading = this.headingLevel(p);
    const numPr = pPr ? child(pPr, "numPr") : null;
    let numId = numPr ? attr(child(numPr, "numId"), "val") : null;
    let ilvl = Number(attr(numPr ? child(numPr, "ilvl") : null, "val") ?? 0);
    if (numId === null && heading === null) {
      numId = this.styleChain(styleId, (s) => s.numId);
      if (numId !== null && !(numPr && child(numPr, "ilvl"))) ilvl = this.styleChain(styleId, (s) => (s.numId ? s.ilvl : null)) ?? 0;
    }
    // Numbered headings stay headings.
    const isList = heading === null && numId !== null && numId !== "0" && this.nums.has(numId);

    const parts = this.inlineParts(p);
    // A page break in the middle of a paragraph splits it in two.
    const chunks: Segment[][] = [[]];
    for (const part of parts) {
      if (part.kind === "pagebreak") chunks.push([]);
      else chunks[chunks.length - 1].push(part);
    }

    chunks.forEach((chunk, index) => {
      if (index > 0) out.push({ kind: "pagebreak" });
      const md = this.finishInline(chunk, heading !== null ? " " : "\\\n");
      const border = pPr ? child(pPr, "pBdr") : null;
      const isRule = styleId === "LeefRule" || (md === "" && !!border && !!child(border, "bottom"));
      if (index === 0 && isRule) {
        out.push({ kind: "hr" });
        return;
      }
      if (index === 0 && isList) {
        const level = this.abstracts.get(this.nums.get(numId!)!.abstractId)?.get(ilvl);
        const ordered = !!level && level.format !== "bullet" && level.format !== "none";
        const start = this.nums.get(numId!)!.starts.get(ilvl) ?? level?.start ?? 1;
        out.push({ kind: "item", list: `${numId}:${ilvl}`, level: ilvl, ordered, start, md });
        return;
      }
      if (md === "") return;
      if (heading !== null) out.push({ kind: "heading", level: heading, md });
      else if (
        index === 0 &&
        (previous?.kind === "item" || previous?.kind === "cont") &&
        names.some((n) => /^list paragraph$/i.test(n))
      )
        out.push({ kind: "cont", md });
      else out.push({ kind: "para", md, quote: names.some((n) => QUOTE_STYLE.test(n)) });
    });
    return out;
  }

  private finishInline(segments: Segment[], hardBreak: string): string {
    const md = serializeInline(segments, hardBreak).trim();
    // Each physical line must not be mistaken for block syntax.
    return md
      .split("\n")
      .map((line) => escapeLineStart(line.replace(/^\s+/, "")))
      .join("\n");
  }

  private inlineMarkdown(p: Element, hardBreak: string): string {
    const segments = this.inlineParts(p).filter((s): s is Segment => s.kind !== "pagebreak");
    return this.finishInline(segments, hardBreak);
  }

  /** Plain text of a paragraph, as code: no Markdown escaping, breaks kept. */
  private rawText(el: Element): string {
    let out = "";
    for (const node of children(el)) {
      switch (node.localName) {
        case "t":
          out += node.textContent ?? "";
          break;
        case "tab":
          if (el.localName === "r") out += "\t";
          break;
        case "br":
        case "cr":
          out += "\n";
          break;
        case "pPr":
        case "rPr":
        case "del":
        case "moveFrom":
          break;
        default:
          out += this.rawText(node);
          break;
      }
    }
    return out;
  }

  // --- Inline ----------------------------------------------------------------

  private inlineParts(container: Element): InlinePart[] {
    const out: InlinePart[] = [];
    // Complex fields (fldChar begin / separate / end) span several runs.
    const fields: { instr: string; result: boolean }[] = [];
    this.walkInline(container, {}, out, fields, null);
    return out;
  }

  private walkInline(
    container: Element,
    marks: Marks,
    out: InlinePart[],
    fields: { instr: string; result: boolean }[],
    noteLabel: string | null,
  ): void {
    for (const el of children(container)) {
      switch (el.localName) {
        case "r":
          this.run(el, marks, out, fields, noteLabel);
          break;
        case "hyperlink": {
          const link = this.hyperlink(el);
          this.walkInline(el, link ? { ...marks, link } : marks, out, fields, noteLabel);
          break;
        }
        case "fldSimple": {
          const link = fieldLink(attr(el, "instr") ?? "");
          this.walkInline(el, link ? { ...marks, link } : marks, out, fields, noteLabel);
          break;
        }
        case "sdt": {
          const tag = attr(descendants(child(el, "sdtPr") ?? el, "tag")[0] ?? null, "val") ?? "";
          const content = child(el, "sdtContent");
          if (!content) break;
          if (tag === "leef:img") {
            const hyperlink = descendants(content, "hyperlink")[0];
            const link = hyperlink ? this.hyperlink(hyperlink) : null;
            const alt = descendants(content, "t")
              .map((t) => t.textContent ?? "")
              .join("");
            if (link) out.push({ kind: "raw", markdown: imageMarkdown(alt, link.href, link.title ?? ""), marks: withoutLink(marks) });
            break;
          }
          const label = tag.startsWith("leef:fn:") ? tag.slice("leef:fn:".length) : noteLabel;
          this.walkInline(content, marks, out, fields, label);
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          this.walkInline(el, marks, out, fields, noteLabel);
          break;
        case "oMath":
        case "oMathPara": {
          const value = descendants(el, "t")
            .map((t) => t.textContent ?? "")
            .join("");
          if (value) out.push({ kind: "text", text: value, marks });
          break;
        }
        default:
          break;
      }
    }
  }

  private hyperlink(el: Element): Link | null {
    const anchor = attr(el, "anchor");
    const id = attr(el, "id");
    const tooltip = attr(el, "tooltip") ?? undefined;
    let href: string | null = null;
    if (id) href = this.currentRels.get(id)?.target ?? null;
    if (anchor) href = `${href ?? ""}#${this.anchors.get(anchor) ?? anchor}`;
    return href === null ? null : { href, title: tooltip };
  }

  private runMarks(r: Element, marks: Marks): { marks: Marks; hidden: boolean } {
    const rPr = child(r, "rPr");
    if (!rPr) return { marks, hidden: false };
    const styleId = attr(child(rPr, "rStyle"), "val");
    const styleBold = this.styleChain(styleId, (s) => (s.bold ? true : null)) ?? false;
    const styleItalic = this.styleChain(styleId, (s) => (s.italic ? true : null)) ?? false;
    const styleMono = this.styleChain(styleId, (s) => (s.mono ? true : null)) ?? false;
    const font = attr(child(rPr, "rFonts"), "ascii") ?? "";
    const b = child(rPr, "b");
    const i = child(rPr, "i");
    return {
      marks: {
        ...marks,
        bold: b ? isOn(b) : styleBold || marks.bold,
        italic: i ? isOn(i) : styleItalic || marks.italic,
        strike: isOn(child(rPr, "strike")) || isOn(child(rPr, "dstrike")) || marks.strike,
        code: styleId === "LeefCodeChar" || styleMono || MONO_FONTS.test(font) || marks.code,
      },
      hidden: isOn(child(rPr, "vanish")),
    };
  }

  private run(r: Element, base: Marks, out: InlinePart[], fields: { instr: string; result: boolean }[], noteLabel: string | null): void {
    const { marks: own, hidden } = this.runMarks(r, base);

    for (const el of children(r)) {
      // Field state can change in the middle of a run.
      if (el.localName === "fldChar") {
        const type = attr(el, "fldCharType");
        if (type === "begin") fields.push({ instr: "", result: false });
        else if (type === "separate" && fields.length > 0) fields[fields.length - 1].result = true;
        else if (type === "end") fields.pop();
        continue;
      }
      if (el.localName === "instrText") {
        if (fields.length > 0) fields[fields.length - 1].instr += el.textContent ?? "";
        continue;
      }
      // Inside a field's instruction part: the code isn't document text.
      if ((fields.length > 0 && !fields[fields.length - 1].result) || hidden) continue;

      const fieldHref = own.link ? null : (fields.map((f) => fieldLink(f.instr)).find((l) => l) ?? null);
      const marks = fieldHref ? { ...own, link: fieldHref } : own;

      switch (el.localName) {
        case "t":
          out.push({ kind: "text", text: el.textContent ?? "", marks });
          break;
        case "tab":
          out.push({ kind: "text", text: "\t", marks });
          break;
        case "br": {
          const type = attr(el, "type");
          if (type === "page") out.push({ kind: "pagebreak" });
          else if (type !== "column") out.push({ kind: "break" });
          break;
        }
        case "cr":
          out.push({ kind: "break" });
          break;
        case "noBreakHyphen":
          out.push({ kind: "text", text: "-", marks });
          break;
        case "sym": {
          const code = parseInt(attr(el, "char") ?? "", 16);
          // Symbol-font private-use glyphs (F0xx) have no Unicode meaning.
          if (Number.isFinite(code) && (code < 0xf000 || code > 0xf0ff)) out.push({ kind: "text", text: String.fromCodePoint(code), marks });
          break;
        }
        case "footnoteReference":
        case "endnoteReference": {
          const kind = el.localName === "footnoteReference" ? "footnote" : "endnote";
          const label = this.noteReference(kind, attr(el, "id") ?? "", noteLabel);
          if (label) out.push({ kind: "raw", markdown: `[^${label}]`, marks: withoutLink(marks) });
          break;
        }
        case "drawing":
        case "pict": {
          const image = this.image(el);
          if (image) out.push({ kind: "raw", markdown: image, marks: withoutLink(marks) });
          break;
        }
        default:
          break;
      }
    }
  }

  private noteReference(kind: "footnote" | "endnote", id: string, tagged: string | null): string | null {
    if (this.dry) return "?";
    const key = `${kind}:${id}`;
    const existing = this.noteLabels.get(key);
    if (existing) return existing;
    const note = this.notes[kind].get(id);
    if (!note) return null;
    const label = tagged ?? String(this.definitions.size + 1);
    this.noteLabels.set(key, label);
    if (!this.definitions.has(label)) {
      // Reserve the slot first: label numbering follows first reference order.
      this.definitions.set(label, "");
      const saved = this.currentRels;
      this.currentRels = this.noteRels[kind];
      const paragraphs = children(note, "p")
        .map((p) => this.inlineMarkdown(p, "\\\n"))
        .filter((md) => md !== "");
      this.currentRels = saved;
      this.definitions.set(label, paragraphs.join("\n\n    ").replace(/\n(?!\n| {4})/g, "\n    "));
    }
    return label;
  }

  private image(el: Element): string | null {
    const docPr = descendants(el, "docPr")[0] ?? null;
    const name = attr(docPr, "name") ?? "";
    const alt = attr(docPr, "descr") ?? "";
    const title = attr(docPr, "title") ?? "";
    if (name.startsWith("leef-src:")) return imageMarkdown(alt, name.slice("leef-src:".length), title);

    const blip = descendants(el, "blip")[0] ?? descendants(el, "imagedata")[0] ?? null;
    const relId = attr(blip, "embed") ?? attr(blip, "link") ?? attr(blip, "id");
    const rel = relId ? this.currentRels.get(relId) : undefined;
    if (!rel) return null;
    if (rel.external) return imageMarkdown(alt, rel.target, title);
    const bytes = this.files[rel.target];
    if (!bytes) return null;
    return imageMarkdown(alt, `data:${mimeOf(rel.target)};base64,${bytesToBase64(bytes)}`, title);
  }

  // --- Tables ----------------------------------------------------------------

  private table(tbl: Element): string {
    const rows: string[][] = [];
    const align: Align[] = [];
    const rowElements = descendants(tbl, "tr").filter((tr) => nearestTable(tr) === tbl);
    rowElements.forEach((tr, rowIndex) => {
      const cells: string[] = [];
      const cellElements = children(tr).flatMap((el) =>
        el.localName === "tc" ? [el] : el.localName === "sdt" ? descendants(el, "tc").filter((tc) => nearestTable(tc) === tbl) : [],
      );
      for (const tc of cellElements) {
        const tcPr = child(tc, "tcPr");
        const span = Number(attr(tcPr ? child(tcPr, "gridSpan") : null, "val") ?? 1);
        const vMerge = tcPr ? child(tcPr, "vMerge") : null;
        const continued = vMerge !== null && attr(vMerge, "val") !== "restart";
        const paragraphs = descendants(tc, "p").filter((p) => nearestTable(p) === tbl);
        const value = continued ? "" : paragraphs.map((p) => this.inlineMarkdown(p, " ")).filter(Boolean).join(" ");
        if (rowIndex === 0) {
          const pPr = paragraphs[0] ? child(paragraphs[0], "pPr") : null;
          const jc = attr(pPr ? child(pPr, "jc") : null, "val");
          align.push(jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "left" || jc === "start" ? "left" : null);
        }
        cells.push(escapeCell(value));
        for (let i = 1; i < span; i++) {
          cells.push("");
          if (rowIndex === 0) align.push(null);
        }
      }
      rows.push(cells);
    });
    return markdownTable(rows, align);
  }
}

function nearestTable(el: Element): Element | null {
  let node = el.parentElement;
  while (node && node.localName !== "tbl") node = node.parentElement;
  return node;
}

function withoutLink(marks: Marks): Marks {
  const { link: _link, ...rest } = marks;
  return rest;
}

function fieldLink(instr: string): Link | null {
  const match = /^\s*HYPERLINK\s+(?:"([^"]*)"|(\S+))(?:.*?\\l\s+"([^"]*)")?/i.exec(instr);
  if (!match) return null;
  const href = match[1] ?? match[2] ?? "";
  const anchor = match[3];
  return { href: anchor ? `${href}#${anchor}` : href };
}

function imageMarkdown(alt: string, src: string, title: string): string {
  const target = /[\s()<>]/.test(src) ? `<${src}>` : src;
  const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  return `![${alt.replace(/([\\[\]])/g, "\\$1")}](${target}${titlePart})`;
}

// --- Block serialization -------------------------------------------------------

function indentLines(md: string, indent: string): string {
  return md
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join("\n");
}

function codeFence(info: string, code: string): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${info}\n${code}\n${fence}`;
}

export function serializeBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  // Open lists, outermost first: what the current item nests under.
  const stack: { list: string; level: number; ordered: boolean; count: number; start: number; width: number; marker: string }[] = [];
  let lastMarker: Record<number, { list: string; marker: string }> = {};
  let previous: Block | null = null;

  const indentFor = (depth: number) => " ".repeat(stack.slice(0, depth).reduce((sum, l) => sum + l.width, 0));

  for (const block of blocks) {
    let chunk = "";
    let separator = "\n\n";

    if (block.kind === "item") {
      while (stack.length > 0 && stack[stack.length - 1].level > block.level) stack.pop();
      let top = stack[stack.length - 1];
      // A different list at the same level: a sibling list, set apart by a blank line.
      const sibling = !!top && top.level === block.level && top.list !== block.list;
      if (sibling) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      if (!top || top.level < block.level) {
        // A new list. Two different lists back to back would merge in
        // Markdown: alternate the marker to keep them apart.
        const depth = stack.length;
        const prior = lastMarker[depth];
        const adjacent = previous?.kind === "item" || previous?.kind === "cont";
        let marker = block.ordered ? "." : "-";
        if (adjacent && prior && prior.list !== block.list && prior.marker === marker) marker = block.ordered ? ")" : "*";
        stack.push({ list: block.list, level: block.level, ordered: block.ordered, count: 0, start: block.start, width: 0, marker });
        lastMarker[depth] = { list: block.list, marker };
      }
      const current = stack[stack.length - 1];
      const bullet = current.ordered ? `${current.start + current.count}${current.marker}` : current.marker;
      current.count++;
      current.width = bullet.length + 1;
      const indent = indentFor(stack.length - 1);
      chunk = `${indent}${bullet}${block.md ? ` ${indentLines(block.md, indent + " ".repeat(current.width))}` : ""}`;
      if (previous?.kind === "item" && !sibling) separator = "\n";
    } else if (block.kind === "cont" && stack.length > 0) {
      const indent = indentFor(stack.length);
      chunk = indent + indentLines(block.md, indent);
    } else {
      stack.length = 0;
      lastMarker = {};
      switch (block.kind) {
        case "para":
        case "cont":
          chunk = block.kind === "para" && block.quote ? block.md.split("\n").map((l) => `> ${l}`).join("\n") : block.md;
          if (block.kind === "para" && block.quote && previous?.kind === "para" && previous.quote) separator = "\n>\n";
          break;
        case "heading":
          chunk = `${"#".repeat(block.level)} ${block.md}`;
          break;
        case "code":
          chunk = codeFence(block.info, block.code);
          break;
        case "table":
          chunk = block.md;
          break;
        case "hr":
          chunk = "---";
          break;
        case "pagebreak":
          chunk = "\\pagebreak";
          break;
        case "admonition": {
          const body = serializeBlocks(block.blocks);
          const head = block.title ? `!!! ${block.type} "${block.title}"` : `!!! ${block.type}`;
          chunk = `${head}\n${body ? `${body}\n` : ""}!!!`;
          break;
        }
      }
    }

    if (parts.length > 0) parts.push(separator);
    parts.push(chunk);
    previous = block;
  }
  return parts.join("");
}

/** Structural conversion only (no bridge): also what the exporter fingerprints. */
export function readDocxStructure(files: PackageFiles): string {
  return new DocxReader(files).convert();
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const files = unzipPackage(bytes);
  if (!files["word/document.xml"]) throw new Error("Ce fichier n'est pas un document Word (.docx).");
  const structural = readDocxStructure(files);
  const bridge = readBridge(files);
  if (bridge && bridge.fingerprint === (await fingerprint(structural))) return bridge.source;
  return structural;
}
