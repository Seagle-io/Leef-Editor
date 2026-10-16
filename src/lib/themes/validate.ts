import { HEX_COLOR } from "./color";
import {
  ACCENT_PRESETS, AUTO_ID, BUILTIN_THEMES, EDITOR_SIZE_RANGE, LINE_HEIGHT_RANGE, LINE_WIDTH_RANGE, NAME_MAX,
  SIZE_RANGE, TOKEN_NAMES,
  type ColorToken, type Result, type Theme, type ThemeBase, type ThemeError, type ThemeFile,
} from "./model";

const DEFAULT = BUILTIN_THEMES.find((t) => t.id === AUTO_ID) as Theme;
const FONT_MAX = 200;
const USER_ID = /^user-[0-9a-f]{8}$/;
// Caractères de contrôle et demi-paires UTF-16 isolées (texte non UTF-8 valide).
const BAD_CHARS = /[\p{Cc}\p{Cs}]/u;
const FONT_FORBIDDEN = /[;{}<>]/;

type Fields = Omit<Theme, "id" | "builtin">;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function invalid(field: string, message: string): Result<never, ThemeError> {
  return { ok: false, error: { code: "invalid-field", field, message } };
}

export function checkName(name: unknown): ThemeError | null {
  const length = typeof name === "string" ? [...name.trim()].length : 0;
  if (typeof name !== "string" || length < 1 || length > NAME_MAX || BAD_CHARS.test(name)) {
    return { code: "invalid-field", field: "name", message: `Nom invalide : 1 à ${NAME_MAX} caractères, sans caractère de contrôle.` };
  }
  return null;
}

function isBase(v: unknown): v is ThemeBase {
  return v === "light" || v === "dark" || v === "auto";
}

function isAccent(v: unknown): v is string {
  return typeof v === "string" && ((ACCENT_PRESETS as readonly string[]).includes(v) || HEX_COLOR.test(v));
}

function isFont(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= FONT_MAX && !FONT_FORBIDDEN.test(v) && !BAD_CHARS.test(v);
}

function inRange(range: readonly [number, number]): (v: unknown) => v is number {
  return (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= range[0] && v <= range[1];
}

function read<T>(src: Record<string, unknown>, key: string, def: T, ok: (v: unknown) => v is T, message: string): Result<T, ThemeError> {
  const v = src[key];
  if (v === undefined) return { ok: true, value: def };
  return ok(v) ? { ok: true, value: v } : invalid(key, message);
}

function isColorToken(k: string): k is ColorToken {
  return TOKEN_NAMES.includes(k);
}

function readOverrides(v: unknown): Result<Theme["overrides"], ThemeError> {
  if (v === undefined) return { ok: true, value: {} };
  if (!isRecord(v)) return invalid("overrides", "overrides doit être un objet.");
  const out: Theme["overrides"] = {};
  for (const scheme of ["light", "dark"] as const) {
    const colors = v[scheme];
    if (colors === undefined) continue;
    if (!isRecord(colors)) return invalid(`overrides.${scheme}`, `overrides.${scheme} doit être un objet.`);
    const picked: Partial<Record<ColorToken, string>> = {};
    for (const [key, value] of Object.entries(colors)) {
      if (!isColorToken(key)) continue;
      if (typeof value !== "string" || !HEX_COLOR.test(value)) {
        return invalid(`overrides.${scheme}.${key}`, `Couleur attendue au format #rrggbb (overrides.${scheme}.${key}).`);
      }
      picked[key] = value.toLowerCase();
    }
    out[scheme] = picked;
  }
  return { ok: true, value: out };
}

/** Valide un thème champ par champ ; champ absent → défaut de leef-auto, clé inconnue ignorée. */
export function parseTheme(u: unknown): Result<Omit<Theme, "id" | "builtin">, ThemeError> {
  if (!isRecord(u)) return invalid("", "Le thème doit être un objet.");
  const version = read(u, "version", 1 as const, (v): v is 1 => v === 1, "version doit valoir 1.");
  if (!version.ok) return version;
  const name = read(u, "name", DEFAULT.name, (v): v is string => checkName(v) === null, `Nom invalide : 1 à ${NAME_MAX} caractères, sans caractère de contrôle.`);
  if (!name.ok) return name;
  const base = read(u, "base", DEFAULT.base, isBase, "base doit valoir light, dark ou auto.");
  if (!base.ok) return base;
  const accent = read(u, "accent", DEFAULT.accent, isAccent, "accent : pastille connue ou couleur #rrggbb.");
  if (!accent.ok) return accent;
  const contentFont = read(u, "contentFont", DEFAULT.contentFont, isFont, "contentFont : 1 à 200 caractères, sans ; { } < >.");
  if (!contentFont.ok) return contentFont;
  const editorFont = read(u, "editorFont", DEFAULT.editorFont, isFont, "editorFont : 1 à 200 caractères, sans ; { } < >.");
  if (!editorFont.ok) return editorFont;
  const size = read(u, "size", DEFAULT.size, inRange(SIZE_RANGE), `size doit être dans [${SIZE_RANGE}].`);
  if (!size.ok) return size;
  const editorSize = read(u, "editorSize", DEFAULT.editorSize, inRange(EDITOR_SIZE_RANGE), `editorSize doit être dans [${EDITOR_SIZE_RANGE}].`);
  if (!editorSize.ok) return editorSize;
  const lineHeight = read(u, "lineHeight", DEFAULT.lineHeight, inRange(LINE_HEIGHT_RANGE), `lineHeight doit être dans [${LINE_HEIGHT_RANGE}].`);
  if (!lineHeight.ok) return lineHeight;
  const isWidth = (v: unknown): v is number | null => v === null || inRange(LINE_WIDTH_RANGE)(v);
  const lineWidth = read<number | null>(u, "lineWidth", DEFAULT.lineWidth, isWidth, `lineWidth doit être null ou dans [${LINE_WIDTH_RANGE}].`);
  if (!lineWidth.ok) return lineWidth;
  const overrides = readOverrides(u.overrides);
  if (!overrides.ok) return overrides;
  const fields: Fields = {
    version: version.value,
    name: name.value.trim(),
    base: base.value,
    accent: accent.value.startsWith("#") ? accent.value.toLowerCase() : accent.value,
    contentFont: contentFont.value,
    editorFont: editorFont.value,
    size: size.value,
    editorSize: editorSize.value,
    lineHeight: lineHeight.value,
    lineWidth: lineWidth.value,
    overrides: overrides.value,
  };
  return { ok: true, value: fields };
}

/** Valide un ThemeFile v1 sérialisé (fichier AppConfig ou cache). */
export function parseThemeFile(json: string): Result<ThemeFile, ThemeError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: { code: "invalid-json", message: `JSON invalide : ${e instanceof Error ? e.message : String(e)}` } };
  }
  if (!isRecord(raw) || raw.version !== 1) return invalid("version", "ThemeFile : version 1 attendue.");
  if (raw.active !== undefined && typeof raw.active !== "string") return invalid("active", "ThemeFile : active doit être une chaîne.");
  if (!Array.isArray(raw.themes)) return invalid("themes", "ThemeFile : themes doit être un tableau.");
  const themes: Theme[] = [];
  for (const [i, entry] of raw.themes.entries()) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !USER_ID.test(entry.id)) {
      return invalid(`themes[${i}].id`, `themes[${i}].id : « user-<8 hex> » attendu.`);
    }
    const id = entry.id;
    if (themes.some((t) => t.id === id)) return invalid(`themes[${i}].id`, `themes[${i}].id : ${id} déjà utilisé.`);
    const parsed = parseTheme(entry);
    if (!parsed.ok) return invalid(`themes[${i}].${parsed.error.field}`, `themes[${i}] : ${parsed.error.message}`);
    const name = parsed.value.name.toLowerCase();
    if ([...BUILTIN_THEMES, ...themes].some((t) => t.name.toLowerCase() === name)) return invalid(`themes[${i}].name`, `themes[${i}].name : « ${parsed.value.name} » déjà utilisé.`);
    themes.push({ ...parsed.value, id, builtin: false });
  }
  return { ok: true, value: { version: 1, active: raw.active ?? AUTO_ID, themes } };
}
