export interface OpenResult {
  path: string | null;
  content: string;
}

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openFile(): Promise<OpenResult | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!path || Array.isArray(path)) return null;
    const content = await readTextFile(path);
    return { path, content };
  }

  return openFileWeb();
}

function openFileWeb(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ path: file.name, content: String(reader.result ?? "") });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

export async function saveFile(content: string, path: string | null): Promise<string | null> {
  if (isTauri()) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    let target = path;
    if (!target) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = await save({
        defaultPath: "document.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!target) return null;
    }
    await writeTextFile(target, content);
    return target;
  }

  return saveFileWeb(content, path);
}

function saveFileWeb(content: string, path: string | null): string {
  const name = path ?? "document.md";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return name;
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

  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}
