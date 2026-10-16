import type { PageSetup } from "./office/docxWriter";

export interface OpenResult {
  path: string | null;
  content: string;
}

/**
 * Documents are always edited as Markdown; Word and Excel files are converted
 * on open and on save (see `office/bridge.ts` for why that loses nothing).
 */
export type FileFormat = "markdown" | "docx" | "xlsx";

const FORMATS: Record<FileFormat, { name: string; extensions: string[]; mime: string }> = {
  markdown: { name: "Markdown", extensions: ["md", "markdown", "txt"], mime: "text/markdown;charset=utf-8" },
  docx: {
    name: "Document Word",
    extensions: ["docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    name: "Classeur Excel",
    extensions: ["xlsx"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

const ALL_EXTENSIONS = Object.values(FORMATS).flatMap((f) => f.extensions);

/** Extensions the app opens, for file pickers and the workspace tree. */
export const OPENABLE = new RegExp(`\\.(${ALL_EXTENSIONS.join("|")})$`, "i");

export function formatOf(path: string | null): FileFormat {
  const ext = path?.split(".").pop()?.toLowerCase();
  return ext === "docx" ? "docx" : ext === "xlsx" ? "xlsx" : "markdown";
}

/** What the Office exporters need besides the Markdown itself. */
export interface ExportContext {
  title: string;
  page: PageSetup;
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function decode(path: string, bytes: Uint8Array): Promise<string> {
  switch (formatOf(path)) {
    case "docx": {
      const { docxToMarkdown } = await import("./office/docxReader");
      return docxToMarkdown(bytes);
    }
    case "xlsx": {
      const { xlsxToMarkdown } = await import("./office/xlsx");
      return xlsxToMarkdown(bytes);
    }
    default:
      return new TextDecoder().decode(bytes);
  }
}

async function encode(format: FileFormat, content: string, docPath: string | null, context: ExportContext): Promise<Uint8Array> {
  switch (format) {
    case "docx": {
      const [{ markdownToDocx }, { imageResolver }] = await Promise.all([import("./office/docxWriter"), import("./office/images")]);
      return markdownToDocx(content, { ...context, resolveImage: imageResolver(docPath, isTauri()) });
    }
    case "xlsx": {
      const { markdownToXlsx } = await import("./office/xlsx");
      return markdownToXlsx(content, { title: context.title });
    }
    default:
      return new TextEncoder().encode(content);
  }
}

/** Reads any supported file from disk as Markdown (desktop). */
export async function readDocument(path: string): Promise<string> {
  const { readFile, readTextFile } = await import("@tauri-apps/plugin-fs");
  return formatOf(path) === "markdown" ? readTextFile(path) : decode(path, await readFile(path));
}

async function writeDocument(path: string, content: string, context: ExportContext, docPath: string | null): Promise<void> {
  const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
  const format = formatOf(path);
  if (format === "markdown") await writeTextFile(path, content);
  else await writeFile(path, await encode(format, content, docPath, context));
}

function download(name: string, data: Uint8Array | string, mime: string): void {
  // Copy into a plain ArrayBuffer-backed view: Blob rejects shared buffers.
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Dialog filters with the given format first, so it's the one preselected. */
function filtersFor(first: FileFormat) {
  const order: FileFormat[] = [first, ...(Object.keys(FORMATS) as FileFormat[]).filter((f) => f !== first)];
  return order.map((f) => ({ name: FORMATS[f].name, extensions: FORMATS[f].extensions }));
}

export async function openFile(): Promise<OpenResult | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ALL_EXTENSIONS }, ...filtersFor("markdown")],
    });
    if (!path || Array.isArray(path)) return null;
    return { path, content: await readDocument(path) };
  }

  return openFileWeb();
}

function openFileWeb(): Promise<OpenResult | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ALL_EXTENSIONS.map((ext) => `.${ext}`).join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buffer) => decode(file.name, new Uint8Array(buffer)))
        .then((content) => resolve({ path: file.name, content }), reject);
    };
    input.click();
  });
}

/**
 * Saves in the format the file name says: a document opened from a .docx is
 * written back as a .docx. `saveAs` always asks for the target (and so the format).
 */
export async function saveFile(content: string, path: string | null, context: ExportContext, saveAs = false): Promise<string | null> {
  if (isTauri()) {
    let target = path;
    if (!target || saveAs) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const format = formatOf(path);
      target = await save({
        defaultPath: path ?? `${context.title}.${FORMATS[format].extensions[0]}`,
        filters: filtersFor(format),
      });
      if (!target) return null;
    }
    await writeDocument(target, content, context, path);
    return target;
  }

  const name = path ?? "document.md";
  const format = formatOf(name);
  download(name, await encode(format, content, path, context), FORMATS[format].mime);
  return name;
}

/** Writes a Word / Excel copy of the document without changing which file it is. */
export async function exportOffice(format: "docx" | "xlsx", content: string, docPath: string | null, context: ExportContext): Promise<string | null> {
  const suggestedName = `${context.title}.${format}`;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const target = await save({ defaultPath: suggestedName, filters: [{ name: FORMATS[format].name, extensions: [format] }] });
    if (!target) return null;
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(target, await encode(format, content, docPath, context));
    return target;
  }

  download(suggestedName, await encode(format, content, docPath, context), FORMATS[format].mime);
  return suggestedName;
}

function htmlDocument(bodyHtml: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Document</title>
<style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a;}
pre{background:#f4f4f4;padding:0.75rem;border-radius:4px;overflow-x:auto;}
code{font-family:Consolas,monospace;}
blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem;color:#555;}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export async function exportHtml(bodyHtml: string, suggestedName = "document.html"): Promise<string | null> {
  const doc = htmlDocument(bodyHtml);

  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const target = await save({
      defaultPath: suggestedName,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!target) return null;
    await writeTextFile(target, doc);
    return target;
  }

  download(suggestedName, doc, "text/html;charset=utf-8");
  return suggestedName;
}
