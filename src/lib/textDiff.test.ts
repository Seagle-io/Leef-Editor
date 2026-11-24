import { describe, expect, it } from "vitest";
import { minimalChange } from "./textDiff";

function apply(prev: string, change: { from: number; to: number; insert: string }): string {
  return prev.slice(0, change.from) + change.insert + prev.slice(change.to);
}

describe("minimalChange", () => {
  it("returns null for equal texts", () => {
    expect(minimalChange("", "")).toBeNull();
    expect(minimalChange("abc", "abc")).toBeNull();
  });

  it("inserts in the middle", () => {
    expect(minimalChange("abcd", "abXYcd")).toEqual({ from: 2, to: 2, insert: "XY" });
  });

  it("deletes", () => {
    expect(minimalChange("abXYcd", "abcd")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("replaces", () => {
    expect(minimalChange("abXcd", "abYcd")).toEqual({ from: 2, to: 3, insert: "Y" });
  });

  it("handles ends and full replacement", () => {
    expect(minimalChange("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(minimalChange("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
    expect(minimalChange("abc", "abcd")).toEqual({ from: 3, to: 3, insert: "d" });
    expect(minimalChange("abc", "xyz")).toEqual({ from: 0, to: 3, insert: "xyz" });
  });

  it("does not overlap prefix and suffix on repeated text", () => {
    expect(minimalChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(minimalChange("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("keeps accents whole", () => {
    expect(minimalChange("café", "cafè")).toEqual({ from: 3, to: 4, insert: "è" });
    expect(minimalChange("é", "e")).toEqual({ from: 1, to: 2, insert: "" });
  });

  it("never cuts a surrogate pair", () => {
    // 😀 = D83D DE00, 😁 = D83D DE01: same high half, different low half.
    expect(minimalChange("a😀b", "a😁b")).toEqual({ from: 1, to: 3, insert: "😁" });
    // Same low half, different high half.
    expect(minimalChange("a😀", "a🨀")).toEqual({ from: 1, to: 3, insert: "🨀" });
    expect(minimalChange("ab", "a😀b")).toEqual({ from: 1, to: 1, insert: "😀" });
    expect(minimalChange("a😀b", "ab")).toEqual({ from: 1, to: 3, insert: "" });
  });

  it("always reproduces the target", () => {
    const pairs: [string, string][] = [
      ["# Titre\n\n- un\n- deux\n", "# Titre\n\n- un\n- deux 😀\n"],
      ["😀😀", "😀"],
      ["é😀é", "é🙀é"],
      ["", "😀"],
    ];
    for (const [prev, next] of pairs) {
      const change = minimalChange(prev, next)!;
      expect(apply(prev, change)).toBe(next);
      for (const i of [change.from, change.to]) {
        const code = prev.charCodeAt(i);
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
      }
    }
  });
});
