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

export const DESIGN_SYSTEM_VERSION = "1.2.0"; // 1.2.0: +dual-layer theme engine (--c-* RGB triplets, .dark/.light, prefers-color-scheme)

import { COLORS, type ColorKey } from "../lib/color/palette.ts";
import { convert, tint } from "../lib/color/kernel.ts";

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
     * vocabulary (the design agent audits against tokenValues()).
     * Values pass through the kernel's convert(key, "hex") — Bun.color's
     * "hex" format GUARANTEES lowercase #rrggbb for any input spelling
     * ("css" would be 'most compact' and can emit named colors, e.g.
     * #FF0000 -> "red", which would break the audit's hex comparison). */
    palette: {
      ...Object.fromEntries(
        (Object.keys(COLORS) as ColorKey[]).map((key) => [key, convert(key, "hex") as string]),
      ),
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

// Load-time guard: every palette entry must be a lowercase hex — the design
// audit compares surfaces against these exact strings.
for (const [name, value] of Object.entries(TOKENS.color.palette)) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error(`Palette token "${name}" is not lowercase hex: ${value}`);
  }
}

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

/** CSS custom properties (`:root { … }`) generated from tokens.
 *
 * Theme engine (bun.com-style dual-layer architecture):
 *   - `:root` — the HQ dark palette as RGB triplets in `--c-*` tokens
 *   - `@media (prefers-color-scheme: light)` — OS default override
 *   - `.dark` / `.light` classes — manual override (themeChrome() toggle)
 * Semantic vars (`--bg`, `--fg`, …) consume the `--c-*` tokens via
 * rgb(var(--c-*)), so every consumer (views, hq-ui, /bun/* widgets, the
 * story server) re-themes at runtime with no per-page code.
 */
export function baseCssVars(): string {
  const c = TOKENS.color;
  const rgb = (hex: string): string => {
    const h = hex.replace("#", "");
    return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
  };
  const dark = {
    canvas: rgb(c.bg), panel: rgb(c.panel), panel2: rgb(c.panel2), line: rgb(c.line),
    fg: rgb(c.fg), dim: rgb(c.dim), acc: rgb(c.acc), ok: rgb(c.ok), warn: rgb(c.warn),
    bad: rgb(c.bad), onAccent: rgb(c.onAccent),
  };
  // Light theme — same semantic roles, readable on white (bun.com-style roles:
  // canvas/panel/fg/line match the shipped blog values; accent darkened for contrast).
  const light = {
    canvas: "255 255 255", panel: "246 246 246", panel2: "255 255 255", line: "226 226 226",
    fg: "10 10 10", dim: "82 82 82", acc: "29 105 220", ok: "21 128 84",
    warn: "178 125 20", bad: "200 60 60", onAccent: "255 255 255",
  };
  const tokens = (t: typeof dark): string =>
    `--c-canvas:${t.canvas};--c-panel:${t.panel};--c-panel2:${t.panel2};--c-line:${t.line};` +
    `--c-fg:${t.fg};--c-dim:${t.dim};--c-acc:${t.acc};--c-ok:${t.ok};--c-warn:${t.warn};` +
    `--c-bad:${t.bad};--c-on-accent:${t.onAccent}`;
  return [
    "/* Kalshi HQ design tokens — dual-layer theme engine (RGB-triplet --c-* + semantic vars) */",
    ":root { " + tokens(dark) + "; color-scheme: dark; }",
    "@media (prefers-color-scheme: light) { :root:not(.dark) { " + tokens(light) + "; color-scheme: light; } }",
    ".light { " + tokens(light) + "; color-scheme: light; }",
    ".dark { " + tokens(dark) + "; color-scheme: dark; }",
    ":root {",
    "  --bg: rgb(var(--c-canvas)); --panel: rgb(var(--c-panel)); --panel2: rgb(var(--c-panel2));",
    "  --line: rgb(var(--c-line)); --fg: rgb(var(--c-fg)); --dim: rgb(var(--c-dim));",
    "  --acc: rgb(var(--c-acc)); --ok: rgb(var(--c-ok)); --warn: rgb(var(--c-warn)); --bad: rgb(var(--c-bad));",
    "  --ok-tint: " + c.okTint + "; --warn-tint: " + c.warnTint + "; --bad-tint: " + c.badTint + "; --acc-tint: " + c.accTint + ";",
    "  --on-accent: rgb(var(--c-on-accent));",
    "  --mono: " + TOKENS.font.mono + ";",
    "}",
  ].join("\n");
}

/** Prose typography layer — the bun.com .blog-prose rules (verified from the
 * shipped blog CSS) adapted to the HQ token surface. Apply class="prose" to any
 * container that renders markdown bodies. */
export function proseCss(): string {
  return [
    '.prose h1{font-weight:700;font-size:1.5rem;margin:1.6em 0 .6em;letter-spacing:-.01em}',
    '.prose h2{margin-top:1.8em;margin-bottom:.7em;padding-bottom:.3em;border-bottom:1px solid var(--line);font-size:1.4rem}',
    '.prose h3{border-top:1px solid var(--line);margin-top:2.2em;margin-bottom:.6em;padding-top:1.1em;font-size:1.2rem}',
    '.prose h4{margin-top:2.4em;margin-bottom:.5em;font-size:1.1rem;font-weight:650}',
    '.prose :where(code){background:rgb(var(--c-fg)/.08);border-radius:4px;padding:0 .3em;font-size:.85em;font-family:var(--mono);letter-spacing:-.01em}',
    '.prose .codeblock{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:1rem;overflow-x:auto}',
    '.prose .codeblock code{background:transparent;padding:0;font-family:var(--mono)}',
    '.prose .langchip{display:inline-block;font-family:var(--mono);font-size:.68em;letter-spacing:.06em;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:.05em .55em;margin-bottom:.45em}',
    '.prose .tablewrap{overflow-x:auto;max-width:100%}',
    '.prose .tablewrap{overflow-x:auto;max-width:100%}',
    '.prose pre{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:1rem;overflow-x:auto;font-family:var(--mono);font-size:.85em}',
    '.prose a{color:var(--acc);text-decoration:underline;text-decoration-color:rgb(var(--c-acc)/.45);text-underline-offset:3px}',
    '.prose blockquote{border-left:3px solid rgb(var(--c-acc)/.5);margin:1.2em 0;padding-left:1em;color:var(--dim)}',
    '.prose table{width:100%;border-collapse:collapse;font-size:.9em}',
    '.prose th,.prose td{border-bottom:1px solid var(--line);padding:.45em .8em;text-align:left}',
    '.prose thead th{color:var(--fg);font-weight:600}',
    '.prose ul,.prose ol{padding-left:1.5em}',
    '.prose li{margin:.25em 0}',
    '.prose p{margin:1em 0}',
  ].join('\n');
}

/** Theme toggle button (fixed bottom-right chip). Include before </body>. */
export function themeToggleButton(): string {
  return '<button id="themeToggle" type="button" aria-label="Toggle light/dark theme" ' +
    'style="position:fixed;right:0.9rem;bottom:0.9rem;z-index:99;border:1px solid var(--line);' +
    'background:var(--panel);color:var(--fg);border-radius:999px;padding:0.35rem 0.8rem;' +
    'font-size:0.75rem;cursor:pointer;font-family:var(--mono)">◐ theme</button>';
}

/** Theme engine JS (localStorage override + prefers-color-scheme default). */
export function themeChrome(): string {
  return '<script>(function(){var r=document.documentElement;var read=function(){try{return localStorage.getItem("kalshi-hq-theme")}catch(e){return null}};' +
    'var apply=function(v){r.classList.toggle("dark",v==="dark");r.classList.toggle("light",v==="light")};' +
    'var t=read();apply(t);if(!t){var m=window.matchMedia("(prefers-color-scheme: light)");' +
    'var onOs=function(){if(!read())apply(m.matches?"light":null)};' +
    'm.addEventListener?m.addEventListener("change",onOs):null}var b=document.getElementById("themeToggle");' +
    'if(b)b.addEventListener("click",function(){var cur=r.classList.contains("dark")?"dark":r.classList.contains("light")?"light":null;' +
    'var n=cur==="dark"?"light":"dark";try{localStorage.setItem("kalshi-hq-theme",n)}catch(e){}apply(n)})})();</script>';
}
