import type { TreeNode } from "../workspace";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type FolderFsErrorCode = "not-found" | "exists" | "permission" | "outside-root" | "io";

export class FolderFsError extends Error {
  code: FolderFsErrorCode;
  path: string;

  constructor(code: FolderFsErrorCode, path: string, message: string) {
    super(message);
    this.name = "FolderFsError";
    this.code = code;
    this.path = path;
  }
}

export interface FolderFs {
  readonly kind: "tauri" | "fsa";
  readonly root: string;
  readonly name: string;
  tree(): Promise<TreeNode[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, c: string): Promise<void>;
  writeBytes(path: string, d: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** Folders never worth showing in a notes tree (same set as workspace.ts). */
export const SKIP = new Set([".git", "node_modules", ".obsidian", "target", "dist", ".svelte-kit"]);
export const MAX_DEPTH = 8;

/** Folders first, then files, each alphabetically (workspace.ts order). */
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    const aDir = a.children ? 0 : 1;
    const bDir = b.children ? 0 : 1;
    return aDir - bDir || a.name.localeCompare(b.name, "fr");
  });
}
