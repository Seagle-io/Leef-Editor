import type { Scheme } from "./model";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Rgb = [number, number, number];

/** Couleur du texte T002 par schéma : cible de l'ajustement de l'accent. */
const TEXT: Record<Scheme, string> = { light: "#1d1d1f", dark: "#f5f5f7" };
const MIN_CONTRAST = 4.5;
const MAX_STEPS = 10;
const STEP = 0.05;

function parseHex(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) throw new Error(`Couleur invalide : ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mélange sRGB 0-255 : t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ra, rb] = [parseHex(a), parseHex(b)];
  return toHex(ra.map((c, i) => c + (rb[i] - c) * t) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG, de 1 à 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function accentVars(hex: string, scheme: Scheme, bg: string): { accent: string; fill: string; selection: string } {
  let accent = hex;
  for (let step = 1; step <= MAX_STEPS && contrastRatio(accent, bg) < MIN_CONTRAST; step++) {
    accent = mixHex(hex, TEXT[scheme], STEP * step);
  }
  return { accent, fill: hex, selection: mixHex(hex, bg, 0.75) };
}
