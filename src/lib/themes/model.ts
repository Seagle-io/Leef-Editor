export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ThemeBase = "light" | "dark" | "auto";
export type Scheme = "light" | "dark";
export type AccentPreset = "seagle" | "blue" | "purple" | "pink" | "red" | "orange" | "green" | "graphite";
export type ColorToken =
  | "bg-window" | "bg-sidebar" | "bg-toolbar" | "bg-content" | "bg-elevated" | "bg-control" | "bg-code"
  | "separator" | "text" | "text-secondary" | "text-tertiary" | "danger" | "danger-bg" | "page-paper"
  | "syntax-keyword" | "syntax-string" | "syntax-number" | "syntax-comment" | "syntax-type" | "syntax-function";

export interface Theme {
  version: 1;
  id: string; // "leef-*" | "user-<8 hex>"
  name: string; // 1..60, unique casse ignorée
  builtin: boolean;
  parent: string; // id de l'intégré d'origine (lui-même pour un intégré) ; absent du fichier → déduit de base
  base: ThemeBase;
  accent: AccentPreset | string; // #rrggbb
  contentFont: string; // "ui" | "serif" | "mono" (presets T002), sinon pile CSS
  editorFont: string;
  size: number; // px [13,22]
  editorSize: number; // px [11,22]
  lineHeight: number; // [1.2,2.0]
  lineWidth: number | null; // ch [50,120], null = none
  overrides: { light?: Partial<Record<ColorToken, string>>; dark?: Partial<Record<ColorToken, string>> };
}

export interface ThemeError {
  code: "invalid-json" | "invalid-field" | "too-large" | "builtin" | "not-found" | "name-taken" | "io";
  field?: string;
  message: string;
}

export interface ThemeFile {
  version: 1;
  active: string;
  themes: Theme[]; // utilisateur
}

export const ACCENT_PRESETS: readonly AccentPreset[] = ["seagle", "blue", "purple", "pink", "red", "orange", "green", "graphite"];
export const FONT_PRESETS: readonly string[] = ["ui", "serif", "mono"];

export const TOKEN_NAMES: readonly string[] = [
  "bg-window", "bg-sidebar", "bg-toolbar", "bg-content", "bg-elevated", "bg-control", "bg-code",
  "separator", "text", "text-secondary", "text-tertiary", "danger", "danger-bg", "page-paper",
  "syntax-keyword", "syntax-string", "syntax-number", "syntax-comment", "syntax-type", "syntax-function",
];

export const NAME_MAX = 60;
export const SIZE_RANGE = [13, 22] as const;
export const EDITOR_SIZE_RANGE = [11, 22] as const;
export const LINE_HEIGHT_RANGE = [1.2, 2.0] as const;
export const LINE_WIDTH_RANGE = [50, 120] as const;
export const AUTO_ID = "leef-auto";

function builtin(id: string, name: string, base: ThemeBase, patch: Partial<Theme> = {}): Theme {
  return {
    version: 1, id, name, builtin: true, parent: id, base, accent: "seagle", contentFont: "ui", editorFont: "mono",
    size: 15, editorSize: 14, lineHeight: 1.6, lineWidth: 68, overrides: {}, ...patch,
  };
}

export const BUILTIN_THEMES: readonly Theme[] = [
  builtin(AUTO_ID, "Automatique", "auto"),
  builtin("leef-light", "Clair", "light"),
  builtin("leef-dark", "Sombre", "dark"),
  builtin("leef-dracula", "Dracula", "dark", {
    accent: "#bd93f9",
    overrides: {
      dark: {
        "bg-window": "#21222c", "bg-sidebar": "#282a36", "bg-toolbar": "#282a36", "bg-content": "#2d2f3f",
        "bg-elevated": "#383a4d", "bg-control": "#383a4d", "bg-code": "#21222c", separator: "#44475a",
        text: "#f8f8f2", "text-secondary": "#b0b6d9", "text-tertiary": "#b0b6d9",
        danger: "#ff6e6e", "danger-bg": "#4b1f1f", "page-paper": "#2d2f3f",
      },
    },
  }),
  builtin("leef-solarized", "Solarized", "light", {
    accent: "#268bd2",
    overrides: {
      light: {
        "bg-window": "#eee8d5", "bg-sidebar": "#eee8d5", "bg-toolbar": "#eee8d5", "bg-content": "#fef7e5",
        "bg-elevated": "#fef7e5", "bg-control": "#e3dcc6", "bg-code": "#eee8d5", separator: "#d9d2c0",
        text: "#586e75", "text-secondary": "#657b83", "text-tertiary": "#93a1a1",
        danger: "#b82825", "danger-bg": "#f7e6df", "page-paper": "#fef7e5",
      },
    },
  }),
];
