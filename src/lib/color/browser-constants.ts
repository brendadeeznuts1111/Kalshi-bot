/**
 * Build-time color constants for browser bundles.
 *
 * `Bun.color` runs as a macro — the output is plain string literals with
 * zero runtime Bun dependency in the client.
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see https://bun.com/docs/bundler/macros
 */
import { color } from "bun" with { type: "macro" };

/** Normalized CSS hex for each palette key (macro-resolved). */
export const COLOR_CSS = {
  kalshi: color("#7DD3FC", "css"),
  polymarket: color("#2E5CFF", "css"),
  pinnacle: color("#1A73E8", "css"),
  betfair: color("#F5B942", "css"),
  unknown: color("#8B949E", "css"),
  trading: color("#E74C3C", "css"),
  middleware: color("#F1C40F", "css"),
  tennis: color("#27AE60", "css"),
  research: color("#E67E22", "css"),
  env: color("#9B59B6", "css"),
  misc: color("#95A5A6", "css"),
  semverMajor: color("#EF4444", "css"),
  semverMinor: color("#EAB308", "css"),
  semverPatch: color("#22C55E", "css"),
  selected: color("#A78BFA", "css"),
} as const;

export type BrowserColorKey = keyof typeof COLOR_CSS;
