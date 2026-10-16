// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// store.ts (lu par font.ts) écoute prefers-color-scheme au chargement : jsdom n'a pas matchMedia.
vi.hoisted(() => {
  window.matchMedia = () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList;
});

type Font = typeof import("./font");
type Store = typeof import("./themes/store");
type Draft = typeof import("./draft");

/** Rechargement : modules neufs, stockage conservé. */
const reload = async (): Promise<{ f: Font; s: Store; d: Draft }> => {
  vi.resetModules();
  document.documentElement.removeAttribute("style");
  const s = await import("./themes/store");
  const d = await import("./draft");
  return { f: await import("./font"), s, d };
};
const contentVar = (): string => document.documentElement.style.getPropertyValue("--leef-font-content");

/** Thème actif réécrit avec une pile CSS libre (copie personnalisée si intégré). */
const withContentFont = (s: Store, contentFont: string): void => {
  s.editTheme(get(s.activeTheme).id, { contentFont });
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("font.ts", () => {
  it("H5 stockage plein → setFont ne lève pas, alerte unique (storageError) avec QuotaExceededError, police inchangée", async () => {
    const { f, s, d } = await reload();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => f.setFont("georgia")).not.toThrow();
    expect(get(d.storageError)).toMatch(/^Police non enregistrée \(.*QuotaExceededError.*\)\.$/);
    expect(get(f.font)).toBe("inter");
    expect(get(s.activeTheme).contentFont).toBe("ui");
    expect(contentVar()).toBe("var(--leef-font-ui)");
    expect(get(s.themeState).themes.filter((t) => !t.builtin)).toEqual([]);
  });

  it("H5 stockage illisible (getItem lève) → setFont ne lève pas, alerte posée", async () => {
    const { f, d } = await reload();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => f.setFont("jetbrains-mono")).not.toThrow();
    expect(get(d.storageError)).toMatch(/^Police non enregistrée \(/);
  });

  it("H10 thème à pile libre → aucune option de la barre (custom), aperçu = pile du thème", async () => {
    for (const pile of ['"Comic Sans MS", cursive', "Papyrus"]) {
      localStorage.clear();
      const first = await reload();
      withContentFont(first.s, pile);
      const { f } = await reload();
      expect(get(f.font), pile).toBe("custom");
      expect(f.fonts.some((o) => o.id === get(f.font))).toBe(false);
      expect(contentVar()).toBe(pile);
    }
  });

  it("H10 barre, thème à pile libre → bouton Police sans libellé d'option, menu sans option cochée", async () => {
    const first = await reload();
    withContentFont(first.s, "Papyrus");
    await reload();
    const { default: Toolbar } = await import("./Toolbar.svelte");
    const vue = new Toolbar({ target: document.body });
    const bouton = document.querySelector<HTMLButtonElement>('button[aria-label="Police"]');
    expect(bouton?.textContent?.trim()).toBe("");
    bouton?.click();
    await Promise.resolve();
    expect([...document.querySelectorAll(".choice-item")].map((b) => b.textContent?.trim())).toEqual(["Système", "Georgia", "JetBrains Mono"]);
    expect(document.querySelectorAll(".choice-item.selected")).toHaveLength(0);
    vue.$destroy();
  });

  it("H10 option « Système » (D8) : id inter conservé, pile = var(--leef-font-ui), préréglage ui", async () => {
    const { f, s } = await reload();
    const systeme = f.fonts.find((o) => o.id === "inter");
    expect(systeme?.label).toBe("Système");
    expect(systeme?.stack).toBe("var(--leef-font-ui)");
    expect(f.fonts.some((o) => o.label === "Inter" || o.stack.includes('"Inter"'))).toBe(false);
    f.setFont("georgia");
    f.setFont("inter");
    expect(get(f.font)).toBe("inter");
    expect(get(s.activeTheme).contentFont).toBe("ui");
    expect(contentVar()).toBe("var(--leef-font-ui)");
  });

  it("entrées hostiles : pile libre limite / unicode → custom ou refus du thème, jamais d'exception de font", async () => {
    const hostiles = ["x".repeat(200), "😀 Emoji", "‮serif", "é", "שלום", "serif ", "Serif", "ui-serif"];
    for (const pile of hostiles) {
      localStorage.clear();
      const first = await reload();
      withContentFont(first.s, pile);
      const { f } = await reload();
      expect(get(f.font), JSON.stringify(pile.slice(0, 20))).toBe("custom");
    }
    const refusees = ["", " ", "x".repeat(201), "a;b", "\uD800", "a{b}"];
    for (const pile of refusees) {
      localStorage.clear();
      const { f, s } = await reload();
      expect(() => withContentFont(s, pile), JSON.stringify(pile.slice(0, 20))).toThrow();
      expect(get(f.font)).toBe("inter");
    }
  });

  it("entrées hostiles : setFont avec un id de type faux → aucune exception", async () => {
    for (const id of [5, null, undefined, {}, "", "__proto__", "INTER", "😀"]) {
      localStorage.clear();
      const { f } = await reload();
      expect(() => f.setFont(id as unknown as Parameters<Font["setFont"]>[0]), String(id)).not.toThrow();
    }
  });
});
