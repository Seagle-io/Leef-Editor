/**
 * Small helpers shared by the Word and Excel converters: OOXML packages are
 * zip files of XML parts, read with the platform DOMParser and written as
 * strings.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type PackageFiles = Record<string, Uint8Array>;

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Characters XML 1.0 forbids even when escaped (control chars except tab/newline/CR).
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function zipPackage(files: PackageFiles): Uint8Array {
  // [Content_Types].xml first, as Office writes it — some readers expect it.
  const ordered: PackageFiles = {};
  if (files["[Content_Types].xml"]) ordered["[Content_Types].xml"] = files["[Content_Types].xml"];
  for (const [name, data] of Object.entries(files)) ordered[name] ??= data;
  return zipSync(ordered, { level: 6 });
}

export function unzipPackage(bytes: Uint8Array): PackageFiles {
  try {
    return unzipSync(bytes);
  } catch (err) {
    throw new Error(`Fichier Office illisible (archive zip invalide) : ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function text(files: PackageFiles, name: string): string | null {
  const data = files[name];
  return data ? strFromU8(data) : null;
}

export function putText(files: PackageFiles, name: string, content: string): void {
  files[name] = strToU8(content);
}

export function parseXml(source: string, part: string): Document {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`Partie XML invalide dans le fichier Office : ${part}`);
  }
  return doc;
}

/** Element children whose local name matches, ignoring namespace prefixes. */
export function children(el: Element, localName?: string): Element[] {
  const out: Element[] = [];
  for (let node = el.firstElementChild; node; node = node.nextElementSibling) {
    if (!localName || node.localName === localName) out.push(node);
  }
  return out;
}

export function child(el: Element, localName: string): Element | null {
  for (let node = el.firstElementChild; node; node = node.nextElementSibling) {
    if (node.localName === localName) return node;
  }
  return null;
}

/** Descendants by local name — namespace-agnostic `getElementsByTagName`. */
export function descendants(el: Element | Document, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", localName));
}

/** Attribute by local name (`w:val`, `r:id`…), whatever the prefix. */
export function attr(el: Element | null, localName: string): string | null {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) {
    if (a.localName === localName) return a.value;
  }
  return null;
}

/** OOXML on/off property: present means on, unless `w:val` says otherwise. */
export function isOn(el: Element | null): boolean {
  if (!el) return false;
  const val = attr(el, "val");
  return val === null || !["0", "false", "off", "none"].includes(val);
}

export interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

/** Reads `<dir>/_rels/<file>.rels` for a part, keyed by relationship id. */
export function readRels(files: PackageFiles, part: string): Map<string, Relationship> {
  const slash = part.lastIndexOf("/");
  const dir = part.slice(0, slash + 1);
  const relsName = `${dir}_rels/${part.slice(slash + 1)}.rels`;
  const source = text(files, relsName);
  const rels = new Map<string, Relationship>();
  if (!source) return rels;
  for (const rel of descendants(parseXml(source, relsName), "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || target === null) continue;
    const external = attr(rel, "TargetMode") === "External";
    rels.set(id, { type: attr(rel, "Type") ?? "", target: external ? target : resolvePath(dir, target), external });
  }
  return rels;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${dir}${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

export function relsXml(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
  const items = rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("");
  return `${XML_HEADER}<Relationships xmlns="${REL_NS}">${items}</Relationships>`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/wmf",
};

export function mimeOf(path: string): string {
  return MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
