/**
 * Markdown ⇄ Excel (.xlsx).
 *
 * Export: each Markdown table becomes a worksheet (named after the heading
 * above it) with typed cells — numbers, ISO dates, percentages and `=`
 * formulas are real Excel values; bold / italic / strike / code are rich text.
 * A cell holding a construct Excel can't express (link mixed with text, image,
 * footnote) keeps its Markdown source under the "Leef Markdown" cell style.
 *
 * Import: every sheet becomes a `## Sheet` section with a GFM table. A workbook
 * Leef wrote comes back through the bridge: unchanged → the exact original
 * Markdown; edited in Excel → the original document with each table replaced
 * by its (edited) sheet, so the text around the tables is never lost.
 */
import { strToU8 } from "fflate";
import { parseMarkdown, type MarkdownToken } from "../markdown";
import { addBridge, fingerprint, readBridge, type Bridge } from "./bridge";
import { escapeCell, markdownTable, serializeInline, type Align, type Marks, type Segment } from "./markdownOut";
import {
  attr,
  child,
  children,
  descendants,
  escapeXml,
  isOn,
  OFFICE_REL,
  parseXml,
  readRels,
  relsXml,
  text,
  unzipPackage,
  XML_HEADER,
  zipPackage,
  type PackageFiles,
} from "./xml";

const SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const MARKDOWN_STYLE = "Leef Markdown";
const CODE_FONT = "Consolas";
const MS_PER_DAY = 86400000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

// --- Shared helpers --------------------------------------------------------------

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  return match ? { col: columnIndex(match[1]), row: Number(match[2]) - 1 } : null;
}

function isoToSerial(value: string): { serial: number; format: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  const check = new Date(time);
  // Reject impossible dates (2026-02-30) instead of letting them roll over.
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return null;
  const format = s !== undefined ? "yyyy-mm-dd hh:mm:ss" : h !== undefined ? "yyyy-mm-dd hh:mm" : "yyyy-mm-dd";
  return { serial: (time - EXCEL_EPOCH) / MS_PER_DAY, format };
}

function serialToIso(serial: number, withTime: boolean, withSeconds: boolean): string {
  const date = new Date(Math.round(EXCEL_EPOCH + serial * MS_PER_DAY));
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (!withTime) return day;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return `${day} ${withSeconds ? `${time}:${pad(date.getUTCSeconds())}` : time}`;
}

/** A plausible Excel formula: Excel refuses to open a file with a malformed one. */
function looksLikeFormula(value: string): boolean {
  if (!/^=(?=.*[A-Za-z0-9])[A-Za-z0-9_$.,:;()+\-*/^&%<>="'! ]+$/.test(value)) return false;
  let depth = 0;
  for (const ch of value.replace(/"[^"]*"/g, "")) {
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0 && (value.match(/"/g)?.length ?? 0) % 2 === 0;
}

// --- Writer ------------------------------------------------------------------------

interface TableCell {
  children: MarkdownToken[];
}

interface TableData {
  heading: string;
  align: Align[];
  rows: TableCell[][];
}

function plainText(children: MarkdownToken[]): string {
  return children.map((t) => (t.type === "text" || t.type === "code_inline" ? t.content : t.type === "softbreak" ? " " : "")).join("");
}

function collectTables(tokens: MarkdownToken[]): TableData[] {
  const tables: TableData[] = [];
  let heading = "";
  let current: TableData | null = null;
  let row: TableCell[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "heading_open") heading = plainText(tokens[i + 1]?.children ?? []);
    else if (token.type === "table_open") current = { heading, align: [], rows: [] };
    else if (token.type === "tr_open") row = [];
    else if ((token.type === "th_open" || token.type === "td_open") && current) {
      if (token.type === "th_open") {
        const align = /text-align:\s*(left|center|right)/.exec(token.attrGet("style") ?? "")?.[1];
        current.align.push((align as Align) ?? null);
      }
      row.push({ children: tokens[i + 1]?.type === "inline" ? (tokens[i + 1].children ?? []) : [] });
    } else if (token.type === "tr_close" && current) current.rows.push(row);
    else if (token.type === "table_close" && current) {
      tables.push(current);
      current = null;
    }
  }
  return tables;
}

function sheetNames(tables: { heading: string }[]): string[] {
  const used = new Set<string>();
  return tables.map((table, i) => {
    const base = table.heading.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, 31) || `Tableau ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

class StyleRegistry {
  private numFmts = new Map<string, number>();
  private xfs = new Map<string, number>();
  private xfList: string[] = [];

  constructor() {
    this.xf({});
  }

  numFmt(code: string): number {
    const builtin: Record<string, number> = { "0%": 9, "0.00%": 10 };
    if (builtin[code] !== undefined) return builtin[code];
    let id = this.numFmts.get(code);
    if (id === undefined) {
      id = 164 + this.numFmts.size;
      this.numFmts.set(code, id);
    }
    return id;
  }

  xf(options: { bold?: boolean; align?: Align; numFmt?: number; markdown?: boolean }): number {
    const key = JSON.stringify([options.bold ?? false, options.align ?? null, options.numFmt ?? 0, options.markdown ?? false]);
    let index = this.xfs.get(key);
    if (index === undefined) {
      index = this.xfList.length;
      this.xfs.set(key, index);
      const numFmt = options.numFmt ?? 0;
      const alignment = options.align ? `<alignment horizontal="${options.align}"/>` : "";
      this.xfList.push(
        `<xf numFmtId="${numFmt}" fontId="${options.bold ? 1 : 0}" fillId="0" borderId="0" xfId="${options.markdown ? 1 : 0}"` +
          `${numFmt ? ' applyNumberFormat="1"' : ""}${options.bold ? ' applyFont="1"' : ""}${alignment ? ' applyAlignment="1"' : ""}>${alignment}</xf>`,
      );
    }
    return index;
  }

  xml(): string {
    const numFmts = this.numFmts.size
      ? `<numFmts count="${this.numFmts.size}">${Array.from(this.numFmts, ([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join("")}</numFmts>`
      : "";
    return (
      `${XML_HEADER}<styleSheet xmlns="${SML_NS}">${numFmts}` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfList.length}">${this.xfList.join("")}</cellXfs>` +
      `<cellStyles count="2"><cellStyle name="Normal" xfId="0" builtinId="0"/><cellStyle name="${MARKDOWN_STYLE}" xfId="1"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

class SharedStrings {
  private index = new Map<string, number>();
  private items: string[] = [];

  add(xml: string): number {
    let i = this.index.get(xml);
    if (i === undefined) {
      i = this.items.length;
      this.items.push(xml);
      this.index.set(xml, i);
    }
    return i;
  }

  plain(value: string): number {
    return this.add(`<t xml:space="preserve">${escapeXml(value)}</t>`);
  }

  xml(count: number): string {
    return `${XML_HEADER}<sst xmlns="${SML_NS}" count="${count}" uniqueCount="${this.items.length}">${this.items.map((i) => `<si>${i}</si>`).join("")}</sst>`;
  }
}

type CellContent =
  | { kind: "empty" }
  | { kind: "number"; value: number; format?: string }
  | { kind: "formula"; formula: string }
  | { kind: "string"; xml: string; markdown?: boolean; link?: { href: string; title: string | null } };

function cellContent(children: MarkdownToken[]): CellContent {
  const simple = children.every((t) => t.type === "text" || t.type === "softbreak");
  if (simple) {
    const value = plainText(children).trim();
    if (value === "") return { kind: "empty" };
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) && String(Number(value)) === value) return { kind: "number", value: Number(value) };
    const percent = /^(-?(?:0|[1-9]\d*)(?:\.(\d+))?)%$/.exec(value);
    if (percent && String(Number(percent[1])) === percent[1]) {
      const decimals = percent[2]?.length ?? 0;
      return { kind: "number", value: Number(percent[1]) / 100, format: decimals ? `0.${"0".repeat(decimals)}%` : "0%" };
    }
    const date = isoToSerial(value);
    if (date) return { kind: "number", value: date.serial, format: date.format };
    if (value.length > 1 && value.startsWith("=") && looksLikeFormula(value)) return { kind: "formula", formula: value.slice(1) };
    return { kind: "string", xml: `<t xml:space="preserve">${escapeXml(value)}</t>` };
  }

  // A cell that is exactly one plain link → a real Excel hyperlink.
  if (children[0]?.type === "link_open" && children[children.length - 1]?.type === "link_close") {
    const inner = children.slice(1, -1);
    if (inner.every((t) => t.type === "text")) {
      const href = children[0].attrGet("href") ?? "";
      return { kind: "string", xml: `<t xml:space="preserve">${escapeXml(plainText(inner))}</t>`, link: { href, title: children[0].attrGet("title") } };
    }
  }

  // Formatting Excel rich text can carry: bold, italic, strike, code.
  const richOnly = children.every((t) => /^(text|softbreak|code_inline|(strong|em|s)_(open|close))$/.test(t.type));
  if (richOnly) {
    const marks = { b: 0, i: 0, s: 0 };
    const runs: string[] = [];
    for (const t of children) {
      if (t.type.endsWith("_open")) marks[t.type === "strong_open" ? "b" : t.type === "em_open" ? "i" : "s"]++;
      else if (t.type.endsWith("_close")) marks[t.type === "strong_close" ? "b" : t.type === "em_close" ? "i" : "s"]--;
      else {
        const value = t.type === "softbreak" ? " " : t.content;
        // CT_RPrElt order: rFont, b, i, strike.
        const rPr =
          (t.type === "code_inline" ? `<rFont val="${CODE_FONT}"/>` : "") +
          (marks.b ? "<b/>" : "") +
          (marks.i ? "<i/>" : "") +
          (marks.s ? "<strike/>" : "");
        runs.push(`<r>${rPr ? `<rPr>${rPr}</rPr>` : ""}<t xml:space="preserve">${escapeXml(value)}</t></r>`);
      }
    }
    return { kind: "string", xml: runs.join("") };
  }

  // Anything else keeps its Markdown source, flagged by the cell style.
  return { kind: "string", xml: `<t xml:space="preserve">${escapeXml(markdownSource(children))}</t>`, markdown: true };
}

/** Rebuilds the Markdown source of a table cell's inline tokens. */
function markdownSource(children: MarkdownToken[]): string {
  let out = "";
  for (const t of children) {
    switch (t.type) {
      case "text":
        out += t.content.replace(/([\\`*_[\]<|])/g, "\\$1");
        break;
      case "softbreak":
        out += " ";
        break;
      case "code_inline":
        out += `\`${t.content}\``;
        break;
      case "strong_open":
      case "strong_close":
        out += "**";
        break;
      case "em_open":
      case "em_close":
        out += "*";
        break;
      case "s_open":
      case "s_close":
        out += "~~";
        break;
      case "link_open":
        out += t.markup === "linkify" ? "" : "[";
        break;
      case "link_close": {
        const open = children.slice(0, children.indexOf(t)).reverse().find((c) => c.type === "link_open");
        if (open && open.markup !== "linkify") {
          const title = open.attrGet("title");
          out += `](${open.attrGet("href") ?? ""}${title ? ` "${title}"` : ""})`;
        }
        break;
      }
      case "image": {
        const title = t.attrGet("title");
        out += `![${t.content}](${t.attrGet("src") ?? ""}${title ? ` "${title}"` : ""})`;
        break;
      }
      case "footnote_ref":
        out += `[^${t.meta?.label ?? Number(t.meta?.id ?? 0) + 1}]`;
        break;
      default:
        out += t.content;
        break;
    }
  }
  return out;
}

interface SheetSpec {
  name: string;
  rows: CellContent[][];
  align: Align[];
  header: boolean;
}

function sheetXml(sheet: SheetSpec, styles: StyleRegistry, strings: SharedStrings, links: { ref: string; relId: string; title: string | null }[], linkRel: (href: string) => string): { xml: string; cells: number } {
  let cells = 0;
  const widths: number[] = [];
  const rowsXml = sheet.rows
    .map((row, r) => {
      const cellsXml = row
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const bold = sheet.header && r === 0;
          const align = sheet.align[c] ?? null;
          const width = cell.kind === "string" ? cell.xml.replace(/<[^>]+>/g, "").length : cell.kind === "formula" ? 12 : 10;
          widths[c] = Math.max(widths[c] ?? 8, Math.min(60, width + 2));
          switch (cell.kind) {
            case "empty": {
              const s = styles.xf({ bold, align });
              return s ? `<c r="${ref}" s="${s}"/>` : "";
            }
            case "number": {
              cells++;
              const s = styles.xf({ bold, align, numFmt: cell.format ? styles.numFmt(cell.format) : 0 });
              return `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${cell.value}</v></c>`;
            }
            case "formula": {
              cells++;
              const s = styles.xf({ bold, align });
              return `<c r="${ref}"${s ? ` s="${s}"` : ""}><f>${escapeXml(cell.formula)}</f></c>`;
            }
            case "string": {
              cells++;
              const s = styles.xf({ bold, align, markdown: cell.markdown });
              if (cell.link) links.push({ ref, relId: linkRel(cell.link.href), title: cell.link.title });
              return `<c r="${ref}" t="s"${s ? ` s="${s}"` : ""}><v>${strings.add(cell.xml)}</v></c>`;
            }
          }
        })
        .join("");
      return `<row r="${r + 1}">${cellsXml}</row>`;
    })
    .join("");
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const pane = sheet.header && sheet.rows.length > 1 ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` : "";
  const hyperlinks = links.length
    ? `<hyperlinks>${links.map((l) => `<hyperlink ref="${l.ref}" r:id="${l.relId}"${l.title ? ` tooltip="${escapeXml(l.title)}"` : ""}/>`).join("")}</hyperlinks>`
    : "";
  return {
    xml:
      `${XML_HEADER}<worksheet xmlns="${SML_NS}" xmlns:r="${OFFICE_REL}">` +
      `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
      `${cols}<sheetData>${rowsXml}</sheetData>${hyperlinks}</worksheet>`,
    cells,
  };
}

function buildWorkbook(sheets: SheetSpec[], title: string): PackageFiles {
  const files: PackageFiles = {};
  const styles = new StyleRegistry();
  const strings = new SharedStrings();
  let stringCount = 0;
  const workbookRels: { id: string; type: string; target: string }[] = [];

  sheets.forEach((sheet, i) => {
    const links: { ref: string; relId: string; title: string | null }[] = [];
    const sheetRels: { id: string; type: string; target: string; external: boolean }[] = [];
    const linkRel = (href: string) => {
      const id = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id, type: `${OFFICE_REL}/hyperlink`, target: href, external: true });
      return id;
    };
    const { xml, cells } = sheetXml(sheet, styles, strings, links, linkRel);
    stringCount += cells;
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
    if (sheetRels.length) files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(relsXml(sheetRels));
    workbookRels.push({ id: `rId${i + 1}`, type: `${OFFICE_REL}/worksheet`, target: `worksheets/sheet${i + 1}.xml` });
  });
  workbookRels.push({ id: `rId${sheets.length + 1}`, type: `${OFFICE_REL}/styles`, target: "styles.xml" });
  workbookRels.push({ id: `rId${sheets.length + 2}`, type: `${OFFICE_REL}/sharedStrings`, target: "sharedStrings.xml" });

  const sheetEntries = sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  files["xl/workbook.xml"] = strToU8(
    `${XML_HEADER}<workbook xmlns="${SML_NS}" xmlns:r="${OFFICE_REL}"><bookViews><workbookView/></bookViews>` +
      `<sheets>${sheetEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(relsXml(workbookRels));
  files["xl/styles.xml"] = strToU8(styles.xml());
  files["xl/sharedStrings.xml"] = strToU8(strings.xml(stringCount));

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${escapeXml(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  files["docProps/app.xml"] = strToU8(
    `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Leef Editor</Application></Properties>`,
  );
  files["_rels/.rels"] = strToU8(
    relsXml([
      { id: "rId1", type: `${OFFICE_REL}/officeDocument`, target: "xl/workbook.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: `${OFFICE_REL}/extended-properties`, target: "docProps/app.xml" },
    ]),
  );

  const sml = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  files["[Content_Types].xml"] = strToU8(
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="${sml}.sheet.main+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${sml}.worksheet+xml"/>`).join("") +
      `<Override PartName="/xl/styles.xml" ContentType="${sml}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${sml}.sharedStrings+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  return files;
}

export async function markdownToXlsx(source: string, options: { title: string }): Promise<Uint8Array> {
  const { tokens } = parseMarkdown(source);
  const tables = collectTables(tokens);
  let sheets: SheetSpec[];
  let layout: "tables" | "text";

  if (tables.length > 0) {
    layout = "tables";
    const names = sheetNames(tables);
    sheets = tables.map((table, i) => ({
      name: names[i],
      rows: table.rows.map((row) => row.map((cell) => cellContent(cell.children))),
      align: table.align,
      header: true,
    }));
  } else {
    // No table: the document's lines, one per row, so it is still readable in Excel.
    layout = "text";
    const lines = source.replace(/\n$/, "").split("\n");
    sheets = [
      {
        name: sheetNames([{ heading: options.title }])[0],
        rows: lines.map((line) => [line === "" ? { kind: "empty" } : { kind: "string", xml: `<t xml:space="preserve">${escapeXml(line)}</t>`, markdown: true }]),
        align: [],
        header: false,
      },
    ];
  }

  const files = buildWorkbook(sheets, options.title);
  addBridge(files, "xl/_rels/workbook.xml.rels", {
    source,
    fingerprint: await fingerprint(structuralMarkdown(readWorkbook(files))),
    extra: { layout, sheets: JSON.stringify(sheets.map((s) => s.name)) },
  });
  return zipPackage(files);
}

// --- Reader ------------------------------------------------------------------------

interface SheetData {
  name: string;
  /** GFM table, or "" for an empty sheet. */
  table: string;
  /** First-column values, for the text layout. */
  lines: string[];
}

interface CellFormat {
  numFmt: number;
  align: Align;
  markdown: boolean;
}

function readStyles(files: PackageFiles): { formats: CellFormat[]; codes: Map<number, string> } {
  const codes = new Map<number, string>();
  const formats: CellFormat[] = [];
  const source = text(files, "xl/styles.xml");
  if (!source) return { formats, codes };
  const doc = parseXml(source, "styles.xml");
  for (const fmt of descendants(doc, "numFmt")) codes.set(Number(attr(fmt, "numFmtId")), attr(fmt, "formatCode") ?? "");

  const markdownStyleXfs = new Set<number>();
  for (const style of descendants(doc, "cellStyle")) {
    if (attr(style, "name") === MARKDOWN_STYLE) markdownStyleXfs.add(Number(attr(style, "xfId")));
  }
  const cellXfs = descendants(doc, "cellXfs")[0];
  for (const xf of cellXfs ? children(cellXfs, "xf") : []) {
    const horizontal = attr(child(xf, "alignment"), "horizontal");
    formats.push({
      numFmt: Number(attr(xf, "numFmtId") ?? 0),
      align: horizontal === "left" || horizontal === "center" || horizontal === "right" ? horizontal : null,
      markdown: markdownStyleXfs.has(Number(attr(xf, "xfId") ?? 0)),
    });
  }
  return { formats, codes };
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function formatNumber(raw: string, numFmt: number, codes: Map<number, string>): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const code = codes.get(numFmt) ?? (numFmt === 9 ? "0%" : numFmt === 10 ? "0.00%" : "");
  if (code.endsWith("%")) {
    const decimals = /\.(0+)%$/.exec(code)?.[1].length ?? 0;
    return `${(value * 100).toFixed(decimals)}%`;
  }
  // Literal text, escapes and currency / locale tags aren't date tokens.
  const tokens = code.replace(/"[^"]*"|\\.|\[\$[^\]]*\]/g, "");
  if (BUILTIN_DATE_FORMATS.has(numFmt) || /[dmy]/i.test(tokens)) {
    const withTime = /h/i.test(tokens) || (numFmt >= 18 && numFmt <= 22) || (numFmt >= 45 && numFmt <= 47) || value % 1 !== 0;
    const withSeconds = /s/i.test(tokens) || [19, 21, 45, 46, 47].includes(numFmt);
    return serialToIso(value, withTime, withSeconds);
  }
  // JS's shortest round-trip form: Excel's "1.1000000000000001" reads back as "1.1".
  return String(value);
}

function richTextMarkdown(si: Element): string {
  const runs = children(si, "r");
  if (runs.length === 0) return escapeCell(serializeInline([{ kind: "text", text: child(si, "t")?.textContent ?? "", marks: {} }], " "));
  const segments: Segment[] = runs.map((r) => {
    const rPr = child(r, "rPr");
    const font = attr(rPr ? child(rPr, "rFont") : null, "val") ?? "";
    const marks: Marks = {
      bold: isOn(rPr ? child(rPr, "b") : null),
      italic: isOn(rPr ? child(rPr, "i") : null),
      strike: isOn(rPr ? child(rPr, "strike") : null),
      code: /^(consolas|courier new|courier|menlo|monaco|lucida console)$/i.test(font),
    };
    return { kind: "text", text: child(r, "t")?.textContent ?? "", marks };
  });
  return escapeCell(serializeInline(segments, " "));
}

/** Translates a shared formula's relative references by a row / column offset. */
function shiftFormula(formula: string, dRow: number, dCol: number): string {
  return formula.replace(/("[^"]*")|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Z_])/g, (match, quoted, colAbs, col, rowAbs, row, offset: number, whole: string) => {
    if (quoted) return match;
    // A preceding letter / digit / "_" means it's part of a name, not a reference.
    if (offset > 0 && /[A-Za-z0-9_.]/.test(whole[offset - 1])) return match;
    const newCol = colAbs ? col : columnName(columnIndex(col) + dCol);
    const newRow = rowAbs ? row : String(Number(row) + dRow);
    return `${colAbs}${newCol}${rowAbs}${newRow}`;
  });
}

function readSheet(files: PackageFiles, path: string, name: string, strings: Element[], formats: CellFormat[], codes: Map<number, string>): SheetData {
  const source = text(files, path);
  if (!source) return { name, table: "", lines: [] };
  const doc = parseXml(source, path);
  const rels = readRels(files, path);
  const links = new Map<string, { href: string; title?: string }>();
  for (const link of descendants(doc, "hyperlink")) {
    const ref = attr(link, "ref");
    const id = attr(link, "id");
    const location = attr(link, "location");
    const href = id ? rels.get(id)?.target : location ? `#${location}` : undefined;
    if (ref && href) links.set(ref.split(":")[0], { href, title: attr(link, "tooltip") ?? undefined });
  }

  const grid = new Map<number, Map<number, string>>();
  const firstCol = new Map<number, string>();
  const headerAlign = new Map<number, Align>();
  const shared = new Map<string, { formula: string; row: number; col: number }>();
  let maxCol = -1;

  for (const row of descendants(doc, "row")) {
    for (const c of children(row, "c")) {
      const ref = attr(c, "r");
      const pos = ref ? parseRef(ref) : null;
      if (!pos) continue;
      const format = formats[Number(attr(c, "s") ?? 0)] ?? { numFmt: 0, align: null, markdown: false };
      const type = attr(c, "t") ?? "n";
      const v = child(c, "v")?.textContent ?? "";
      const f = child(c, "f");
      let value = "";

      if (f) {
        let formula = f.textContent ?? "";
        const si = attr(f, "si");
        if (attr(f, "t") === "shared" && si !== null) {
          const master = shared.get(si);
          if (formula) shared.set(si, { formula, row: pos.row, col: pos.col });
          else if (master) formula = shiftFormula(master.formula, pos.row - master.row, pos.col - master.col);
        }
        value = formula ? escapeCell(`=${formula}`) : v;
      } else if (type === "s") {
        const si = strings[Number(v)];
        const raw = si ? descendants(si, "t").map((t) => t.textContent ?? "").join("") : "";
        value = format.markdown ? escapeCell(raw) : si ? richTextMarkdown(si) : "";
        if (format.markdown) firstCol.set(pos.row, raw);
      } else if (type === "inlineStr") {
        const is = child(c, "is");
        const raw = is ? descendants(is, "t").map((t) => t.textContent ?? "").join("") : "";
        value = format.markdown ? escapeCell(raw) : is ? richTextMarkdown(is) : "";
        if (format.markdown) firstCol.set(pos.row, raw);
      } else if (type === "b") {
        value = v === "1" ? "TRUE" : "FALSE";
      } else if (type === "str" || type === "e") {
        value = escapeCell(v);
      } else if (type === "d") {
        value = v;
      } else if (v !== "") {
        value = formatNumber(v, format.numFmt, codes);
      }

      const link = ref ? links.get(ref) : undefined;
      if (link && value) {
        const textValue = value;
        const href = /[\s()<>]/.test(link.href) ? `<${link.href}>` : link.href;
        value = link.href === textValue && !link.title ? textValue : `[${textValue}](${href}${link.title ? ` "${link.title}"` : ""})`;
      }
      if (pos.col === 0 && !firstCol.has(pos.row)) firstCol.set(pos.row, value);
      if (value === "" && !format.align) continue;
      if (!grid.has(pos.row)) grid.set(pos.row, new Map());
      grid.get(pos.row)!.set(pos.col, value);
      if (format.align && !headerAlign.has(pos.col)) headerAlign.set(pos.col, format.align);
      if (value !== "") maxCol = Math.max(maxCol, pos.col);
    }
  }

  const rowIndexes = Array.from(grid.keys())
    .filter((r) => Array.from(grid.get(r)!.values()).some((v) => v !== ""))
    .sort((a, b) => a - b);
  const lines: string[] = [];
  const lastLine = Math.max(-1, ...firstCol.keys());
  for (let r = 0; r <= lastLine; r++) lines.push(firstCol.get(r) ?? "");
  if (rowIndexes.length === 0 || maxCol < 0) return { name, table: "", lines };

  // Trim empty leading columns as well as empty rows above the data.
  const usedCols = new Set<number>();
  for (const r of rowIndexes) for (const [col, val] of grid.get(r)!) if (val !== "") usedCols.add(col);
  const minCol = Math.min(...usedCols);
  const firstRow = rowIndexes[0];
  const lastRow = rowIndexes[rowIndexes.length - 1];
  const rows: string[][] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const cells: string[] = [];
    for (let col = minCol; col <= maxCol; col++) cells.push(grid.get(r)?.get(col) ?? "");
    rows.push(cells);
  }
  const align: Align[] = [];
  for (let col = minCol; col <= maxCol; col++) align.push(headerAlign.get(col) ?? null);
  return { name, table: markdownTable(rows, align), lines };
}

function readWorkbook(files: PackageFiles): SheetData[] {
  const source = text(files, "xl/workbook.xml");
  if (!source) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
  const workbook = parseXml(source, "workbook.xml");
  const rels = readRels(files, "xl/workbook.xml");
  const { formats, codes } = readStyles(files);

  let strings: Element[] = [];
  const sharedRel = Array.from(rels.values()).find((r) => r.type.endsWith("/sharedStrings"));
  const sharedSource = sharedRel ? text(files, sharedRel.target) : null;
  if (sharedSource) strings = descendants(parseXml(sharedSource, "sharedStrings.xml"), "si");

  return descendants(workbook, "sheet").flatMap((sheet) => {
    const rel = rels.get(attr(sheet, "id") ?? "");
    if (!rel || !rel.type.endsWith("/worksheet")) return [];
    return [readSheet(files, rel.target, attr(sheet, "name") ?? "Feuille", strings, formats, codes)];
  });
}

function structuralMarkdown(sheets: SheetData[]): string {
  const sections = sheets.filter((s) => s.table).map((s) => `## ${s.name}\n\n${s.table}`);
  return sections.length ? `${sections.join("\n\n")}\n` : "";
}

/** The original document with each table replaced by its sheet as edited in Excel. */
function mergeIntoSource(bridge: Bridge, sheets: SheetData[]): string {
  if (bridge.extra.layout === "text") {
    const lines = sheets[0]?.lines ?? [];
    return `${lines.join("\n").replace(/\n+$/, "")}\n`;
  }

  let names: string[] = [];
  try {
    names = JSON.parse(bridge.extra.sheets ?? "[]") as string[];
  } catch {
    names = [];
  }
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const lines = bridge.source.split("\n");
  const tables = parseMarkdown(bridge.source).tokens.filter((t) => t.type === "table_open" && t.map);

  // From the last table up, so earlier line numbers stay valid.
  for (let i = tables.length - 1; i >= 0; i--) {
    const [start, end] = tables[i].map!;
    const sheet = names[i] !== undefined ? byName.get(names[i]) : undefined;
    // Keep the container prefix (list indentation, `> `) of the original table.
    const prefix = /^[\s>]*/.exec(lines[start])?.[0] ?? "";
    const replacement = sheet?.table ? sheet.table.split("\n").map((l) => prefix + l) : [];
    lines.splice(start, end - start, ...replacement);
  }

  let merged = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const added = sheets.filter((s) => s.table && !names.includes(s.name));
  if (added.length) merged = `${merged.trimEnd()}\n\n${structuralMarkdown(added)}`;
  return merged.endsWith("\n") ? merged : `${merged}\n`;
}

export async function xlsxToMarkdown(bytes: Uint8Array): Promise<string> {
  const files = unzipPackage(bytes);
  const sheets = readWorkbook(files);
  const structural = structuralMarkdown(sheets);
  const bridge = readBridge(files);
  if (!bridge) return structural;
  if (bridge.fingerprint === (await fingerprint(structural))) return bridge.source;
  return mergeIntoSource(bridge, sheets);
}
