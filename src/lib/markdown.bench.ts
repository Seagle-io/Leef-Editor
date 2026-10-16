import { bench, describe } from "vitest";
import { parseMarkdown, renderDocument } from "./markdown";

const BLOC = (i: number): string =>
  [
    `# Section ${i}`,
    "",
    `Paragraphe avec **gras**, *italique*, \`code\` et un [lien](https://example.com/${i}).`,
    "",
    "- item a",
    "- item b",
    "  - sous-item",
    "- item c",
    "",
    "| col1 | col2 | col3 |",
    "|------|------|------|",
    `| a${i} | b | c |`,
    "| d | e | f |",
    "",
    "```ts",
    `const x${i} = ${i};`,
    "```",
    "",
    `!!! note "Note ${i}"`,
    "    Contenu d'admonition.",
    "",
  ].join("\n");

function documentDe(lignes: number): string {
  const sortie: string[] = [];
  let n = 0;
  for (let i = 1; sortie.length < lignes; i++) {
    sortie.push(BLOC(i));
    n += BLOC(i).split("\n").length;
    if (n >= lignes) break;
  }
  return sortie.join("\n").split("\n").slice(0, lignes).join("\n");
}

const SOURCE = documentDe(1000);

describe("aperçu — document de 1 000 lignes", () => {
  bench("parseMarkdown", () => {
    parseMarkdown(SOURCE);
  });
  bench("renderDocument", () => {
    renderDocument(SOURCE);
  });
});
