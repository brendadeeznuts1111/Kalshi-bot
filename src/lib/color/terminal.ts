/**
 * Terminal paint helper — unified ANSI coloring via the color kernel.
 *
 * @see https://bun.com/docs/runtime/color#format-colors-as-ansi-for-terminals
 * @see https://bun.com/docs/pm/cli/update#visual-indicators
 * @see ./kernel.ts
 */
import { ansi16mColor, ansiColor } from "./kernel.ts";
import type { ColorKey } from "./palette.ts";

export const ANSI_RESET = "\x1b[0m";

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
