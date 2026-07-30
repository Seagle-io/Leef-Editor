/**
 * Workspace = a folder opened as a tree of markdown files. Desktop only: it
 * needs real directory access, which the browser build doesn't have (the
 * explorer is simply hidden there).
 */
import { writable } from "svelte/store";
import { isTauri } from "./fileio";

export interface TreeNode {
  name: string;
  path: string;
  /** Directory children, or undefined for a file. */
  children?: TreeNode[];
}

export interface Workspace {
  root: string;
  name: string;
  tree: TreeNode[];
}

const MARKDOWN = /\.(md|markdown|txt)$/i;
/** Folders never worth showing in a notes tree. */
const SKIP = new Set([".git", "node_modules", ".obsidian", "target", "dist", ".svelte-kit"]);
const MAX_DEPTH = 8;

export const workspace = writable<Workspace | null>(null);

export function workspaceSupported(): boolean {
  return isTauri();
}

function join(dir: string, name: string): string {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

async function readTree(dir: string, depth = 0): Promise<TreeNode[]> {
  const { readDir } = await import("@tauri-apps/plugin-fs");
  const entries = await readDir(dir);
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);

    if (entry.isDirectory) {
      if (depth >= MAX_DEPTH) continue;
      const children = await readTree(path, depth + 1);
      // Directories with no markdown anywhere below are just noise.
      if (children.length > 0) nodes.push({ name: entry.name, path, children });
    } else if (MARKDOWN.test(entry.name)) {
      nodes.push({ name: entry.name, path });
    }
  }

  // Folders first, then files, each alphabetically.
  return nodes.sort((a, b) => {
    const aDir = a.children ? 0 : 1;
    const bDir = b.children ? 0 : 1;
    return aDir - bDir || a.name.localeCompare(b.name, "fr");
  });
}

/** Asks for a folder and loads it as the current workspace. */
export async function openWorkspace(): Promise<Workspace | null> {
  if (!workspaceSupported()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const root = await open({ directory: true, multiple: false });
  if (!root || Array.isArray(root)) return null;

  const loaded: Workspace = {
    root,
    name: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    tree: await readTree(root),
  };
  workspace.set(loaded);
  return loaded;
}

/** Re-reads the current workspace from disk (files created outside GMD). */
export async function refreshWorkspace(current: Workspace): Promise<void> {
  workspace.set({ ...current, tree: await readTree(current.root) });
}

export function closeWorkspace(): void {
  workspace.set(null);
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}
