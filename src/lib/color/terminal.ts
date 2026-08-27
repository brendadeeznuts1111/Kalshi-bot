/**
 * Terminal paint helper — unified ANSI coloring via the color kernel.
 *
 * @see https://bun.com/docs/runtime/color#format-colors-as-ansi-for-terminals
 * @see https://bun.com/docs/pm/cli/update#visual-indicators
 * @see ./kernel.ts
 */
import { ansi16mColor, ansiColor, ansiRgbColor } from "./kernel.ts";
import type { ColorKey } from "./palette.ts";

export const ANSI_RESET = "\x1b[0m";

/** RGB triplet input — Bun.color accepts the array directly (docs "flexible input"). */
export type RGBTuple = [number, number, number];

/**
 * Paint text with an arbitrary RGB triplet.
 * `auto` delegates fully to `Bun.color(rgb, "ansi")`, which detects the color
 * depth of stdout from ENVIRONMENT VARIABLES (docs "Format colors as ANSI") and
 * picks ansi-16m / ansi-256 / ansi-16 accordingly, returning "" when unsupported.
 * PROBE-VERIFIED 1.4.0 (§235): 'ansi' is ENV-driven, not TTY-driven — it emits
 * even when stdout is piped: NO_COLOR silences (unless FORCE_COLOR); FORCE_COLOR
 * 1|2|3 → 16/256/16m (overrides TERM=dumb); TERM picks depth (xterm→16,
 * xterm-256color→256, dumb→""); COLORTERM=truecolor upgrades to 16m; RGB-array
 * input === hex input. `deterministic` forces ansi-16m (true RGB regardless of
 * env — NOTE: explicit formats ignore NO_COLOR). Returns plain text when the
 * open sequence is empty.
 */
export function styledRGB(
  text: string,
  rgb: RGBTuple,
  mode: "auto" | "deterministic" = "auto",
): string {
  const open = ansiRgbColor(rgb, mode === "auto" ? "ansi" : "ansi-16m");
  return open ? `${open}${text}${ANSI_RESET}` : text;
}

/**
 * Paint text with a domain color.
 * `auto` respects NO_COLOR / TTY depth; `deterministic` always uses ansi-16m.
 * Returns plain text when the open sequence is empty (colors disabled).
 */
export function paint(
  text: string,
  key: ColorKey,
  mode: "auto" | "deterministic" = "auto",
): string {
  const open = mode === "auto" ? ansiColor(key) : ansi16mColor(key);
  return open ? `${open}${text}${ANSI_RESET}` : text;
}

/** Semver bump class — same language as `bun update --interactive`. */
export type SemverChange = "major" | "minor" | "patch" | "same" | "unknown";

export function semverChangeColor(change: SemverChange): ColorKey {
  switch (change) {
    case "major":
      return "semverMajor";
    case "minor":
      return "semverMinor";
    case "patch":
      return "semverPatch";
    default:
      return "misc";
  }
}

/** Colorize a label with semver-change indicator ANSI. */
export function paintSemverChange(
  change: SemverChange,
  text: string,
  mode: "auto" | "deterministic" = "auto",
): string {
  return paint(text, semverChangeColor(change), mode);
}
