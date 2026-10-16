// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { createDoc } from "./documents";

async function fresh<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return load();
}

const theme = (): Promise<typeof import("./theme")> => fresh(() => import("./theme"));
const page = (): Promise<typeof import("./page")> => fresh(() => import("./page"));
const draft = (): Promise<typeof import("./draft")> => fresh(() => import("./draft"));
const panes = (): Promise<typeof import("./panes")> => fresh(() => import("./panes"));
const previewEdit = (): Promise<typeof import("./previewEdit")> => fresh(() => import("./previewEdit"));

type Failure = "localStorage" | "getItem" | "setItem";

/** Accès à localStorage bloqué (cookies refusés), lecture refusée, ou stockage plein. */
const failStorage = (failure: Failure): void => {
  const thrower = (): never => {
    throw failure === "setItem" ? new DOMException("full", "QuotaExceededError") : new DOMException("denied", "SecurityError");
  };
  if (failure === "localStorage") vi.spyOn(window, "localStorage", "get").mockImplementation(thrower);
  else vi.spyOn(Storage.prototype, failure).mockImplementation(thrower);
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  window.matchMedia = globalThis.matchMedia;
});

describe.each<Failure>(["localStorage", "getItem", "setItem"])("V1 stockage indisponible (%s lève) → import sans exception, défauts, réglages en mémoire", (failure) => {
  it("theme.ts", async () => {
    failStorage(failure);
    const m = await theme();
    expect(get(m.theme)).toBe("light");
    m.setTheme("dracula");
    expect(get(m.theme)).toBe("dracula");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("page.ts", async () => {
    failStorage(failure);
    const m = await page();
    expect([get(m.pageFormat), get(m.pageMode), get(m.pageHeader), get(m.pageFooter)]).toEqual(["a4", false, "", m.DEFAULT_FOOTER]);
    m.setPageFormat("letter");
    m.togglePageMode();
    m.pageHeader.set("Titre");
    m.pageFooter.set("{page}");
    expect([get(m.pageFormat), get(m.pageMode), get(m.pageHeader), get(m.pageFooter)]).toEqual(["letter", true, "Titre", "{page}"]);
    expect(document.documentElement.style.getPropertyValue("--page-width")).toBe("215.9mm");
  });

  it("draft.ts", async () => {
    failStorage(failure);
    const m = await draft();
    expect(m.loadSession()).toBeNull();
    expect(() => m.saveSession([createDoc("# Note")], 0)).not.toThrow();
  });

  it("panes.ts", async () => {
    failStorage(failure);
    const m = await panes();
    expect(get(m.panes)).toEqual({ explorer: false, editor: true, preview: true, outline: true });
    m.togglePane("explorer");
    expect(get(m.panes).explorer).toBe(true);
  });

  it("previewEdit.ts", async () => {
    failStorage(failure);
    const m = await previewEdit();
    expect(get(m.previewEditable)).toBe(true);
    m.togglePreviewEditable();
    expect(get(m.previewEditable)).toBe(false);
  });
});

describe("V1 stockage plein : les valeurs déjà enregistrées restent lues", () => {
  it("theme, page, panes, previewEdit, draft", async () => {
    localStorage.setItem("gmd-theme", "solarized");
    localStorage.setItem("gmd-page-format", "legal");
    localStorage.setItem("gmd-page-mode", "on");
    localStorage.setItem("gmd-page-header", "En-tête");
    localStorage.setItem("gmd-panes", JSON.stringify({ outline: false }));
    localStorage.setItem("gmd-preview-editable", "false");
    localStorage.setItem("gmd-draft", "ancien brouillon");
    failStorage("setItem");
    expect(get((await theme()).theme)).toBe("solarized");
    const p = await page();
    expect([get(p.pageFormat), get(p.pageMode), get(p.pageHeader)]).toEqual(["legal", true, "En-tête"]);
    expect(get((await panes()).panes).outline).toBe(false);
    expect(get((await previewEdit()).previewEditable)).toBe(false);
    expect((await draft()).loadSession()?.docs[0].content).toBe("ancien brouillon");
  });
});

describe("entrées hostiles", () => {
  const texts = ["", "x".repeat(1024 * 1024), "\uD800 isolée \uDC00", "😀 𝄞 שלום é"];

  it("en-tête / pied : vide, 1 Mo, demi-paires UTF-16, emoji hors BMP + RTL + combinants → relus tels quels", async () => {
    for (const text of texts) {
      localStorage.clear();
      localStorage.setItem("gmd-page-header", text);
      localStorage.setItem("gmd-page-footer", text);
      const m = await page();
      expect(get(m.pageHeader)).toBe(text);
      expect(get(m.pageFooter)).toBe(text);
    }
  });

  it("session : mêmes textes en contenu → aller-retour fidèle", async () => {
    for (const text of texts) {
      localStorage.clear();
      const m = await draft();
      m.saveSession([createDoc(text, "a.md")], 0);
      expect(m.loadSession()?.docs.map((d) => [d.path, d.content])).toEqual([["a.md", text]]);
    }
  });

  it("valeurs inconnues ou limites (vide, casse, __proto__, 1 Mo, demi-paire) → défauts (thème, format, mode, aperçu)", async () => {
    for (const bad of ["", "A4", "__proto__", "constructor", "x".repeat(1024 * 1024), "\uD800"]) {
      localStorage.clear();
      for (const key of ["gmd-theme", "gmd-page-format", "gmd-page-mode", "gmd-preview-editable"]) localStorage.setItem(key, bad);
      expect(get((await theme()).theme)).toBe("light");
      const p = await page();
      expect([get(p.pageFormat), get(p.pageMode)]).toEqual(["a4", false]);
      expect(get((await previewEdit()).previewEditable)).toBe(true);
    }
  });

  it("volets / session illisibles (vide, tronqué, null, nombre, tableau, docs vides ou nuls) → défauts, ancien brouillon", async () => {
    for (const bad of ["", "{", "null", "5", "[]", '{"docs":[]}', '{"docs":[null]}', '{"docs":null}']) {
      localStorage.clear();
      localStorage.setItem("gmd-panes", bad);
      localStorage.setItem("gmd-session", bad);
      localStorage.setItem("gmd-draft", "brouillon");
      expect(get((await panes()).panes)).toMatchObject({ editor: true, preview: true });
      expect((await draft()).loadSession()?.docs.map((d) => d.content)).toEqual(["brouillon"]);
    }
  });
});

describe("T033 session, écritures, volets", () => {
  it("H1 session corrompue (content nombre / objet / null, path nombre, dirty non booléen, doc non objet) → session ignorée, brouillon, erreur signalée", async () => {
    for (const doc of [{ content: 5, path: null, dirty: false }, { content: {}, path: null, dirty: false }, { content: null, path: null, dirty: false }, { content: "ok", path: 7, dirty: false }, { content: "ok", path: null, dirty: "x" }, "texte", 5]) {
      localStorage.clear();
      localStorage.setItem("gmd-session", JSON.stringify({ docs: [{ content: "bon", path: null, dirty: false }, doc], activeIndex: 0 }));
      localStorage.setItem("gmd-draft", "brouillon");
      const m = await draft();
      expect(m.loadSession()?.docs.map((d) => d.content)).toEqual(["brouillon"]);
      expect(get(m.storageError)).toMatch(/session/);
    }
  });

  it("H1 session illisible (JSON tronqué, null, nombre, docs non tableau) → brouillon, erreur signalée ; absente → aucune erreur", async () => {
    for (const bad of ["{", "null", "5", '"x"', '{"docs":5}', '{"docs":{"0":{"content":"a"}}}']) {
      localStorage.clear();
      localStorage.setItem("gmd-session", bad);
      const m = await draft();
      expect(m.loadSession()).toBeNull();
      expect(get(m.storageError)).toMatch(/session/);
    }
    localStorage.clear();
    const m = await draft();
    expect(m.loadSession()).toBeNull();
    expect(get(m.storageError)).toBeNull();
  });

  it("H1 activeIndex hors bornes, négatif, décimal, texte, absent → borné ; valide → gardé", async () => {
    const docs = [{ content: "a", path: "a.md", dirty: true }, { content: "😀 שלום", path: null, dirty: false }];
    for (const [index, expected] of [[99, 0], [-3, 0], [1.5, 0], ["1", 0], [null, 0], [undefined, 0], [1, 1]] as const) {
      localStorage.clear();
      localStorage.setItem("gmd-session", JSON.stringify({ docs, activeIndex: index }));
      const r = (await draft()).loadSession();
      expect(r?.activeIndex).toBe(expected);
      expect(r?.docs.map((d) => [d.path, d.content, d.dirty])).toEqual([["a.md", "a", true], [null, "😀 שלום", false]]);
    }
  });

  it("H2 stockage plein → chaque écriture (session, mise en page, volets, aperçu) signale une erreur lisible", async () => {
    failStorage("setItem");
    const d = await draft();
    d.saveSession([createDoc("VERSION-2")], 0);
    expect(get(d.storageError)).toMatch(/onglets.*QuotaExceededError/);
    for (const load of [page, panes, previewEdit]) {
      await load();
      expect(get((await import("./draft")).storageError)).toMatch(/QuotaExceededError/);
    }
  });

  it("H3 theme.ts n'écrit jamais gmd-theme (import, setTheme)", async () => {
    const m = await theme();
    m.setTheme("dracula");
    expect(localStorage.getItem("gmd-theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("H9 volets : éditeur et aperçu tous deux false → éditeur montré ; types faux → défauts, aucune clé étrangère", async () => {
    localStorage.setItem("gmd-panes", '{"editor":false,"preview":false}');
    expect(get((await panes()).panes)).toEqual({ explorer: false, editor: true, preview: false, outline: true });
    for (const bad of ['"abc"', '{"editor":"x","preview":0,"outline":null,"explorer":{}}', '{"__proto__":{"editor":false},"x":1}', "[false,false]"]) {
      localStorage.setItem("gmd-panes", bad);
      expect(get((await panes()).panes)).toEqual({ explorer: false, editor: true, preview: true, outline: true });
    }
  });
});
