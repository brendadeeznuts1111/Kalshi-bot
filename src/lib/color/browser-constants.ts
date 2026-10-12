/**
 * CSS color constants, normalized with `Bun.color`.
 *
 * Not a macro: under `bun run`, the `with { type: "macro" }` import is left
 * unbound (`color is not defined`) when this module loads after
 * `src/institutions/glossary.ts` in the same graph.
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 */
function color(input: string, format: "css"): string {
  const out = Bun.color(input, format);
  if (!out) throw new Error(`Invalid color value: ${input}`);
  return out;
}

/** Normalized CSS hex for each palette key. */
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
