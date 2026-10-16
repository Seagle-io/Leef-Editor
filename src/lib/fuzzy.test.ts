import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch, normalizeForSearch } from "./fuzzy";

describe("normalizeForSearch", () => {
  it("strips accents and case, one code point to one", () => {
    expect(normalizeForSearch("Éléphant À Noël")).toBe("elephant a noel");
    for (const s of ["", "abc", "Œuvre", "😀é", "한글", "שלום", "́", "İ"]) {
      expect([...normalizeForSearch(s)]).toHaveLength([...s].length);
    }
  });

  it("keeps emoji, RTL and control characters", () => {
    expect(normalizeForSearch("😀")).toBe("😀");
    expect(normalizeForSearch("שלום")).toBe("שלום");
    expect(normalizeForSearch("a\u0000\u0007b")).toBe("a\u0000\u0007b");
  });
});

describe("fuzzyMatch", () => {
  it("requires a subsequence", () => {
    expect(fuzzyMatch("abc", "acb")).toBeNull();
    expect(fuzzyMatch("abc", "a-b-c")?.positions).toEqual([0, 2, 4]);
  });

  it("empty query matches everything with score 0; spaces are ignored", () => {
    expect(fuzzyMatch("", "x")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("  ", "x")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("a b", "ab")).toEqual(fuzzyMatch("ab", "ab"));
  });

  it("scores: index 0 +8, +1 per char, consecutive +4", () => {
    expect(fuzzyMatch("a", "a")?.score).toBe(9);
    expect(fuzzyMatch("ab", "ab")?.score).toBe(9 + 1 + 4);
  });

  it("scores: word start +6, gap penalty capped at -3", () => {
    expect(fuzzyMatch("b", "a b")?.score).toBe(1 + 6);
    expect(fuzzyMatch("ab", "a-b")?.score).toBe(9 + 1 + 6 - 1);
    expect(fuzzyMatch("ab", "axxxxxxb")?.score).toBe(9 + 1 - 3);
    expect(fuzzyMatch("fb", "fooBar")?.score).toBe(9 + 1 + 6 - 2);
  });

  it("picks the best alignment", () => {
    expect(fuzzyMatch("ab", "xaab")?.positions).toEqual([2, 3]);
  });

  it("ignores accents and case, positions are code points", () => {
    expect(fuzzyMatch("ete", "Été")?.positions).toEqual([0, 1, 2]);
    expect(fuzzyMatch("b", "😀b")?.positions).toEqual([1]);
    expect(fuzzyMatch("ש", "אש")?.positions).toEqual([1]);
  });

  it("limits: query > 64 never matches, text truncated at 256", () => {
    expect(fuzzyMatch("a".repeat(65), "a".repeat(100))).toBeNull();
    expect(fuzzyMatch("a".repeat(64), "a".repeat(100))).not.toBeNull();
    expect(fuzzyMatch("z", "a".repeat(256) + "z")).toBeNull();
    expect(fuzzyMatch("a", "a".repeat(5_000_000))?.positions).toEqual([0]);
    expect(fuzzyMatch("a", "")).toBeNull();
  });

  it("survives control characters and non-UTF-8 leftovers", () => {
    expect(fuzzyMatch("a", "\u0000a�")?.positions).toEqual([1]);
    expect(fuzzyMatch("a", "\ud800a")?.positions).toEqual([1]);
  });
});

describe("fuzzyFilter", () => {
  const items = ["notes/zebra.md", "alpha.md", "a.md", "notes/alpha.md"];
  const id = (s: string) => s;

  it("empty query keeps order and applies the limit", () => {
    expect(fuzzyFilter(items, "", id).map((r) => r.item)).toEqual(items);
    expect(fuzzyFilter(items, "", id, 2)).toHaveLength(2);
    expect(fuzzyFilter(items, "a", id, 0)).toEqual([]);
    expect(fuzzyFilter(items, "a", id, -3)).toEqual([]);
  });

  it("sorts by score, then shorter text, then original order", () => {
    expect(fuzzyFilter(items, "a", id).map((r) => r.item)).toEqual(["a.md", "alpha.md", "notes/alpha.md", "notes/zebra.md"]);
    expect(fuzzyFilter(["bb", "bb"].map((t, i) => ({ t, i })), "bb", (x) => x.t).map((r) => r.item.i)).toEqual([0, 1]);
  });

  it("drops non-matching items", () => {
    expect(fuzzyFilter(items, "zzz", id)).toEqual([]);
  });

  it("performance shape: 1000 x 40 chars", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `dossier/sous-dossier/note-numero-${i}.md`);
    const t0 = performance.now();
    expect(fuzzyFilter(many, "nnum9", id)).not.toHaveLength(0);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
