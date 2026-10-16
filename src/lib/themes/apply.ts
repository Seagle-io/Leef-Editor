import { HEX_COLOR, accentVars } from "./color";
import { ACCENT_PRESETS, FONT_PRESETS, type AccentPreset, type Scheme, type Theme, type ThemeBase } from "./model";

const FALLBACK_BG: Record<Scheme, string> = { light: "#ffffff", dark: "#1c1c1e" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

let applied: string[] = [];
let stopWatching: (() => void) | null = null;

function isPreset(accent: string): accent is AccentPreset {
  return (ACCENT_PRESETS as readonly string[]).includes(accent);
}

function fontValue(font: string): string {
  return FONT_PRESETS.includes(font) ? `var(--leef-font-${font})` : font;
}

export function resolveScheme(base: ThemeBase): Scheme {
  if (base !== "auto") return base;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Variables CSS d'un thème pour un schéma ; `bgContent` = fond du contenu hors surcharge (hex). */
export function themeVariables(t: Theme, scheme: Scheme, bgContent: string): Record<string, string> {
  const colors = t.overrides[scheme] ?? {};
  const vars: Record<string, string> = {
    "--leef-font-content": fontValue(t.contentFont),
    "--leef-font-editor": fontValue(t.editorFont),
    "--leef-content-size": `${t.size}px`,
    "--leef-editor-size": `${t.editorSize}px`,
    "--leef-leading-content": String(t.lineHeight),
    "--leef-measure": t.lineWidth === null ? "none" : `${t.lineWidth}ch`,
  };
  if (!isPreset(t.accent)) {
    const accent = accentVars(t.accent, scheme, colors["bg-content"] ?? bgContent);
    vars["--leef-accent"] = accent.accent;
    vars["--leef-accent-fill"] = accent.fill;
    vars["--leef-text-selection"] = accent.selection;
  }
  for (const [token, value] of Object.entries(colors)) {
    if (value !== undefined) vars[`--leef-${token}`] = value;
  }
  return vars;
}

export function applyTheme(t: Theme, root: HTMLElement): Scheme {
  stopWatching?.();
  stopWatching = null;
  for (const name of applied) root.style.removeProperty(name);
  root.dataset.theme = t.base;
  if (isPreset(t.accent)) root.dataset.accent = t.accent;
  else delete root.dataset.accent;

  const scheme = resolveScheme(t.base);
  const computed = getComputedStyle(root).getPropertyValue("--leef-bg-content").trim();
  const vars = themeVariables(t, scheme, HEX_COLOR.test(computed) ? computed : FALLBACK_BG[scheme]);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);

  if (t.base === "auto") {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (): void => void applyTheme(t, root);
    query.addEventListener("change", onChange);
    stopWatching = () => query.removeEventListener("change", onChange);
  }
  return scheme;
}
