/**
 * Domain color palette — single source of truth for hex inputs.
 *
 * Stored as CSS hex strings. Convert via the kernel (`cssColor`, `hexColor`, …);
 * do not call `Bun.color` ad hoc outside `kernel.ts` / `terminal.ts`.
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see https://bun.com/docs/pm/cli/update#visual-indicators — major/minor/patch language
 * @see src/institutions/venue-badge.ts — venue identity consumers
 */

/** Domain colors as hex strings. Bun.color() parses these directly. */
export const COLORS = {
  // ── Venue identity ──
  kalshi: "#7DD3FC",
  polymarket: "#2E5CFF",
  pinnacle: "#1A73E8",
  betfair: "#F5B942",
  unknown: "#8B949E",

  // ── Domain / system ──
  trading: "#E74C3C", // red — real money / risk
  middleware: "#F1C40F", // yellow — caution / gate
  tennis: "#27AE60", // green — live / healthy
  research: "#E67E22", // orange — discovery
  env: "#9B59B6", // purple — configuration
  misc: "#95A5A6", // gray — neutral

  // ── Semver / bun update -i visual language ──
  // @see https://bun.com/docs/pm/cli/update#visual-indicators
  semverMajor: "#EF4444", // red — major
  semverMinor: "#EAB308", // yellow — minor
  semverPatch: "#22C55E", // green — patch
  selected: "#A78BFA", // accent for “current target”
} as const;

export type ColorKey = keyof typeof COLORS;

export function isColorKey(value: string): value is ColorKey {
  return Object.hasOwn(COLORS, value);
}
