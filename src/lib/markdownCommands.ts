import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

function wrapSelection(before: string, after: string): Command {
  return (view) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const content = view.state.sliceDoc(range.from, range.to);
        const alreadyWrapped = content.startsWith(before) && content.endsWith(after) && content.length >= before.length + after.length;

        if (alreadyWrapped) {
          const inner = content.slice(before.length, content.length - after.length);
          return {
            changes: [{ from: range.from, to: range.to, insert: inner }],
            range: EditorSelection.range(range.from, range.from + inner.length),
          };
        }

        const insert = `${before}${content}${after}`;
        return {
          changes: [{ from: range.from, to: range.to, insert }],
          range: EditorSelection.range(range.from + before.length, range.from + before.length + content.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    );
    return true;
  };
}

export const toggleBold = wrapSelection("**", "**");
export const toggleItalic = wrapSelection("*", "*");
export const toggleStrikethrough = wrapSelection("~~", "~~");
export const toggleInlineCode = wrapSelection("`", "`");

export const insertLink: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const label = view.state.sliceDoc(range.from, range.to) || "texte du lien";
      const insert = `[${label}](url)`;
      const urlStart = range.from + label.length + 3;
      return {
        changes: [{ from: range.from, to: range.to, insert }],
        range: EditorSelection.range(urlStart, urlStart + 3),
      };
    }),
    { scrollIntoView: true, userEvent: "input" },
  );
  return true;
};

export const toggleCodeBlock: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const content = view.state.sliceDoc(range.from, range.to);
      const before = "```\n";
      const after = "\n```";
      const insert = `${before}${content}${after}`;
      const innerStart = range.from + before.length;
      return {
        changes: [{ from: range.from, to: range.to, insert }],
        range: EditorSelection.range(innerStart, innerStart + content.length),
      };
    }),
    { scrollIntoView: true, userEvent: "input" },
  );
  return true;
};

export const insertHorizontalRule: Command = (view) => {
  const pos = view.state.selection.main.to;
  const insert = "\n\n---\n\n";
  view.dispatch(
    view.state.update({
      changes: { from: pos, insert },
      selection: EditorSelection.cursor(pos + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

export const insertPageBreak: Command = (view) => {
  const pos = view.state.selection.main.to;
  const insert = "\n\n\\pagebreak\n\n";
  view.dispatch(
    view.state.update({
      changes: { from: pos, insert },
      selection: EditorSelection.cursor(pos + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

/**
 * Inserts an empty GFM table of the given size, cursor placed in the first
 * header cell. Columns are padded so the markdown source stays readable.
 */
export function insertTable(rows: number, cols: number): Command {
  return (view) => {
    const { state } = view;
    const pos = state.selection.main.to;
    const atLineStart = state.doc.lineAt(pos).from === pos;

    const header = `| ${Array.from({ length: cols }, (_, i) => `Colonne ${i + 1}`).join(" | ")} |`;
    const divider = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
    const body = Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => "   ").join(" | ")} |`);

    const lead = atLineStart ? "" : "\n\n";
    const insert = `${lead}${[header, divider, ...body].join("\n")}\n`;
    const firstCell = pos + lead.length + 2;

    view.dispatch(
      state.update({
        changes: { from: pos, insert },
        selection: EditorSelection.range(firstCell, firstCell + "Colonne 1".length),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  };
}

function toggleLinePrefix(prefix: string): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;

    let allHavePrefix = true;
    for (let n = startLine; n <= endLine; n++) {
      if (!state.doc.line(n).text.startsWith(prefix)) {
        allHavePrefix = false;
        break;
      }
    }

    const changes = [];
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n);
      if (allHavePrefix) {
        changes.push({ from: line.from, to: line.from + prefix.length });
      } else if (!line.text.startsWith(prefix)) {
        changes.push({ from: line.from, insert: prefix });
      }
    }

    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBulletList = toggleLinePrefix("- ");
export const toggleOrderedList = toggleLinePrefix("1. ");
export const toggleBlockquote = toggleLinePrefix("> ");

const headingPattern = /^#{1,6}\s+/;

function setHeadingLevel(level: number): Command {
  const prefix = `${"#".repeat(level)} `;
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;

    const changes = [];
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n);
      const match = line.text.match(headingPattern);
      const alreadyThisLevel = match?.[0] === prefix;
      const stripLength = match ? match[0].length : 0;
      changes.push({ from: line.from, to: line.from + stripLength, insert: alreadyThisLevel ? "" : prefix });
    }

    view.dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const setHeading1 = setHeadingLevel(1);
export const setHeading2 = setHeadingLevel(2);
export const setHeading3 = setHeadingLevel(3);

export const insertFootnote: Command = (view) => {
  const { state } = view;
  const text = state.doc.toString();
  const existing = [...text.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  const marker = `[^${next}]`;
  const pos = state.selection.main.to;
  const endPos = state.doc.length;
  const noteStub = `\n\n${marker}: `;

  view.dispatch(
    state.update({
      changes: [
        { from: pos, insert: marker },
        { from: endPos, insert: noteStub },
      ],
      // Cursor lands at the end of the appended definition stub, ready to
      // type the note's text, regardless of where the reference was inserted.
      selection: EditorSelection.cursor(endPos + marker.length + noteStub.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

export const insertAdmonition: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const content = state.sliceDoc(range.from, range.to) || "Contenu de la note.";
  const before = '!!! note "Note"\n';
  const insert = `${before}${content}\n!!!\n`;
  const innerStart = range.from + before.length;

  view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.range(innerStart, innerStart + content.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};
