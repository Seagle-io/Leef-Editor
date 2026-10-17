/**
 * HTML → Markdown, used by the editable preview: the rendered DOM is edited in
 * place, then converted back to markdown source so the editor stays the single
 * source of truth.
 *
 * Turndown is loaded on demand — it's only needed once the preview is unlocked.
 */
import type TurndownServiceType from "turndown";

let servicePromise: Promise<TurndownServiceType> | null = null;

async function getService(): Promise<TurndownServiceType> {
  servicePromise ??= (async () => {
    const [{ default: TurndownService }, gfm] = await Promise.all([import("turndown"), import("turndown-plugin-gfm")]);

    const service = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**",
    });
    service.use(gfm.gfm);

    // Chrome, not content: the copy buttons live inside the rendered output.
    service.remove(["style", "script"]);
    service.addRule("copyButton", {
      filter: (node) => node.classList?.contains("copy-code-btn") ?? false,
      replacement: () => "",
    });

    // A rendered Mermaid block is an <svg>; the original source is kept in
    // `data-src` by the renderer.
    service.addRule("mermaid", {
      filter: (node) => node.nodeName === "PRE" && node.classList.contains("mermaid"),
      replacement: (_content, node) => {
        const el = node as HTMLElement;
        const source = el.getAttribute("data-src") ?? el.textContent ?? "";
        return `\n\n\`\`\`mermaid\n${source.trim()}\n\`\`\`\n\n`;
      },
    });

    // A link retargeted at render time (`#app` → `#section-app`): write back the
    // href of the source, never Leef's internal id (T044 K9). Escaping as
    // Turndown's own inline links.
    service.addRule("retargetedLink", {
      filter: (node) => node.nodeName === "A" && Boolean(node.getAttribute("data-href-source")),
      replacement: (content, node) => {
        const el = node as HTMLElement;
        const escaped = el.getAttribute("data-href-source")!.replace(/([<>()])/g, "\\$1");
        const href = escaped.includes(" ") ? `<${escaped}>` : escaped;
        const title = (el.getAttribute("title") ?? "").replace(/(\n+\s*)+/g, "\n").replace(/"/g, '\\"');
        return `[${content}](${href}${title ? ` "${title}"` : ""})`;
      },
    });

    // Fenced code: keep the language recorded on the wrapper.
    service.addRule("codeBlock", {
      filter: (node) => node.nodeName === "DIV" && node.classList.contains("code-block"),
      replacement: (_content, node) => {
        const el = node as HTMLElement;
        const lang = el.getAttribute("data-lang") ?? "";
        const code = el.querySelector("code")?.textContent ?? "";
        return `\n\n\`\`\`${lang}\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
      },
    });

    // Admonition → `!!! type "Title"` … `!!!` block (markdown-it-admonition
    // syntax: the body is not indented and the block has a closing marker).
    service.addRule("admonition", {
      filter: (node) => node.classList?.contains("admonition") ?? false,
      replacement: (_content, node) => {
        const el = node as HTMLElement;
        const type = Array.from(el.classList).find((c) => c !== "admonition") ?? "note";
        const titleEl = el.querySelector(".admonition-title");
        const title = titleEl?.textContent?.trim() ?? "";
        titleEl?.remove();
        const bodyHtml = el.innerHTML;
        const body = turndownSync(service, bodyHtml).trim();
        const heading = title && title.toLowerCase() !== type ? `!!! ${type} "${title}"` : `!!! ${type}`;
        return `\n\n${heading}\n${body ? `${body}\n` : ""}!!!\n\n`;
      },
    });

    // Footnotes: the generated section becomes `[^n]: …` definitions, and the
    // in-text superscript links become `[^n]` references.
    service.addRule("footnoteRef", {
      filter: (node) => node.classList?.contains("footnote-ref") ?? false,
      replacement: (content) => `[^${content.replace(/[^\w-]/g, "")}]`,
    });
    service.addRule("footnoteSection", {
      filter: (node) => node.classList?.contains("footnotes") ?? false,
      replacement: (_content, node) => {
        const items = Array.from((node as HTMLElement).querySelectorAll("li"));
        const lines = items.map((li) => {
          const label = li.id.replace(/^fn/, "");
          const clone = li.cloneNode(true) as HTMLElement;
          clone.querySelectorAll(".footnote-backref").forEach((el) => el.remove());
          return `[^${label}]: ${turndownSync(service, clone.innerHTML).trim().replace(/\n+/g, " ")}`;
        });
        return lines.length > 0 ? `\n\n${lines.join("\n")}\n` : "";
      },
    });

    return service;
  })();

  return servicePromise;
}

function turndownSync(service: TurndownServiceType, html: string): string {
  return service.turndown(html);
}

/**
 * The page-break marker is an empty `<div>`, which Turndown drops as blank
 * before any rule gets a chance to run — so it travels through the conversion
 * as a text token and is restored afterwards.
 */
const PAGE_BREAK_TOKEN = "@@gmd-pagebreak@@";

export async function htmlToMarkdown(html: string): Promise<string> {
  const service = await getService();
  const prepared = html.replace(/<div class="page-break"[^>]*><\/div>/g, `<p>${PAGE_BREAK_TOKEN}</p>`);
  const markdown = service.turndown(prepared).replace(new RegExp(PAGE_BREAK_TOKEN, "g"), "\\pagebreak");
  return `${markdown.trim()}\n`;
}
