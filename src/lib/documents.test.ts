import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  activeDoc,
  activeId,
  addDoc,
  closeDoc,
  createDoc,
  docName,
  docTitle,
  documents,
  focusByPath,
  moveDoc,
  setDocuments,
  updateDoc,
} from "./documents";

describe("documents", () => {
  beforeEach(() => {
    setDocuments([]);
  });

  it("names a doc from its path and falls back for a new one", () => {
    expect(docName(createDoc("", "/home/x/notes/todo.md"))).toBe("todo.md");
    expect(docTitle(createDoc("", "/home/x/notes/todo.md"))).toBe("todo");
    expect(docName(createDoc(""))).toBe("Sans titre");
  });

  it("focuses the newly added doc", () => {
    const first = addDoc(createDoc("a"));
    const second = addDoc(createDoc("b"));
    expect(get(documents)).toHaveLength(2);
    expect(get(activeId)).toBe(second);
    expect(get(activeDoc)?.content).toBe("b");
    expect(first).not.toBe(second);
  });

  it("reuses the tab already showing a path", () => {
    const opened = addDoc(createDoc("a", "/tmp/a.md"));
    addDoc(createDoc("b", "/tmp/b.md"));

    expect(focusByPath("/tmp/a.md")).toBe(true);
    expect(get(activeId)).toBe(opened);
    expect(focusByPath("/tmp/never.md")).toBe(false);
  });

  it("marks a doc dirty without touching its neighbours", () => {
    const first = addDoc(createDoc("a"));
    const second = addDoc(createDoc("b"));

    updateDoc(first, { content: "a!", dirty: true });
    const [one, two] = get(documents);
    expect(one).toMatchObject({ content: "a!", dirty: true });
    expect(two).toMatchObject({ content: "b", dirty: false });
    expect(get(activeId)).toBe(second);
  });

  it("moves focus to the right-hand neighbour when closing the active tab", () => {
    const first = addDoc(createDoc("a"));
    const second = addDoc(createDoc("b"));
    const third = addDoc(createDoc("c"));

    activeId.set(second);
    closeDoc(second);
    expect(get(documents).map((d) => d.content)).toEqual(["a", "c"]);
    expect(get(activeId)).toBe(third);

    activeId.set(third);
    closeDoc(third);
    expect(get(activeId)).toBe(first);
  });

  it("keeps the focus when closing another tab", () => {
    const first = addDoc(createDoc("a"));
    const second = addDoc(createDoc("b"));
    activeId.set(second);

    closeDoc(first);
    expect(get(activeId)).toBe(second);
  });

  it("reorders tabs by drag and drop, ignoring out-of-range moves", () => {
    addDoc(createDoc("a"));
    addDoc(createDoc("b"));
    addDoc(createDoc("c"));

    moveDoc(0, 2);
    expect(get(documents).map((d) => d.content)).toEqual(["b", "c", "a"]);

    moveDoc(2, 0);
    expect(get(documents).map((d) => d.content)).toEqual(["a", "b", "c"]);

    moveDoc(1, 9);
    moveDoc(-1, 0);
    expect(get(documents).map((d) => d.content)).toEqual(["a", "b", "c"]);
  });

  it("restores a session, keeping the previously active doc", () => {
    const docs = [createDoc("a"), createDoc("b")];
    setDocuments(docs, docs[1].id);
    expect(get(activeId)).toBe(docs[1].id);

    // An id that no longer exists falls back to the first tab.
    setDocuments(docs, "doc-does-not-exist");
    expect(get(activeId)).toBe(docs[0].id);
  });
});
