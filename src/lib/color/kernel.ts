/**
 * Bun-native color kernel — validate palette, cache deterministic formats,
 * expose typed getters for CSS / HEX / number / RGB / ANSI / foreground.
 *
 * Bun.color returns null for invalid input (does not throw) — we fail hard
 * at module load so no invalid palette ships.
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see https://bun.com/docs/runtime/color#output-formats
 */
import { COLORS, type ColorKey } from "./palette.ts";

export type RGB = { r: number; g: number; b: number };

export type ForegroundCss = "#000000" | "#ffffff";

export type ResolvedColor = {
  key: ColorKey;
  css: string;
  hex: string;
  foregroundCss: ForegroundCss;
  number: number;
  rgb: RGB;
};

type DeterministicFormat = "css" | "HEX" | "number" | "{rgb}" | "ansi-16m";

const DETERMINISTIC_FORMATS = [
  "css",
  "HEX",
  "number",
  "{rgb}",
  "ansi-16m",
] as const satisfies readonly DeterministicFormat[];

// Validate palette on module load — Bun.color returns null for bad input.
for (const [key, value] of Object.entries(COLORS)) {
  const hex = Bun.color(value, "HEX");
  if (typeof hex !== "string" || !hex) {
    throw new Error(`Invalid color value for "${key}": ${value}`);
  }
}

type FormatCache = {
  css: Record<ColorKey, string>;
  HEX: Record<ColorKey, string>;
  number: Record<ColorKey, number>;
  "{rgb}": Record<ColorKey, RGB>;
  "ansi-16m": Record<ColorKey, string>;
};

/**
 * Bun.color overloads reject a union of string-returning and object-returning
 * formats, so narrow per format — each branch resolves a concrete overload
 * with no casts (bun-types 1.4.0 types every format incl. {rgb}).
 */
function convertDeterministic(
  value: string,
  format: DeterministicFormat,
): string | number | RGB | null {
  if (format === "{rgb}") return Bun.color(value, "{rgb}");
  if (format === "number") return Bun.color(value, "number");
  return Bun.color(value, format); // css | HEX | ansi-16m (string overload)
}

function buildCache(): FormatCache {
  const keys = Object.keys(COLORS) as ColorKey[];
  const cache = {} as FormatCache;
  for (const format of DETERMINISTIC_FORMATS) {
    const row = {} as Record<ColorKey, unknown>;
    for (const key of keys) {
      const converted = convertDeterministic(COLORS[key], format);
      if (converted == null) {
        throw new Error(`Bun.color failed for "${key}" format "${format}"`);
      }
      row[key] = converted;
    }
    (cache as Record<string, unknown>)[format] = row;
  }
  return cache;
}
const cache = buildCache();

const foregroundCache = {} as Record<ColorKey, ForegroundCss>;
for (const key of Object.keys(COLORS) as ColorKey[]) {
  foregroundCache[key] = pickForeground(cache["{rgb}"][key]);
}

function srgbLuminance(rgb: RGB): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

function contrastRatio(a: number, b: number): number {
  const [L, d] = a > b ? [a, b] : [b, a];
  return (L + 0.05) / (d + 0.05);
}

/** Prefer black/white by WCAG contrast (not a raw luminance midpoint). */
function pickForeground(rgb: RGB): ForegroundCss {
  const bg = srgbLuminance(rgb);
  const vsBlack = contrastRatio(bg, 0);
  const vsWhite = contrastRatio(bg, 1);
  return vsBlack >= vsWhite ? "#000000" : "#ffffff";
}

export function cssColor(key: ColorKey): string {
  return cache.css[key];
}

export function hexColor(key: ColorKey): string {
  return cache.HEX[key];
}

export function colorNumber(key: ColorKey): number {
  return cache.number[key];
}

export function rgbChannels(key: ColorKey): RGB {
  return cache["{rgb}"][key];
}

export function ansi16mColor(key: ColorKey): string {
  return cache["ansi-16m"][key];
}

/** Environment-sensitive ANSI — Bun.color returns "" when colors are disabled. */
export function ansiColor(key: ColorKey): string {
  return (Bun.color(COLORS[key], "ansi") as string | null) || "";
}

export function foregroundCss(key: ColorKey): ForegroundCss {
  return foregroundCache[key];
}

/** Full resolved wire blob for a key (API / registry / glossary). */
export function resolveColor(key: ColorKey): ResolvedColor {
  return {
    key,
    css: cssColor(key),
    hex: hexColor(key),
    foregroundCss: foregroundCss(key),
    number: colorNumber(key),
    rgb: rgbChannels(key),
  };
}

/** Relative luminance per WCAG 2.1 (sRGB). 0 (black) to 1 (white). */
export function luminance(key: ColorKey): number {
  return srgbLuminance(rgbChannels(key));
}

/** Contrast ratio per WCAG 2.1 (1–21). AA ≥ 4.5, AAA ≥ 7. */
export function contrast(a: ColorKey, b: ColorKey): number {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const [L, d] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (L + 0.05) / (d + 0.05);
}

/** True if the color is dark (luminance < 0.5) — prefer white text on it. */
export function isDark(key: ColorKey): boolean {
  return luminance(key) < 0.5;
}

/** Convert a domain color to any Bun.color() output format (uncached passthrough). */
export function convert(key: ColorKey, format: string): string | number | RGB | null {
  return Bun.color(COLORS[key], format as "hex") as string | number | RGB | null;
}

function hexByte(v: number): string {
  return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0").toUpperCase();
}

/** Lighten a color by pct (0–100) and return a new hex string. */
export function lighten(key: ColorKey, pct: number): string {
  const c = rgbChannels(key);
  const f = (v: number) => Math.min(255, Math.round(v + (255 - v) * (pct / 100)));
  return `#${hexByte(f(c.r))}${hexByte(f(c.g))}${hexByte(f(c.b))}`;
}

/** Darken a color by pct (0–100) and return a new hex string. */
export function darken(key: ColorKey, pct: number): string {
  const c = rgbChannels(key);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - pct / 100)));
  return `#${hexByte(f(c.r))}${hexByte(f(c.g))}${hexByte(f(c.b))}`;
}

/** Alias kept for design-colors consumers. */
export const channels = rgbChannels;