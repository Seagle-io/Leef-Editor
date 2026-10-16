/**
 * Markdown ⇄ Word / Excel must never lose information. These tests pin:
 *  - the bridge: an untouched .docx / .xlsx gives back the exact source;
 *  - the structural conversion (used once the file was edited in Office):
 *    every construct GMD renders survives without the bridge;
 *  - reading Office files Leef didn't write.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { renderDocument } from "../markdown";
import { markdownToDocx } from "./docxWriter";
import { docxToMarkdown } from "./docxReader";
import { markdownToXlsx, xlsxToMarkdown } from "./xlsx";

// Only the XML parser is borrowed from jsdom: a full jsdom environment would
// swap the global Uint8Array for its own, which fflate doesn't recognise.
globalThis.DOMParser = new JSDOM().window.DOMParser;

const FULL_DOCUMENT = `# Rapport *annuel*

Un paragraphe avec du **gras**, de l'*italique*, du ~~barré~~, du \`code\`,
un [lien](https://seagle.io "Seagle") et une URL nue https://exemple.fr.

## Listes

- Premier
- Deuxième
  - Imbriqué
    1. Profond
- Troisième

3. Trois
4. Quatre

> Une citation
> sur deux lignes.

\`\`\`ts
const x: number = 1;
	if (x) { return "\`\`"; }
\`\`\`

\`\`\`mermaid
graph TD
  A-->B
\`\`\`

| Produit | Prix | Stock |
| :------ | ---: | :---: |
| Pomme   | 1.5  | 12    |
| Poire \\| bis | 2 | **rupture** |

!!! warning "Attention"
Contenu de la **note**.
!!!

Une affirmation[^1] et une autre[^source].

\\pagebreak

Après le saut, [retour au titre](#rapport-annuel).

---

Ligne avec saut\\
forcé et un ![logo](https://exemple.fr/logo.png "Logo").

[^1]: La première note.
[^source]: Une note *nommée*.
`;

/** Removes the bridge so the import has to rely on the Word / Excel content alone. */
function stripBridge(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  for (const name of Object.keys(files)) if (name.startsWith("customXml/")) delete files[name];
  return zipSync(files);
}

/** Simulates an edit made in Office: rewrites one part of the package. */
function editPart(bytes: Uint8Array, part: string, edit: (xml: string) => string): Uint8Array {
  const files = unzipSync(bytes);
  files[part] = strToU8(edit(strFromU8(files[part])));
  return zipSync(files);
}

/** Same rendering = no information lost, whatever the Markdown spelling. */
function rendered(markdown: string): string {
  return renderDocument(markdown)
    .html.replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}

describe("Markdown → Word → Markdown", () => {
  it("gives back the exact source when the file wasn't edited in Word", async () => {
    const docx = await markdownToDocx(FULL_DOCUMENT, { title: "Rapport" });
    expect(await docxToMarkdown(docx)).toBe(FULL_DOCUMENT);
  });

  it("renders identically without the bridge (structural conversion)", async () => {
    const docx = stripBridge(await markdownToDocx(FULL_DOCUMENT, { title: "Rapport" }));
    const result = await docxToMarkdown(docx);
    expect(rendered(result)).toBe(rendered(FULL_DOCUMENT));
  });

  it("keeps Markdown-only constructs through Word content controls", async () => {
    const result = await docxToMarkdown(stripBridge(await markdownToDocx(FULL_DOCUMENT, { title: "Rapport" })));
    expect(result).toContain("```ts\nconst x: number = 1;");
    expect(result).toContain("```mermaid\ngraph TD\n  A-->B\n```");
    expect(result).toContain('!!! warning "Attention"\nContenu de la **note**.\n!!!');
    expect(result).toContain("[^source]: Une note *nommée*.");
    expect(result).toContain("\\pagebreak");
    expect(result).toContain("[retour au titre](#rapport-annuel)");
    expect(result).toContain('![logo](https://exemple.fr/logo.png "Logo")');
    expect(result).toContain("| Poire \\| bis |");
  });

  it("takes Word edits into account instead of the stale embedded source", async () => {
    const docx = await markdownToDocx("# Titre\n\nTexte original.\n", { title: "t" });
    const edited = editPart(docx, "word/document.xml", (xml) => xml.replace("Texte original.", "Texte modifié dans Word."));
    const result = await docxToMarkdown(edited);
    expect(result).toBe("# Titre\n\nTexte modifié dans Word.\n");
  });

  it("ignores Word's own re-save noise (split runs, rsids, proofing marks)", async () => {
    const docx = await markdownToDocx("Bonjour **tout le monde**.\n", { title: "t" });
    const resaved = editPart(docx, "word/document.xml", (xml) =>
      xml
        .replace("<w:t xml:space=\"preserve\">Bonjour </w:t></w:r>", '<w:t xml:space="preserve">Bon</w:t></w:r><w:proofErr w:type="spellStart"/><w:r w:rsidR="00A1"><w:t xml:space="preserve">jour </w:t></w:r>')
        .replace("<w:body>", '<w:body><w:bookmarkStart w:id="99" w:name="_GoBack"/><w:bookmarkEnd w:id="99"/>'),
    );
    expect(await docxToMarkdown(resaved)).toBe("Bonjour **tout le monde**.\n");
  });

  it("embeds images when they can be loaded", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const source = "![Schéma](schema.png)\n";
    const docx = await markdownToDocx(source, {
      title: "t",
      resolveImage: async () => ({ data: png, width: 100, height: 50, extension: "png" }),
    });
    const files = unzipSync(docx);
    expect(files["word/media/image1.png"]).toEqual(png);
    expect(await docxToMarkdown(stripBridge(docx))).toBe(source);
  });

  it("writes page size, header and footer fields", async () => {
    const docx = await markdownToDocx("Texte\n", {
      title: "Doc",
      page: { widthMm: 210, heightMm: 297, marginMm: 20, header: "{title}", footer: "{page} / {pages}" },
    });
    const files = unzipSync(docx);
    const document = strFromU8(files["word/document.xml"]);
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(strFromU8(files["word/footer1.xml"])).toContain(" NUMPAGES ");
    expect(strFromU8(files["word/header1.xml"])).toContain("Doc");
  });
});

describe("Word documents not written by Leef", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function wordDocument(body: string, extra: Record<string, string> = {}): Uint8Array {
    return zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
      "word/styles.xml": strToU8(
        `<w:styles ${W}>` +
          `<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Quote"/></w:style>` +
          `</w:styles>`,
      ),
      "word/numbering.xml": strToU8(
        `<w:numbering ${W}><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>` +
          `<w:abstractNum w:abstractNumId="8"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>` +
          `<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="8"/></w:num></w:numbering>`,
      ),
      "word/_rels/document.xml.rels": strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://seagle.io" TargetMode="External"/></Relationships>`,
      ),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
    });
  }

  const p = (content: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
  const r = (value: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${value}</w:t></w:r>`;

  it("reads localized heading styles, formatting, links and lists", async () => {
    const body =
      p(r("Titre"), '<w:pStyle w:val="Titre1"/>') +
      p(r("Du ") + r("gras", "<w:b/>") + r(" et ") + r("italique", "<w:i/>") + r(" et ") + `<w:hyperlink r:id="rId9">${r("un lien")}</w:hyperlink>`) +
      p(r("un"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
      p(r("sous"), '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>') +
      p(r("deux"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
      p(r("étape"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
      p(r("Sage parole"), '<w:pStyle w:val="Citation"/>') +
      p("") +
      p(r("2 * 3 = 6 et # pas un titre"));
    expect(await docxToMarkdown(wordDocument(body))).toBe(
      "# Titre\n\nDu **gras** et *italique* et [un lien](https://seagle.io)\n\n- un\n  - sous\n- deux\n\n1. étape\n\n> Sage parole\n\n2 \\* 3 = 6 et # pas un titre\n",
    );
  });

  it("reads tables, tracked changes, HYPERLINK fields and footnotes", async () => {
    const tc = (value: string, jc = "") => `<w:tc>${p(r(value), jc ? `<w:jc w:val="${jc}"/>` : "")}</w:tc>`;
    const body =
      `<w:tbl><w:tr>${tc("Nom")}${tc("Total", "right")}</w:tr><w:tr>${tc("A")}${tc("10")}</w:tr></w:tbl>` +
      p(r("Gardé ") + `<w:del><w:r><w:delText>supprimé</w:delText></w:r></w:del>` + `<w:ins>${r("inséré")}</w:ins>`) +
      p(
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://x.fr" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
          r("site") +
          `<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      ) +
      p(r("Note") + `<w:r><w:footnoteReference w:id="5"/></w:r>`);
    const footnotes = `<w:footnotes ${W}><w:footnote w:id="5">${p(`<w:r><w:footnoteRef/></w:r>` + r(" Le détail."))}</w:footnote></w:footnotes>`;
    expect(await docxToMarkdown(wordDocument(body, { "word/footnotes.xml": footnotes }))).toBe(
      "| Nom | Total |\n| --- | ----: |\n| A   | 10    |\n\nGardé inséré\n\n[site](https://x.fr)\n\nNote[^1]\n\n[^1]: Le détail.\n",
    );
  });

  it("rejects a file that isn't a Word document", async () => {
    await expect(docxToMarkdown(strToU8("pas un zip"))).rejects.toThrow();
  });
});

describe("Markdown → Excel → Markdown", () => {
  const SOURCE = `# Budget

Introduction qui n'est pas un tableau.

## Dépenses

| Poste | Montant | Part | Date | Total |
| :---- | ------: | ---: | :--: | ----- |
| Loyer | 1200 | 60% | 2026-01-31 | =B2*12 |
| **Énergie** | 300.5 | 12.5% | 2026-02-28 14:30 | [devis](https://x.fr) |
| \`code\` *it* | 007 | | | voir https://y.fr |

## Recettes

| Source | Montant |
| --- | --- |
| Ventes | 5000 |

Conclusion.
`;

  it("gives back the exact source when the workbook wasn't edited", async () => {
    const xlsx = await markdownToXlsx(SOURCE, { title: "Budget" });
    expect(await xlsxToMarkdown(xlsx)).toBe(SOURCE);
  });

  it("writes typed cells: numbers, dates, percentages, formulas", async () => {
    const files = unzipSync(await markdownToXlsx(SOURCE, { title: "Budget" }));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="B2" s="');
    expect(sheet).toMatch(/<c r="B2"[^>]*><v>1200<\/v>/);
    expect(sheet).toMatch(/<c r="C2"[^>]*><v>0\.6<\/v>/);
    expect(sheet).toMatch(/<c r="D2"[^>]*><v>46053<\/v>/);
    expect(sheet).toMatch(/<c r="E2"[^>]*><f>B2\*12<\/f>/);
    // "007" isn't the number 7: it stays text.
    expect(sheet).toMatch(/<c r="B4" t="s"/);
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect(workbook).toContain('name="Dépenses"');
    expect(workbook).toContain('name="Recettes"');
  });

  it("reads tables back without the bridge", async () => {
    const result = await xlsxToMarkdown(stripBridge(await markdownToXlsx(SOURCE, { title: "Budget" })));
    expect(result).toContain("## Dépenses");
    expect(rendered(result.split("## Recettes")[0].split("## Dépenses")[1])).toBe(rendered(SOURCE.split("## Recettes")[0].split("## Dépenses")[1].replace("Introduction qui n'est pas un tableau.", "")));
    expect(result).toContain("| Ventes");
  });

  it("merges Excel edits into the original document, keeping the text around tables", async () => {
    const xlsx = await markdownToXlsx(SOURCE, { title: "Budget" });
    const edited = editPart(xlsx, "xl/worksheets/sheet2.xml", (xml) => xml.replace("<v>5000</v>", "<v>6500</v>"));
    const result = await xlsxToMarkdown(edited);
    expect(result).toContain("Introduction qui n'est pas un tableau.");
    expect(result).toContain("Conclusion.");
    expect(result).toContain("6500");
    expect(result).not.toContain("5000");
    expect(result.indexOf("6500")).toBeLessThan(result.indexOf("Conclusion."));
  });

  it("keeps a document without tables as lines", async () => {
    const source = "# Notes\n\nPas de tableau ici.\n";
    const xlsx = await markdownToXlsx(source, { title: "Notes" });
    expect(await xlsxToMarkdown(xlsx)).toBe(source);
    const edited = editPart(xlsx, "xl/sharedStrings.xml", (xml) => xml.replace("Pas de tableau ici.", "Modifié dans Excel."));
    expect(await xlsxToMarkdown(edited)).toBe("# Notes\n\nModifié dans Excel.\n");
  });
});

describe("pasting cells from a spreadsheet", () => {
  it("turns tab-separated cells into a GFM table", async () => {
    const { tsvToMarkdownTable } = await import("./tsv");
    expect(tsvToMarkdownTable('Nom\tPrix\r\nPomme\t1,50 €\r\n"Deux\nlignes"\t"a ""b"" | c"\r\n')).toBe(
      '| Nom         | Prix       |\n| ----------- | ---------- |\n| Pomme       | 1,50 €     |\n| Deux lignes | a "b" \\| c |',
    );
    expect(tsvToMarkdownTable("une seule colonne\nde texte")).toBeNull();
  });
});
