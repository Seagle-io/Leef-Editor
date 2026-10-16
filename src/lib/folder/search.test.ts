import { afterEach, describe, expect, it, vi } from "vitest";
import { compileQuery, INTERRUPTED, searchInWorker, searchNotes, type FileResult, type SearchableNote, type SearchOptions, type WorkerRequest } from "./search";

const plain: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

function re(q: string, o: Partial<SearchOptions> = {}): RegExp {
  const r = compileQuery(q, { ...plain, ...o });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function note(rel: string, content: string, headings: string[] = []): SearchableNote {
  return { path: `/d/${rel}`, rel, content, headings };
}

async function run(notes: SearchableNote[], r: RegExp, signal = new AbortController().signal) {
  const results: FileResult[] = [];
  const summary = await searchNotes(notes, r, (b) => results.push(...b), signal);
  return { results, summary };
}

describe("compileQuery", () => {
  it("rejects queries under 2 characters (empty, 1 char)", () => {
    for (const q of ["", "a"]) {
      const r = compileQuery(q, plain);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("too-short");
    }
  });

  it("accepts exactly 2 characters (boundary)", () => {
    expect(compileQuery("ab", plain).ok).toBe(true);
  });

  it("returns a readable error for an invalid regex", () => {
    const r = compileQuery("(abc", { ...plain, regex: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid-regex");
      expect(r.error.message).toMatch(/^Expression régulière invalide/);
    }
  });

  it("escapes plain text so regex syntax is literal", () => {
    expect("a.b+c".match(re("a.b+c"))?.[0]).toBe("a.b+c");
    expect("axb+c".match(re("a.b+c"))).toBeNull();
  });

  it("honours case", () => {
    expect("Hello".match(re("hello"))).not.toBeNull();
    expect("Hello".match(re("hello", { caseSensitive: true }))).toBeNull();
  });

  it("whole word works with accents, digits and underscore", () => {
    const r = re("été", { wholeWord: true });
    expect("un été chaud".match(r)).not.toBeNull();
    expect("préétés".match(r)).toBeNull();
    expect("été2".match(r)).toBeNull();
    expect("_été".match(r)).toBeNull();
  });

  it("whole word wraps a whole regex alternation", () => {
    const r = re("chat|chien", { regex: true, wholeWord: true });
    expect("chatte".match(r)).toBeNull();
    expect("un chien".match(r)?.[0]).toBe("chien");
  });

  it("handles unicode: emoji, RTL, accents", () => {
    expect("a 😀 b".match(re("😀 b"))?.[0]).toBe("😀 b");
    expect("שלום עולם".match(re("עולם"))?.[0]).toBe("עולם");
    expect("ÉCOLE".match(re("école"))).not.toBeNull();
  });

  it("accepts control characters in the query without throwing", () => {
    expect(compileQuery("a\u0001b", plain).ok).toBe(true);
  });

  it("copes with a very large query", () => {
    const r = compileQuery("x".repeat(100_000), plain);
    expect(r.ok).toBe(true);
  });
});

describe("searchNotes", () => {
  it("orders by rel, reports 1-based line and column", async () => {
    const { results, summary } = await run([note("b.md", "x\nfoo bar"), note("a.md", "foo")], re("foo"));
    expect(results.map((r) => r.rel)).toEqual(["a.md", "b.md"]);
    expect(results[1].hits[0]).toMatchObject({ line: 2, column: 1, length: 3 });
    expect(summary).toMatchObject({ files: 2, hits: 2, truncated: false, aborted: false });
  });

  it("flags titleMatch on file name or ATX heading, without content hits", async () => {
    const { results } = await run([note("dir/foo.md", "rien"), note("x.md", "rien", ["Le foo"]), note("y.md", "rien", ["bar"])], re("foo"));
    expect(results.map((r) => [r.rel, r.titleMatch, r.hits.length])).toEqual([["dir/foo.md", true, 0], ["x.md", true, 0]]);
  });

  it("ignores empty matches", async () => {
    const { results } = await run([note("a.md", "abc")], /x*/gu);
    expect(results).toEqual([]);
  });

  it("ignores empty matches next to astral characters (emoji) without looping", async () => {
    const { results } = await run([note("a.md", "😀 bonjour\nnote 🍃 leef\ne\u0301te\u0301 שלום 𝒳")], /x*/gu);
    expect(results).toEqual([]);
    const alt = await run([note("a.md", "note 🍃 leef")], re("x|", { regex: true }));
    expect(alt.results).toEqual([]);
  });

  it("titleMatch ignores empty matches in an emoji name or heading without looping", async () => {
    const { results } = await run([note("😀.md", "rien", ["🍃 titre"])], /x*/gu);
    expect(results).toEqual([]);
  });

  it("empty file and CRLF lines", async () => {
    const { results } = await run([note("e.md", ""), note("c.md", "ab foo\r\nfoo\r\n")], re("foo"));
    expect(results).toHaveLength(1);
    expect(results[0].hits.map((h) => h.preview)).toEqual(["ab foo", "foo"]);
  });

  it("lone CR and mixed line endings split lines like CodeMirror", async () => {
    const { results } = await run([note("a.md", "un\rdeux\rcible"), note("b.md", "a\r\nb\rc\n\r\ncible")], re("cible"));
    expect(results.map((r) => r.hits[0].line)).toEqual([3, 5]);
    expect(results[0].hits[0]).toMatchObject({ column: 1, preview: "cible" });
  });

  it("truncates previews at 200 around the match", async () => {
    const line = `${"a".repeat(500)}NEEDLE${"b".repeat(500)}`;
    const { results } = await run([note("a.md", line)], re("needle"));
    const hit = results[0].hits[0];
    expect(hit.preview.length).toBeLessThanOrEqual(200);
    expect(hit.preview).toContain("NEEDLE");
    expect(line.slice(hit.previewStart, hit.previewStart + hit.preview.length)).toBe(hit.preview);
    expect(hit.column).toBe(501);
  });

  it("does not cut a surrogate pair at the preview start", async () => {
    const line = `${"😀".repeat(100)}NEEDLE${"😀".repeat(100)}`;
    const { results } = await run([note("a.md", line)], re("needle"));
    expect(results[0].hits[0].preview).not.toMatch(/^[\uDC00-\uDFFF]/);
  });

  it("caps hits per file at 100 and flags it", async () => {
    const { results, summary } = await run([note("a.md", "foo\n".repeat(150))], re("foo"));
    expect(results[0].hits).toHaveLength(100);
    expect(results[0].truncated).toBe(true);
    expect(summary.truncated).toBe(false);
  });

  it("caps total hits at 2000 and flags the summary", async () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(`n${String(i).padStart(2, "0")}.md`, "foo\n".repeat(100)));
    const { summary } = await run(notes, re("foo"));
    expect(summary.hits).toBe(2000);
    expect(summary.truncated).toBe(true);
  });

  it("exactly 2000 hits is not truncated, even with more files after (title-only ones still listed)", async () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`n${String(i).padStart(2, "0")}.md`, "foo\n".repeat(100)));
    const { results, summary } = await run([...notes, note("x.md", "rien"), note("y-foo.md", "rien")], re("foo"));
    expect(summary).toMatchObject({ hits: 2000, truncated: false });
    expect(results.at(-1)).toMatchObject({ rel: "y-foo.md", titleMatch: true, hits: [] });
  });

  it("2000 hits then one more → truncated", async () => {
    const notes = Array.from({ length: 20 }, (_, i) => note(`n${String(i).padStart(2, "0")}.md`, "foo\n".repeat(100)));
    const { summary } = await run([...notes, note("x.md", "rien"), note("z.md", "foo")], re("foo"));
    expect(summary).toMatchObject({ hits: 2000, truncated: true });
  });

  it("exactly 100 hits in a file is not truncated", async () => {
    const { results } = await run([note("a.md", "foo\n".repeat(100))], re("foo"));
    expect(results[0]).toMatchObject({ truncated: false });
    expect(results[0].hits).toHaveLength(100);
  });

  it("skips binary (NUL) and huge files", async () => {
    const { results } = await run(
      [note("bin.md", "foo\0foo"), note("huge.md", `foo${"x".repeat(2_000_001)}`), note("ok.md", "foo")],
      re("foo"),
    );
    expect(results.map((r) => r.rel)).toEqual(["ok.md"]);
  });

  it("searches non-UTF-8 leftovers (U+FFFD) and control characters without failing", async () => {
    const { results } = await run([note("a.md", "�\u0007 foo \u001b[0m")], re("foo"));
    expect(results[0].hits[0].column).toBe(4);
  });

  it("handles RTL and emoji content", async () => {
    const { results } = await run([note("a.md", "שלום 😀 עולם")], re("עולם"));
    expect(results[0].hits[0]).toMatchObject({ line: 1, column: 9, length: 4 });
  });

  it("batches by 50 files and yields between batches", async () => {
    const notes = Array.from({ length: 120 }, (_, i) => note(`n${String(i).padStart(3, "0")}.md`, "foo"));
    const sizes: number[] = [];
    await searchNotes(notes, re("foo"), (b) => sizes.push(b.length), new AbortController().signal);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("stops on abort and says so", async () => {
    const controller = new AbortController();
    const notes = Array.from({ length: 200 }, (_, i) => note(`n${String(i).padStart(3, "0")}.md`, "foo"));
    const seen: FileResult[] = [];
    const summary = await searchNotes(notes, re("foo"), (b) => {
      seen.push(...b);
      controller.abort();
    }, controller.signal);
    expect(summary.aborted).toBe(true);
    expect(seen).toHaveLength(50);
  });

  it("returns aborted at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { results, summary } = await run([note("a.md", "foo")], re("foo"), controller.signal);
    expect(results).toEqual([]);
    expect(summary.aborted).toBe(true);
  });

  it("no notes → empty summary", async () => {
    const { summary } = await run([], re("foo"));
    expect(summary).toMatchObject({ files: 0, hits: 0, truncated: false, aborted: false });
  });
});

// Node has no Web Worker: a stand-in that answers with the real engine, stays silent (catastrophic regex) or fails.
class FakeWorker {
  static mode: "answer" | "silent" | "error" = "answer";
  static made: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = 0;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    FakeWorker.made.push(this);
  }
  postMessage(req: WorkerRequest) {
    if (FakeWorker.mode === "silent") return;
    if (FakeWorker.mode === "error") {
      setTimeout(() => this.onerror?.({ message: "boom" } as ErrorEvent), 0);
      return;
    }
    const results: FileResult[] = [];
    void searchNotes(req.notes, req.re, (b) => results.push(...b), new AbortController().signal).then((summary) =>
      this.onmessage?.({ data: { results, summary } } as MessageEvent),
    );
  }
  terminate() {
    this.terminated += 1;
  }
}

describe("searchInWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.mode = "answer";
    FakeWorker.made = [];
  });

  it("runs the engine in a module worker and terminates it once done", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { results, summary } = await searchInWorker(re("foo"), [note("b.md", "foo"), note("a.md", "x\nfoo")], new AbortController().signal);
    expect(results.map((r) => [r.rel, r.hits[0].line])).toEqual([["a.md", 2], ["b.md", 1]]);
    expect(summary).toMatchObject({ files: 2, hits: 2, aborted: false });
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0].url.pathname.endsWith("/search.worker.ts")).toBe(true);
    expect(FakeWorker.made[0].options).toEqual({ type: "module" });
    expect(FakeWorker.made[0].terminated).toBe(1);
  });

  it("abort before start rejects at once, no worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(searchInWorker(re("foo"), [note("a.md", "foo")], controller.signal)).rejects.toThrow(INTERRUPTED);
    expect(FakeWorker.made).toHaveLength(0);
  });

  it("abort while the worker is stuck terminates it; a second abort changes nothing", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "silent";
    const controller = new AbortController();
    const pending = searchInWorker(re("(a+)+$", { regex: true }), [note("a.md", "a".repeat(29) + "b")], controller.signal);
    setTimeout(() => {
      controller.abort();
      controller.abort();
    }, 10);
    await expect(pending).rejects.toThrow(INTERRUPTED);
    expect(FakeWorker.made[0].terminated).toBe(1);
  });

  it("times out (default 5 s, here 20 ms) and terminates the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "silent";
    const started = performance.now();
    await expect(searchInWorker(re("foo"), [note("a.md", "foo")], new AbortController().signal, { timeoutMs: 20 })).rejects.toThrow(INTERRUPTED);
    expect(performance.now() - started).toBeLessThan(500);
    expect(FakeWorker.made[0].terminated).toBe(1);
  });

  it("a late abort after the answer neither rejects nor terminates twice", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    await searchInWorker(re("foo"), [note("a.md", "foo")], controller.signal, { timeoutMs: 20 });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(FakeWorker.made[0].terminated).toBe(1);
  });

  it("a worker error rejects with a readable message", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.mode = "error";
    await expect(searchInWorker(re("foo"), [note("a.md", "foo")], new AbortController().signal)).rejects.toThrow("Recherche impossible : boom");
    expect(FakeWorker.made[0].terminated).toBe(1);
  });

  it("10 000 files and a 10 MB file go through the worker (huge one skipped)", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const notes = Array.from({ length: 10_000 }, (_, i) => note(`n${String(i).padStart(5, "0")}.md`, i % 100 === 0 ? "foo" : "bar"));
    notes.push(note("huge.md", "foo ".repeat(2_500_000)));
    const { summary } = await searchInWorker(re("foo"), notes, new AbortController().signal);
    expect(summary).toMatchObject({ files: 100, hits: 100, truncated: false, aborted: false });
  });
});
