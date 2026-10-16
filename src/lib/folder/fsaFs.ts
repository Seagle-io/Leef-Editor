import { OPENABLE } from "../fileio";
import type { TreeNode } from "../workspace";
import { FolderFsError, MAX_DEPTH, SKIP, sortNodes, type FolderFs, type FolderFsErrorCode } from "./types";

/** Directory access through the File System Access API: Chrome only, detected by feature. */
export function fsaSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function codeOf(e: unknown): FolderFsErrorCode {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotFoundError") return "not-found";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission";
  if (name === "InvalidModificationError") return "exists";
  return "io";
}

/** Asks for a folder; null when the user dismisses the picker. */
export async function pickFsaFs(): Promise<FolderFs | null> {
  if (!fsaSupported()) {
    throw new FolderFsError("io", "", "Dossiers indisponibles dans ce navigateur : utilisez Chrome ou l'application de bureau.");
  }
  try {
    return createFsaFs(await window.showDirectoryPicker({ mode: "readwrite" }));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw new FolderFsError(codeOf(e), "", `Ouverture du dossier impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** FolderFs over a directory handle; path = "fsa://<name>/<rel>". */
export function createFsaFs(dir: FileSystemDirectoryHandle): FolderFs {
  const root = `fsa://${dir.name}`;
  const files = new Map<string, FileSystemFileHandle>();

  function relOf(path: string): string[] {
    const segments = path.startsWith(`${root}/`) ? path.slice(root.length + 1).split("/") : [];
    if (segments.length === 0 || segments.some((s) => s === "" || s === "." || s === "..")) {
      throw new FolderFsError("outside-root", path, `Chemin hors du dossier ouvert : ${path}`);
    }
    return segments;
  }

  async function run<T>(path: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof FolderFsError) throw e;
      const code = codeOf(e);
      throw new FolderFsError(code, path, `Accès impossible à ${path} (${code}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function parentOf(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let current = dir;
    for (const part of segments.slice(0, -1)) current = await current.getDirectoryHandle(part, { create });
    return current;
  }

  async function fileOf(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const segments = relOf(path);
    const rel = segments.join("/");
    const known = files.get(rel);
    if (known) return known;
    const handle = await (await parentOf(segments, create)).getFileHandle(segments[segments.length - 1], { create });
    files.set(rel, handle);
    return handle;
  }

  async function write(path: string, data: string | Uint8Array): Promise<void> {
    const writable = await (await fileOf(path, true)).createWritable();
    try {
      // Copy: the signature wants an ArrayBuffer-backed view, not a possibly shared one.
      await writable.write(typeof data === "string" ? data : new Uint8Array(data));
    } catch (e) {
      // A stream in error rejects close() too: its error would hide the cause (disk full → "io").
      await writable.close().catch(() => undefined);
      throw e;
    }
    await writable.close();
  }

  async function existsAt(path: string): Promise<boolean> {
    try {
      await fileOf(path, false);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "TypeMismatchError") return true; // a folder
      if (e instanceof DOMException && e.name === "NotFoundError") return false;
      if (e instanceof FolderFsError) throw e;
      const code = codeOf(e);
      throw new FolderFsError(code, path, `Accès impossible à ${path} (${code}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function readTree(handle: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith(".") || SKIP.has(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const path = `${root}/${rel}`;
      if (entry.kind === "directory") {
        if (depth >= MAX_DEPTH) continue;
        const children = await readTree(entry as FileSystemDirectoryHandle, rel, depth + 1);
        if (children.length > 0) nodes.push({ name, path, children });
      } else if (OPENABLE.test(name)) {
        files.set(rel, entry as FileSystemFileHandle);
        nodes.push({ name, path });
      }
    }
    return sortNodes(nodes);
  }

  return {
    kind: "fsa",
    root,
    name: dir.name,
    tree: () => run(root, () => readTree(dir, "", 0)),
    readText: (path) => run(path, async () => (await (await fileOf(path, false)).getFile()).text()),
    readBytes: (path) => run(path, async () => new Uint8Array(await (await (await fileOf(path, false)).getFile()).arrayBuffer())),
    writeText: (path, c) => run(path, () => write(path, c)),
    writeBytes: (path, d) => run(path, () => write(path, d)),
    async rename(from, to) {
      if (await existsAt(to)) throw new FolderFsError("exists", to, `Le fichier existe déjà : ${to}`);
      await run(from, async () => {
        const bytes = new Uint8Array(await (await (await fileOf(from, false)).getFile()).arrayBuffer());
        await fileOf(to, true);
        try {
          await write(to, bytes);
        } catch (e) {
          // `to` did not exist: remove the file just created, or a retry would say "exists".
          const target = relOf(to);
          await (await parentOf(target, false)).removeEntry(target[target.length - 1]);
          files.delete(target.join("/"));
          throw e;
        }
        const segments = relOf(from);
        await (await parentOf(segments, false)).removeEntry(segments[segments.length - 1]);
        files.delete(segments.join("/"));
      });
    },
    exists: existsAt,
  };
}
