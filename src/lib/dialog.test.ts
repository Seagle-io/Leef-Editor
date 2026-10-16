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
import { fonts, setFont } from "./font";

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
  it("D2 police : setFont pose --leef-font-content, lu par l'aperçu", () => {
    expect(contentCss).toMatch(/\.leef-content \{\s*font-family: var\(--leef-font-content\);/);
    for (const f of fonts) {
      setFont(f.id);
      expect(document.documentElement.style.getPropertyValue("--leef-font-content")).toBe(f.stack);
    }
  });

  it("D2 police stockée hostile → Inter posé sur --leef-font-content", async () => {
    for (const v of ["", "__proto__", "GEORGIA", "georgia\n", "😀", "x".repeat(100_000)]) {
      localStorage.setItem("gmd-font", v);
      vi.resetModules();
      await import("./font");
      expect(document.documentElement.style.getPropertyValue("--leef-font-content")).toBe(fonts[0].stack);
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
