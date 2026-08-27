/**
 * Color system barrel — palette, kernel, roles, terminal paint.
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see https://bun.com/docs/pm/cli/update#visual-indicators
 * @see https://bun.com/docs/guides/html-rewriter/extract-social-meta
 * @see https://bun.com/docs/runtime/environment-variables#configuring-bun
 */
export { COLORS, isColorKey, type ColorKey } from "./palette.ts";
export {
  ansi16mColor,
  ansiColor,
  ansiRgbColor,
  channels,
  colorNumber,
  contrast,
  convert,
  convertColorFallback,
  parseExtendedColor,
  cssColor,
  darken,
  foregroundCss,
  hexColor,
  isDark,
  lighten,
  luminance,
  resolveColor,
  rgbChannels,
  rgbaChannels,
  tint,
  type ForegroundCss,
  type ResolvedColor,
  type RGB,
  type RGBA,
} from "./kernel.ts";
export {
  COLOR_ROLES,
  roleColor,
  type ColorRoleCategory,
} from "./roles.ts";
export {
  ANSI_RESET,
  paint,
  paintSemverChange,
  semverChangeColor,
  styledRGB,
  type RGBTuple,
  type SemverChange,
} from "./terminal.ts";
export { COLOR_CSS, type BrowserColorKey } from "./browser-constants.ts";
