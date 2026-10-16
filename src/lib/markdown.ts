import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import admonition from "markdown-it-admonition";
import copyIconSvg from "./icons/copy.svg?raw";

// html:false (default) keeps raw HTML in the source escaped as text,
// preventing script injection when rendering user-authored markdown.
const md = new MarkdownIt({ linkify: true, breaks: false }).use(footnote).use(admonition);

// markdown-it-admonition doesn't strip the quotes from `!!! type "Title"`,
// leaving them as literal text in the rendered title. Also capitalize the
// type-name fallback used when no title is given, to match mkdocs-material.
md.core.ruler.after("block", "admonition_title_cleanup", (state) => {
  const tokens = state.tokens;
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i].type !== "admonition_title_open" || tokens[i + 1]?.type !== "inline") continue;
    const inlineToken = tokens[i + 1];
    const isTypeFallback = inlineToken.content === tokens[i - 1]?.info;
    const unquoted = inlineToken.content.replace(/^"(.*)"$/, "$1");
    inlineToken.content = isTypeFallback ? unquoted.replace(/^./, (c) => c.toUpperCase()) : unquoted;
  }
});

/**
 * Manual page break: a line containing only `\pagebreak` (or `\newpage`).
 * Renders an empty marker block that the paged preview turns into a real page
 * break, and that plain scrolling mode shows as a labelled separator.
 */
md.block.ruler.before("hr", "pagebreak", (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(start, max).trim();
  if (line !== "\\pagebreak" && line !== "\\newpage") return false;
  if (silent) return true;

  const token = state.push("pagebreak", "div", 0);
  token.markup = line;
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
});

md.renderer.rules.pagebreak = () => '<div class="page-break" aria-hidden="true"></div>\n';

const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim();
  // `data-src` / `data-lang` let the editable preview convert the rendered
  // block back to its original fence (Mermaid's source is replaced by an SVG).
  if (info === "mermaid") {
    const source = md.utils.escapeHtml(token.content);
    return `<pre class="mermaid" data-src="${source}">${source}</pre>`;
  }
  const rendered = defaultFence(tokens, idx, options, env, self);
  return `<div class="code-block" data-lang="${md.utils.escapeHtml(info)}"><button class="copy-code-btn" type="button" aria-label="Copier le code">${copyIconSvg}</button>${rendered}</div>`;
};

type Token = ReturnType<typeof md.parse>[number];

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}

function collectHeadings(tokens: Token[]): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;

    const level = Number(token.tag.slice(1));
    const text = tokens[i + 1]?.content ?? "";
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count > 0 ? `${base}-${count}` : base;

    token.attrSet("id", id);
    items.push({ level, text, id });
  }

  return items;
}

export type MarkdownToken = Token;

/**
 * Tokens with heading ids already assigned: the common input of the HTML
 * renderer and of the Word / Excel exporters, so anchors match everywhere.
 */
export function parseMarkdown(source: string): { tokens: Token[]; toc: TocItem[] } {
  const tokens = md.parse(source, {});
  return { tokens, toc: collectHeadings(tokens) };
}

export function renderDocument(source: string): { html: string; toc: TocItem[] } {
  const { tokens, toc } = parseMarkdown(source);
  const html = md.renderer.render(tokens, md.options, {});
  return { html, toc };
}

export function generateTocMarkdown(toc: TocItem[]): string {
  if (toc.length === 0) return "";
  const minLevel = Math.min(...toc.map((item) => item.level));
  const lines = toc.map((item) => {
    const indent = "  ".repeat(item.level - minLevel);
    return `${indent}- [${item.text}](#${item.id})`;
  });
  return `${lines.join("\n")}\n`;
}
