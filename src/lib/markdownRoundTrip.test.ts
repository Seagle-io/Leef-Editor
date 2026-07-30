/**
 * The editable preview edits the *rendered* document, then converts it back to
 * markdown. These tests pin the round trip: render → convert back must not lose
 * the constructs GMD renders specially (code fences, Mermaid, admonitions,
 * tables, footnotes, page breaks).
 */
import { describe, expect, it } from "vitest";
import { renderDocument } from "./markdown";
import { htmlToMarkdown } from "./htmlToMarkdown";

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

  it("keeps an admonition as a !!! block", async () => {
    const result = await roundTrip('!!! warning "Attention"\n    Du texte important.\n');
    expect(result).toContain('!!! warning "Attention"');
    expect(result).toContain("Du texte important.");
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
