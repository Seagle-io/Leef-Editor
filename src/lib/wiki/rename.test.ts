import { describe, expect, it } from "vitest";
import { NoteIndex, type NoteFile } from "./noteIndex";
import { scanWikiRefs } from "./parse";
import { planRename, renameRewrites, rewriteRefs } from "./rename";

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

  it("rewrites links the new name would capture, so they keep their current target (T013 D4)", () => {
    const ix = NoteIndex.build([f("d1/X.md", "[[A]] [[X]]"), f("d2/A.md"), f("d1/s.md", "[[A]] [[A#T|v]] [[X]]"), f("d2/s.md", "[[A]]")]);
    expect(planRename(ix, "/w/d1/X.md", "/w/d1/A.md", "d1/A.md")).toEqual({
      files: [
        { path: "/w/d1/s.md", count: 3 },
        { path: "/w/d1/X.md", count: 2 },
      ],
      total: 5,
    });
  });

  it("does not count broken links the new name brings to life, nor links already elsewhere (T013 D4)", () => {
    const ix = NoteIndex.build([f("d1/X.md"), f("d1/s.md", "[[A]] [[d2/A]]"), f("d2/A.md"), f("d2/s.md", "[[A]] [[B]]")]);
    expect(planRename(ix, "/w/d1/X.md", "/w/d1/A.md", "d1/A.md").files).toEqual([{ path: "/w/d1/s.md", count: 1 }]);
    const broken = NoteIndex.build([f("x.md"), f("s.md", "[[😀]] [[é]]")]);
    expect(planRename(broken, "/w/x.md", "/w/😀.md", "😀.md").total).toBe(0);
    const nfd = NoteIndex.build([f("d1/x.md"), f("d2/e\u0301te\u0301.md"), f("d1/s.md", "[[été]]")]);
    expect(planRename(nfd, "/w/d1/x.md", "/w/d1/été.md", "d1/été.md").total).toBe(1);
  });

  it("unknown source throws; unicode and punctuation names", () => {
    const ix = NoteIndex.build([f("é.md"), f("s.md", "[[é]] [[É]]")]);
    expect(() => planRename(ix, "/w/zz.md", "/w/y.md", "y.md")).toThrow("Note inconnue");
    expect(planRename(ix, "/w/é.md", "/w/😀.md", "😀.md").total).toBe(2);
  });
});

/** Applies the rewrites and the move; lists every existing link whose target changed (it must stay on its note, or follow `from`). */
function apply(files: NoteFile[], from: string, toRel: string) {
  const to = `/w/${toRel}`;
  const before = NoteIndex.build(files);
  const rewrites = renameRewrites(before, from, to, toRel);
  expect(rewrites.map(({ path, count }) => ({ path, count }))).toEqual(planRename(before, from, to, toRel).files);
  const contents = new Map(rewrites.map((r) => [r.path, r.content]));
  const next = files.map((n) => (n.path === from ? { path: to, rel: toRel, content: contents.get(n.path) ?? n.content } : { ...n, content: contents.get(n.path) ?? n.content }));
  const after = NoteIndex.build(next);
  const moved: string[] = [];
  files.forEach((n, i) => {
    const was = scanWikiRefs(n.content);
    const now = scanWikiRefs(next[i].content);
    if (was.length !== now.length) moved.push(`${n.rel}: ${was.length} refs → ${now.length}`);
    was.forEach((r, k) => {
      const target = before.resolve(r.target, n.path);
      if (target === null) return;
      const got = now[k] ? after.resolve(now[k].target, next[i].path) : null;
      if (got !== (target === from ? to : target)) moved.push(`${n.rel} [[${r.raw}]] → [[${now[k]?.raw}]] : ${target} → ${got}`);
    });
  });
  return { contents: Object.fromEntries(contents), moved };
}

describe("renameRewrites: no link changes target (T022 F1 F2, decision D7)", () => {
  it("a root note keeps its links: [[A]] → [[/A]] when d1/X becomes d1/A", () => {
    const r = apply([f("A.md"), f("d1/X.md"), f("d1/s.md", "[[A]] [[A#T|v]]")], "/w/d1/X.md", "d1/A.md");
    expect(r).toEqual({ contents: { "/w/d1/s.md": "[[/A]] [[/A#T|v]]" }, moved: [] });
  });

  it("renamed to the root while d1/A d2/A d3/A exist: links reach the root note, others keep theirs", () => {
    const files = [f("d1/A.md"), f("d2/A.md"), f("d3/A.md"), f("d4/X.md"), f("d1/s.md", "[[X]]"), f("d4/s.md", "[[X]]"), f("r.md", "[[A]]")];
    const r = apply(files, "/w/d4/X.md", "A.md");
    expect(r.moved).toEqual([]);
    expect(r.contents).toEqual({ "/w/d1/s.md": "[[/A]]", "/w/d4/s.md": "[[A]]", "/w/r.md": "[[d1/A]]" });
  });

  it("root rename captured by a nearer note: d1/sub/* [[A#T]] → [[/X#T]]", () => {
    const r = apply([f("A.md"), f("d1/sub/X.md"), f("d1/sub/s.md", "[[A#T]]")], "/w/A.md", "X.md");
    expect(r).toEqual({ contents: { "/w/d1/sub/s.md": "[[/X#T]]" }, moved: [] });
  });

  it("a path captured by a suffix match goes absolute: z/d1/s [[X]] → [[/d1/A]]", () => {
    const r = apply([f("z/d1/A.md"), f("d4/X.md"), f("z/d1/s.md", "[[X]]")], "/w/d4/X.md", "d1/A.md");
    expect(r).toEqual({ contents: { "/w/z/d1/s.md": "[[/d1/A]]" }, moved: [] });
  });

  it("the moved note's own links keep their targets in its new folder", () => {
    const r = apply([f("d1/A.md"), f("d1/sub/A.md"), f("d1/sub/B.md", "[[A#T]] [[B]] [[#T]]")], "/w/d1/sub/B.md", "d1/B.md");
    expect(r).toEqual({ contents: { "/w/d1/sub/B.md": "[[d1/sub/A#T]] [[B]] [[#T]]" }, moved: [] });
  });

  it("a table cell keeps its \\| escape: | [[Note\\|alias]] | 1 | → | [[Neuf\\|alias]] | 1 |", () => {
    const table = "| lien | n |\n|---|---|\n| [[Note\\|alias]] | 1 |\n| [[Note|x]] | [[Note#H\\|y]] |\n";
    const r = apply([f("Note.md"), f("t.md", table)], "/w/Note.md", "Neuf.md");
    expect(r.moved).toEqual([]);
    expect(r.contents["/w/t.md"]).toBe("| lien | n |\n|---|---|\n| [[Neuf\\|alias]] | 1 |\n| [[Neuf|x]] | [[Neuf#H\\|y]] |\n");
  });

  it("refuses a name no link can reach, rather than break links: C#, d1/F#, a]]b, too long (T029 G3)", () => {
    const refused = (files: NoteFile[], from: string, toRel: string) => {
      const ix = NoteIndex.build(files);
      expect(() => renameRewrites(ix, from, `/w/${toRel}`, toRel)).toThrow(/^Renommage refusé : /);
      expect(() => planRename(ix, from, `/w/${toRel}`, toRel)).toThrow(/^Renommage refusé : /);
    };
    refused([f("X.md"), f("s.md", "[[X]] [[X|v]]")], "/w/X.md", "C#.md");
    refused([f("d1/X.md"), f("d1/s.md", "[[X]]"), f("s.md", "[[d1/X]]")], "/w/d1/X.md", "d1/F#.md");
    refused([f("X.md"), f("s.md", "[[X]]")], "/w/X.md", "a]]b.md");
    refused([f("X.md"), f("s.md", "[[X#T|alias]]")], "/w/X.md", `${"y".repeat(510)}.md`);
    expect(apply([f("X.md"), f("s.md", "plain")], "/w/X.md", "C#.md")).toEqual({ contents: {}, moved: [] });
    expect(apply([f("d1/X.md"), f("s.md", "[[X]] [[d1/X|v]]")], "/w/d1/X.md", "c#/Y.md")).toEqual({ contents: { "/w/s.md": "[[Y]] [[Y|v]]" }, moved: [] });
  });

  it("hostile names: emoji, RTL, combining marks, empty and huge content", () => {
    const files = [f("😀.md"), f("d/שלום.md"), f("d/X.md"), f("d/s.md", "[[😀]] [[שלום]] [[e\u0301]]"), f("é.md"), f("e.md", ""), f("big.md", "[[X]] ".repeat(20_000))];
    expect(apply(files, "/w/d/X.md", "d/😀.md").moved).toEqual([]);
    expect(apply(files, "/w/d/X.md", "d/é.md").moved).toEqual([]);
    expect(apply(files, "/w/e.md", "שלום.md").moved).toEqual([]);
    expect(renameRewrites(NoteIndex.build(files), "/w/d/X.md", "/w/d/Y.md", "d/Y.md").find((x) => x.path === "/w/big.md")?.count).toBe(20_000);
  });

  it("property: 3 000 random renames, with and without root notes, change no existing link's target", () => {
    for (const dirs of [["", "d1/", "d2/", "d1/sub/"], ["d0/", "d1/", "d2/", "d1/sub/"]]) {
      let seed = 42;
      const rnd = (n: number): number => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % n;
      };
      const names = ["A", "B", "X"];
      const refs = ["[[A]]", "[[B]]", "[[X]]", "[[d1/A]]", "[[d2/A]]", "[[sub/A]]", "[[A#T]]", "[[A|al]]", "[[#T]]", "[[d1/X]]", "[[x]]", "[[/A]]", "[[/d1/A]]", "| [[A\\|t]] |"];
      const fails: string[] = [];
      for (let k = 0; k < 3000; k++) {
        const rels = new Set<string>();
        const want = 2 + rnd(6);
        while (rels.size < want) rels.add(dirs[rnd(4)] + names[rnd(3)] + ".md");
        const files = [...rels].map((rel) => f(rel, Array.from({ length: rnd(4) }, () => refs[rnd(refs.length)]).join(" ")));
        const from = files[rnd(files.length)].path;
        let toRel = "";
        do toRel = dirs[rnd(4)] + names[rnd(3)] + ".md";
        while (rels.has(toRel));
        const { moved } = apply(files, from, toRel);
        if (moved.length > 0) fails.push(`${JSON.stringify(files.map((x) => [x.rel, x.content]))} ${from} → ${toRel} : ${moved.join(" ; ")}`);
      }
      expect(fails.slice(0, 3), `${fails.length} / 3000, root ${dirs[0] === ""}`).toEqual([]);
    }
  });
});
