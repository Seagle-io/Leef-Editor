// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { accentVars, contrastRatio, mixHex } from "./color";
import { BUILTIN_THEMES, type Theme } from "./model";
import { themeVariables } from "./apply";
import { parseTheme, parseThemeFile } from "./validate";

type Store = typeof import("./store");

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("./store");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  window.matchMedia = globalThis.matchMedia;
});

const dracula = BUILTIN_THEMES.find((t) => t.id === "leef-dracula") as Theme;

describe("migration gmd-*", () => {
  it.each([["light"], ["dark"], ["dracula"], ["solarized"]])("gmd-theme %s → leef-%s, clés supprimées", async (id) => {
    localStorage.setItem("gmd-theme", id);
    const store = await freshStore();
    expect(get(store.themeState).activeId).toBe(`leef-${id}`);
    expect(localStorage.getItem("gmd-theme")).toBeNull();
    expect(localStorage.getItem("leef-themes-v1")).not.toBeNull();
  });

  it("valeur inconnue ou absente → leef-auto", async () => {
    localStorage.setItem("gmd-theme", "<script>");
    expect(get((await freshStore()).themeState).activeId).toBe("leef-auto");
  });

  it.each([["georgia", "serif"], ["jetbrains-mono", "mono"]])("gmd-font %s → contentFont %s sur copie du thème actif", async (font, expected) => {
    localStorage.setItem("gmd-theme", "dark");
    localStorage.setItem("gmd-font", font);
    const store = await freshStore();
    const active = get(store.activeTheme);
    expect(active.contentFont).toBe(expected);
    expect(active.builtin).toBe(false);
    expect(active.name).toBe("Sombre personnalisé");
    expect(localStorage.getItem("gmd-font")).toBeNull();
  });

  it("gmd-font inter ou prototype (\"constructor\") → aucun thème créé", async () => {
    for (const font of ["inter", "constructor"]) {
      localStorage.clear();
      localStorage.setItem("gmd-font", font);
      const state = get((await freshStore()).themeState);
      expect(state.themes.filter((t) => !t.builtin)).toEqual([]);
      expect(localStorage.getItem("gmd-font")).toBeNull();
    }
  });

  it("migration jouée une seule fois : cache présent → gmd-* ignorées", async () => {
    await freshStore();
    localStorage.setItem("gmd-theme", "dark");
    expect(get((await freshStore()).themeState).activeId).toBe("leef-auto");
    expect(localStorage.getItem("gmd-theme")).toBe("dark");
  });
});

describe("store", () => {
  it("dupliquer un thème intégré → copie utilisateur, nom unique, intégré intact", async () => {
    const store = await freshStore();
    const a = store.duplicateTheme("leef-dracula");
    const b = store.duplicateTheme("leef-dracula");
    const themes = get(store.themeState).themes;
    expect(themes.find((t) => t.id === a)).toMatchObject({ name: "Dracula copie", builtin: false, base: "dark", accent: "#bd93f9" });
    expect(themes.find((t) => t.id === b)?.name).toBe("Dracula copie 2");
    expect(a).toMatch(/^user-[0-9a-f]{8}$/);
    expect(themes.find((t) => t.id === "leef-dracula")).toEqual(dracula);
  });

  it("éditer un intégré → copie « personnalisé » activée ; éditer un utilisateur → en place", async () => {
    const store = await freshStore();
    const copy = store.editTheme("leef-light", { size: 18 });
    expect(get(store.themeState).activeId).toBe(copy);
    expect(get(store.activeTheme)).toMatchObject({ name: "Clair personnalisé", size: 18 });
    expect(store.editTheme(copy, { size: 20 })).toBe(copy);
    expect(get(store.activeTheme).size).toBe(20);
    expect(document.documentElement.style.getPropertyValue("--leef-content-size")).toBe("20px");
  });

  it("rename / delete : intégré refusé, doublon refusé, actif supprimé → leef-auto", async () => {
    const store = await freshStore();
    const id = store.editTheme("leef-dark", { size: 16 });
    expect(store.renameTheme("leef-dark", "X")).toMatchObject({ ok: false, error: { code: "builtin" } });
    expect(store.renameTheme(id, "sombre")).toMatchObject({ ok: false, error: { code: "name-taken" } });
    expect(store.renameTheme(id, "")).toMatchObject({ ok: false, error: { code: "invalid-field", field: "name" } });
    expect(store.renameTheme(id, "Mon thème")).toEqual({ ok: true, value: undefined });
    expect(store.deleteTheme("leef-auto")).toMatchObject({ ok: false, error: { code: "builtin" } });
    expect(store.deleteTheme("user-00000000")).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(store.deleteTheme(id).ok).toBe(true);
    expect(get(store.themeState).activeId).toBe("leef-auto");
  });

  it("export → import : aller-retour, nom pris → suffixe, id/builtin absents du fichier", async () => {
    const store = await freshStore();
    const exported = store.exportTheme("leef-dracula");
    const file = JSON.parse(exported);
    expect(file).toMatchObject({ format: "leef-theme", version: 1 });
    expect(file.theme.id).toBeUndefined();
    expect(file.theme.builtin).toBeUndefined();
    const r = store.importTheme(exported);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const imported = get(store.themeState).themes.find((t) => t.id === r.value);
    expect(imported).toMatchObject({ name: "Dracula 2", builtin: false, overrides: dracula.overrides });
  });

  it("ThemeFile v1 : cache persisté = { version: 1, active, themes utilisateur }", async () => {
    const store = await freshStore();
    const id = store.duplicateTheme("leef-solarized");
    store.selectTheme(id);
    const file = JSON.parse(localStorage.getItem("leef-themes-v1") ?? "");
    expect(file).toMatchObject({ version: 1, active: id });
    expect(file.themes).toHaveLength(1);
    expect(parseThemeFile(JSON.stringify(file)).ok).toBe(true);
    expect(get((await freshStore()).themeState).activeId).toBe(id);
  });

  it("cache corrompu → thème par défaut + themeState.error, pas d'exception", async () => {
    localStorage.setItem("leef-themes-v1", "{pas du json");
    const state = get((await freshStore()).themeState);
    expect(state.activeId).toBe("leef-auto");
    expect(state.error).toMatch(/illisibles/);
  });

  it("selectTheme inconnu → erreur explicite", async () => {
    const store = await freshStore();
    expect(() => store.selectTheme("nope")).toThrow(/introuvable/);
  });
});

describe("import JSON invalide → erreur par champ", () => {
  const wrap = (theme: unknown): string => JSON.stringify({ format: "leef-theme", version: 1, theme });
  const cases: [string, unknown, string][] = [
    ["base", { base: "sepia" }, "base"],
    ["accent", { accent: "#12345" }, "accent"],
    ["accent injection", { accent: "red; background:url(x)" }, "accent"],
    ["contentFont", { contentFont: "Arial; } body {" }, "contentFont"],
    ["editorFont vide", { editorFont: "" }, "editorFont"],
    ["editorFont trop longue", { editorFont: "a".repeat(201) }, "editorFont"],
    ["size", { size: 12 }, "size"],
    ["editorSize", { editorSize: 23 }, "editorSize"],
    ["lineHeight", { lineHeight: 2.1 }, "lineHeight"],
    ["lineWidth", { lineWidth: 49 }, "lineWidth"],
    ["lineWidth chaîne", { lineWidth: "68" }, "lineWidth"],
    ["name", { name: "" }, "name"],
    ["overrides non objet", { overrides: [] }, "overrides"],
    ["overrides couleur", { overrides: { dark: { text: "white" } } }, "overrides.dark.text"],
  ];
  it.each(cases)("%s", async (_n, theme, field) => {
    const store = await freshStore();
    expect(store.importTheme(wrap(theme))).toMatchObject({ ok: false, error: { code: "invalid-field", field } });
    expect(get(store.themeState).themes).toHaveLength(BUILTIN_THEMES.length);
  });

  it("JSON invalide, format absent, fichier trop gros", async () => {
    const store = await freshStore();
    expect(store.importTheme("")).toMatchObject({ ok: false, error: { code: "invalid-json" } });
    expect(store.importTheme("{")).toMatchObject({ ok: false, error: { code: "invalid-json" } });
    expect(store.importTheme("null")).toMatchObject({ ok: false, error: { code: "invalid-field", field: "format" } });
    expect(store.importTheme("{}")).toMatchObject({ ok: false, error: { code: "invalid-field", field: "format" } });
    expect(store.importTheme(wrap({ name: "x".repeat(70 * 1024) }))).toMatchObject({ ok: false, error: { code: "too-large" } });
    expect(store.importTheme(wrap({ name: "é".repeat(33 * 1024) }))).toMatchObject({ ok: false, error: { code: "too-large" } });
  });
});

describe("parseTheme — entrées hostiles", () => {
  it("vide : {} → défauts de leef-auto ; non-objets refusés", () => {
    expect(parseTheme({})).toMatchObject({ ok: true, value: { base: "auto", accent: "blue", size: 15, editorSize: 14, lineHeight: 1.6, lineWidth: 68, editorFont: "mono" } });
    for (const u of [null, undefined, 42, "x", []]) expect(parseTheme(u)).toMatchObject({ ok: false, error: { code: "invalid-field" } });
  });

  it("caractères de contrôle et demi-paires UTF-16 isolées refusés (nom, police)", () => {
    for (const bad of ["a\u0000b", "a\nb", "a\u007fb", "\ud800", "x\udc00y"]) {
      expect(parseTheme({ name: bad })).toMatchObject({ ok: false, error: { field: "name" } });
      expect(parseTheme({ contentFont: bad })).toMatchObject({ ok: false, error: { field: "contentFont" } });
    }
  });

  it("unicode accepté : accents, emoji, RTL ; longueur en points de code", () => {
    for (const name of ["Thème été", "Nuit 🌙", "עברית ‏RTL", "日本語"]) expect(parseTheme({ name }).ok).toBe(true);
    expect(parseTheme({ name: "🌙".repeat(60) }).ok).toBe(true);
    expect(parseTheme({ name: "🌙".repeat(61) })).toMatchObject({ ok: false, error: { field: "name" } });
    expect(parseTheme({ contentFont: '"Noto Sans", "思源黑体", serif' }).ok).toBe(true);
  });

  it("valeurs limites incluses, juste au-delà exclues, non finis exclus", () => {
    const ok = { size: 13, editorSize: 11, lineHeight: 1.2, lineWidth: 50, name: "x".repeat(60), editorFont: "a".repeat(200) };
    expect(parseTheme(ok).ok).toBe(true);
    expect(parseTheme({ size: 22, editorSize: 22, lineHeight: 2.0, lineWidth: 120 }).ok).toBe(true);
    expect(parseTheme({ lineWidth: null })).toMatchObject({ ok: true, value: { lineWidth: null } });
    for (const patch of [{ size: 12.99 }, { size: 22.01 }, { editorSize: 10 }, { lineHeight: 1.19 }, { lineWidth: 121 }, { name: "x".repeat(61) }]) {
      expect(parseTheme(patch).ok).toBe(false);
    }
    for (const n of [NaN, Infinity, -Infinity]) expect(parseTheme({ size: n }).ok).toBe(false);
  });

  it("très grand : 5 000 clés inconnues ignorées, __proto__ sans effet", () => {
    const big: Record<string, unknown> = JSON.parse('{"__proto__":{"polluted":true},"overrides":{"dark":{"__proto__":"#000000"}}}');
    for (let i = 0; i < 5000; i++) big[`k${i}`] = i;
    const r = parseTheme(big);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(big).length).toBeGreaterThan(5000);
  });

  it("couleurs en majuscules normalisées en minuscules", () => {
    expect(parseTheme({ accent: "#ABCDEF", overrides: { light: { text: "#AABBCC" } } })).toMatchObject({
      ok: true, value: { accent: "#abcdef", overrides: { light: { text: "#aabbcc" } } },
    });
  });
});

describe("couleurs", () => {
  it("contrastRatio : noir/blanc = 21, identiques = 1, symétrique", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
    expect(contrastRatio("#336699", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#336699"), 10);
  });

  it("mixHex : bornes et milieu", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(() => mixHex("noir", "#ffffff", 0.5)).toThrow(/invalide/);
  });

  it.each([
    ["#ff3b30", "light", "#ffffff"], ["#34c759", "light", "#ffffff"], ["#ff9f0a", "light", "#ffffff"],
    ["#007aff", "dark", "#1c1c1e"], ["#5856d6", "dark", "#1c1c1e"], ["#8e8e93", "light", "#ffffff"],
    ["#bd93f9", "light", "#fef7e5"],
  ] as const)("accent %s sur %s %s → texte accent ≥ 4.5", (hex, scheme, bg) => {
    const v = accentVars(hex, scheme, bg);
    expect(contrastRatio(v.accent, bg)).toBeGreaterThanOrEqual(4.5);
    expect(v.fill).toBe(hex);
    expect(v.selection).toBe(mixHex(hex, bg, 0.75));
  });

  it("valeur limite : noir sur fond sombre inatteignable en 10 pas → meilleur effort, borné à 50 % vers le texte", () => {
    const v = accentVars("#000000", "dark", "#1c1c1e");
    expect(v.accent).toBe(mixHex("#000000", "#f5f5f7", 0.5));
    expect(contrastRatio(v.accent, "#1c1c1e")).toBeGreaterThan(contrastRatio("#000000", "#1c1c1e"));
  });

  it("accent déjà lisible → inchangé", () => {
    expect(accentVars("#0066d6", "light", "#ffffff").accent).toBe("#0066d6");
  });
});

describe("applyTheme / themeVariables", () => {
  it("accent personnalisé → 3 variables ; preset → aucune, data-accent posé par applyTheme", () => {
    const custom = themeVariables(dracula, "dark", "#1c1c1e");
    expect(custom["--leef-accent-fill"]).toBe("#bd93f9");
    expect(custom["--leef-bg-content"]).toBe("#2d2f3f");
    expect(custom["--leef-font-content"]).toBe("var(--leef-font-ui)");
    expect(custom["--leef-measure"]).toBe("68ch");
    const preset = themeVariables(BUILTIN_THEMES[0], "light", "#ffffff");
    expect(preset["--leef-accent"]).toBeUndefined();
    expect(themeVariables({ ...BUILTIN_THEMES[0], lineWidth: null, contentFont: "Georgia, serif" }, "light", "#fff")["--leef-measure"]).toBe("none");
  });

  it("changement de thème retire les variables du précédent", async () => {
    const store = await freshStore();
    store.selectTheme("leef-dracula");
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--leef-bg-content")).toBe("#2d2f3f");
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.accent).toBeUndefined();
    store.selectTheme("leef-light");
    expect(root.style.getPropertyValue("--leef-bg-content")).toBe("");
    expect(root.style.getPropertyValue("--leef-accent")).toBe("");
    expect(root.dataset.accent).toBe("blue");
  });
});
