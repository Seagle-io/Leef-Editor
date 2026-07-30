import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// The "light" theme had no syntax-highlighting colors at all (dark/dracula/
// solarized all come with one bundled). This gives it its own, matching the
// app's blue accent (--toolbar-fg).
const lightHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "#3a55d9", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold", color: "#1a1a1a" },
  { tag: t.emphasis, fontStyle: "italic", color: "#1a1a1a" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#888888" },
  { tag: t.link, color: "#3a55d9", textDecoration: "underline" },
  { tag: t.url, color: "#7a86c9" },
  { tag: t.monospace, color: "#b3261e", backgroundColor: "#f4f4f4" },
  { tag: t.quote, color: "#666666", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "#aaaaaa" },
  { tag: t.list, color: "#3a55d9" },
  { tag: t.processingInstruction, color: "#aaaaaa" },
  { tag: t.meta, color: "#999999" },
]);

export const lightTheme = syntaxHighlighting(lightHighlightStyle);
