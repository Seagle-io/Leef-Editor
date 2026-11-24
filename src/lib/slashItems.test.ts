import { describe, expect, it } from "vitest";
import { filterSlashItems, slashItems } from "./slashItems";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("filterSlashItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterSlashItems("")).toHaveLength(slashItems.length);
  });

  it("matches on the label and on the keywords", () => {
    expect(filterSlashItems("titre").map((i) => i.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterSlashItems("ul").map((i) => i.id)).toEqual(["bulletList"]);
  });

  it("ignores case and accents", () => {
    expect(filterSlashItems("NUMEROTEE").map((i) => i.id)).toEqual(["orderedList"]);
    expect(filterSlashItems("numérotée").map((i) => i.id)).toEqual(["orderedList"]);
  });

  it("returns nothing for an unknown query", () => {
    expect(filterSlashItems("zzz")).toEqual([]);
  });
});

describe("slash item HTML", () => {
  // The preview inserts HTML, which then has to survive the trip back to
  // markdown — otherwise a block inserted from the menu would be lost on save.
  const expected: Record<string, string> = {
    h1: "# Titre",
    h2: "## Titre",
    h3: "### Titre",
    bulletList: "- Élément",
    orderedList: "1. Élément",
    quote: "> Citation",
    codeBlock: "```",
    table: "| Colonne 1 | Colonne 2 | Colonne 3 |",
    admonition: "!!! note",
    mermaid: "```mermaid",
    hr: "---",
    pageBreak: "\\pagebreak",
    footnote: "[^1]",
  };

  it("covers every item in the menu", () => {
    expect(Object.keys(expected).sort()).toEqual(slashItems.map((i) => i.id).sort());
  });

  for (const item of slashItems) {
    it(`converts « ${item.label} » back to markdown`, async () => {
      expect(await htmlToMarkdown(item.html)).toContain(expected[item.id]);
    });
  }
});
