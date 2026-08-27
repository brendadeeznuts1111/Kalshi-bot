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

// ── Environment adapter ──────────────────────────────────────────────────
// The kernel is Bun-native (Bun.color) but the design-system bundle is also
// shipped to browsers (target: browser) and consumed by the live hq-app. A
// pure-JS fallback covers the deterministic formats so the module can LOAD
// without Bun; output matches Bun.color for every format the cache builds.
// Under Bun the adapter delegates to Bun.color — identical behavior.
const HAS_BUN_COLOR = typeof Bun !== "undefined" && typeof Bun.color === "function";

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(hex.trim());
  if (!m) return null;
  let hex6 = m[1]!;
  if (hex6.length === 3) {
    hex6 = hex6
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(hex6, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHexLower(rgb: RGB): string {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
  );
}

function toHexUpper(rgb: RGB): string {
  return toHexLower(rgb).toUpperCase();
}

/** Bun.color css output abbreviates doubled channel pairs (#005544 -> #054, #ff8800 -> #f80). */
function cssHexShorthand(rgb: RGB): string {
  const pair = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const [r, g, b] = [pair(rgb.r), pair(rgb.g), pair(rgb.b)];
  if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1]) {
    return "#" + r[0] + g[0] + b[0];
  }
  return "#" + r + g + b;
}

/** Round to N decimals and strip trailing zeros ("1.5" not "1.50000"; "0" not "0.00000"). */
function trimDecimals(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** RGB -> HSL string matching Bun.color's "hsl" format ("hsl(H, S%, L%)", 5 decimals). */
function hslString(rgb: RGB): string {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return (
    "hsl(" +
    trimDecimals(h, 5) +
    ", " +
    trimDecimals(s * 100, 5) +
    "%, " +
    trimDecimals(l * 100, 5) +
    "%)"
  );
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** RGB -> LAB components (D50 white point, CSS Color 4). Shared by the
 * "lab" and "lch" output strings. Matches Bun.color to float precision. */
function labTriplet(rgb: RGB): { L: number; a: number; b: number } {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  // sRGB -> XYZ (D65)
  const x65 = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y65 = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z65 = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  // Bradford chromatic adaptation D65 -> D50
  const x = 1.0478112 * x65 + 0.0228866 * y65 - 0.050127 * z65;
  const y = 0.0295424 * x65 + 0.9904844 * y65 - 0.0170491 * z65;
  const z = -0.0092345 * x65 + 0.0150436 * y65 + 0.7521316 * z65;
  // D50 white point
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / 0.96422);
  const fy = f(y);
  const fz = f(z / 0.82521);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** RGB -> LAB string matching Bun.color's "lab" format. */
function labString(rgb: RGB): string {
  const { L, a, b } = labTriplet(rgb);
  return "lab(" + trimDecimals(L, 6) + "% " + trimDecimals(a, 6) + " " + trimDecimals(b, 6) + ")";
}

/** RGB -> LCH string (kernel-defined shape; Bun.color 1.4.0 has no "lch"). */
function lchString(rgb: RGB): string {
  const { L, a, b } = labTriplet(rgb);
  const c = Math.sqrt(a * a + b * b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return "lch(" + trimDecimals(L, 6) + "% " + trimDecimals(c, 6) + " " + trimDecimals(h, 6) + ")";
}

/** RGB -> HSV string (kernel-defined shape). */
function hsvString(rgb: RGB): string {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / max;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return "hsv(" + trimDecimals(h, 5) + ", " + trimDecimals(s * 100, 5) + "%, " + trimDecimals(v * 100, 5) + "%)";
}

/** sRGB -> OKLab components (standard Ottosson matrices). */
function oklabTriplet(rgb: RGB): { L: number; a: number; b: number } {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** RGB -> OKLab string (kernel-defined shape). */
function oklabString(rgb: RGB): string {
  const { L, a, b } = oklabTriplet(rgb);
  return "oklab(" + trimDecimals(L, 6) + " " + trimDecimals(a, 6) + " " + trimDecimals(b, 6) + ")";
}

/** RGB -> OKLCH string (kernel-defined shape). */
function oklchString(rgb: RGB): string {
  const { L, a, b } = oklabTriplet(rgb);
  const c = Math.sqrt(a * a + b * b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return "oklch(" + trimDecimals(L, 6) + " " + trimDecimals(c, 6) + " " + trimDecimals(h, 6) + ")";
}

/** ANSI-256 index via the standard 6x6x6 color cube (Bun.color "ansi-256"). */
function ansi256Index(rgb: RGB): number {
  const level = (v: number): number => (v < 48 ? 0 : Math.min(5, Math.round((v - 35) / 40)));
  return 16 + 36 * level(rgb.r) + 6 * level(rgb.g) + level(rgb.b);
}

/**
 * Pure-JS fallback for Bun.color's deterministic formats — must match
 * Bun.color output exactly (hexColor/cssColor/number/ansi-16m are compared
 * in tests/lib/color-kernel.test.ts). Exported so the parity test can run
 * both paths side by side.
 */
export function convertColorFallback(value: string, format: string): string | number | RGB | RGBA | null {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  switch (format) {
    case "HEX":
      return toHexUpper(rgb);
    case "hex":
      return toHexLower(rgb);
    case "css":
      return cssHexShorthand(rgb);
    case "number":
      return (rgb.r << 16) | (rgb.g << 8) | rgb.b;
    case "{rgb}":
      return rgb;
    case "{rgba}":
      return { ...rgb, a: 1 };
    case "ansi-16m":
      return "\x1b[38;2;" + rgb.r + ";" + rgb.g + ";" + rgb.b + "m";
    case "ansi-256":
      return "\x1b[38;5;" + ansi256Index(rgb) + "m";
    case "hsl":
      return hslString(rgb);
    case "lab":
      return labString(rgb);
    case "lch":
      return lchString(rgb);
    case "hsv":
      return hsvString(rgb);
    case "oklab":
      return oklabString(rgb);
    case "oklch":
      return oklchString(rgb);
    case "ansi":
      return "";
    default:
      return null;
  }
}

/** Bun.color-compatible conversion with a browser fallback. */
function colorConvert(value: string, format: string): string | number | RGB | RGBA | null {
  if (HAS_BUN_COLOR) {
    return Bun.color(value, format as "hex") as string | number | RGB | RGBA | null;
  }
  return convertColorFallback(value, format);
}

/** Linear-light sRGB → 8-bit gamma (inverse of srgbToLinear). */
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, v));
}

/** XYZ (D65) → linear sRGB (standard inverse of the forward matrix). */
function xyz65ToLinearSrgb(x: number, y: number, z: number): { r: number; g: number; b: number } {
  return {
    r: 3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    g: -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    b: 0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  };
}

/** LAB (D50) → sRGB hex. Inverse of labTriplet + the D65→D50 Bradford step. */
function labToHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t: number): number => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };
  // XYZ D50
  const x50 = 0.96422 * finv(fx);
  const y50 = finv(fy);
  const z50 = 0.82521 * finv(fz);
  // Bradford D50 -> D65 (inverse of the forward adaptation)
  const x65 = 0.9555766 * x50 - 0.0230393 * y50 + 0.0631636 * z50;
  const y65 = -0.0282895 * x50 + 1.0099416 * y50 + 0.0210077 * z50;
  const z65 = 0.0122982 * x50 - 0.020483 * y50 + 1.3299098 * z50;
  const lin = xyz65ToLinearSrgb(x65, y65, z65);
  return toHexLower({
    r: Math.round(linearToSrgb(lin.r) * 255),
    g: Math.round(linearToSrgb(lin.g) * 255),
    b: Math.round(linearToSrgb(lin.b) * 255),
  });
}

/** OKLab → sRGB hex (inverse of oklabTriplet). */
function oklabToHex(L: number, a: number, b: number): string {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
  return toHexLower({
    r: Math.round(linearToSrgb(lin.r) * 255),
    g: Math.round(linearToSrgb(lin.g) * 255),
    b: Math.round(linearToSrgb(lin.b) * 255),
  });
}

/**
 * Parse a CSS Color 4 string into hex — covers the formats Bun.color 1.4.0
 * cannot parse.
 *
 * Grounding (bun.com/docs/runtime/color + runtime probes on 1.4.0):
 *   - Bun.color parses lab() and lch() INPUTS natively (the guide documents
 *     "LAB strings like lab(50% 50 50)"; lch shares the parser — both
 *     round-trip here via the same inverse math, verified byte-equal).
 *   - Bun.color returns null for oklab()/oklch()/hsv()/device-cmyk() inputs
 *     (probe-verified) — those are what THIS parser covers, along with
 *     round-tripping the kernel's own output strings for every extended
 *     format. Returns null when the string is not one of these formats.
 */
export function parseExtendedColor(input: string): string | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  if ((m = /^hsv\(([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*\)$/i.exec(s))) {
    const h = Number(m[1]);
    const sv = Number(m[2]) / 100;
    const v = Number(m[3]) / 100;
    const c = v * sv;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = v - c;
    const seg = Math.floor(h / 60) % 6;
    const [r1, g1, b1] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
    return toHexLower({
      r: Math.round((r1 + mm) * 255),
      g: Math.round((g1 + mm) * 255),
      b: Math.round((b1 + mm) * 255),
    });
  }
  if ((m = /^lch\(([\d.]+)%\s+([\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(s))) {
    const L = Number(m[1]);
    const c = Number(m[2]);
    const h = (Number(m[3]) * Math.PI) / 180;
    return labToHex(L, c * Math.cos(h), c * Math.sin(h));
  }
  if ((m = /^lab\(([\d.]+)%\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(s))) {
    return labToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if ((m = /^oklch\(([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(s))) {
    const L = Number(m[1]);
    const c = Number(m[2]);
    const h = (Number(m[3]) * Math.PI) / 180;
    return oklabToHex(L, c * Math.cos(h), c * Math.sin(h));
  }
  if ((m = /^oklab\((-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(s))) {
    return oklabToHex(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  return null;
}

export type RGB = { r: number; g: number; b: number };
export type RGBA = RGB & { a: number };

export type ForegroundCss = "#000000" | "#ffffff";

export type ResolvedColor = {
  key: ColorKey;
  css: string;
  hex: string;
  foregroundCss: ForegroundCss;
  number: number;
  rgb: RGB;
};

type DeterministicFormat = "css" | "HEX" | "number" | "{rgb}" | "{rgba}" | "ansi-16m";

const DETERMINISTIC_FORMATS = [
  "css",
  "HEX",
  "number",
  "{rgb}",
  "{rgba}",
  "ansi-16m",
] as const satisfies readonly DeterministicFormat[];

// Validate palette on module load — Bun.color returns null for bad input.
for (const [key, value] of Object.entries(COLORS)) {
  const hex = colorConvert(value, "HEX");
  if (typeof hex !== "string" || !hex) {
    throw new Error(`Invalid color value for "${key}": ${value}`);
  }
}

type FormatCache = {
  css: Record<ColorKey, string>;
  HEX: Record<ColorKey, string>;
  number: Record<ColorKey, number>;
  "{rgb}": Record<ColorKey, RGB>;
  "{rgba}": Record<ColorKey, RGBA>;
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
): string | number | RGB | RGBA | null {
  return colorConvert(value, format);
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

/** Channels incl. alpha (1 = opaque) — the deterministic alpha source. */
export function rgbaChannels(key: ColorKey): RGBA {
  return cache["{rgba}"][key];
}

/**
 * Derive an rgba() CSS string from ANY css hex (token or palette value) at
 * the given alpha — the design system uses this for tint/scrim tokens so the
 * rgba literals are computed from the base hex, not hand-maintained.
 * Alpha is formatted without a leading zero ("rgba(63,178,127,.15)").
 */
export function tint(hex: string, alpha: number): string {
  const { r, g, b } = (colorConvert(hex, "{rgba}") as RGBA | null) ?? { r: 0, g: 0, b: 0, a: 1 };
  const a = String(alpha).replace(/^0\./, ".");
  return `rgba(${r},${g},${b},${a})`;
}

export function ansi16mColor(key: ColorKey): string {
  return cache["ansi-16m"][key];
}

/** Environment-sensitive ANSI — Bun.color returns "" when colors are disabled. */
export function ansiColor(key: ColorKey): string {
  return (colorConvert(COLORS[key], "ansi") as string | null) || "";
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
  return colorConvert(COLORS[key], format) as string | number | RGB | null;
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