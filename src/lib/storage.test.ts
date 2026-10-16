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
    // Plein : le store refuse l'écriture (Result io, alerte) ; bloqué : thèmes en mémoire seule.
    expect([get(m.theme), document.documentElement.dataset.theme]).toEqual(failure === "setItem" ? ["light", "auto"] : ["dracula", "dark"]);
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
    // Migration non écrite : le store garde leef-auto, gmd-theme rejouée au prochain démarrage (T033 H6).
    expect(get((await theme()).theme)).toBe("light");
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
      expect(get(m.storageErrors).onglets).toMatch(/session/);
    }
  });

  it("H1 session illisible (JSON tronqué, null, nombre, docs non tableau) → brouillon, erreur signalée ; absente → aucune erreur", async () => {
    for (const bad of ["{", "null", "5", '"x"', '{"docs":5}', '{"docs":{"0":{"content":"a"}}}']) {
      localStorage.clear();
      localStorage.setItem("gmd-session", bad);
      const m = await draft();
      expect(m.loadSession()).toBeNull();
      expect(get(m.storageErrors).onglets).toMatch(/session/);
    }
    localStorage.clear();
    const m = await draft();
    expect(m.loadSession()).toBeNull();
    expect(Object.values(get(m.storageErrors))).toEqual([null, null, null, null, null, null]);
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
    expect(get(d.storageErrors).onglets).toMatch(/onglets.*QuotaExceededError/);
    for (const [load, source] of [[page, "page"], [panes, "volets"], [previewEdit, "apercu"]] as const) {
      await load();
      expect(get((await import("./draft")).storageErrors)[source]).toMatch(/QuotaExceededError/);
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

describe("T042 erreurs de stockage par source", () => {
  const plein = (key?: string): void => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (key === undefined || k === key) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, k, v);
    });
  };

  it("J6 gmd-session et gmd-panes en échec → 2 messages, 1 par source, aucun écrasé", async () => {
    plein();
    const d = await draft();
    await import("./panes");
    d.saveSession([createDoc("VERSION-2")], 0);
    const errors = get(d.storageErrors);
    expect(errors.onglets).toMatch(/onglets.*QuotaExceededError/);
    expect(errors.volets).toMatch(/volets.*QuotaExceededError/);
    expect([errors.page, errors.apercu, errors.police]).toEqual([null, null, null]);
  });

  it("J5 panne puis écriture réussie → message de la source effacé (onglets, page, volets, aperçu), les autres gardés", async () => {
    plein();
    const d = await draft();
    const p = await import("./page");
    const v = await import("./panes");
    const a = await import("./previewEdit");
    d.saveSession([createDoc("A2")], 0);
    expect(Object.values(get(d.storageErrors)).filter((m) => m !== null)).toHaveLength(4);
    vi.restoreAllMocks();
    d.saveSession([createDoc("A3")], 0);
    expect(get(d.storageErrors)).toMatchObject({ onglets: null, page: expect.any(String), volets: expect.any(String), apercu: expect.any(String) });
    p.setPageFormat("letter");
    expect(get(d.storageErrors).page).toMatch(/mise en page/);
    p.togglePageMode();
    p.pageHeader.set("En-tête");
    p.pageFooter.set("{page}");
    v.togglePane("explorer");
    a.togglePreviewEditable();
    expect(get(d.storageErrors)).toEqual({ onglets: null, page: null, volets: null, apercu: null, police: null, theme: null });
    expect(d.loadSession()?.docs.map((doc) => doc.content)).toEqual(["A3"]);
  });

  it("J5 mise en page : en-tête 1 Mo refusé puis pied enregistré → erreur page gardée tant que l'en-tête n'est pas écrit", async () => {
    const d = await draft();
    const p = await import("./page");
    plein("gmd-page-header");
    p.pageHeader.set("x".repeat(1024 * 1024));
    p.pageFooter.set("{page}");
    expect(get(d.storageErrors).page).toMatch(/mise en page.*QuotaExceededError/);
    vi.restoreAllMocks();
    p.pageHeader.set("court");
    expect(get(d.storageErrors).page).toBeNull();
  });

  it("compatibilité : reportStorageError / storageError = source « police » ; les autres sources n'y paraissent pas", async () => {
    plein("gmd-session");
    const d = await draft();
    d.saveSession([createDoc("x")], 0);
    expect(get(d.storageError)).toBeNull();
    d.reportStorageError("Police non enregistrée", new DOMException("full", "QuotaExceededError"));
    expect(get(d.storageError)).toMatch(/^Police non enregistrée \(QuotaExceededError ?: full\)\.$/);
    expect(get(d.storageErrors).police).toBe(get(d.storageError));
    d.effacerErreur("police");
    expect(get(d.storageError)).toBeNull();
    expect(get(d.storageErrors).onglets).toMatch(/onglets/);
  });

  it("entrées hostiles : action vide / 1 Mo / unicode, erreur non-Error (null, nombre, objet, chaîne) → message lisible, sans exception", async () => {
    const d = await draft();
    for (const action of ["", "x".repeat(1024 * 1024), "😀 𝄞 שלום é \uD800"]) {
      for (const e of [null, 5, { code: 1 }, "texte", undefined, new TypeError("t")]) {
        expect(() => d.signalerErreur("page", action, e)).not.toThrow();
        expect(get(d.storageErrors).page?.startsWith(action)).toBe(true);
      }
    }
    expect(get(d.storageErrors).page).toBe("😀 𝄞 שלום é \uD800 (TypeError : t).");
  });
});

describe("T042 alerte de stockage (App)", () => {
  const lignes = (): string[] => [...document.querySelectorAll(".storage-alert p")].map((p) => p.textContent ?? "");
  const fermer = (): void => (document.querySelector(".storage-alert-close") as HTMLButtonElement).click();

  async function monte(): Promise<{ d: typeof import("./draft"); destroy: () => void }> {
    vi.resetModules();
    const d = await import("./draft");
    const { default: App } = await import("../App.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const app = new App({ target });
    return { d, destroy: () => { app.$destroy(); target.remove(); } };
  }

  it("J2 fermer → écriture réussie → nouvelle panne au même texte : l'alerte réapparaît ; J6 2 sources → 2 lignes ; fermer masque l'occurrence", async () => {
    const { tick } = await import("svelte");
    const { d, destroy } = await monte();
    const setItem = Storage.prototype.setItem;
    let full = new Set<string>();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (full.has(k)) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, k, v);
    });
    try {
      full = new Set(["gmd-session"]);
      d.saveSession([createDoc("VERSION-2")], 0);
      await tick();
      const panne = lignes();
      expect(panne).toEqual([expect.stringMatching(/onglets.*QuotaExceededError/)]);
      fermer();
      await tick();
      expect(lignes()).toEqual([]);
      d.saveSession([createDoc("VERSION-2 bis")], 0);
      await tick();
      expect(lignes()).toEqual([]);
      full = new Set();
      d.saveSession([createDoc("VERSION-3")], 0);
      await tick();
      full = new Set(["gmd-session"]);
      d.saveSession([createDoc("VERSION-4")], 0);
      await tick();
      expect(lignes()).toEqual(panne);
      full = new Set(["gmd-session", "gmd-panes"]);
      (await import("./panes")).togglePane("explorer");
      await tick();
      expect(lignes()).toEqual([panne[0], expect.stringMatching(/volets.*QuotaExceededError/)]);
    } finally {
      destroy();
    }
  });
});
