/**
 * Loads the images a document references so the Word export can embed them.
 * Word reads PNG / JPEG / GIF everywhere; anything else (WebP, SVG, BMP…) is
 * re-encoded to PNG through a canvas. An image that can't be loaded (offline,
 * blocked by CORS, outside the app's file permissions) resolves to null and
 * the exporter keeps it as a link — never silently dropped.
 */
import type { ImageData } from "./docxWriter";

const NATIVE: Record<string, ImageData["extension"]> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image illisible : ${url}`));
    img.src = url;
  });
}

async function fromBlob(blob: Blob): Promise<ImageData | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || 1;
    const height = img.naturalHeight || 1;
    const native = NATIVE[blob.type];
    if (native) return { data: new Uint8Array(await blob.arrayBuffer()), width, height, extension: native };

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? { data: new Uint8Array(await png.arrayBuffer()), width, height, extension: "png" } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(0, index + 1) : "";
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" }[ext] ?? "";
}

/** `docPath` lets relative image paths resolve next to the document (desktop). */
export function imageResolver(docPath: string | null, desktop: boolean): (src: string) => Promise<ImageData | null> {
  return async (src) => {
    try {
      if (/^(data:|https?:|blob:)/i.test(src)) {
        const response = await fetch(src);
        if (!response.ok) return null;
        return await fromBlob(await response.blob());
      }
      if (!desktop) return null;
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const local = decodeURI(src.replace(/^file:\/\//i, ""));
      const isAbsolute = /^([a-z]:[\\/]|[\\/])/i.test(local);
      const path = isAbsolute || !docPath ? local : `${dirname(docPath)}${local}`;
      const bytes = await readFile(path);
      return await fromBlob(new Blob([bytes], { type: mimeFromPath(path) }));
    } catch {
      // Unreachable image: the exporter falls back to a link to it.
      return null;
    }
  };
}
