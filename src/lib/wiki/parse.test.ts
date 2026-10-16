import { describe, expect, it } from "vitest";
import { noteKey, parseWikiInner, scanHeadings, scanWikiRefs, wikiDisplay, wikiFromEdited } from "./parse";

const raws = (s: string) => scanWikiRefs(s).map((r) => r.raw);

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
    expect(raws(">".repeat(100_000) + " [[a]]")).toEqual(["a"]);
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
});

describe("scanHeadings", () => {
  it("reads ATX headings outside fences, strips closing #", () => {
    const s = "# One\ntext\n## Two ##\n```\n# no\n```\n###### Six\n####### seven\n#tag\n#\n  # Indented\n";
    expect(scanHeadings(s)).toEqual(["One", "Two", "Six", "Indented"]);
    expect(scanHeadings("")).toEqual([]);
    expect(scanHeadings("# C#")).toEqual(["C#"]);
    expect(scanHeadings("# 😀 Été\r\n")).toEqual(["😀 Été"]);
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
