import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsaFs, fsaSupported, pickFsaFs } from "./fsaFs";
import { FolderFsError } from "./types";

// Minimal in-memory File System Access: just what fsaFs calls.
class FakeFile {
  readonly kind = "file";
  constructor(readonly name: string, public data: Uint8Array = new Uint8Array()) {}
  async getFile() {
    const data = this.data;
    return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), text: async () => new TextDecoder().decode(data) };
  }
  async createWritable() {
    const file = this;
    return {
      async write(chunk: string | Uint8Array) {
        file.data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
      },
      async close() {},
    };
  }
}

class FakeDir {
  readonly kind = "directory";
  readonly children = new Map<string, FakeDir | FakeFile>();
  denyWrite = false;
  constructor(readonly name: string) {}
  async *entries() {
    yield* this.children.entries();
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let c = this.children.get(name);
    if (!c && o?.create) this.children.set(name, (c = new FakeDir(name)));
    if (!c) throw new DOMException("x", "NotFoundError");
    if (c.kind !== "directory") throw new DOMException("x", "TypeMismatchError");
    return c;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    let c = this.children.get(name);
    if (!c && o?.create) {
      if (this.denyWrite) throw new DOMException("x", "NotAllowedError");
      this.children.set(name, (c = new FakeFile(name)));
    }
    if (!c) throw new DOMException("x", "NotFoundError");
    if (c.kind !== "file") throw new DOMException("x", "TypeMismatchError");
    return c;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException("x", "NotFoundError");
  }
}

function setup() {
  const root = new FakeDir("notes");
  const sub = new FakeDir("sub");
  root.children.set("b.md", new FakeFile("b.md", new TextEncoder().encode("bé😀")));
  root.children.set("a.md", new FakeFile("a.md"));
  root.children.set("img.png", new FakeFile("img.png"));
  root.children.set(".hidden.md", new FakeFile(".hidden.md"));
  root.children.set("node_modules", new FakeDir("node_modules"));
  root.children.set("empty", new FakeDir("empty"));
  sub.children.set("c.md", new FakeFile("c.md"));
  root.children.set("sub", sub);
  const fs = createFsaFs(root as unknown as FileSystemDirectoryHandle);
  return { root, fs };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FolderFsError) return e.code;
    throw e;
  }
  return "none";
}

afterEach(() => vi.unstubAllGlobals());

describe("createFsaFs", () => {
  it("exposes kind, name and fsa:// root", () => {
    const { fs } = setup();
    expect([fs.kind, fs.name, fs.root]).toEqual(["fsa", "notes", "fsa://notes"]);
  });

  it("tree: folders first, skips hidden/SKIP/empty/non-openable", async () => {
    const { fs } = setup();
    const tree = await fs.tree();
    expect(tree.map((n) => n.name)).toEqual(["sub", "a.md", "b.md"]);
    expect(tree[0].children?.[0].path).toBe("fsa://notes/sub/c.md");
  });

  it("reads text (unicode) and bytes", async () => {
    const { fs } = setup();
    await fs.tree();
    expect(await fs.readText("fsa://notes/b.md")).toBe("bé😀");
    expect((await fs.readBytes("fsa://notes/b.md")).length).toBe(7);
  });

  it("writes text and bytes, creating files and folders", async () => {
    const { fs } = setup();
    await fs.writeText("fsa://notes/new/deep.md", "# Titre\n");
    expect(await fs.readText("fsa://notes/new/deep.md")).toBe("# Titre\n");
    await fs.writeBytes("fsa://notes/a.md", new Uint8Array([1, 2, 3]));
    expect([...(await fs.readBytes("fsa://notes/a.md"))]).toEqual([1, 2, 3]);
  });

  it("writes an empty and a very large file", async () => {
    const { fs } = setup();
    await fs.writeText("fsa://notes/a.md", "");
    expect(await fs.readText("fsa://notes/a.md")).toBe("");
    const big = "x".repeat(5_000_000);
    await fs.writeText("fsa://notes/big.md", big);
    expect((await fs.readText("fsa://notes/big.md")).length).toBe(big.length);
  });

  it("exists: file, missing, folder", async () => {
    const { fs } = setup();
    expect(await fs.exists("fsa://notes/b.md")).toBe(true);
    expect(await fs.exists("fsa://notes/nope.md")).toBe(false);
    expect(await fs.exists("fsa://notes/sub")).toBe(true);
  });

  it("rename = create + write + removeEntry", async () => {
    const { fs, root } = setup();
    await fs.rename("fsa://notes/b.md", "fsa://notes/sub/b2.md");
    expect(root.children.has("b.md")).toBe(false);
    expect(await fs.readText("fsa://notes/sub/b2.md")).toBe("bé😀");
  });

  it("rename onto an existing file → exists; unknown source → not-found", async () => {
    const { fs } = setup();
    expect(await code(fs.rename("fsa://notes/b.md", "fsa://notes/a.md"))).toBe("exists");
    expect(await code(fs.rename("fsa://notes/zz.md", "fsa://notes/y.md"))).toBe("not-found");
  });

  it("missing file → not-found", async () => {
    const { fs } = setup();
    expect(await code(fs.readText("fsa://notes/zz.md"))).toBe("not-found");
  });

  it("refused permission → permission", async () => {
    const { fs, root } = setup();
    root.denyWrite = true;
    expect(await code(fs.writeText("fsa://notes/fresh.md", "x"))).toBe("permission");
  });

  it("paths outside the root, traversal, empty segments → outside-root", async () => {
    const { fs } = setup();
    for (const p of ["fsa://other/a.md", "/etc/passwd", "fsa://notes", "fsa://notes/", "fsa://notes/../a.md", "fsa://notes//a.md", "fsa://notesx/a.md"]) {
      expect(await code(fs.readText(p))).toBe("outside-root");
    }
  });
});

describe("pickFsaFs / fsaSupported", () => {
  it("is unsupported without showDirectoryPicker and says so clearly", async () => {
    vi.stubGlobal("window", {});
    expect(fsaSupported()).toBe(false);
    await expect(pickFsaFs()).rejects.toThrow(/Chrome/);
  });

  it("is detected by feature, not by user agent", () => {
    vi.stubGlobal("window", { showDirectoryPicker: () => undefined });
    expect(fsaSupported()).toBe(true);
  });

  it("returns a FolderFs from the picker with readwrite, null on dismissal", async () => {
    const picker = vi.fn().mockResolvedValueOnce(new FakeDir("docs")).mockRejectedValueOnce(new DOMException("x", "AbortError"));
    vi.stubGlobal("window", { showDirectoryPicker: picker });
    expect((await pickFsaFs())?.root).toBe("fsa://docs");
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(await pickFsaFs()).toBeNull();
  });
});
