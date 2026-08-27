/**
 * theme.ts — unified zero-dependency theme system spanning terminal, web,
 * and image output from ONE semantic theme (the "one vocabulary" rule).
 *
 * Roles resolve to TOKENS.color values — the theme is legal design
 * vocabulary by construction (the design agent audits against tokenValues()).
 *
 * Probe-verified against Bun 1.4.0 (see docs/AGENT-PITFALLS.md §22):
 *   - `Bun.color(hex, "luminance")` DOES NOT EXIST (TypeError) — luminance
 *     and contrast are computed here per WCAG 2.1, not via a Bun format.
 *   - "object" / "array" output formats DO NOT EXIST — the real forms
 *     are `{rgb}` / `{rgba}` / `[rgb]` / `[rgba]`.
 *   - the 2nd argument is an OUTPUT format; CSS color-space keywords
 *     ("display-p3", "srgb") are rejected.
 *   - `color-mix(in srgb, …)` and `hwb(…)` inputs ARE parsed; `device-cmyk`,
 *     `lab`, `lch`, `oklch` inputs return null (not parsed).
 *   - `hex` output drops alpha (`#ff0000aa` -> `#ff0000`); `transparent`
 *     -> `#000000`; no 2nd arg = identity passthrough.
 *   - `ansi` (auto) detects the color depth of stdout from ENVIRONMENT
 *     VARIABLES (docs "Format colors as ANSI", §235) — ENV-driven, not
 *     TTY-driven: NO_COLOR silences (unless FORCE_COLOR); FORCE_COLOR 1|2|3
 *     selects 16/256/16m (overrides TERM=dumb); TERM picks depth even piped
 *     (xterm→16, xterm-256color→256, dumb→""); COLORTERM=truecolor → 16m;
 *     RGB-array input [r,g,b] accepted (docs "flexible input").
 *     Explicit formats (`ansi-16m` …) always emit (NO_COLOR does NOT silence
 *     them) — see styledRGB (src/lib/color/terminal.ts) for the RGB-tuple path.
 */
import { TOKENS } from "../../institutions/design-tokens.ts";
import { convertColorFallback } from "./kernel.ts";
import { brandSwatchPng } from "../brand-image.ts";

export const THEME_ROLES = [
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "background",
  "foreground",
  "muted",
  "border",
  "onAccent",
] as const;

export type ThemeRole = (typeof THEME_ROLES)[number];

/** Semantic role -> TOKEN value (audit-safe: every value is in TOKENS). */
export const THEME: Record<ThemeRole, string> = {
  primary: TOKENS.color.acc,
  secondary: TOKENS.color.ok,
  accent: TOKENS.color.warn,
  success: TOKENS.color.ok,
  warning: TOKENS.color.warn,
  error: TOKENS.color.bad,
  info: TOKENS.color.acc,
  background: TOKENS.color.bg,
  foreground: TOKENS.color.fg,
  muted: TOKENS.color.dim,
  border: TOKENS.color.line,
  onAccent: TOKENS.color.onAccent,
};

export type AnsiMode = "auto" | "16" | "256" | "16m";

/**
 * Concrete terminal color depth after env resolution (grounded §211):
 * NO_COLOR wins; FORCE_COLOR 1|2|3 -> 16 / 256 / 24-bit; TTY -> 16m default;
 * piped (no env) -> none. Bun.isTerminal / getColorDepth DO NOT EXIST on 1.4.0,
 * so this is the repo's proper definition of color-depth detection.
 */
export type ResolvedColorMode = "16" | "256" | "16m" | "none";

/**
 * Resolve the effective ANSI depth from the environment (proper definition of
 * the FORCE_COLOR / NO_COLOR contract, §211). Explicit formats (ansi-256,
 * ansi-16m) still emit regardless - this governs the AUTO mode only.
 */
export function resolveColorMode(
  env: NodeJS.ProcessEnv = process.env,
  opts: { isTty?: boolean } = {},
): ResolvedColorMode {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "" && env.NO_COLOR !== "0") return "none";
  if (env.FORCE_COLOR === "1") return "16";
  if (env.FORCE_COLOR === "2") return "256";
  if (env.FORCE_COLOR === "3") return "16m";
  if (env.FORCE_COLOR === "0") return "none";
  const tty = opts.isTty ?? Boolean(process.stdout.isTTY);
  return tty ? "16m" : "none";
}

/** ANSI code for a role (foreground). Auto = Bun.color(…, "ansi"). */
export function themeAnsi(role: ThemeRole, mode: AnsiMode = "auto"): string {
  const hex = THEME[role];
  if (mode === "auto") {
    if (typeof Bun !== "undefined" && typeof Bun.color === "function") {
      return (Bun.color(hex, "ansi") as string | null) ?? "";
    }
    return "";
  }
  const format = mode === "16m" ? "ansi-16m" : mode === "256" ? "ansi-256" : "ansi-16";
  const out = convertColorFallback(hex, format);
  return typeof out === "string" ? out : "";
}

/** WCAG 2.1 relative luminance (0-1) for ANY hex — Bun has no luminance format. */
export function relativeLuminance(hex: string): number {
  const rgb = convertColorFallback(hex, "{rgb}");
  if (!rgb || typeof rgb === "string" || typeof rgb === "number") return 0;
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** WCAG 2.1 contrast ratio (1-21) between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [L, d] = la > lb ? [la, lb] : [lb, la];
  return (L + 0.05) / (d + 0.05);
}

/** Pick #000000 / #ffffff text by WCAG contrast (like kernel pickForeground). */
export function accessibleForeground(bg: string): "#000000" | "#ffffff" {
  const vsBlack = contrastRatio("#000000", bg);
  const vsWhite = contrastRatio("#ffffff", bg);
  return vsBlack >= vsWhite ? "#000000" : "#ffffff";
}

export type ContrastVerdict = "AA" | "AAA" | "AA-large" | "fail";

/** WCAG verdict for a ratio: AAA >= 7, AA >= 4.5, AA-large >= 3, else fail. */
export function verdict(ratio: number): ContrastVerdict {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/** The theme's key contrast pairs (text on surfaces) with ratios + verdicts. */
export function themeContrastPairs(): Array<{
  fg: string;
  bg: string;
  ratio: number;
  verdict: ContrastVerdict;
}> {
  // fg/bg as token hexes (roles + a literal token for the panel surface).
  const pairs: Array<[string, string]> = [
    [THEME.foreground, THEME.background],
    [THEME.muted, THEME.background],
    [THEME.foreground, THEME.primary],
    [THEME.onAccent, THEME.accent],
    [THEME.onAccent, THEME.info],
    [TOKENS.color.fg, TOKENS.color.panel],
  ];
  return pairs.map(([fg, bg]) => {
    const ratio = contrastRatio(fg, bg);
    return { fg, bg, ratio, verdict: verdict(ratio) };
  });
}

/** CSS custom-property block for the web side of the theme. */
export function themeCssVars(): string {
  return THEME_ROLES.map((role) => "  --" + role + ": " + THEME[role] + ";").join("\n");
}

/** Solid PNG for a role (zero-dep hand-rolled encoder — verified image path). */
export function themeSwatchPng(role: ThemeRole, size = 64): Uint8Array {
  return brandSwatchPng(THEME[role], size);
}

export type ThemeManifest = {
  version: string;
  roles: ThemeRole[];
  theme: Record<ThemeRole, string>;
  cssVars: string;
  contrast: ReturnType<typeof themeContrastPairs>;
  ansi: Record<ThemeRole, Record<AnsiMode, string>>;
};

/** Full wire blob for /api/color/theme. */
export function themeManifest(): ThemeManifest {
  const ansi = {} as ThemeManifest["ansi"];
  for (const role of THEME_ROLES) {
    ansi[role] = {
      auto: themeAnsi(role, "auto"),
      "16": themeAnsi(role, "16"),
      "256": themeAnsi(role, "256"),
      "16m": themeAnsi(role, "16m"),
    };
  }
  return {
    version: "1.0.0",
    roles: [...THEME_ROLES],
    theme: { ...THEME },
    cssVars: themeCssVars(),
    contrast: themeContrastPairs(),
    ansi,
  };
}
