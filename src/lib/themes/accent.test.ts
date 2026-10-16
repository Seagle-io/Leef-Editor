import { describe, expect, it } from "vitest";
import { accentVars, contrastRatio } from "./color";
import { BUILTIN_THEMES, type Scheme, type Theme } from "./model";
import { themeVariables } from "./apply";

const auto = BUILTIN_THEMES.find((t) => t.id === "leef-auto") as Theme;
const dracula = BUILTIN_THEMES.find((t) => t.id === "leef-dracula") as Theme;

/** Surfaces de tokens.css : contenu, barre latérale, surélevée (popover), contrôle. */
const SURFACES: Record<Scheme, string[]> = {
  light: ["#ffffff", "#f2f2f4", "#ffffff", "#e6e6e9"],
  dark: ["#1c1c1e", "#232325", "#2c2c2e", "#353538"],
};
const SCHEMES: Scheme[] = ["light", "dark"];
const ACCENTS = ["#777777", "#808080", "#000000", "#1c1c1e", "#0066d6", "#ffff00", "#000080"];
const EXTREMES = ["#ffffff", "#000000", "#010101", "#fefefe", "#7f7f7f", "#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff"];

const accentOf = (t: Theme, scheme: Scheme): string => themeVariables(t, scheme, SURFACES[scheme][0])["--leef-accent"];

describe("V6 accent lisible sur toutes les surfaces", () => {
  it("7 accents + 10 extrêmes × 4 surfaces × 2 schémas → ≥ 4.5", () => {
    for (const scheme of SCHEMES) {
      for (const hex of [...ACCENTS, ...EXTREMES]) {
        const accent = accentOf({ ...auto, accent: hex }, scheme);
        for (const bg of SURFACES[scheme]) {
          expect(contrastRatio(accent, bg), `${scheme} ${hex} → ${accent} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("T023 lien-popover : sombre #777777 #808080 #000000 #1c1c1e sur popover #2a2a2c → ≥ 4.5", () => {
    for (const hex of ["#777777", "#808080", "#000000", "#1c1c1e"]) {
      expect(contrastRatio(accentOf({ ...auto, accent: hex }, "dark"), "#2a2a2c"), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("surfaces surchargées par le thème prises en compte (Dracula)", () => {
    const colors = dracula.overrides.dark ?? {};
    const surfaces = [colors["bg-content"], colors["bg-sidebar"], colors["bg-elevated"], colors["bg-control"]].map((c, i) => c ?? SURFACES.dark[i]);
    for (const hex of [...ACCENTS, ...EXTREMES]) {
      const accent = themeVariables({ ...dracula, accent: hex }, "dark", "#1c1c1e")["--leef-accent"];
      for (const bg of surfaces) expect(contrastRatio(accent, bg), `${hex} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("accentVars(…, surfaces) : surface la plus exigeante, accent déjà lisible inchangé", () => {
    expect(contrastRatio(accentVars("#777777", "dark", "#1c1c1e", ["#353538"]).accent, "#353538")).toBeGreaterThanOrEqual(4.5);
    expect(accentVars("#0066d6", "light", "#ffffff", ["#ffffff"]).accent).toBe("#0066d6");
    expect(accentVars("#777777", "dark", "#1c1c1e", []).accent).toBe(accentVars("#777777", "dark", "#1c1c1e").accent);
  });

  it("surfaces irréconciliables (blanc + #777777) : boucle bornée, cible blanc/noir au meilleur minimum", () => {
    expect(["#ffffff", "#000000"]).toContain(accentVars("#ff00ff", "light", "#ffffff", ["#777777", "#000000"]).accent);
    expect(contrastRatio(accentVars("#ff00ff", "light", "#777777", ["#ffffff"]).accent, "#777777")).toBeGreaterThanOrEqual(4.5);
    const many = accentVars("#808080", "dark", "#1c1c1e", Array.from({ length: 10_000 }, (_, i) => (i % 2 ? "#ffffff" : "#000000")));
    expect(["#ffffff", "#000000"]).toContain(many.accent);
  });

  it("entrées hostiles : couleur ou surface non hex → erreur explicite", () => {
    for (const bad of ["", "#fff", "#gggggg", "😀", "#ff00ff\n", "‮#ffffff", "é", "\uD800", "x".repeat(100_000)]) {
      expect(() => accentVars(bad, "light", "#ffffff", SURFACES.light), JSON.stringify(bad.slice(0, 20))).toThrow(/Couleur invalide/);
      expect(() => accentVars("#ff00ff", "light", "#ffffff", [bad]), JSON.stringify(bad.slice(0, 20))).toThrow(/Couleur invalide/);
    }
  });
});
