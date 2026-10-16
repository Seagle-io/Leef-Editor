/**
 * The editable preview edits the *rendered* document, then converts it back to
 * markdown. These tests pin the round trip: render → convert back must not lose
 * the constructs GMD renders specially (code fences, Mermaid, admonitions,
 * tables, footnotes, page breaks).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { strFromU8, unzipSync } from "fflate";
import { generateTocMarkdown, parseMarkdown, renderDocument } from "./markdown";
import { htmlToMarkdown } from "./htmlToMarkdown";
import { markdownToDocx } from "./office/docxWriter";

// The Word export reads its own XML back: borrow jsdom's parser only (as office.test.ts).
globalThis.DOMParser = new JSDOM().window.DOMParser;

async function roundTrip(source: string): Promise<string> {
  const { html } = renderDocument(source);
  return htmlToMarkdown(html);
}

describe("markdown round trip", () => {
  it("keeps headings, emphasis and links", async () => {
    const result = await roundTrip("# Titre\n\nDu **gras**, de l'*italique* et un [lien](https://exemple.fr).\n");
    expect(result).toContain("# Titre");
    expect(result).toContain("**gras**");
    expect(result).toContain("*italique*");
    expect(result).toContain("[lien](https://exemple.fr)");
  });

  it("keeps lists and quotes", async () => {
    const result = await roundTrip("- un\n- deux\n\n1. a\n2. b\n\n> une citation\n");
    expect(result).toContain("-   un");
    expect(result).toContain("1.  a");
    expect(result).toContain("> une citation");
  });

  it("keeps a fenced code block with its language", async () => {
    const result = await roundTrip('```js\nconsole.log("x");\n```\n');
    expect(result).toContain("```js");
    expect(result).toContain('console.log("x");');
  });

  it("keeps a Mermaid diagram (source, not the rendered SVG)", async () => {
    const result = await roundTrip("```mermaid\ngraph TD;\n  A-->B;\n```\n");
    expect(result).toContain("```mermaid");
    expect(result).toContain("A-->B;");
  });

  it("keeps a GFM table", async () => {
    const result = await roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(result).toContain("| a | b |");
    expect(result).toContain("| 1 | 2 |");
  });

  it("keeps an admonition as a closed !!! block", async () => {
    const result = await roundTrip('!!! warning "Attention"\nDu **texte** important.\n!!!\n\nAprès.\n');
    expect(result).toBe('!!! warning "Attention"\nDu **texte** important.\n!!!\n\nAprès.\n');
  });

  it("keeps a manual page break", async () => {
    const result = await roundTrip("Avant\n\n\\pagebreak\n\nAprès\n");
    expect(result).toContain("\\pagebreak");
    expect(result).toContain("Avant");
    expect(result).toContain("Après");
  });

  it("keeps footnote references and definitions", async () => {
    const result = await roundTrip("Une affirmation[^1].\n\n[^1]: La source.\n");
    expect(result).toContain("[^1]");
    expect(result).toContain("[^1]: La source.");
  });

  it("does not leak the copy-code button into the source", async () => {
    const result = await roundTrip("```\ntexte\n```\n");
    expect(result).not.toContain("Copier");
    expect(result).not.toContain("svg");
  });

  it("is stable when applied twice", async () => {
    const source = "# Titre\n\nDu **gras** et un tableau :\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const once = await roundTrip(source);
    const twice = await roundTrip(once);
    expect(twice).toBe(once);
  });
});

describe("heading ids", () => {
  const ids = (source: string): string[] => parseMarkdown(source).toc.map((item) => item.id);

  it("numbers repeated titles", () => {
    expect(ids("# A\n\n# A\n\n# A\n")).toEqual(["a", "a-1", "a-2"]);
  });

  it("never reuses an id already emitted (T023 V3)", () => {
    expect(ids("# A\n\n## A\n\n## A-1\n")).toEqual(["a", "a-1", "a-1-1"]);
    expect(ids("# A-1\n\n# A\n\n# A\n")).toEqual(["a-1", "a", "a-2"]);
    expect(ids("# A\n\n# A\n\n# A-1\n\n# A-1\n\n# A\n")).toEqual(["a", "a-1", "a-1-1", "a-1-2", "a-2"]);
    const { html } = renderDocument("# A\n\n## A\n\n## A-1\n");
    expect(html.match(/id="[^"]*"/g)).toEqual(['id="a"', 'id="a-1"', 'id="a-1-1"']);
  });

  it("hostile titles: empty, unicode, many duplicates", () => {
    expect(ids("#\n\n# !!!\n\n# section\n")).toEqual(["section", "section-1", "section-2"]);
    expect(ids("# 😀 مرحبا é\n\n# 😀 مرحبا é\n")).toEqual(["-مرحبا-é", "-مرحبا-é-1"]);
    const many = ids(Array.from({ length: 2000 }, (_, i) => `# ${i % 2 === 0 ? "A" : `A-${i}`}`).join("\n\n"));
    expect(new Set(many).size).toBe(2000);
  });
});

describe("heading ids vs the host page ids (T030 D7)", () => {
  const ids = (source: string): string[] => parseMarkdown(source).toc.map((item) => item.id);
  const source = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), "utf8");
  const svelteFiles = (readdirSync(new URL("../", import.meta.url), { recursive: true }) as string[]).filter((f) => f.endsWith(".svelte"));
  const hostSources = [source("../../index.html"), ...svelteFiles.map((f) => source(`../${f}`))].join("\n");
  // Ids built at runtime, not as a literal `id="…"` attribute (Dialog.svelte `{id}-…`, page.ts, footnotes).
  const runtimeIds = ["leef-dialog-title", "leef-dialog-body", "leef-dialog-error", "gmd-page-size", "palette-list", "fn1", "fnref1"];
  const literalIds = [...hostSources.matchAll(/\bid="([^"{]+)"/g)].map((m) => m[1]);
  const templatePrefixes = [...hostSources.matchAll(/\bid="([^"{]+)\{/g)].map((m) => m[1]);
  const hostIds = [...literalIds, ...runtimeIds];

  it("finds the host ids it guards against", () => {
    expect(literalIds).toEqual(expect.arrayContaining(["app", "backlinks-unlinked", "ap-base", "ap-size", "themes-title", "theme-name"]));
    expect(templatePrefixes).toEqual(expect.arrayContaining(["palette-g-", "palette-opt-"]));
  });

  it("never gives a title the id of a host element", () => {
    const titles = ["App", "app", "Palette input", "ap-x", ...hostIds, ...templatePrefixes.map((p) => `${p}0`)];
    const emitted = ids(titles.map((t) => `# ${t}`).join("\n\n"));
    expect(emitted).toHaveLength(titles.length);
    expect(new Set(emitted).size).toBe(titles.length);
    expect(emitted.filter((id) => hostIds.includes(id))).toEqual([]);
    expect(emitted.filter((id) => ["ap-", "palette-", ...templatePrefixes].some((p) => id.startsWith(p)))).toEqual([]);
  });

  it("keeps a reserved title id distinct and stable", () => {
    expect(ids("# App\n\n# app\n\n# Palette input\n\n# ap-x\n")).toEqual(["section-app", "section-app-1", "section-palette-input", "section-ap-x"]);
    expect(ids("# Section App\n\n# App\n")).toEqual(["section-app", "section-app-1"]);
    expect(ids("# Palette\n\n# Palette\n")).toEqual(["section-palette", "section-palette-1"]);
    expect(generateTocMarkdown(parseMarkdown("# App\n").toc)).toBe("- [App](#section-app)\n");
  });

  it("does not collide with footnote ids", () => {
    const { html } = renderDocument("# fn1\n\n# fnref1\n\nUne note[^1].\n\n[^1]: La source.\n");
    const all = [...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the ids of ordinary titles, so existing #anchors still resolve", () => {
    const { html, toc } = renderDocument("# Titre\n\n## Mon application\n\n[voir](#titre) [app](#mon-application)\n");
    expect(toc.map((item) => item.id)).toEqual(["titre", "mon-application"]);
    expect(html).toContain('id="titre"');
    expect(html).toContain('href="#titre"');
    expect(html).toContain('id="mon-application"');
  });

  it("hostile titles stay clear of host ids", () => {
    expect(ids("#\n\n# ‏\n\n# 😀\n")).toEqual(["section", "section-1", "section-2"]);
    expect(ids("# APP\n\n# a\u0301pp\n\n# \ud800app\n")).toEqual(["section-app", "section-app-1", "section-app-2"]);
    expect(ids(`# ${"app ".repeat(25_000)}`)[0]).toHaveLength(100_000 - 1);
    expect(ids("###### app\n\n####### app\n")).toEqual(["section-app"]);
    expect(ids(Array.from({ length: 2000 }, (_, i) => `# ${i % 2 === 0 ? "App" : `palette-${i}`}`).join("\n\n")).filter((id) => hostIds.includes(id) || id.startsWith("palette-"))).toEqual([]);
    for (const wrong of [42, { a: 1 }, null, undefined]) expect(() => parseMarkdown(wrong as unknown as string)).toThrow();
  });
});

describe("manual links to a renamed title (T037 J8)", () => {
  const hrefs = (source: string): string[] => [...renderDocument(source).html.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1]);

  it("points [aller](#app) at the title « App », not at the host element", () => {
    expect(hrefs("[aller](#app)\n\n# Intro\n\n# App\n")).toEqual(["#section-app"]);
    expect(hrefs("[a](#palette-input) [b](#fn1)\n\n# Palette input\n\n# fn1\n")).toEqual(["#section-palette-input", "#section-fn1"]);
    expect(hrefs("# App\n\nVoir [ici](#app), dans une note[^1].\n\n[^1]: Et [là](#app).\n").filter((h) => !h.startsWith("#fn"))).toEqual(["#section-app", "#section-app"]);
  });

  it("follows the title's actual id when the prefixed one is taken", () => {
    expect(hrefs("[aller](#app)\n\n# Section App\n\n# App\n")).toEqual(["#section-app-1"]);
    expect(hrefs("[aller](#app)\n\n# App\n\n# App\n")).toEqual(["#section-app"]);
  });

  it("leaves ordinary anchors alone", () => {
    expect(hrefs("[a](#fin) [b](#section-app) [c](#App) [d](https://x.fr/#app)\n\n# App\n\n# Fin\n")).toEqual(["#fin", "#section-app", "#App", "https://x.fr/#app"]);
    expect(hrefs("[aller](#app)\n\n# Intro\n")).toEqual(["#app"]);
  });

  it("gives the Word export the same anchor as the preview", async () => {
    const source = "[aller](#app)\n\n# App\n";
    const xml = strFromU8(unzipSync(await markdownToDocx(source, { title: "t" }))["word/document.xml"]);
    expect(xml).toMatch(/<w:hyperlink w:anchor="_Leef\d+"/);
    expect(xml).toMatch(/<w:bookmarkStart w:id="\d+" w:name="_Leef\d+"\/>/);
  });

  it("hostile links: empty, encoded, unicode, very long", () => {
    expect(hrefs("[a](#) [b](<#>) [c](#%61pp) [d](#%E0)\n\n# App\n")).toEqual(["#", "#", "#section-app", "#%E0"]);
    expect(hrefs("[a](#ap-été) [b](#ap-%C3%A9t%C3%A9) [c](#ap-😀)\n\n# ap-été\n")).toEqual(["#section-ap-%C3%A9t%C3%A9", "#section-ap-%C3%A9t%C3%A9", "#ap-%F0%9F%98%80"]);
    expect(hrefs("[a](#\ud800app) [b](#a\u0301pp) [c](#app)\n\n# \ud800app\n\n# مرحبا\n")).toEqual(["#%EF%BF%BDapp", "#a%CC%81pp", "#section-app"]);
    const long = "ap ".repeat(30_000).trim().replace(/ /g, "-");
    expect(hrefs(`[a](#${long})\n\n# ${"ap ".repeat(30_000)}\n`)).toEqual([`#section-${long}`]);
    expect(hrefs(Array.from({ length: 2000 }, () => "[a](#app)").join(" ") + "\n\n# App\n").every((h) => h === "#section-app")).toBe(true);
  });
});
