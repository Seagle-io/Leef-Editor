import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Built-in "light" and "dark" editor themes: chrome and syntax colors both come
// from the --leef-* tokens, so one palette follows the app theme and accent.
// (dracula / solarized stay third-party and untouched.)
const daHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "var(--leef-accent)", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold", color: "var(--leef-text)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--leef-text)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--leef-text-secondary)" },
  { tag: t.link, color: "var(--leef-accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--leef-syntax-type)" },
  { tag: t.monospace, color: "var(--leef-syntax-string)", backgroundColor: "var(--leef-bg-code)" },
  { tag: t.quote, color: "var(--leef-text-secondary)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--leef-text-tertiary)" },
  { tag: t.list, color: "var(--leef-accent)" },
  { tag: t.processingInstruction, color: "var(--leef-text-tertiary)" },
  { tag: t.meta, color: "var(--leef-text-tertiary)" },
  // Fenced code blocks (languages loaded by lang-markdown).
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--leef-syntax-keyword)" },
  { tag: [t.string, t.regexp], color: "var(--leef-syntax-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--leef-syntax-number)" },
  { tag: t.comment, color: "var(--leef-syntax-comment)", fontStyle: "italic" },
  { tag: [t.typeName, t.className], color: "var(--leef-syntax-type)" },
  { tag: [t.function(t.variableName), t.propertyName], color: "var(--leef-syntax-function)" },
]);

function daTheme(dark: boolean): Extension[] {
  return [
    EditorView.theme(
      {
        "&": { color: "var(--leef-text)", backgroundColor: "var(--leef-bg-content)" },
        ".cm-content": { caretColor: "var(--leef-accent)" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--leef-accent)" },
        "& .cm-content ::selection, & .cm-content::selection": { backgroundColor: "var(--leef-text-selection)" },
        ".cm-gutters": {
          backgroundColor: "var(--leef-bg-content)",
          color: "var(--leef-text-tertiary)",
          borderRight: "var(--leef-hairline) solid var(--leef-separator)",
        },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--leef-bg-hover)" },
      },
      { dark },
    ),
    syntaxHighlighting(daHighlightStyle),
  ];
}

export const lightTheme = daTheme(false);
export const darkTheme = daTheme(true);
