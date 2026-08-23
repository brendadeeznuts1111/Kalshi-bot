/**
 * Terminal color + pad helpers for tennis-hq charts.
 * Visible width uses Bun.stringWidth (not UTF-16 length).
 *
 * @see https://bun.com/docs/runtime/utils#bun-stringwidth
 * @see https://bun.com/docs/runtime/utils#bun-stripansi
 */

import { ANSI } from "../../../institutions/terminal-utils.ts";

export const c = {
  reset: ANSI.reset,
  bold: ANSI.bold,
  dim: ANSI.dim,
  green: ANSI.green,
  yellow: ANSI.yellow,
  red: ANSI.red,
  blue: ANSI.blue,
  cyan: ANSI.cyan,
  brightCyan: ANSI.brightCyan,
  brightBlue: ANSI.brightBlue,
} as const;

/**
 * Pad/truncate by visible columns. Truncation delegates to the NATIVE
 * Bun.sliceAnsi (width-aware, ANSI/OSC-8 preserving, ellipsis) instead of
 * a hand-rolled char loop - use Bun's utils by default (pitfalls 31).
 */
export function pad(
  str: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const visible = Bun.stringWidth(str);
  if (visible === width) return str;
  if (visible > width) {
    if (width <= 1) return Bun.stripANSI(str).slice(0, Math.max(0, width));
    return Bun.sliceAnsi(str, 0, width, { ellipsis: "…" });
  }
  const spaces = " ".repeat(width - visible);
  return align === "right" ? spaces + str : str + spaces;
}


