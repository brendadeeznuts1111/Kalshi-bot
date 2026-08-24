/**
 * Design-system public API — tokens + color kernel in one importable
 * surface (bundled standalone via `bun run design:build`).
 */
export {
  BRAND,
  DESIGN_SYSTEM_VERSION,
  TOKENS,
  baseCssVars,
  tokenPaths,
  tokenValues,
} from './design-tokens.ts';
export {
  COLORS,
  ansi16mColor,
  ansiColor,
  colorNumber,
  contrast,
  convert,
  cssColor,
  darken,
  foregroundCss,
  hexColor,
  isColorKey,
  isDark,
  lighten,
  luminance,
  resolveColor,
  rgbChannels,
  rgbaChannels,
  tint,
} from '../lib/color/index.ts';
export type { ColorKey } from '../lib/color/palette.ts';
export type { RGB, RGBA } from '../lib/color/kernel.ts';
