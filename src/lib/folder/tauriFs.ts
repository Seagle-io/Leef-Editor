import { OPENABLE } from "../fileio";
import type { TreeNode } from "../workspace";
import { FolderFsError, MAX_DEPTH, SKIP, sortNodes, type FolderFs, type FolderFsErrorCode } from "./types";

function join(dir: string, name: string): string {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

function codeOf(e: unknown): FolderFsErrorCode {
  const text = String(e instanceof Error ? e.message : e);
  if (/not found|no such file|os error 2\b|introuvable/i.test(text)) return "not-found";
  if (/already exists|os error 17\b/i.test(text)) return "exists";
  if (/permission|denied|not allowed|os error 13\b/i.test(text)) return "permission";
  return "io";
}

/** FolderFs over @tauri-apps/plugin-fs; paths are absolute and must stay under `root`. */
export function tauriFs(root: string): FolderFs {
  const base = root.replace(/[\\/]+$/, "");

  function inside(path: string): string {
    const rest = path.slice(base.length);
    if (path.split(/[\\/]/).includes("..") || !path.startsWith(base) || !(rest === "" || /^[\\/]/.test(rest))) {
      throw new FolderFsError("outside-root", path, `Chemin hors du dossier ouvert : ${path}`);
    }
    return path;
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

  async function readTree(dir: string, depth: number): Promise<TreeNode[]> {
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const entries = await run(dir, () => readDir(dir));
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        if (depth >= MAX_DEPTH) continue;
        const children = await readTree(path, depth + 1);
        if (children.length > 0) nodes.push({ name: entry.name, path, children });
      } else if (OPENABLE.test(entry.name)) {
        nodes.push({ name: entry.name, path });
      }
    }
    return sortNodes(nodes);
  }

  return {
    kind: "tauri",
    root,
    name: base.split(/[\\/]/).filter(Boolean).pop() ?? base,
    tree: () => readTree(base, 0),
    async readText(path) {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      return run(path, () => readTextFile(inside(path)));
    },
    async readBytes(path) {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      return run(path, () => readFile(inside(path)));
    },
    async writeText(path, c) {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await run(path, () => writeTextFile(inside(path), c));
    },
    async writeBytes(path, d) {
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await run(path, () => writeFile(inside(path), d));
    },
    async rename(from, to) {
      const { exists, rename } = await import("@tauri-apps/plugin-fs");
      inside(from);
      inside(to);
      if (await run(to, () => exists(to))) throw new FolderFsError("exists", to, `Le fichier existe déjà : ${to}`);
      await run(from, () => rename(from, to));
    },
    async exists(path) {
      const { exists } = await import("@tauri-apps/plugin-fs");
      return run(path, () => exists(inside(path)));
    },
  };
}
