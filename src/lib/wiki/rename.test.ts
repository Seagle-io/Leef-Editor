import { describe, expect, it } from "vitest";
import { NoteIndex, type NoteFile } from "./noteIndex";
import { planRename, rewriteRefs } from "./rename";

const f = (rel: string, content = ""): NoteFile => ({ path: `/w/${rel}`, rel, content });

describe("rewriteRefs", () => {
  it("rewrites matching links only and counts changes", () => {
    const src = "[[a]] [[b]] `[[a]]`\n```\n[[a]]\n```\n[[a#H|x]]";
    const r = rewriteRefs(src, (x) => x.target === "a", (x) => `z${x.heading ? `#${x.heading}` : ""}`);
    expect(r.count).toBe(2);
    expect(r.content).toBe("[[z]] [[b]] `[[a]]`\n```\n[[a]]\n```\n[[z#H]]");
  });

  it("unchanged replacement is not counted; empty content", () => {
    expect(rewriteRefs("[[a]]", () => true, (x) => x.raw)).toEqual({ content: "[[a]]", count: 0 });
    expect(rewriteRefs("", () => true, () => "x")).toEqual({ content: "", count: 0 });
  });

  it("unicode and large input", () => {
    const r = rewriteRefs("😀 [[é]] שלום [[é]]", () => true, () => "e");
    expect(r).toEqual({ content: "😀 [[e]] שלום [[e]]", count: 2 });
    expect(rewriteRefs("[[a]]".repeat(30_000), () => true, () => "b").count).toBe(30_000);
  });
});

describe("planRename", () => {
  const files = [
    f("a.md", "self [[a]] [[#H]]"),
    f("s1.md", "[[a]] [[a#H|alias]] [[other]]\n`[[a]]`"),
    f("s2.md", "[[dir/a]] [[Dir/A.md|x]]"),
    f("dir/a.md"),
    f("other.md", "[[a]]"),
  ];

  it("counts links and files, leaves other links intact", () => {
    const ix = NoteIndex.build(files);
    const plan = planRename(ix, "/w/other.md", "/w/neuf.md", "neuf.md");
    expect(plan).toEqual({ files: [{ path: "/w/s1.md", count: 1 }], total: 1 });
  });

  it("plain-name links get the new name, path links the new path; heading and alias kept", () => {
    const ix = NoteIndex.build(files);
    const plan = planRename(ix, "/w/dir/a.md", "/w/lib/b.md", "lib/b.md");
    expect(plan.files.map((x) => x.path)).toEqual(["/w/s2.md"]);
    expect(plan.total).toBe(2);
    const s2 = ix.get("/w/s2.md");
    const out = rewriteRefs(
      s2?.content ?? "",
      (r) => ix.resolve(r.target, "/w/s2.md") === "/w/dir/a.md",
      (r) => `lib/b${r.alias ? `|${r.alias}` : ""}`,
    );
    expect(out.content).toBe("[[lib/b]] [[lib/b|x]]");
  });

  it("includes self links of the renamed note (not heading-only ones)", () => {
    const ix = NoteIndex.build([f("a.md", "[[a]] [[#H]] [[a#H|x]]")]);
    expect(planRename(ix, "/w/a.md", "/w/b.md", "b.md")).toEqual({ files: [{ path: "/w/a.md", count: 2 }], total: 2 });
  });

  it("falls back to the path when the new name is ambiguous", () => {
    const ix = NoteIndex.build([f("x/a.md"), f("y/n.md"), f("s.md", "[[a]]")]);
    const plan = planRename(ix, "/w/x/a.md", "/w/x/n.md", "x/n.md");
    expect(plan.total).toBe(1);
  });

  it("a move that keeps an unambiguous name changes nothing for name links", () => {
    const ix = NoteIndex.build([f("a.md"), f("s.md", "[[a]]")]);
    expect(planRename(ix, "/w/a.md", "/w/sub/a.md", "sub/a.md")).toEqual({ files: [], total: 0 });
  });

  it("unknown source throws; unicode and punctuation names", () => {
    const ix = NoteIndex.build([f("é.md"), f("s.md", "[[é]] [[É]]")]);
    expect(() => planRename(ix, "/w/zz.md", "/w/y.md", "y.md")).toThrow("Note inconnue");
    expect(planRename(ix, "/w/é.md", "/w/😀.md", "😀.md").total).toBe(2);
  });
});
