import { describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import admonition from "markdown-it-admonition";
import { noteKey, parseWikiInner, scanHeadings, scanNote, scanWikiRefs, wikiDisplay, wikiFromEdited } from "./parse";

const raws = (s: string) => scanWikiRefs(s).map((r) => r.raw);
const bestMs = (s: string, runs = 3) =>
  Math.min(
    ...Array.from({ length: runs }, () => {
      const start = performance.now();
      scanWikiRefs(s);
      return performance.now() - start;
    }),
  );

describe("parseWikiInner", () => {
  it("parses target, heading, alias", () => {
    expect(parseWikiInner("a")).toEqual({ raw: "a", target: "a", heading: null, alias: null });
    expect(parseWikiInner("a|b")).toMatchObject({ target: "a", alias: "b", heading: null });
    expect(parseWikiInner("a#T")).toMatchObject({ target: "a", heading: "T", alias: null });
    expect(parseWikiInner("a#T|x")).toMatchObject({ target: "a", heading: "T", alias: "x" });
    expect(parseWikiInner("#T")).toMatchObject({ target: "", heading: "T" });
    expect(parseWikiInner("a|b|c")).toMatchObject({ alias: "b|c" });
    expect(parseWikiInner("a#b#c")).toMatchObject({ heading: "b#c" });
  });

  it("strips .md/.markdown, keeps paths, trims", () => {
    expect(parseWikiInner(" dir/note.MD ")?.target).toBe("dir/note");
    expect(parseWikiInner("n.markdown#H")?.target).toBe("n");
    expect(parseWikiInner("n.txt")?.target).toBe("n.txt");
  });

  it("rejects invalid inner", () => {
    for (const bad of ["", "   ", "\t", "a\nb", "a[b", "a]b", "#", "|x", "#|x", ".md", "a".repeat(513)]) {
      expect(parseWikiInner(bad)).toBeNull();
    }
    expect(parseWikiInner("a".repeat(512))).not.toBeNull();
  });

  it("reads the GFM table escape \\| as the alias separator (T013 D6)", () => {
    expect(parseWikiInner("Note\\|alias")).toEqual({ raw: "Note\\|alias", target: "Note", heading: null, alias: "alias" });
    expect(parseWikiInner("Note#H\\|x")).toMatchObject({ target: "Note", heading: "H", alias: "x" });
    expect(parseWikiInner("\\|x")).toBeNull();
    expect(parseWikiInner("a\\")).toMatchObject({ target: "a\\", alias: null });
    const [r] = scanWikiRefs("| col |\n|---|\n| [[Note\\|alias]] |\n");
    expect(r).toMatchObject({ target: "Note", alias: "alias" });
  });
});

describe("scanWikiRefs", () => {
  it("finds links with offsets and 0-based lines", () => {
    const s = "x\nsee [[a]] and [[b|B]]\n";
    const refs = scanWikiRefs(s);
    expect(refs.map((r) => [r.raw, r.line])).toEqual([["a", 1], ["b|B", 1]]);
    expect(s.slice(refs[0].from, refs[0].to)).toBe("[[a]]");
    expect(s.slice(refs[1].from, refs[1].to)).toBe("[[b|B]]");
  });

  it("ignores inline code, any backtick run length", () => {
    expect(raws("`[[a]]` [[b]]")).toEqual(["b"]);
    expect(raws("``x `[[a]]` y`` [[b]]")).toEqual(["b"]);
    expect(raws("`[[a]]\n[[b]]`")).toEqual([]);
    expect(raws("`unclosed [[a]]")).toEqual(["a"]);
    expect(raws("`a\n\nb` [[c]]")).toEqual(["c"]);
  });

  it("ignores fenced blocks (``` and ~~~, same marker, >= length)", () => {
    expect(raws("```\n[[a]]\n```\n[[b]]")).toEqual(["b"]);
    expect(raws("~~~js\n[[a]]\n~~~\n[[b]]")).toEqual(["b"]);
    expect(raws("````\n```\n[[a]]\n```\n````\n[[b]]")).toEqual(["b"]);
    expect(raws("```\n~~~\n[[a]]\n~~~\n```\n[[b]]")).toEqual(["b"]);
    expect(raws("```\n[[a]]")).toEqual([]);
    expect(raws("``` `x`\n[[a]]")).toEqual(["a"]);
  });

  it("ignores indented code blocks, tab included, but not paragraph or list continuations (T013 D5)", () => {
    expect(raws("para\n\n    [[a]]\n")).toEqual([]);
    expect(raws("para\n\n\t[[a]]\n")).toEqual([]);
    expect(raws("  \t[[a]]")).toEqual([]);
    expect(raws("    [[a]]\n\n    [[b]]\n[[c]]")).toEqual(["c"]);
    expect(raws("para\n    [[a]]")).toEqual(["a"]);
    expect(raws("- a\n\n    [[b]]")).toEqual(["b"]);
    expect(raws("1. a\n\n\t[[b]]")).toEqual(["b"]);
    expect(raws("- a\n\n      [[b]]")).toEqual([]);
    expect(raws("- a\n  b\n\n    [[c]]")).toEqual(["c"]);
    expect(raws("- a\n\nb\n\n    [[c]]")).toEqual([]);
    expect(raws("para\n- a\n\n    [[b]]")).toEqual(["b"]);
    expect(raws("- a\n  - b\n\n  c\n\n    [[x]]")).toEqual(["x"]);
    expect(raws("    😀 [[a]]\n\n‏ [[ש]]")).toEqual(["ש"]);
  });

  it("a heading or a thematic break ends the paragraph: indented code right after is code (T022 F4)", () => {
    expect(raws("# T\n    [[a]]\n")).toEqual([]);
    expect(raws("***\n    [[a]]\n")).toEqual([]);
    expect(raws("- - -\n    [[a]]")).toEqual([]);
    expect(raws("  ___\n    [[a]]")).toEqual([]);
    expect(raws("para\n---\n    [[a]]")).toEqual([]);
    expect(raws("para\n===\n    [[a]]")).toEqual([]);
    expect(raws("- a\n# T\n    [[a]]")).toEqual([]);
    expect(raws("# [[h]]\n    [[a]]\n[[b]]")).toEqual(["h", "b"]);
    expect(raws("# H\n[[a]]")).toEqual(["a"]);
    expect(raws("## T\npara\n    [[a]]")).toEqual(["a"]);
    expect(raws("para\n    ***\n    [[a]]")).toEqual(["a"]);
    expect(raws("===\n    [[a]]")).toEqual(["a"]);
    expect(raws("#tag\n    [[a]]")).toEqual(["a"]);
    expect(raws("# 😀 שלום é\u0301\n    [[a]]\n".repeat(20_000))).toEqual([]);
  });

  it("short setext, heading, rule or empty marker at the head of an item, CRLF: indented code after is code, as markdown-it (T029 G2)", () => {
    for (const code of [
      "T\n--\n    [[a]]\n",
      "T\n-\n    [[a]]\n",
      "T\n  - \n    [[a]]\n",
      "> T\n> --\n>     [[a]]\n",
      "- T\n  --\n      [[a]]\n",
      "- # T\n      [[a]]\n",
      "1. # T\n       [[a]]\n",
      "- ***\n      [[a]]\n",
      "-\n      [[a]]\n",
      "-     [[a]]\n",
      "> - # T\n>       [[a]]\n",
      "#\r\n    [[a]]\r\n",
      "T\r\n--\r\n    [[a]]\r\n",
      "-\r\n      [[a]]\r\n",
    ])
      expect(raws(code), JSON.stringify(code)).toEqual([]);
    for (const text of [
      "T\n    --\n    [[a]]\n",
      "- T\n--\n    [[a]]\n",
      "> T\n--\n    [[a]]\n",
      "> T\n===\n    [[a]]\n",
      "> T\nx\n--\n    [[a]]\n",
      "T\n*\n    [[a]]\n",
      "- # T\n  [[a]]\n",
      "- [[a]]\n",
      "-  😀 [[a]]\r\n",
    ])
      expect(raws(text), JSON.stringify(text)).toEqual(["a"]);
    expect(raws("- # [[h]]\n      [[a]]")).toEqual(["h"]);
    expect(raws("- ‏שלום\n  --\n      [[a]]\n".repeat(10_000))).toEqual([]);
  });

  it("indented code inside a blockquote is code, a quote paragraph continues (T022 F4)", () => {
    expect(raws(">     [[a]]\n")).toEqual([]);
    expect(raws(">>     [[a]]")).toEqual([]);
    expect(raws("p\n>     [[a]]")).toEqual([]);
    expect(raws("> p\n>\n>     [[a]]")).toEqual([]);
    expect(raws("> > p\n>\n> >     [[a]]")).toEqual([]);
    expect(raws("> # T\n>     [[a]]")).toEqual([]);
    expect(raws(">\t\t[[a]]")).toEqual([]);
    expect(raws("> p\n>     [[a]]")).toEqual(["a"]);
    expect(raws("> p\ncont\n    [[a]]")).toEqual(["a"]);
    expect(raws(">\t[[a]]")).toEqual(["a"]);
    expect(raws("> [[a]]\n\n    [[b]]")).toEqual(["a"]);
    expect(raws(">".repeat(99) + " [[a]]")).toEqual(["a"]);
    expect(raws(">".repeat(100_000) + " [[a]]")).toEqual([]); // au-delà de maxNesting (100), l'aperçu ne rend rien (T038 D9)
  });

  it("markdown-it decides what is code, inside items and quotes too (T038 D9, T036 I1 I3 I4)", () => {
    // I1 : fence ouverte sur la ligne-marqueur d'un item, le reste du fichier est lu
    expect(raws("- ```\n  [[a]]\n  ```\n\n[[b]]\n")).toEqual(["b"]);
    expect(raws("- ```\n  code\n  ```\n\nVoir [[X]]\n")).toEqual(["X"]);
    expect(raws("1. ~~~\n   [[a]]\n   ~~~\n[[b]]")).toEqual(["b"]);
    expect(raws("> - ```\n>   [[a]]\n>   ```\n[[b]]")).toEqual(["b"]);
    // I3 : citation, ligne paresseuse, ligne citée indentée = continuation du paragraphe
    expect(raws("> T\nsuite\n>     [[X]]\n")).toEqual(["X"]);
    expect(raws("> T\n=\n>     [[a]]\n")).toEqual(["a"]);
    // I4 : marqueurs empilés sur une ligne, le code indenté qui suit reste du code
    for (const code of ["- - # T\n        [[X]]\n", "* - ***\n        [[a]]\n", "- 1. # T\n         [[a]]\n", "- > # T\n\t\t[[a]]\n"])
      expect(raws(code), JSON.stringify(code)).toEqual([]);
    expect(raws("* - T\n  ==\n\t\t[[a]]\n")).toEqual(["a"]);
    // aperçu : `\pagebreak` est un bloc, maxNesting coupe la fin, une note de bas de page sans appel n'est pas rendue
    expect(raws("\\pagebreak\n    [[a]]\n[[b]]")).toEqual(["b"]);
    expect(raws("> ".repeat(200) + "[[a]]")).toEqual([]);
    expect(raws("[^1]: [[a]]\n")).toEqual([]);
    expect(raws("x[^1]\n\n[^1]: [[a]]\n")).toEqual(["a"]);
  });

  it("CR alone and CRLF: offsets and lines point into the original text (T038 D9)", () => {
    for (const eol of ["\r", "\r\n", "\n"]) {
      const s = ["T", "--", "    [[a]]", "x [[b]]", "```", "[[c]]", "```", "> [[d|D]]"].join(eol);
      const refs = scanWikiRefs(s);
      expect(refs.map((r) => [r.raw, r.line]), JSON.stringify(eol)).toEqual([["b", 3], ["d|D", 7]]);
      for (const r of refs) expect(s.slice(r.from, r.to)).toBe(`[[${r.raw}]]`);
    }
    expect(raws("[[a\rb]] [[c]]")).toEqual(["c"]);
  });

  it("ignores escapes and embeds", () => {
    expect(raws("\\[[a]] [[b]]")).toEqual(["b"]);
    expect(raws("![[a]] [[b]]")).toEqual(["b"]);
    expect(raws("\\\\[[a]]")).toEqual(["a"]);
    expect(raws("\\`[[a]]\\`")).toEqual(["a"]);
  });

  it("handles malformed brackets", () => {
    expect(raws("[[a")).toEqual([]);
    expect(raws("[[]]")).toEqual([]);
    expect(raws("[[a [[b]]")).toEqual(["b"]);
    expect(raws("[[[a]]")).toEqual(["a"]);
    expect(raws("[[a\nb]]")).toEqual([]);
    expect(raws("[a] [[b]]]]")).toEqual(["b"]);
  });

  it("keeps case, accents, emoji, RTL, control characters verbatim", () => {
    expect(raws("[[Été]] [[😀]] [[שלום]] [[a\u0000b]] [[é]]")).toEqual(["Été", "😀", "שלום", "a\u0000b", "é"]);
  });

  it("CRLF and empty / huge input", () => {
    expect(scanWikiRefs("")).toEqual([]);
    expect(raws("a\r\n[[x]]\r\n```js\r\n[[y]]\r\n```\r\n")).toEqual(["x"]);
    expect(scanWikiRefs("a\r\n[[x]]")[0].line).toBe(1);
    const big = "[[a]] ".repeat(50_000);
    expect(scanWikiRefs(big)).toHaveLength(50_000);
    expect(scanWikiRefs("[[".repeat(100_000))).toEqual([]);
    expect(scanWikiRefs("`a ".repeat(50_000))).toEqual([]);
  });

  it("lone surrogates and U+FFFD do not break scanning", () => {
    expect(raws("\ud800 [[a]] �")).toEqual(["a"]);
  });

  it("footnotes are read without markdown-it's inline phase, in linear time (T043 K1)", () => {
    const inline = vi.spyOn(Object.getPrototypeOf(new MarkdownIt().inline), "parse");
    expect(raws("x[^1]\n\n[^1]: [[a]]\n")).toEqual(["a"]);
    expect(raws("[^2]: [^1]\n\n[^1]: [[a]]\n")).toEqual(["a"]); // appelée depuis une note non appelée, comme l'aperçu
    expect(raws("x[^1]\n\n[^1]: [[a]]\n\n[^1]: [[b]]\n")).toEqual(["b"]); // la dernière définition est rendue
    expect(inline).not.toHaveBeenCalled();
    inline.mockRestore();
    expect(bestMs("[^1]: x\n\n" + "^[".repeat(8_000))).toBeLessThan(5);
    expect(bestMs("Texte [[a]]\n\n[^1]: x\n\n" + "^[x".repeat(5_334))).toBeLessThan(5);
    expect(bestMs("[^1]: x\n\n" + "^[".repeat(500_000))).toBeLessThan(150);
    expect(bestMs("[^1]: x\n\n" + "[[".repeat(500_000))).toBeLessThan(150);
    expect(bestMs("[^1]: x\n\n" + "[^".repeat(500_000))).toBeLessThan(150);
  });

  it("a 1 MB table costs little more than markdown-it's own block parse (T043 K2)", () => {
    // Mesures entrelacées, au meilleur de 7 : la charge de la machine pèse autant sur les deux (borne absolue : perf.t043).
    const blocks = new MarkdownIt().use(footnote).use(admonition);
    blocks.core.ruler.disable(["inline", "footnote_tail"]);
    const table = "| a | b |\n|---|---|\n" + "| [[x]] | `y` |\n".repeat(62_500);
    expect(scanWikiRefs(table)).toHaveLength(62_500);
    let parse = Infinity;
    let scan = Infinity;
    for (let k = 0; k < 7; k++) {
      const start = performance.now();
      blocks.parse(table, {});
      parse = Math.min(parse, performance.now() - start);
      scan = Math.min(scan, bestMs(table, 1));
    }
    expect(scan / parse).toBeLessThan(1.5);
  });

  it("links are the preview's: table cells, link URL and title, autolinks, linkify, ^[ (T043 K4)", () => {
    expect(raws("| t | u |\n|---|---|\n| [[a|z]] | x |\n")).toEqual([]);
    expect(raws("| `x | [[a]] | y` |\n|---|---|---|\n")).toEqual(["a"]);
    expect(raws("| t |\n|---|\n| x | [[b]] |\n")).toEqual([]); // colonne en trop : l'aperçu ne la rend pas
    for (const s of ["[x]([[a]])", '[x](u "[[a]]")', "<http://x/[[a]]>", "http://x.com/[[a]]", "x <mailto:a@b.c/[[a]]>", "x^[[a]]", "[^[[a]]]", "![x [[a]]](u)"])
      expect(raws(s), s).toEqual([]);
    expect(raws("[ [[a]] ](u) ^[voir [[b]]] [x](u) [[c]]")).toEqual(["a", "b", "c"]);
    expect(raws("www.x.com/[[a]] a@b.co/[[b]] ![^[ [[c]] ]](u)")).toEqual(["a", "b", "c"]);
    expect(raws("[a [^1] b](u) [[c]]\n\n[^1]: n")).toEqual(["c"]);
    for (const [s, line] of [
      ["| t | u |\n|---|---|\n| x | [[Note\\|alias]] |\n", 2],
      ["> | t | [[a]] |\n> |---|---|\n> | [[b]] | x |\n", 0],
      ["- | t | [[a]] |\n  |---|---|\n  | [[b]] | x |\n", 0],
      ["x\r\n\r\n| [[a\\|z]] | x |\r\n|---|---|\r\n", 2],
      ["# T [[a]] ##\n> 😀 [[b]]  \n> [[c|C]] `[[d]]`\t\n!!! note \"[[e]]\"\n", 0],
    ] as [string, number][]) {
      const refs = scanWikiRefs(s);
      expect(refs.length, s).toBeGreaterThan(0);
      expect(refs[0].line, s).toBe(line);
      for (const r of refs) expect(s.slice(r.from, r.to), s).toBe(`[[${r.raw}]]`);
    }
  });

  it("hostile input: wrong types throw, limits, lone surrogates, RTL (T045)", () => {
    for (const bad of [null, 42, {}, undefined]) expect(() => scanNote(bad as unknown as string)).toThrow();
    expect(raws(`[[${"a".repeat(512)}]] [[${"b".repeat(513)}]]`)).toEqual(["a".repeat(512)]);
    expect(raws("\u202e[[a]] [[e\u0301]] [[😀]] \ud800[[b\udc00x]]")).toEqual(["a", "e\u0301", "😀", "b\udc00x"]);
    expect(scanNote("")).toEqual({ headings: [], refs: [] });
  });
});

describe("scanHeadings", () => {
  it("reads ATX headings outside fences, strips closing #", () => {
    const s = "# One\ntext\n## Two ##\n```\n# no\n```\n###### Six\n####### seven\n#tag\n#\n  # Indented\n";
    expect(scanHeadings(s)).toEqual(["One", "Two", "Six", "Indented"]);
    expect(scanHeadings("")).toEqual([]);
    expect(scanHeadings("# C#")).toEqual(["C#"]);
    expect(scanHeadings("# 😀 Été\r\n")).toEqual(["😀 Été"]);
  });

  it("are the preview's titles: markdown-it heading tokens of the same parse (T043 K3)", () => {
    expect(scanHeadings("- ```\n  code\n  ```\n\n# Titre\n")).toEqual(["Titre"]);
    expect(scanHeadings("1. ```\n   x\n   ```\n# Après\n")).toEqual(["Après"]);
    expect(scanHeadings("- # T")).toEqual(["T"]);
    expect(scanHeadings("> # T")).toEqual(["T"]);
    expect(scanHeadings("T\r# R\r")).toEqual(["R"]);
    expect(scanHeadings("Setext\n===\n")).toEqual(["Setext"]);
    expect(scanHeadings("    # code\n```\n# no\n```\n# [[a]] `b` ##\n")).toEqual(["[[a]] `b`"]);
    expect(scanHeadings("[^1]: # Note\n\n# Corps\n")).toEqual(["Corps"]); // note non appelée : pas rendue
    expect(scanHeadings("x[^1]\n\n[^1]: # Note\n\n# Corps\n")).toEqual(["Corps", "Note"]); // rendue en fin de document
    expect(scanNote("# T\n[[a]]")).toEqual({ headings: ["T"], refs: scanWikiRefs("# T\n[[a]]") });
  });
});

describe("noteKey", () => {
  it("normalizes NFC, case, slashes, ./ and extension", () => {
    expect(noteKey("./Dir\\Note.MD")).toBe("dir/note");
    expect(noteKey("  a.markdown ")).toBe("a");
    expect(noteKey("é")).toBe(noteKey("é"));
    expect(noteKey("")).toBe("");
    expect(noteKey(".md")).toBe("");
    expect(noteKey("a.b")).toBe("a.b");
  });
});

describe("wikiDisplay / wikiFromEdited", () => {
  it("displays alias, heading or target", () => {
    expect(wikiDisplay({ raw: "", target: "a", heading: null, alias: null })).toBe("a");
    expect(wikiDisplay({ raw: "", target: "a", heading: "H", alias: null })).toBe("a › H");
    expect(wikiDisplay({ raw: "", target: "", heading: "H", alias: null })).toBe("H");
    expect(wikiDisplay({ raw: "", target: "a", heading: "H", alias: "x" })).toBe("x");
  });

  it("rebuilds raw from the edited visible text", () => {
    expect(wikiFromEdited("a#H", "")).toBe("a#H");
    expect(wikiFromEdited("a#H", "a › H")).toBe("a#H");
    expect(wikiFromEdited("a#H", "texte")).toBe("a#H|texte");
    expect(wikiFromEdited("a|old", "new")).toBe("a|new");
    expect(wikiFromEdited("a.md", "x")).toBe("a|x");
    expect(wikiFromEdited("[", "x")).toBe("[");
  });

  it("keeps a valid link whatever the edited visible text (T013 D13)", () => {
    for (const visible of ["a]b", "[x]", "a\nb", "a\r\nb", "]]", "😀 שלום é", "\ud800", "x".repeat(100_000), "😀".repeat(300)]) {
      const raw = wikiFromEdited("x#H", visible);
      expect(parseWikiInner(raw), JSON.stringify(visible.slice(0, 20))).toMatchObject({ target: "x", heading: "H" });
    }
    expect(wikiFromEdited("x", "a]b")).toBe("x|ab");
    expect(wikiFromEdited("x", "a\nb")).toBe("x|a b");
    expect(wikiFromEdited("x", "[]")).toBe("x");
    expect(wikiFromEdited("a".repeat(512), "yz")).toBe("a".repeat(512));
    expect(wikiFromEdited("a".repeat(511), "yz")).toBe("a".repeat(511));
    const emoji = wikiFromEdited("a".repeat(500), "😀".repeat(10));
    expect(emoji).toBe(`${"a".repeat(500)}|${"😀".repeat(5)}`);
  });

  it("keeps the GFM table escape \\| of the edited link (T022 F8)", () => {
    expect(wikiFromEdited("Note\\|alias", "autre")).toBe("Note\\|autre");
    expect(wikiFromEdited("Note#H\\|x", "שלום 😀")).toBe("Note#H\\|שלום 😀");
    expect(wikiFromEdited("Note\\|alias", "alias")).toBe("Note\\|alias");
    expect(wikiFromEdited("Note|alias", "autre")).toBe("Note|autre");
    expect(wikiFromEdited("a|b\\|c", "z")).toBe("a|z");
    const long = wikiFromEdited("n\\|x", "😀".repeat(300));
    expect(long.length).toBeLessThanOrEqual(512);
    expect(parseWikiInner(long)).toMatchObject({ target: "n" });
    expect(long.startsWith("n\\|")).toBe(true);
  });
});
