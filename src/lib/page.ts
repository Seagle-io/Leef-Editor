import { writable } from "svelte/store";

export type PageFormatId = "a4" | "a5" | "letter" | "legal";

export interface PageFormat {
  id: PageFormatId;
  label: string;
  /** Page size in millimetres (portrait). */
  width: number;
  height: number;
  /** CSS `size` value used by the `@page` rule when printing. */
  cssSize: string;
}

export const pageFormats: PageFormat[] = [
  { id: "a4", label: "A4", width: 210, height: 297, cssSize: "A4 portrait" },
  { id: "a5", label: "A5", width: 148, height: 210, cssSize: "A5 portrait" },
  { id: "letter", label: "Letter", width: 215.9, height: 279.4, cssSize: "Letter portrait" },
  { id: "legal", label: "Legal", width: 215.9, height: 355.6, cssSize: "Legal portrait" },
];

/** Page margin, in millimetres, on all four sides. */
export const PAGE_MARGIN_MM = 20;
/** Vertical space reserved at the top / bottom of each page for the header
 *  and footer bands. Only counted when the corresponding text is non-empty. */
export const PAGE_HEADER_MM = 10;
export const PAGE_FOOTER_MM = 10;

/** CSS defines 1in as exactly 96px, so millimetres convert deterministically. */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}

const FORMAT_IDS = pageFormats.map((f) => f.id);
const FORMAT_KEY = "gmd-page-format";
const MODE_KEY = "gmd-page-mode";
const HEADER_KEY = "gmd-page-header";
const FOOTER_KEY = "gmd-page-footer";

export const DEFAULT_FOOTER = "{page} / {pages}";

function isFormatId(value: string | null): value is PageFormatId {
  return value !== null && (FORMAT_IDS as string[]).includes(value);
}

function initialFormat(): PageFormatId {
  const stored = localStorage.getItem(FORMAT_KEY);
  return isFormatId(stored) ? stored : "a4";
}

export const pageFormat = writable<PageFormatId>(initialFormat());
export const pageMode = writable<boolean>(localStorage.getItem(MODE_KEY) === "on");

/**
 * `@page { size: ... }` can't read a custom property, so the print page size
 * lives in its own stylesheet that we rewrite whenever the format changes.
 */
function applyPageSize(format: PageFormat): void {
  let style = document.getElementById("gmd-page-size") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "gmd-page-size";
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${format.cssSize}; margin: 0; }`;
}

pageFormat.subscribe((value) => {
  const format = getPageFormat(value);
  const root = document.documentElement.style;
  root.setProperty("--page-width", `${format.width}mm`);
  root.setProperty("--page-height", `${format.height}mm`);
  root.setProperty("--page-margin", `${PAGE_MARGIN_MM}mm`);
  root.setProperty("--page-band", `${PAGE_HEADER_MM}mm`);
  applyPageSize(format);
  localStorage.setItem(FORMAT_KEY, value);
});

pageMode.subscribe((value) => localStorage.setItem(MODE_KEY, value ? "on" : "off"));

export const pageHeader = writable<string>(localStorage.getItem(HEADER_KEY) ?? "");
export const pageFooter = writable<string>(localStorage.getItem(FOOTER_KEY) ?? DEFAULT_FOOTER);

pageHeader.subscribe((value) => localStorage.setItem(HEADER_KEY, value));
pageFooter.subscribe((value) => localStorage.setItem(FOOTER_KEY, value));

export interface TemplateContext {
  page: number;
  pages: number;
  title: string;
}

/**
 * Expands the placeholders allowed in a header / footer. A band can be split
 * into left / centre / right by separating the parts with `|`.
 */
export function fillTemplate(template: string, context: TemplateContext): string {
  return template
    .replace(/\{page\}/g, String(context.page))
    .replace(/\{pages\}/g, String(context.pages))
    .replace(/\{title\}/g, context.title)
    .replace(/\{date\}/g, new Date().toLocaleDateString("fr-FR"));
}

export function setPageFormat(id: PageFormatId): void {
  pageFormat.set(id);
}

export function togglePageMode(): void {
  pageMode.update((v) => !v);
}

export function getPageFormat(id: PageFormatId): PageFormat {
  return pageFormats.find((f) => f.id === id) ?? pageFormats[0];
}
