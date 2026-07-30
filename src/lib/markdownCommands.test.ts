import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertTable } from "./markdownCommands";

/** Minimal stand-in for an EditorView: commands only need state + dispatch. */
function fakeView(doc: string, cursor = doc.length) {
  let state = EditorState.create({ doc, selection: { anchor: cursor } });
  return {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = tr.state;
    },
  } as unknown as EditorView & { state: EditorState };
}

describe("insertTable", () => {
  it("inserts a GFM table of the requested size", () => {
    const view = fakeView("");
    insertTable(2, 3)(view);

    expect(view.state.doc.toString()).toBe(
      [
        "| Colonne 1 | Colonne 2 | Colonne 3 |",
        "| --- | --- | --- |",
        "|     |     |     |",
        "|     |     |     |",
        "",
      ].join("\n"),
    );
  });

  it("selects the first header cell so it can be typed over", () => {
    const view = fakeView("");
    insertTable(1, 2)(view);

    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("Colonne 1");
  });

  it("separates the table from preceding text with a blank line", () => {
    const view = fakeView("Du texte.");
    insertTable(1, 1)(view);

    expect(view.state.doc.toString()).toBe("Du texte.\n\n| Colonne 1 |\n| --- |\n|     |\n");
  });

  it("does not add a leading blank line at the start of an empty line", () => {
    const view = fakeView("Du texte.\n");
    insertTable(1, 1)(view);

    expect(view.state.doc.toString()).toBe("Du texte.\n| Colonne 1 |\n| --- |\n|     |\n");
  });
});
