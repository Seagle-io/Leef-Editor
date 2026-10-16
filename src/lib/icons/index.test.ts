import { describe, expect, it } from "vitest";
import { icons, type IconName } from "./index";

const entries = Object.entries(icons) as [IconName, string][];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

describe("icons", () => {
  it("expose 57 icônes", () => {
    expect(entries).toHaveLength(57);
  });

  it("conserve les 50 noms existants et ajoute les 7 neufs", () => {
    const names: string[] = [
      "chevronDown", "chevronRight", "file", "folder", "folderOpen", "refresh", "sidebar", "split", "bold",
      "bulletList", "check", "close", "code", "codeBlock", "copy", "cut", "dangerAdmonition", "export",
      "focusEnter", "focusExit", "font", "footnote", "h1", "h2", "h3", "hr", "italic", "link", "lock",
      "maximize", "menu", "minimize", "new", "noteAdmonition", "open", "orderedList", "page", "paste", "print",
      "quote", "save", "search", "strikethrough", "successAdmonition", "table", "theme", "tipAdmonition", "toc",
      "unlock", "warningAdmonition", "inspector", "insert", "popup", "wikiLink", "editorOnly", "pageBreak",
      "folderInput",
    ];
    expect(Object.keys(icons).sort()).toEqual([...names].sort());
  });

  it.each(entries)("%s : SVG au trait, viewBox 24, trait par token", (_name, svg) => {
    expect(svg.length).toBeGreaterThan(0);
    expect(svg.length).toBeLessThan(2000);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain("stroke-width:var(--leef-icon-stroke");
    expect(svg.indexOf('fill="none"')).toBeLessThan(svg.indexOf(">"));
  });

  it.each(entries)("%s : ASCII pur, sans caractère de contrôle, sans script", (_name, svg) => {
    expect(CONTROL.test(svg)).toBe(false);
    // eslint-disable-next-line no-control-regex
    expect(/^[ -~\n]*$/.test(svg)).toBe(true);
    expect(svg).not.toMatch(/<script|on\w+=|javascript:|<!--/i);
  });

  it("lit une clé inconnue ou limite comme absente", () => {
    const table: Record<string, string | undefined> = icons;
    for (const key of ["", "toString", "__proto__", "é😀", "‮abc", "x".repeat(10_000)]) {
      expect(Object.hasOwn(icons, key)).toBe(false);
    }
    expect(table["inconnue"]).toBeUndefined();
  });
});
