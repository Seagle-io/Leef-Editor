// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import Dialog from "./Dialog.svelte";
import {
  answerConfirm,
  cancelDialog,
  confirmDialog,
  dialogRequest,
  promptDialog,
  submitPrompt,
  type DialogRequest,
} from "./dialog";
import { fonts } from "./font";

// store.ts (lu par font.ts) écoute prefers-color-scheme au chargement : jsdom n'a pas matchMedia.
vi.hoisted(() => {
  window.matchMedia = () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList;
});

const source = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), "utf8");
const contentCss = source("../styles/content.css");
const tokensCss = source("../styles/tokens.css");
const mainTs = source("../main.ts");
const indexHtml = source("../../index.html");

const cur = (): DialogRequest | null => get(dialogRequest);
const ask = { title: "t", label: "l" };

describe("dialog", () => {
  it("file FIFO : une demande à la fois, ordre d'arrivée", async () => {
    const a = promptDialog(ask);
    const b = confirmDialog({ title: "t", message: "m", okLabel: "ok" });
    const c = promptDialog(ask);
    expect(cur()?.kind).toBe("prompt");
    expect(submitPrompt("x")).toBeNull();
    expect(await a).toBe("x");
    expect(cur()?.kind).toBe("confirm");
    answerConfirm(true);
    expect(await b).toBe(true);
    expect(cur()?.kind).toBe("prompt");
    cancelDialog();
    expect(await c).toBeNull();
    expect(cur()).toBeNull();
  });

  it("annulation : prompt → null, confirm → false, sans demande = sans effet", async () => {
    const p = promptDialog(ask);
    cancelDialog();
    expect(await p).toBeNull();
    const c = confirmDialog({ title: "t", message: "m", okLabel: "ok", danger: true });
    cancelDialog();
    expect(await c).toBe(false);
    expect(() => cancelDialog()).not.toThrow();
    expect(cur()).toBeNull();
  });

  it("validation refusée puis acceptée", async () => {
    const p = promptDialog({ ...ask, validate: (v) => (v.trim() ? null : "Saisie requise.") });
    expect(submitPrompt("  ")).toBe("Saisie requise.");
    expect(cur()?.kind).toBe("prompt");
    expect(submitPrompt("ok")).toBeNull();
    expect(await p).toBe("ok");
    expect(cur()).toBeNull();
  });

  it("validate qui lève : refus avec message, jamais d'exception", async () => {
    const p = promptDialog({ ...ask, validate: () => { throw new Error("boom"); } });
    expect(submitPrompt("a")).toBe("boom");
    cancelDialog();
    expect(await p).toBeNull();
  });

  it("submitPrompt sur confirm ou sans demande : sans effet", async () => {
    expect(submitPrompt("x")).toBeNull();
    const c = confirmDialog({ title: "t", message: "m", okLabel: "ok" });
    expect(submitPrompt("x")).toBeNull();
    expect(cur()?.kind).toBe("confirm");
    answerConfirm(false);
    expect(await c).toBe(false);
  });

  it("entrées hostiles : valeur rendue à l'identique", async () => {
    const valeurs = [
      "",
      "a".repeat(1_000_000),
      "\u0000\u0007\u001b[31m\r\n\t",
      "�\uD800",
      "éàü ñ 😀 👨‍👩‍👧 ‮عربى‬",
      "x".repeat(512),
      " ",
    ];
    for (const v of valeurs) {
      const p = promptDialog({ ...ask, value: v });
      expect(submitPrompt(v)).toBeNull();
      expect(await p).toBe(v);
    }
    const p = promptDialog({ title: "", label: "", okLabel: "" });
    cancelDialog();
    expect(await p).toBeNull();
  });
});

describe("Dialog.svelte : focus rendu à l'origine (D1)", () => {
  // jsdom n'implémente ni showModal ni close : on modélise l'état modal par l'attribut open.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  const fermetures: [string, (d: HTMLDialogElement) => void][] = [
    ["Échap", (d) => d.dispatchEvent(new Event("cancel", { cancelable: true }))],
    ["Entrée", (d) => d.querySelector("form")?.requestSubmit()],
    ["clic Annuler", (d) => [...d.querySelectorAll("button")].find((b) => b.textContent === "Annuler")?.click()],
  ];
  for (const [nom, fermer] of fermetures) {
    it(`${nom} : focus rendu après retrait du dialogue modal`, async () => {
      const origine = document.createElement("button");
      document.body.append(origine);
      const vue = new Dialog({ target: document.body });
      origine.focus();
      let modalAuFocus: boolean | null = null;
      origine.addEventListener("focus", () => { modalAuFocus = document.querySelector("dialog")?.open ?? false; });
      const p = promptDialog({ ...ask, value: "x" });
      await settle();
      const dialogue = document.querySelector("dialog");
      expect(dialogue?.open).toBe(true);
      expect(document.activeElement?.tagName).toBe("INPUT");
      if (dialogue) fermer(dialogue);
      await p;
      await settle();
      expect(document.querySelector("dialog")).toBeNull();
      expect(modalAuFocus).toBe(false);
      expect(document.activeElement).toBe(origine);
      vue.$destroy();
      origine.remove();
    });
  }

  it("entrées hostiles et limites : file de 2, origine retirée, textes extrêmes", async () => {
    const origine = document.createElement("button");
    document.body.append(origine);
    const vue = new Dialog({ target: document.body });
    origine.focus();
    const hostile = { title: "‮عربى‬ 👨‍👩‍👧 e\u0301".repeat(10_000), label: "\uD800\u0000", value: "a".repeat(1_000_000) };
    const a = promptDialog(hostile);
    const b = confirmDialog({ title: "", message: "", okLabel: "" });
    await settle();
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(submitPrompt(hostile.value)).toBeNull();
    expect(await a).toBe(hostile.value);
    await settle();
    expect(document.querySelector("dialog")?.open).toBe(true);
    expect(document.activeElement).not.toBe(origine);
    answerConfirm(true);
    expect(await b).toBe(true);
    await settle();
    expect(document.activeElement).toBe(origine);
    const c = promptDialog(ask);
    await settle();
    origine.remove();
    cancelDialog();
    expect(await c).toBeNull();
    await settle();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    vue.$destroy();
  });
});

describe("coquille : police, icône copier, barre, marque de démarrage", () => {
  type Font = typeof import("./font");
  type Store = typeof import("./themes/store");
  /** Rechargement : modules neufs, stockage conservé. */
  const reload = async (): Promise<{ f: Font; s: Store }> => {
    vi.resetModules();
    document.documentElement.removeAttribute("style");
    const s = await import("./themes/store");
    return { f: await import("./font"), s };
  };
  const PRESETS = { inter: "ui", georgia: "serif", "jetbrains-mono": "mono" } as const;
  const contentVar = (): string => document.documentElement.style.getPropertyValue("--leef-font-content");

  it("D2/V2 police : setFont = editTheme(thème actif, { contentFont }), aperçu posé par le thème", async () => {
    localStorage.clear();
    const { f, s } = await reload();
    f.setFont("inter");
    expect(get(s.themeState).themes.filter((t) => !t.builtin)).toEqual([]);
    expect(contentCss).toMatch(/\.leef-content \{\s*font-family: var\(--leef-font-content\);/);
    for (const { id } of fonts) {
      f.setFont(id);
      expect(get(f.font)).toBe(id);
      expect(get(s.activeTheme).contentFont).toBe(PRESETS[id]);
      expect(contentVar()).toBe(`var(--leef-font-${PRESETS[id]})`);
    }
    const copies = get(s.themeState).themes.filter((t) => !t.builtin);
    expect(copies.map((t) => t.name)).toEqual([`${get(s.themeState).themes.find((t) => t.id === "leef-auto")?.name} personnalisé`]);
    expect(get(s.activeTheme).id).toBe(copies[0].id);
    const again = await reload();
    again.f.setFont("jetbrains-mono");
    expect(get(again.s.themeState).themes.filter((t) => !t.builtin)).toHaveLength(1);
  });

  it("V2 thème actif contentFont serif + rechargement → aperçu serif, gmd-font jamais réécrite", async () => {
    localStorage.clear();
    const first = await reload();
    first.s.editTheme(get(first.s.activeTheme).id, { contentFont: "serif" });
    expect(localStorage.getItem("gmd-font")).toBeNull();
    const { f } = await reload();
    expect(contentVar()).toBe("var(--leef-font-serif)");
    expect(get(f.font)).toBe("georgia");
    expect(localStorage.getItem("gmd-font")).toBeNull();
    f.setFont("jetbrains-mono");
    const after = await reload();
    expect(get(after.f.font)).toBe("jetbrains-mono");
    expect(contentVar()).toBe("var(--leef-font-mono)");
    expect(localStorage.getItem("gmd-font")).toBeNull();
    localStorage.setItem("gmd-font", "georgia");
    const ignored = await reload();
    expect(get(ignored.f.font)).toBe("jetbrains-mono");
    expect(localStorage.getItem("gmd-font")).toBe("georgia");
  });

  it("V2 migration gmd-font (hostile ou héritée) → thème, clé supprimée, non réécrite", async () => {
    const hostile = ["", "__proto__", "constructor", "GEORGIA", "georgia\n", "😀", "‮serif", "e\u0301", "\uD800", "x".repeat(100_000), "inter"];
    const cas: [string, string][] = [...hostile.map((v): [string, string] => [v, "inter"]), ["georgia", "georgia"], ["jetbrains-mono", "jetbrains-mono"]];
    for (const [v, attendu] of cas) {
      localStorage.clear();
      localStorage.setItem("gmd-font", v);
      const { f } = await reload();
      expect(get(f.font), JSON.stringify(v.slice(0, 20))).toBe(attendu);
      expect(contentVar()).toBe(`var(--leef-font-${PRESETS[attendu as keyof typeof PRESETS]})`);
      expect(localStorage.getItem("gmd-font")).toBeNull();
    }
  });

  it("V1 font.ts : gmd-font illisible ou non inscriptible → module chargé, aucun accès à gmd-font", async () => {
    localStorage.clear();
    await reload();
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    const touched: string[] = [];
    const deny = (key: string): void => {
      if (key === "gmd-font") {
        touched.push(key);
        throw new DOMException("denied", "SecurityError");
      }
    };
    const g = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      deny(key);
      return getItem.call(this, key);
    });
    const w = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      deny(key);
      setItem.call(this, key, value);
    });
    try {
      const { f } = await reload();
      f.setFont("georgia");
      expect(get(f.font)).toBe("georgia");
      expect(touched).toEqual([]);
    } finally {
      g.mockRestore();
      w.mockRestore();
    }
  });

  it("setFont, stockage plein → erreur remontée, police inchangée", async () => {
    localStorage.clear();
    const { f } = await reload();
    const w = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("plein", "QuotaExceededError");
    });
    try {
      expect(() => f.setFont("georgia")).toThrow(/QuotaExceededError/);
      expect(get(f.font)).toBe("inter");
      expect(contentVar()).toBe("var(--leef-font-ui)");
    } finally {
      w.mockRestore();
    }
  });

  it("D7 icône copier au trait : aucun fill sur .copy-code-btn svg", () => {
    const bloc = contentCss.match(/\.copy-code-btn svg \{([^}]*)\}/);
    expect(bloc).not.toBeNull();
    expect(bloc?.[1]).not.toMatch(/fill\s*:/);
  });

  it("D8 boutons de la barre : alias --toolbar-fg → --leef-text", () => {
    expect(tokensCss).toMatch(/--toolbar-fg: var\(--leef-text\);/);
  });

  it("marque leef:boot posée en ligne avant le module, main.ts garde leef:ready", () => {
    const marque = indexHtml.indexOf('performance.mark("leef:boot")');
    expect(marque).toBeGreaterThan(-1);
    expect(marque).toBeLessThan(indexHtml.indexOf('<script type="module"'));
    expect(mainTs).not.toContain('performance.mark("leef:boot")');
    expect(mainTs).toContain('performance.mark("leef:ready")');
    expect(mainTs).toContain('performance.measure("leef:boot-to-ready", "leef:boot", "leef:ready")');
  });
});
