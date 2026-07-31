/**
 * Design colors — compatibility facade over `src/lib/color/`.
 *
 * Prefer importing from `./color/index.ts` (or `./color/kernel.ts`) in new code.
 *
 * @see https://bun.com/docs/runtime/color
 * @see https://bun.com/docs/pm/cli/update#visual-indicators
 * @see src/lib/color/kernel.ts — cached Bun.color conversions
 */

export {
  COLORS,
  ANSI_RESET,
  channels,
  contrast,
  convert,
  darken,
  isDark,
  lighten,
  luminance,
  paint,
  paintSemverChange,
  semverChangeColor,
  type ColorKey,
  type RGB,
  type SemverChange,
} from "./color/index.ts";

/** ANSI escape for terminal output (auto-detect color depth). */
export { ansiColor as ansi, ansi16mColor as ansi16m } from "./color/index.ts";
