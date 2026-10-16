import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  answerConfirm,
  cancelDialog,
  confirmDialog,
  dialogRequest,
  promptDialog,
  submitPrompt,
  type DialogRequest,
} from "./dialog";

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
