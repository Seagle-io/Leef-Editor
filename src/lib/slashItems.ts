/**
 * Notion-style insert menu: typing `/` on an empty line offers the blocks GMD
 * can insert. The same list drives both surfaces, which insert differently —
 * the editor works on markdown source, the editable preview on rendered HTML.
 */
import type { Command } from "@codemirror/view";
import type { IconName } from "./icons";
import {
  insertAdmonition,
  insertFootnote,
  insertHorizontalRule,
  insertPageBreak,
  insertTable,
  setHeading1,
  setHeading2,
  setHeading3,
  toggleBlockquote,
  toggleBulletList,
  toggleCodeBlock,
  toggleOrderedList,
} from "./markdownCommands";

export interface SlashItem {
  id: string;
  label: string;
  /** Extra words matched by the filter, so "titre" also finds "Heading 1". */
  keywords: string;
  icon: IconName;
  /** Applied in the editor, on the line the `/` was typed on. */
  command: Command;
  /** Inserted in the editable preview, where content is HTML, not markdown. */
  html: string;
}

export const slashItems: SlashItem[] = [
  {
    id: "h1",
    label: "Titre 1",
    keywords: "heading h1 titre",
    icon: "h1",
    command: setHeading1,
    html: "<h1>Titre</h1>",
  },
  {
    id: "h2",
    label: "Titre 2",
    keywords: "heading h2 titre sous-titre",
    icon: "h2",
    command: setHeading2,
    html: "<h2>Titre</h2>",
  },
  {
    id: "h3",
    label: "Titre 3",
    keywords: "heading h3 titre",
    icon: "h3",
    command: setHeading3,
    html: "<h3>Titre</h3>",
  },
  {
    id: "bulletList",
    label: "Liste à puces",
    keywords: "liste puces bullet ul",
    icon: "bulletList",
    command: toggleBulletList,
    html: "<ul><li>Élément</li></ul>",
  },
  {
    id: "orderedList",
    label: "Liste numérotée",
    keywords: "liste numerotee ordered ol",
    icon: "orderedList",
    command: toggleOrderedList,
    html: "<ol><li>Élément</li></ol>",
  },
  {
    id: "quote",
    label: "Citation",
    keywords: "citation quote blockquote",
    icon: "quote",
    command: toggleBlockquote,
    html: "<blockquote><p>Citation</p></blockquote>",
  },
  {
    id: "codeBlock",
    label: "Bloc de code",
    keywords: "code bloc fence",
    icon: "codeBlock",
    command: toggleCodeBlock,
    html: '<div class="code-block" data-lang=""><pre><code>code</code></pre></div>',
  },
  {
    id: "table",
    label: "Tableau",
    keywords: "tableau table grille",
    icon: "table",
    command: insertTable(2, 3),
    html:
      "<table><thead><tr><th>Colonne 1</th><th>Colonne 2</th><th>Colonne 3</th></tr></thead>" +
      "<tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table>",
  },
  {
    id: "admonition",
    label: "Admonition",
    keywords: "admonition note avertissement warning encadre",
    icon: "noteAdmonition",
    command: insertAdmonition,
    html: '<div class="admonition note"><p class="admonition-title">Note</p><p>Contenu de la note.</p></div>',
  },
  {
    id: "mermaid",
    label: "Diagramme Mermaid",
    keywords: "mermaid diagramme graph schema",
    icon: "codeBlock",
    command: (view) => {
      const pos = view.state.selection.main.to;
      const insert = "```mermaid\ngraph TD;\n  A-->B;\n```\n";
      view.dispatch({ changes: { from: pos, insert }, userEvent: "input" });
      return true;
    },
    html: '<pre class="mermaid" data-src="graph TD;\n  A--&gt;B;">graph TD;\n  A--&gt;B;</pre>',
  },
  {
    id: "hr",
    label: "Ligne horizontale",
    keywords: "ligne separateur hr regle",
    icon: "hr",
    command: insertHorizontalRule,
    html: "<hr>",
  },
  {
    id: "pageBreak",
    label: "Saut de page",
    keywords: "saut page pagebreak",
    icon: "page",
    command: insertPageBreak,
    html: '<div class="page-break"></div><p></p>',
  },
  {
    id: "footnote",
    label: "Note de bas de page",
    keywords: "note bas page footnote",
    icon: "footnote",
    command: insertFootnote,
    html: '<sup class="footnote-ref">[1]</sup>',
  },
];

/** Accent- and case-insensitive filtering, so "élément" matches "element". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function filterSlashItems(query: string): SlashItem[] {
  const needle = normalize(query.trim());
  if (needle === "") return slashItems;
  return slashItems.filter((item) => normalize(`${item.label} ${item.keywords}`).includes(needle));
}
