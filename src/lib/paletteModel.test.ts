import { describe, expect, it, vi } from "vitest";
import type { AppCommand } from "./commands";
import type { PaletteFile } from "./paletteModel";

// commands.ts lit localStorage à l'import (récentes) : l'environnement de test est Node.
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});

const { highlightSegments, paletteGroups, paletteRows, parsePaletteInput } = await import("./paletteModel");

function cmd(id: string, title: string, extra: Partial<AppCommand> = {}): AppCommand {
  return { id, title, group: "Fichier", enabled: () => true, run: () => {}, ...extra };
}

const base = { commands: [] as AppCommand[], recent: [] as string[], files: [] as PaletteFile[], headings: [], mac: false };

describe("parsePaletteInput", () => {
  it("lit le mode depuis le préfixe", () => {
    expect(parsePaletteInput(">lien")).toEqual({ mode: "commands", query: "lien" });
    expect(parsePaletteInput("# Plan")).toEqual({ mode: "headings", query: "Plan" });
    expect(parsePaletteInput("note")).toEqual({ mode: "files", query: "note" });
  });
  it("entrées limites : vide, préfixe seul, espaces, caractères de contrôle", () => {
    expect(parsePaletteInput("")).toEqual({ mode: "files", query: "" });
    expect(parsePaletteInput(">")).toEqual({ mode: "commands", query: "" });
    expect(parsePaletteInput("   #")).toEqual({ mode: "headings", query: "" });
    expect(parsePaletteInput("\u0000>x").mode).toBe("files");
    expect(parsePaletteInput("a>b")).toEqual({ mode: "files", query: "a>b" });
  });
  it("très grand : ne plante pas", () => {
    expect(parsePaletteInput(`>${"x".repeat(1_000_000)}`).query.length).toBe(1_000_000);
  });
});

describe("paletteRows commandes", () => {
  const commands = [
    cmd("a", "Alpha", { enabled: () => false }),
    cmd("b", "Bravo", { shortcut: { keys: "Mod-Shift-s", scope: "global" } }),
    cmd("c", "Charlie", { keywords: "zèbre" }),
    cmd("d", "Delta"),
  ];
  it("désactivées en fin de liste", () => {
    const rows = paletteRows("commands", "", { ...base, commands });
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
    expect(rows[3].disabled).toBe(true);
  });
  it("récentes en tête (ordre des récentes), inconnues ignorées, désactivée toujours en fin", () => {
    const rows = paletteRows("commands", "", { ...base, commands, recent: ["d", "inconnue", "a", "c"] });
    expect(rows.map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });
  it("récentes sans effet quand une requête est tapée", () => {
    const rows = paletteRows("commands", "a", { ...base, commands, recent: ["d"] });
    expect(rows[0].id).not.toBe("d");
  });
  it("filtre flou : positions sur le libellé, mots-clés acceptés sans positions", () => {
    const rows = paletteRows("commands", "brv", { ...base, commands });
    expect(rows.map((r) => r.id)).toEqual(["b"]);
    expect(rows[0].positions).toEqual([0, 1, 3]);
    const kw = paletteRows("commands", "zebre", { ...base, commands });
    expect(kw.map((r) => r.id)).toEqual(["c"]);
    expect(kw[0].positions).toEqual([]);
  });
  it("raccourci formaté selon la plateforme", () => {
    expect(paletteRows("commands", "bravo", { ...base, commands, mac: false })[0].shortcut).toBe("Ctrl+Maj+S");
    expect(paletteRows("commands", "bravo", { ...base, commands, mac: true })[0].shortcut).toBe("⌘⇧S");
    expect(paletteRows("commands", "alpha", { ...base, commands })[0].shortcut).toBeNull();
  });
  it("≤ 50 lignes sur 100 000 commandes", () => {
    const many = Array.from({ length: 100_000 }, (_, i) => cmd(`c${i}`, `Commande ${i}`));
    expect(paletteRows("commands", "", { ...base, commands: many })).toHaveLength(50);
    expect(paletteRows("commands", "cmd", { ...base, commands: many.slice(0, 2000) }).length).toBeLessThanOrEqual(50);
  });
  it("requête de plus de 64 caractères : aucune ligne ; sans commande : vide", () => {
    expect(paletteRows("commands", "a".repeat(65), { ...base, commands })).toEqual([]);
    expect(paletteRows("commands", "", base)).toEqual([]);
  });
  it("unicode : accents, emoji, RTL, caractères de contrôle", () => {
    const odd = [cmd("e", "Éditer 😀 la note"), cmd("r", "مرحبا بالعالم"), cmd("z", "a\u0000b‮")];
    expect(paletteRows("commands", "editer", { ...base, commands: odd }).map((r) => r.id)).toEqual(["e"]);
    expect(paletteRows("commands", "😀", { ...base, commands: odd }).map((r) => r.id)).toEqual(["e"]);
    expect(paletteRows("commands", "مرحبا", { ...base, commands: odd }).map((r) => r.id)).toEqual(["r"]);
    expect(paletteRows("commands", "\u0000b", { ...base, commands: odd }).map((r) => r.id)).toEqual(["z"]);
  });
  it("valeurs limites : requête de 64 caractères exactement", () => {
    const title = "x".repeat(64);
    expect(paletteRows("commands", title, { ...base, commands: [cmd("x", title)] })).toHaveLength(1);
  });
});

describe("paletteRows fichiers et titres", () => {
  const files: PaletteFile[] = [
    { path: "/n/a.md", label: "Format des liens", detail: "Conception" },
    { path: "/n/b.md", label: "Feuille de route", detail: "" },
    { path: "/n/a.md", label: "Format des liens", detail: "Onglet" },
  ];
  it("dédoublonne par path, ordre d'origine si requête vide", () => {
    expect(paletteRows("files", "", { ...base, files }).map((r) => r.id)).toEqual(["/n/a.md", "/n/b.md"]);
  });
  it("filtre sur le libellé et le détail", () => {
    expect(paletteRows("files", "concep", { ...base, files }).map((r) => r.id)).toEqual(["/n/a.md"]);
    expect(paletteRows("files", "fdr", { ...base, files })[0].id).toBe("/n/b.md");
  });
  it("titres : id du titre, niveau en détail", () => {
    const headings = [{ level: 2, text: "Le problème", id: "le-probleme" }, { level: 1, text: "Plan", id: "plan" }];
    const rows = paletteRows("headings", "prob", { ...base, headings });
    expect(rows).toEqual([{ id: "le-probleme", label: "Le problème", detail: "Titre de niveau 2", shortcut: null, disabled: false, positions: [3, 4, 5, 6] }]);
    expect(paletteRows("headings", "", { ...base, headings })).toHaveLength(2);
  });
  it("très grand : 100 000 notes → 50 lignes", () => {
    const many = Array.from({ length: 100_000 }, (_, i) => ({ path: `/p/${i}`, label: `Note ${i}`, detail: "" }));
    expect(paletteRows("files", "", { ...base, files: many })).toHaveLength(50);
  });
});

describe("highlightSegments", () => {
  it("regroupe les points de code consécutifs, emoji entier", () => {
    expect(highlightSegments("a😀bc", [1, 3])).toEqual([
      { text: "a", hit: false }, { text: "😀", hit: true }, { text: "b", hit: false }, { text: "c", hit: true },
    ]);
  });
  it("vide et positions hors bornes", () => {
    expect(highlightSegments("", [0, 5])).toEqual([]);
    expect(highlightSegments("ab", [9])).toEqual([{ text: "ab", hit: false }]);
  });
});

describe("paletteGroups (maquette 3)", () => {
  const files: PaletteFile[] = [
    { path: "/n/format.md", label: "Format des liens", detail: "Conception" },
    { path: "/n/feuille.md", label: "Feuille de route T4", detail: "" },
    { path: "/n/sync.md", label: "Synchronisation hors ligne", detail: "Conception" },
    { path: "/n/liens-2.md", label: "Liens morts", detail: "Archives" },
    { path: "/n/lien-wiki.md", label: "Lien wiki", detail: "" },
  ];
  const commands = [
    cmd("insert.link", "Insérer un lien"),
    cmd("insert.wiki", "Insérer un lien wiki vers une note"),
    cmd("view.backlinks", "Afficher les rétroliens", { keywords: "liens entrants" }),
    cmd("export.html", "Exporter en HTML", { keywords: "lien" }),
    cmd("off", "Lien inactif", { enabled: () => false }),
  ];
  const src = { ...base, files, commands };
  const ids = (g: ReturnType<typeof paletteGroups>[number]) =>
    g.entries.map((e) => (e.kind === "create" ? `+${e.name}` : e.row.id));

  it("sans préfixe : Notes puis Commandes, 3 + 3 au plus", () => {
    const groups = paletteGroups("lien", src);
    expect(groups.map((g) => g.title)).toEqual(["Notes", "Commandes"]);
    expect(groups[0].entries).toHaveLength(3);
    expect(groups[1].entries).toHaveLength(3);
    expect(groups[0].entries.every((e) => e.kind === "note")).toBe(true);
    expect(groups[1].entries.every((e) => e.kind === "command")).toBe(true);
  });
  it("requête vide : 3 notes dans l'ordre, commandes récentes en tête", () => {
    const groups = paletteGroups("", { ...src, recent: ["view.backlinks"] });
    expect(ids(groups[0])).toEqual(["/n/format.md", "/n/feuille.md", "/n/sync.md"]);
    expect(ids(groups[1])[0]).toBe("view.backlinks");
    expect(groups[0].entries.some((e) => e.kind === "create")).toBe(false);
  });
  it("note absente : ligne « créer » en tête du groupe Notes", () => {
    const groups = paletteGroups("  Évaluation des CRDT ", src);
    expect(groups[0].title).toBe("Notes");
    expect(ids(groups[0])).toEqual(["+Évaluation des CRDT"]);
  });
  it("ni note ni commande : seule la ligne « créer »", () => {
    expect(paletteGroups("qqqq", src).map(ids)).toEqual([["+qqqq"]]);
  });
  it("une note correspond : pas de ligne « créer »", () => {
    expect(paletteGroups("feuille", src)[0].entries.map((e) => e.kind)).toEqual(["note"]);
  });
  it("> : un seul groupe Commandes, désactivée en fin, ≤ 50", () => {
    const groups = paletteGroups(">lien", src);
    expect(groups.map((g) => g.title)).toEqual(["Commandes"]);
    expect(ids(groups[0]).at(-1)).toBe("off");
    expect(paletteGroups(">zzz", src)).toEqual([]);
    const many = Array.from({ length: 200 }, (_, i) => cmd(`c${i}`, `Commande ${i}`));
    expect(paletteGroups(">", { ...base, commands: many })[0].entries).toHaveLength(50);
  });
  it("# : groupe Titres, jamais de ligne « créer »", () => {
    const headings = [{ level: 2, text: "Le problème", id: "le-probleme" }];
    expect(paletteGroups("#prob", { ...src, headings }).map((g) => g.title)).toEqual(["Titres"]);
    expect(paletteGroups("#zzz", { ...src, headings })).toEqual([]);
  });
  it("entrées hostiles : vide, contrôle, très grand, unicode", () => {
    expect(paletteGroups("", base)).toEqual([]);
    expect(paletteGroups("   ", base)).toEqual([]);
    expect(paletteGroups("\u0000\u0007", base)).toEqual([]);
    expect(paletteGroups("a\u0000b\u001fc", base).map(ids)).toEqual([["+a b c"]]);
    expect(paletteGroups("x".repeat(513), base)).toEqual([]);
    expect(paletteGroups("x".repeat(512), base).map(ids)).toEqual([[`+${"x".repeat(512)}`]]);
    expect(paletteGroups("x".repeat(1_000_000), src)).toEqual([]);
    expect(paletteGroups("Réunion 😀 مرحبا", base).map(ids)).toEqual([["+Réunion 😀 مرحبا"]]);
  });
});
