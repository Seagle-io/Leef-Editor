import { describe, expect, it } from "vitest";
import { NoteIndex, type NoteFile } from "./noteIndex";

const f = (rel: string, content = ""): NoteFile => ({ path: `/w/${rel}`, rel, content });
const snapshot = (ix: NoteIndex) =>
  ix.all().map((e) => ({
    path: e.path,
    headings: e.headings,
    back: ix.backlinks(e.path).map((b) => [b.source, b.ref.from, b.ref.raw, b.context]),
  }));

describe("NoteIndex basics", () => {
  it("builds, sorts by rel, exposes headings", () => {
    const ix = NoteIndex.build([f("b.md", "# H1\n## H2"), f("a.md"), f("dir/c.md")]);
    expect(ix.all().map((e) => e.rel)).toEqual(["a.md", "b.md", "dir/c.md"]);
    expect(ix.headings("/w/b.md")).toEqual(["H1", "H2"]);
    expect(ix.headings("/w/nope.md")).toEqual([]);
    expect(ix.get("/w/a.md")?.key).toBe("a");
  });

  it("empty index and duplicate paths (last wins)", () => {
    expect(NoteIndex.build([]).all()).toEqual([]);
    const ix = NoteIndex.build([f("a.md", "1"), f("a.md", "2")]);
    expect(ix.all()).toHaveLength(1);
    expect(ix.get("/w/a.md")?.content).toBe("2");
  });

  it("resolves by name, case, accents-as-NFC, path, extension", () => {
    const ix = NoteIndex.build([f("Notes/Été.md"), f("x/y/note.md")]);
    expect(ix.resolve("été", null)).toBe("/w/Notes/Été.md");
    expect(ix.resolve("été", null)).toBe("/w/Notes/Été.md");
    expect(ix.resolve("note.md", null)).toBe("/w/x/y/note.md");
    expect(ix.resolve("y/note", null)).toBe("/w/x/y/note.md");
    expect(ix.resolve("x/y/note", null)).toBe("/w/x/y/note.md");
    expect(ix.resolve("z/note", null)).toBeNull();
    expect(ix.resolve("absent", null)).toBeNull();
    expect(ix.resolve("", "/w/Notes/Été.md")).toBe("/w/Notes/Été.md");
    expect(ix.resolve("", null)).toBeNull();
    expect(ix.resolve("dir/", null)).toBeNull();
  });

  it("ambiguity: same folder, then fewer segments, then rel order", () => {
    const ix = NoteIndex.build([f("a/n.md"), f("b/n.md"), f("b/c/n.md"), f("z.md"), f("b/src.md")]);
    expect(ix.resolve("n", "/w/b/src.md")).toBe("/w/b/n.md");
    expect(ix.resolve("n", "/w/z.md")).toBe("/w/a/n.md");
    expect(ix.resolve("n", null)).toBe("/w/a/n.md");
    expect(ix.resolve("c/n", null)).toBe("/w/b/c/n.md");
    const deep = NoteIndex.build([f("p/q/n.md"), f("r/n.md")]);
    expect(deep.resolve("n", null)).toBe("/w/r/n.md");
  });

  it("a leading / starts from the root of the folder (T022 D7)", () => {
    const ix = NoteIndex.build([f("A.md"), f("d1/A.md"), f("z/d1/A.md"), f("d1/s.md", "[[/A]] [[/d1/A#T|v]]"), f("Été.md"), f("😀.md")]);
    expect(ix.resolve("/A", "/w/d1/s.md")).toBe("/w/A.md");
    expect(ix.resolve("A", "/w/d1/s.md")).toBe("/w/d1/A.md");
    expect(ix.resolve("/d1/A", "/w/z/d1/x.md")).toBe("/w/d1/A.md");
    expect(ix.resolve("/D1/a.md", null)).toBe("/w/d1/A.md");
    expect(ix.resolve("/e\u0301te\u0301", null)).toBe("/w/Été.md");
    expect(ix.resolve("/😀", null)).toBe("/w/😀.md");
    for (const bad of ["/", "//A", "/z/A", "/B", "/A/"]) expect(ix.resolve(bad, null), bad).toBeNull();
    expect(ix.backlinks("/w/A.md").map((b) => b.ref.raw)).toEqual(["/A"]);
    expect(ix.backlinks("/w/d1/A.md").map((b) => b.ref.raw)).toEqual(["/d1/A#T|v"]);
    expect(NoteIndex.build([f("n.md")]).resolve("/n", null)).toBe("/w/n.md");
  });

  it("backlinks: sorted, context, no self link, broken ignored, ambiguity", () => {
    const long = "x".repeat(200);
    const ix = NoteIndex.build([
      f("t.md", "# T\nself [[t]]"),
      f("b.md", "l0\nvoir [[t]] et [[t#T|alias]]\n[[missing]]"),
      f("a.md", `${long} [[t]]`),
      f("sub/t.md"),
    ]);
    const bl = ix.backlinks("/w/t.md");
    expect(bl.map((b) => [b.rel, b.ref.line])).toEqual([["a.md", 0], ["b.md", 1], ["b.md", 1]]);
    expect(bl[1].context).toBe("voir [[t]] et [[t#T|alias]]");
    expect(bl[0].context).toHaveLength(160);
    expect(ix.backlinks("/w/sub/t.md")).toEqual([]);
    expect(ix.backlinks("/w/none.md")).toEqual([]);
  });

  it("backlinks: 20 000 refs on one line read that line once, same contexts (T029 G5)", () => {
    const line = Array(20_000).fill("[[t]]").join(" ");
    const ix = NoteIndex.build([f("t.md"), f("s.md", `${line}\n  voir [[t|x]]  \n😀`)]);
    const start = performance.now();
    const bl = ix.backlinks("/w/t.md");
    const ms = performance.now() - start;
    expect(bl).toHaveLength(20_001);
    expect(bl[0].context).toBe(line.slice(0, 160));
    expect(bl[19_999].context).toBe(line.slice(0, 160));
    expect(bl[20_000].context).toBe("voir [[t|x]]");
    expect(ms).toBeLessThan(500);
  });

  it("heading-only links resolve to the note itself and are not backlinks", () => {
    const ix = NoteIndex.build([f("a.md", "# H\n[[#H]]")]);
    expect(ix.backlinks("/w/a.md")).toEqual([]);
  });

  it("suggest: unique name vs rel without extension, fuzzy on rel", () => {
    const ix = NoteIndex.build([f("a/n.md"), f("b/n.md"), f("Alpha.md")]);
    expect(ix.suggest("alp")).toEqual([{ insert: "Alpha", label: "Alpha", detail: "Alpha.md" }]);
    expect(ix.suggest("n").map((s) => s.insert)).toEqual(["a/n", "b/n"]);
    expect(ix.suggest("").map((s) => s.detail)).toEqual(["a/n.md", "Alpha.md", "b/n.md"]);
    expect(ix.suggest("", 1)).toHaveLength(1);
    expect(ix.suggest("zzz")).toEqual([]);
  });

  it("move throws on unknown source; remove of unknown is a no-op", () => {
    const ix = NoteIndex.build([f("a.md")]);
    expect(() => ix.move("/w/x.md", "/w/y.md", "y.md")).toThrow("Note inconnue");
    ix.remove("/w/x.md");
    expect(ix.all()).toHaveLength(1);
  });
});

describe("NoteIndex incremental", () => {
  it("upsert / remove / move keep backlinks right", () => {
    const ix = NoteIndex.build([f("a.md", "[[b]]"), f("b.md")]);
    expect(ix.backlinks("/w/b.md")).toHaveLength(1);
    ix.upsert(f("a.md", "no link"));
    expect(ix.backlinks("/w/b.md")).toEqual([]);
    ix.upsert(f("a.md", "[[b]] [[b]]"));
    expect(ix.backlinks("/w/b.md")).toHaveLength(2);
    ix.remove("/w/b.md");
    expect(ix.backlinks("/w/b.md")).toEqual([]);
    ix.upsert(f("b.md"));
    expect(ix.backlinks("/w/b.md")).toHaveLength(2);
    ix.move("/w/b.md", "/w/c.md", "c.md");
    expect(ix.backlinks("/w/c.md")).toEqual([]);
    ix.upsert(f("a.md", "[[c]]"));
    expect(ix.backlinks("/w/c.md")).toHaveLength(1);
  });

  it("a new homonym takes over resolution when closer", () => {
    const ix = NoteIndex.build([f("far/n.md"), f("d/s.md", "[[n]]")]);
    expect(ix.backlinks("/w/far/n.md")).toHaveLength(1);
    ix.upsert(f("d/n.md"));
    expect(ix.backlinks("/w/far/n.md")).toEqual([]);
    expect(ix.backlinks("/w/d/n.md")).toHaveLength(1);
    ix.remove("/w/d/n.md");
    expect(ix.backlinks("/w/far/n.md")).toHaveLength(1);
  });

  it("property, every upsert/remove/move sequence equals a rebuild", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const dirs = ["", "a/", "b/", "a/c/"];
    const names = ["n1", "n2", "n3", "N1", "été"];
    const targets = ["n1", "n2", "n3", "a/n1", "c/n2", "été", "missing", "#H", "n1#H|x", ""];
    const make = (): NoteFile => {
      const rel = `${dirs[rnd(dirs.length)]}${names[rnd(names.length)]}.md`;
      let content = "# H\n";
      for (let i = rnd(4); i > 0; i--) content += `l [[${targets[rnd(targets.length)]}]]\n`;
      return { path: `/w/${rel}`, rel, content };
    };
    for (let round = 0; round < 40; round++) {
      const ix = NoteIndex.build([]);
      const live = new Map<string, NoteFile>();
      for (let step = 0; step < 40; step++) {
        const op = rnd(4);
        const keys = [...live.keys()];
        if (op < 2 || keys.length === 0) {
          const n = make();
          ix.upsert(n);
          live.set(n.path, n);
        } else if (op === 2) {
          const p = keys[rnd(keys.length)];
          ix.remove(p);
          live.delete(p);
        } else {
          const p = keys[rnd(keys.length)];
          const dest = make();
          const src = live.get(p) as NoteFile;
          ix.move(p, dest.path, dest.rel);
          live.delete(p);
          live.set(dest.path, { ...dest, content: src.content });
        }
        expect(snapshot(ix)).toEqual(snapshot(NoteIndex.build([...live.values()])));
      }
    }
  });
});

describe("NoteIndex hostile input", () => {
  it("empty, huge, control characters, unicode, limits", () => {
    const hostile = [
      f("empty.md", ""),
      f("ctl.md", "[[a\u0000b]] \u0007 � \ud800"),
      f("uni.md", "# 😀 שלום\n[[😀]] [[שלום]] [[é]]"),
      f("😀.md"),
      f("שלום.md"),
      f("é.md"),
      f("big.md", "[[big]] ".repeat(20_000) + "\n" + "# T\n".repeat(20_000)),
      f(".md"),
      f("a".repeat(300) + ".md"),
    ];
    const ix = NoteIndex.build(hostile);
    expect(ix.backlinks("/w/😀.md").map((b) => b.rel)).toEqual(["uni.md"]);
    expect(ix.backlinks("/w/שלום.md")).toHaveLength(1);
    expect(ix.backlinks("/w/é.md")).toHaveLength(1);
    expect(ix.backlinks("/w/big.md")).toEqual([]);
    expect(ix.headings("/w/big.md")).toHaveLength(20_000);
    expect(ix.suggest("\u0000")).toEqual([]);
    expect(ix.suggest("x".repeat(1000))).toEqual([]);
    expect(ix.suggest("a", 0)).toEqual([]);
  });

  it("a note over the scan bound stays listed and resolvable, without headings or links (T045)", () => {
    const huge = "# T\n[[b]]\n" + "x".repeat(1_000_000);
    const ix = NoteIndex.build([f("huge.md", huge), f("b.md"), f("c.md", "# C\n[[b]]")]);
    expect(ix.get("/w/huge.md")?.content).toBe(huge);
    expect(ix.resolve("huge", null)).toBe("/w/huge.md");
    expect(ix.headings("/w/huge.md")).toEqual([]);
    expect(ix.backlinks("/w/b.md").map((b) => b.rel)).toEqual(["c.md"]);
    expect(ix.headings("/w/c.md")).toEqual(["C"]);
  });
});
