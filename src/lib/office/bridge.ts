/**
 * The Markdown ⇄ Office bridge.
 *
 * Word and Excel can't represent every Markdown construct (Mermaid source,
 * reference-style links, the exact spelling of the source…), so every .docx /
 * .xlsx Leef writes also carries the original Markdown, in a Custom XML Part —
 * the one kind of foreign data Word and Excel keep when they re-save a file.
 *
 * Next to it sits a fingerprint of what Leef reads back from the Office content
 * itself. On import:
 *  - fingerprint unchanged → the file wasn't edited in Office: the embedded
 *    Markdown is returned byte for byte;
 *  - fingerprint changed → the Office edits win, and the structural conversion
 *    (which carries Markdown-only constructs through Word content controls) is
 *    used instead — or merged with the embedded source, for Excel.
 */
import { strToU8 } from "fflate";
import {
  attr,
  base64ToBytes,
  bytesToBase64,
  descendants,
  escapeXml,
  OFFICE_REL,
  parseXml,
  text,
  XML_HEADER,
  type PackageFiles,
} from "./xml";

const BRIDGE_NS = "urn:leef-editor:bridge:1";
const CUSTOM_XML_REL = `${OFFICE_REL}/customXml`;
const CUSTOM_XML_PROPS_REL = `${OFFICE_REL}/customXmlProps`;
// Fixed: Office identifies a data-store item by this id across saves.
const ITEM_ID = "{6C1E5A3B-0D2F-4E8A-9B1C-7F4D2E8A1B3C}";

export interface Bridge {
  source: string;
  fingerprint: string;
  /** Format-specific extras (e.g. sheet ↔ table mapping for Excel). */
  extra: Record<string, string>;
}

export async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function utf8ToBase64(value: string): string {
  return bytesToBase64(strToU8(value));
}

function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}

/**
 * Adds the bridge part to a package. `ownerRels` is the relationships part of
 * the main document (`word/_rels/document.xml.rels`, `xl/_rels/workbook.xml.rels`):
 * Office only keeps custom XML parts that the main part points to.
 */
export function addBridge(files: PackageFiles, ownerRels: string, bridge: Bridge): void {
  const extras = Object.entries(bridge.extra)
    .map(([key, value]) => `<leef:meta name="${escapeXml(key)}">${escapeXml(utf8ToBase64(value))}</leef:meta>`)
    .join("");
  const item =
    `${XML_HEADER}<leef:bridge xmlns:leef="${BRIDGE_NS}" version="1">` +
    `<leef:fingerprint>${bridge.fingerprint}</leef:fingerprint>` +
    `<leef:source encoding="base64">${utf8ToBase64(bridge.source)}</leef:source>` +
    `${extras}</leef:bridge>`;
  const props =
    `${XML_HEADER}<ds:datastoreItem ds:itemID="${ITEM_ID}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
    `<ds:schemaRefs><ds:schemaRef ds:uri="${BRIDGE_NS}"/></ds:schemaRefs></ds:datastoreItem>`;

  files["customXml/item1.xml"] = strToU8(item);
  files["customXml/itemProps1.xml"] = strToU8(props);
  files["customXml/_rels/item1.xml.rels"] = strToU8(
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${CUSTOM_XML_PROPS_REL}" Target="itemProps1.xml"/></Relationships>`,
  );

  const rels = text(files, ownerRels);
  if (!rels) throw new Error(`Partie manquante : ${ownerRels}`);
  files[ownerRels] = strToU8(
    rels.replace(
      "</Relationships>",
      `<Relationship Id="rIdLeefBridge" Type="${CUSTOM_XML_REL}" Target="../customXml/item1.xml"/></Relationships>`,
    ),
  );

  const types = text(files, "[Content_Types].xml");
  if (!types) throw new Error("Partie manquante : [Content_Types].xml");
  files["[Content_Types].xml"] = strToU8(
    types.replace(
      "</Types>",
      '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>',
    ),
  );
}

/** Finds the bridge, wherever Office renumbered the custom XML items to. */
export function readBridge(files: PackageFiles): Bridge | null {
  for (const name of Object.keys(files)) {
    if (!/^customXml\/item\d+\.xml$/.test(name)) continue;
    const source = text(files, name);
    if (!source || !source.includes(BRIDGE_NS)) continue;
    const doc = parseXml(source, name);
    const sourceEl = descendants(doc, "source")[0];
    const fingerprintEl = descendants(doc, "fingerprint")[0];
    if (!sourceEl || !fingerprintEl) continue;
    const extra: Record<string, string> = {};
    for (const meta of descendants(doc, "meta")) {
      const key = attr(meta, "name");
      if (key) extra[key] = base64ToUtf8(meta.textContent ?? "");
    }
    return {
      source: base64ToUtf8(sourceEl.textContent ?? ""),
      fingerprint: (fingerprintEl.textContent ?? "").trim(),
      extra,
    };
  }
  return null;
}
