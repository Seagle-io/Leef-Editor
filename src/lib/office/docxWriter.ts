/**
 * Markdown → Word (.docx), written straight from markdown-it tokens.
 *
 * Every construct maps to a native Word feature (styles, real lists, real
 * footnotes, tables, hyperlinks, page breaks, header / footer fields) so the
 * document behaves like one written in Word. What Word has no notion of —
 * code language, Mermaid, admonition type, named footnote labels — rides in
 * content controls (`w:sdt` tags), which Word keeps when the file is edited.
 */
import { strToU8 } from "fflate";
import { parseMarkdown, type MarkdownToken } from "../markdown";
import { addBridge, fingerprint } from "./bridge";
import { readDocxStructure } from "./docxReader";
import { escapeXml, OFFICE_REL, relsXml, XML_HEADER, zipPackage, type PackageFiles } from "./xml";

export interface ImageData {
  data: Uint8Array;
  /** Pixel size, used to keep the aspect ratio. */
  width: number;
  height: number;
  extension: "png" | "jpeg" | "gif";
}

export interface PageSetup {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  /** Header / footer templates (`{page}`, `{pages}`, `{title}`, `{date}`, `|` columns). */
  header: string;
  footer: string;
}

export interface DocxOptions {
  title: string;
  page?: PageSetup;
  /** Loads an image's bytes; without it (or on failure) images stay links. */
  resolveImage?: (src: string) => Promise<ImageData | null>;
}

const W_NS =
  'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const MM_TO_TWIP = 1440 / 25.4;
const PX_TO_EMU = 9525;
const LIST_INDENT = 720;
const CODE_FONT = "Consolas";

const ADMONITION_COLORS: Record<string, { border: string; fill: string }> = {
  note: { border: "448AFF", fill: "ECF3FF" },
  info: { border: "00B8D4", fill: "E5F8FB" },
  tip: { border: "00BFA5", fill: "E5F8F6" },
  success: { border: "00C853", fill: "E5F9ED" },
  warning: { border: "FF9100", fill: "FFF4E5" },
  danger: { border: "FF1744", fill: "FFE8EC" },
};

function admonitionColors(type: string) {
  return ADMONITION_COLORS[type] ?? ADMONITION_COLORS.note;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function textRun(value: string, rPr: string): string {
  const props = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
  // Tabs are their own element in WordprocessingML.
  return value
    .split("\t")
    .map((part, i) => (i > 0 ? `<w:r>${props}<w:tab/></w:r>` : "") + (part ? `<w:r>${props}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>` : ""))
    .join("");
}

interface ListLevel {
  numId: number;
  ordered: boolean;
}

interface Inline {
  bold: number;
  italic: number;
  strike: number;
  link: { open: string; runs: string[] } | null;
}

class DocxBuilder {
  private rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  private media: PackageFiles = {};
  private nums: { numId: number; ordered: boolean; level: number; start: number }[] = [];
  private footnoteBodies = new Map<number, string>();
  private footnoteRefs: { wordId: number; footnoteId: number }[] = [];
  private headingBookmarks = new Map<string, string>();
  private nextRel = 1;
  private nextDocPr = 1;
  private nextBookmark = 1;
  private nextSdt = 1;
  private images = new Map<string, ImageData | null>();

  constructor(private readonly options: DocxOptions) {}

  private rel(type: string, target: string, external = false): string {
    const id = `rId${this.nextRel++}`;
    this.rels.push({ id, type: `${OFFICE_REL}/${type}`, target, external });
    return id;
  }

  private sdtId(): number {
    return this.nextSdt++;
  }

  // --- Preparation (async: images) ------------------------------------------

  async prepare(tokens: MarkdownToken[]): Promise<void> {
    for (const token of tokens) {
      if (token.type === "heading_open") {
        const id = token.attrGet("id");
        if (id) this.headingBookmarks.set(id, `_Leef${this.nextBookmark++}`);
      }
      for (const child of token.children ?? []) {
        if (child.type !== "image") continue;
        const src = child.attrGet("src") ?? "";
        if (this.images.has(src)) continue;
        let data: ImageData | null = null;
        try {
          data = (await this.options.resolveImage?.(src)) ?? null;
        } catch {
          // An unreachable image is exported as a link to it, never dropped.
          data = null;
        }
        this.images.set(src, data);
      }
    }
  }

  // --- Blocks -----------------------------------------------------------------

  /** Renders block tokens; the footnote block is rendered separately into footnotes.xml. */
  body(tokens: MarkdownToken[]): string {
    const out: string[] = [];
    const lists: ListLevel[] = [];
    // Whether the next paragraph is the first of a list item (gets the bullet / number).
    let itemStart = false;
    let quoteDepth = 0;
    const admonitions: string[] = [];
    let footnote: { id: number; paragraphs: string[] } | null = null;
    let headingLevel = 0;
    let headingId: string | null = null;
    let table: { rows: string[]; cells: string[]; header: boolean; align: (string | null)[]; cell: number } | null = null;

    const target = () => (footnote ? footnote.paragraphs : out);

    const paragraphProps = (extra = "", style?: string): string => {
      let pStyle = style;
      let numPr = "";
      let ind = "";
      if (!pStyle && footnote) pStyle = "FootnoteText";
      if (lists.length > 0) {
        const level = lists.length - 1;
        if (itemStart) {
          numPr = `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${lists[level].numId}"/></w:numPr>`;
          pStyle ??= "ListParagraph";
        } else {
          ind = `<w:ind w:left="${(level + 1) * LIST_INDENT}"/>`;
          pStyle ??= "ListParagraph";
        }
        itemStart = false;
      }
      if (!pStyle && quoteDepth > 0) pStyle = "Quote";
      if (quoteDepth > 1 && !ind) ind = `<w:ind w:left="${quoteDepth * 432}"/>`;
      let decoration = "";
      if (admonitions.length > 0) {
        const colors = admonitionColors(admonitions[admonitions.length - 1]);
        decoration =
          `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${colors.border}"/></w:pBdr>` +
          `<w:shd w:val="clear" w:color="auto" w:fill="${colors.fill}"/>`;
        if (!ind) ind = `<w:ind w:left="240" w:right="240"/>`;
      }
      const styleXml = pStyle ? `<w:pStyle w:val="${pStyle}"/>` : "";
      return `<w:pPr>${styleXml}${numPr}${decoration}${extra}${ind}</w:pPr>`;
    };

    const codeBlock = (code: string, tag: string) => {
      const lines = code.replace(/\n$/, "").split("\n");
      const runs = lines.map((line, i) => (i > 0 ? `<w:r><w:br/></w:r>` : "") + textRun(line, "")).join("");
      const id = this.sdtId();
      target().push(
        `<w:sdt><w:sdtPr><w:tag w:val="${escapeXml(tag)}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent>` +
          `<w:p>${paragraphProps("", "LeefCode")}${runs}</w:p></w:sdtContent></w:sdt>`,
      );
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      switch (token.type) {
        case "heading_open":
          headingLevel = Number(token.tag.slice(1));
          headingId = token.attrGet("id");
          break;
        case "heading_close":
          headingLevel = 0;
          headingId = null;
          break;
        case "paragraph_open":
        case "paragraph_close":
        case "thead_open":
        case "thead_close":
        case "tbody_open":
        case "tbody_close":
        case "footnote_anchor":
          break;
        case "inline": {
          if (table) {
            table.cells.push(this.inline(token.children ?? []));
            break;
          }
          if (tokens[i - 1]?.type === "admonition_title_open") {
            const runs = this.inline(token.children ?? []);
            target().push(`<w:p>${paragraphProps("", "LeefAdmonitionTitle")}${runs}</w:p>`);
            break;
          }
          const runs = this.inline(token.children ?? []);
          if (headingLevel > 0) {
            const bookmark = headingId ? this.headingBookmarks.get(headingId) : undefined;
            const id = this.nextBookmark++;
            const marked = bookmark
              ? `<w:bookmarkStart w:id="${id}" w:name="${bookmark}"/>${runs}<w:bookmarkEnd w:id="${id}"/>`
              : runs;
            target().push(`<w:p>${paragraphProps("", `Heading${headingLevel}`)}${marked}</w:p>`);
          } else {
            const firstInFootnote = footnote !== null && footnote.paragraphs.length === 0;
            const marker = firstInFootnote
              ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`
              : "";
            target().push(`<w:p>${paragraphProps()}${marker}${runs}</w:p>`);
          }
          break;
        }
        case "blockquote_open":
          quoteDepth++;
          break;
        case "blockquote_close":
          quoteDepth--;
          break;
        case "bullet_list_open":
        case "ordered_list_open": {
          const ordered = token.type === "ordered_list_open";
          const numId = this.nums.length + 1;
          this.nums.push({ numId, ordered, level: lists.length, start: Number(token.attrGet("start") ?? 1) });
          lists.push({ numId, ordered });
          break;
        }
        case "bullet_list_close":
        case "ordered_list_close":
          lists.pop();
          break;
        case "list_item_open":
          itemStart = true;
          break;
        case "list_item_close":
          // An empty item still needs its bullet.
          if (itemStart) target().push(`<w:p>${paragraphProps()}</w:p>`);
          itemStart = false;
          break;
        case "fence": {
          const info = token.info.trim();
          codeBlock(token.content, info === "mermaid" ? "leef:mermaid" : `leef:code:${info}`);
          break;
        }
        case "code_block":
          codeBlock(token.content, "leef:code:");
          break;
        case "hr":
          target().push(`<w:p>${paragraphProps("", "LeefRule")}</w:p>`);
          break;
        case "pagebreak":
          target().push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
          break;
        case "admonition_open": {
          const type = token.info.trim().split(/\s+/)[0] || "note";
          admonitions.push(type);
          target().push(
            `<w:sdt><w:sdtPr><w:tag w:val="leef:admonition:${escapeXml(type)}"/><w:id w:val="${this.sdtId()}"/></w:sdtPr><w:sdtContent>`,
          );
          break;
        }
        case "admonition_close":
          admonitions.pop();
          target().push(`</w:sdtContent></w:sdt>`);
          break;
        case "admonition_title_open":
        case "admonition_title_close":
          break;
        case "table_open":
          table = { rows: [], cells: [], header: false, align: [], cell: 0 };
          break;
        case "tr_open":
          if (table) {
            table.cells = [];
            table.cell = 0;
          }
          break;
        case "th_open":
        case "td_open":
          if (table) {
            table.header = token.type === "th_open";
            const style = token.attrGet("style") ?? "";
            const align = /text-align:\s*(left|center|right)/.exec(style)?.[1] ?? null;
            if (table.header) table.align.push(align);
          }
          break;
        case "th_close":
        case "td_close":
          if (table) table.cell++;
          break;
        case "tr_close":
          if (table) {
            const isHeader = table.rows.length === 0;
            const cells = table.cells
              .map((runs, c) => {
                const jc = table!.align[c] ? `<w:jc w:val="${table!.align[c]}"/>` : "";
                return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${jc}</w:pPr>${runs}</w:p></w:tc>`;
              })
              .join("");
            const trPr = isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
            table.rows.push(`<w:tr>${trPr}${cells}</w:tr>`);
          }
          break;
        case "table_close":
          if (table) {
            const cols = Math.max(1, table.align.length);
            const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join("");
            target().push(
              `<w:tbl><w:tblPr><w:tblStyle w:val="LeefTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
                `<w:tblGrid>${grid}</w:tblGrid>${table.rows.join("")}</w:tbl>`,
            );
            // Word merges two adjacent tables; an empty paragraph keeps them apart.
            if (tokens[i + 1]?.type === "table_open") target().push("<w:p/>");
            table = null;
          }
          break;
        case "footnote_block_open":
        case "footnote_block_close":
          break;
        case "footnote_open":
          footnote = { id: Number(token.meta?.id ?? 0), paragraphs: [] };
          break;
        case "footnote_close":
          if (footnote) this.footnoteBodies.set(footnote.id, footnote.paragraphs.join(""));
          footnote = null;
          break;
        default:
          break;
      }
    }
    return out.join("");
  }

  // --- Inline -----------------------------------------------------------------

  private inline(children: MarkdownToken[]): string {
    const state: Inline = { bold: 0, italic: 0, strike: 0, link: null };
    const out: string[] = [];

    // Element order follows the CT_RPr schema (rStyle, b, i, strike).
    const rPr = (style = state.link ? "Hyperlink" : "") => {
      let props = style ? `<w:rStyle w:val="${style}"/>` : "";
      if (state.bold > 0) props += "<w:b/>";
      if (state.italic > 0) props += "<w:i/>";
      if (state.strike > 0) props += "<w:strike/>";
      return props;
    };
    const emit = (xml: string) => (state.link ? state.link.runs.push(xml) : out.push(xml));

    for (const token of children) {
      switch (token.type) {
        case "text":
          emit(textRun(token.content, rPr()));
          break;
        case "softbreak":
          emit(textRun(" ", rPr()));
          break;
        case "hardbreak":
          emit(`<w:r><w:br/></w:r>`);
          break;
        case "strong_open":
          state.bold++;
          break;
        case "strong_close":
          state.bold--;
          break;
        case "em_open":
          state.italic++;
          break;
        case "em_close":
          state.italic--;
          break;
        case "s_open":
          state.strike++;
          break;
        case "s_close":
          state.strike--;
          break;
        case "code_inline":
          emit(textRun(token.content, rPr("LeefCodeChar")));
          break;
        case "link_open": {
          const href = token.attrGet("href") ?? "";
          const title = token.attrGet("title");
          const tooltip = title ? ` w:tooltip="${escapeXml(title)}"` : "";
          const bookmark = href.startsWith("#") ? this.headingBookmarks.get(safeDecode(href.slice(1))) : undefined;
          const open = bookmark
            ? `<w:hyperlink w:anchor="${bookmark}"${tooltip} w:history="1">`
            : `<w:hyperlink r:id="${this.rel("hyperlink", href, true)}"${tooltip} w:history="1">`;
          state.link = { open, runs: [] };
          break;
        }
        case "link_close":
          if (state.link) {
            const { open, runs } = state.link;
            state.link = null;
            out.push(`${open}${runs.join("")}</w:hyperlink>`);
          }
          break;
        case "image":
          emit(this.image(token));
          break;
        case "footnote_ref":
          emit(this.footnoteRef(token));
          break;
        default:
          if (token.content) emit(textRun(token.content, rPr()));
          break;
      }
    }
    return out.join("");
  }

  private footnoteRef(token: MarkdownToken): string {
    const footnoteId = Number(token.meta?.id ?? 0);
    const label = String(token.meta?.label ?? footnoteId + 1);
    const wordId = this.footnoteRefs.length + 1;
    this.footnoteRefs.push({ wordId, footnoteId });
    const run = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${wordId}"/></w:r>`;
    // Numbered labels follow first-reference order and need nothing more. A
    // named label (`[^source]`), or a second reference to the same note (Word
    // notes have exactly one reference each), is kept in a content-control tag.
    if (label === String(footnoteId + 1) && !token.meta?.subId) return run;
    return `<w:sdt><w:sdtPr><w:tag w:val="leef:fn:${escapeXml(label)}"/><w:id w:val="${this.sdtId()}"/></w:sdtPr><w:sdtContent>${run}</w:sdtContent></w:sdt>`;
  }

  private image(token: MarkdownToken): string {
    const src = token.attrGet("src") ?? "";
    const alt = token.content || "";
    const title = token.attrGet("title") ?? "";
    const data = this.images.get(src) ?? null;

    if (!data) {
      // Not embeddable: a link to the image, tagged so it comes back as `![…](…)`.
      const tooltip = title ? ` w:tooltip="${escapeXml(title)}"` : "";
      const id = this.rel("hyperlink", src, true);
      return (
        `<w:sdt><w:sdtPr><w:tag w:val="leef:img"/><w:id w:val="${this.sdtId()}"/></w:sdtPr><w:sdtContent>` +
        `<w:hyperlink r:id="${id}"${tooltip} w:history="1">${textRun(alt || src, `<w:rStyle w:val="Hyperlink"/>`)}</w:hyperlink>` +
        `</w:sdtContent></w:sdt>`
      );
    }

    const index = Object.keys(this.media).length + 1;
    const name = `image${index}.${data.extension}`;
    this.media[`word/media/${name}`] = data.data;
    const relId = this.rel("image", `media/${name}`);

    const page = this.options.page;
    const maxWidthPx = page ? ((page.widthMm - 2 * page.marginMm) / 25.4) * 96 : 600;
    const scale = data.width > maxWidthPx ? maxWidthPx / data.width : 1;
    const cx = Math.max(1, Math.round(data.width * scale * PX_TO_EMU));
    const cy = Math.max(1, Math.round(data.height * scale * PX_TO_EMU));
    const docPr = this.nextDocPr++;
    // The original src (unless it is the image itself, as a data: URI) is kept
    // in the shape name so the Markdown link survives the round trip.
    const shapeName = src.startsWith("data:") ? `Image ${docPr}` : `leef-src:${src}`;
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPr}" name="${escapeXml(shapeName)}" descr="${escapeXml(alt)}"${title ? ` title="${escapeXml(title)}"` : ""}/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${docPr}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    );
  }

  // --- Package parts ----------------------------------------------------------

  private numberingXml(): string {
    const bullets = ["•", "◦", "▪"];
    const levels = (ordered: boolean) =>
      Array.from({ length: 9 }, (_, l) => {
        const fmt = ordered ? "decimal" : "bullet";
        const lvlText = ordered ? `%${l + 1}.` : bullets[l % 3];
        return (
          `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/>` +
          `<w:pPr><w:ind w:left="${(l + 1) * LIST_INDENT}" w:hanging="360"/></w:pPr></w:lvl>`
        );
      }).join("");
    const abstracts =
      `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>`;
    // One instance per Markdown list, so each ordered list restarts at its own `start`.
    const nums = this.nums
      .map(
        (n) =>
          `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.ordered ? 1 : 0}"/>` +
          `<w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`,
      )
      .join("");
    return `${XML_HEADER}<w:numbering ${W_NS}>${abstracts}${nums}</w:numbering>`;
  }

  private footnotesXml(): string {
    const separators =
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`;
    const notes = this.footnoteRefs
      .map(({ wordId, footnoteId }) => {
        const body = this.footnoteBodies.get(footnoteId) || `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r></w:p>`;
        return `<w:footnote w:id="${wordId}">${body}</w:footnote>`;
      })
      .join("");
    return `${XML_HEADER}<w:footnotes ${W_NS}>${separators}${notes}</w:footnotes>`;
  }

  private band(kind: "hdr" | "ftr", template: string, textWidth: number): string {
    const parts = template.split("|");
    const slots = parts.length === 1 ? ["", parts[0], ""] : parts.length === 2 ? [parts[0], "", parts[1]] : parts.slice(0, 3);
    const field = (instr: string, shown: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${textRun(shown, "")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const renderSlot = (slot: string) =>
      slot
        .trim()
        .split(/(\{page\}|\{pages\}|\{title\}|\{date\})/)
        .map((piece) => {
          if (piece === "{page}") return field("PAGE", "1");
          if (piece === "{pages}") return field("NUMPAGES", "1");
          if (piece === "{date}") return field('DATE \\@ "dd/MM/yyyy"', new Date().toLocaleDateString("fr-FR"));
          if (piece === "{title}") return textRun(this.options.title, "");
          return textRun(piece, "");
        })
        .join("");
    const runs = slots.map(renderSlot).join(`<w:r><w:tab/></w:r>`);
    const tabs = `<w:tabs><w:tab w:val="center" w:pos="${Math.round(textWidth / 2)}"/><w:tab w:val="right" w:pos="${textWidth}"/></w:tabs>`;
    const style = kind === "hdr" ? "Header" : "Footer";
    return `${XML_HEADER}<w:${kind} ${W_NS}><w:p><w:pPr><w:pStyle w:val="${style}"/>${tabs}</w:pPr>${runs}</w:p></w:${kind}>`;
  }

  build(bodyXml: string): PackageFiles {
    const files: PackageFiles = {};
    const page = this.options.page ?? { widthMm: 210, heightMm: 297, marginMm: 20, header: "", footer: "" };
    const width = Math.round(page.widthMm * MM_TO_TWIP);
    const height = Math.round(page.heightMm * MM_TO_TWIP);
    const margin = Math.round(page.marginMm * MM_TO_TWIP);
    const textWidth = width - 2 * margin;

    this.rel("styles", "styles.xml");
    this.rel("settings", "settings.xml");
    this.rel("numbering", "numbering.xml");
    this.rel("footnotes", "footnotes.xml");
    let headerRef = "";
    if (page.header.trim()) {
      files["word/header1.xml"] = strToU8(this.band("hdr", page.header, textWidth));
      headerRef = `<w:headerReference w:type="default" r:id="${this.rel("header", "header1.xml")}"/>`;
    }
    let footerRef = "";
    if (page.footer.trim()) {
      files["word/footer1.xml"] = strToU8(this.band("ftr", page.footer, textWidth));
      footerRef = `<w:footerReference w:type="default" r:id="${this.rel("footer", "footer1.xml")}"/>`;
    }

    const sectPr =
      `<w:sectPr>${headerRef}${footerRef}<w:pgSz w:w="${width}" w:h="${height}"/>` +
      `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;

    files["word/document.xml"] = strToU8(`${XML_HEADER}<w:document ${W_NS}><w:body>${bodyXml}${sectPr}</w:body></w:document>`);
    files["word/styles.xml"] = strToU8(STYLES_XML);
    files["word/settings.xml"] = strToU8(SETTINGS_XML);
    files["word/numbering.xml"] = strToU8(this.numberingXml());
    files["word/footnotes.xml"] = strToU8(this.footnotesXml());
    files["word/_rels/document.xml.rels"] = strToU8(relsXml(this.rels));
    Object.assign(files, this.media);

    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    files["docProps/core.xml"] = strToU8(
      `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${escapeXml(this.options.title)}</dc:title>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    );
    files["docProps/app.xml"] = strToU8(
      `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Leef Editor</Application></Properties>`,
    );
    files["_rels/.rels"] = strToU8(
      relsXml([
        { id: "rId1", type: `${OFFICE_REL}/officeDocument`, target: "word/document.xml" },
        { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
        { id: "rId3", type: `${OFFICE_REL}/extended-properties`, target: "docProps/app.xml" },
      ]),
    );

    const wml = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    const overrides = [
      `<Override PartName="/word/document.xml" ContentType="${wml}.document.main+xml"/>`,
      `<Override PartName="/word/styles.xml" ContentType="${wml}.styles+xml"/>`,
      `<Override PartName="/word/settings.xml" ContentType="${wml}.settings+xml"/>`,
      `<Override PartName="/word/numbering.xml" ContentType="${wml}.numbering+xml"/>`,
      `<Override PartName="/word/footnotes.xml" ContentType="${wml}.footnotes+xml"/>`,
      headerRef ? `<Override PartName="/word/header1.xml" ContentType="${wml}.header+xml"/>` : "",
      footerRef ? `<Override PartName="/word/footer1.xml" ContentType="${wml}.footer+xml"/>` : "",
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
    ].join("");
    files["[Content_Types].xml"] = strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>` +
        `${overrides}</Types>`,
    );
    return files;
  }
}

export async function markdownToDocx(source: string, options: DocxOptions): Promise<Uint8Array> {
  const { tokens } = parseMarkdown(source);
  const builder = new DocxBuilder(options);
  await builder.prepare(tokens);
  const files = builder.build(builder.body(tokens));
  // The fingerprint is what Leef itself reads back from this exact Word
  // content: if it still matches on import, nothing was edited in Word.
  addBridge(files, "word/_rels/document.xml.rels", {
    source,
    fingerprint: await fingerprint(readDocxStructure(files)),
    extra: {},
  });
  return zipPackage(files);
}

const SETTINGS_XML =
  `${XML_HEADER}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>` +
  `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
  `</w:settings>`;

function headingStyle(level: number): string {
  const sizes = [40, 32, 28, 26, 24, 22];
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${level <= 2 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:color w:val="${level <= 2 ? "1F3A93" : "2B2B2B"}"/><w:sz w:val="${sizes[level - 1]}"/><w:szCs w:val="${sizes[level - 1]}"/></w:rPr></w:style>`
  );
}

const STYLES_XML =
  `${XML_HEADER}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  [1, 2, 3, 4, 5, 6].map(headingStyle).join("") +
  `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/>` +
  `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="432"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="LeefCode"><w:name w:val="Leef Code"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:cs="${CODE_FONT}"/><w:noProof/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:customStyle="1" w:styleId="LeefCodeChar"><w:name w:val="Leef Code Char"/>` +
  `<w:rPr><w:rFonts w:ascii="${CODE_FONT}" w:hAnsi="${CODE_FONT}" w:cs="${CODE_FONT}"/><w:noProof/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="LeefRule"><w:name w:val="Leef Rule"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr><w:spacing w:after="240"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="LeefAdmonitionTitle"><w:name w:val="Leef Admonition Title"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>` +
  `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
  `<w:style w:type="table" w:customStyle="1" w:styleId="LeefTable"><w:name w:val="Leef Table"/><w:basedOn w:val="TableNormal"/>` +
  `<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders>` +
  `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
  // Header row look comes from the table style, not from run formatting, so
  // the header cells' text stays plain (no `**` on the way back).
  `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr></w:tblStylePr></w:style>` +
  `</w:styles>`;
