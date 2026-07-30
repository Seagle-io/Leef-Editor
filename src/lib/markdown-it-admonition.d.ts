declare module "markdown-it-admonition" {
  import type MarkdownIt from "markdown-it";
  const admonition: (md: MarkdownIt, options?: { marker?: string; types?: string[] }) => void;
  export default admonition;
}
