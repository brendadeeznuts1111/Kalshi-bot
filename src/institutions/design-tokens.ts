/**
 * design-tokens.ts — Kalshi HQ design system, single source of truth.
 *
 * Versioning rules (semver):
 *   - MAJOR: token removed or meaning changed (consumers must migrate)
 *   - MINOR: token added
 *   - PATCH: value tweak (color tuning, spacing adjust)
 *
 * Consumers import TOKENS / baseCssVars() — never hardcode hex/radii in views.
 * The design agent (`src/agent/design-agent.ts`) audits compliance.
 */

export const DESIGN_SYSTEM_VERSION = "1.1.0"; // 1.1.0: +palette (domain COLORS), +status, +scrim, +accTint

import { COLORS } from "../lib/color/palette.ts";
import { tint } from "../lib/color/kernel.ts";

export const BRAND = {
  name: "Kalshi HQ",
  wordmark: "KALSHI",
  accentWord: "HQ",
  tagline: "Research · Alpha · Trading",
} as const;

export const TOKENS = {
  color: {
    bg: "#0b0e14",
    panel: "#12161f",
    panel2: "#171c28",
    line: "#232a3a",
    fg: "#d7dee9",
    dim: "#7d8798",
    acc: "#4da3ff",
    ok: "#3fb27f",
    warn: "#e0a93e",
    bad: "#e05e5e",
    /** Badge backgrounds are 15%-alpha tints of the semantic color —
     * derived from the base hex via Bun.color (color kernel tint()), not
     * hand-maintained rgba literals. */
    okTint: tint("#3fb27f", 0.15),
    warnTint: tint("#e0a93e", 0.15),
    badTint: tint("#e05e5e", 0.15),
    accTint: tint("#4da3ff", 0.15),
    onAccent: "#06121f",
    /** Domain palette — mirrors the generated --color-* vars in
     * hq-app/color-vars.css (scripts/generate-color-artifacts.ts reads the
     * same COLORS source). Registering them here makes them legal design
     * vocabulary (the design agent audits against tokenValues()). */
    palette: {
      ...COLORS,
      /** Ink-on-color (the generated --color-*-on vars are #000000/#ffffff). */
      onLight: "#000000",
      onDark: "#ffffff",
      /** hq-app status badge colors (.g-status-*). */
      deprecated: "#f0b429",
      draft: "#7aa2ff",
    },
    /** Overlay scrims (box-shadow / modal dim) — derived via tint(). */
    scrim: {
      soft: tint("#000000", 0.35),
      strong: tint("#000000", 0.45),
    },
  },
  space: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.9rem",
    lg: "1.25rem",
    xl: "1.5rem",
  },
  radius: {
    sm: "4px",
    md: "6px",
    lg: "8px",
    pill: "999px",
  },
  font: {
    body: '-apple-system, "SF Pro Text", Segoe UI, sans-serif',
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    sizeBody: "14px",
    sizeSmall: "0.85rem",
    sizeMicro: "0.72rem",
    sizeH1: "1.1rem",
    sizeStat: "1.6rem",
  },
} as const;

/** Flat token path list — design agent audits views against these. */
export function tokenPaths(): string[] {
  const out: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out.push(path);
      else walk(v as Record<string, unknown>, path);
    }
  };
  walk(TOKENS, "");
  return out;
}

/** All token VALUES (hex etc.) — the legal color set for views. */
export function tokenValues(): string[] {
  const out: string[] = [];
  const walk = (obj: Record<string, unknown>) => {
    for (const v of Object.values(obj)) {
      if (typeof v === "string") out.push(v);
      else walk(v as Record<string, unknown>);
    }
  };
  walk(TOKENS);
  return out;
}

/** CSS custom properties block (`:root { … }`) generated from tokens. */
export function baseCssVars(): string {
  const c = TOKENS.color;
  return `:root {
  --bg: ${c.bg}; --panel: ${c.panel}; --panel2: ${c.panel2}; --line: ${c.line};
  --fg: ${c.fg}; --dim: ${c.dim}; --acc: ${c.acc}; --ok: ${c.ok};
  --warn: ${c.warn}; --bad: ${c.bad};
  --ok-tint: ${c.okTint}; --warn-tint: ${c.warnTint}; --bad-tint: ${c.badTint};
  --on-accent: ${c.onAccent};
  --mono: ${TOKENS.font.mono};
}`;
}
