/**
 * ANSI-aware string width utilities (Bun.stringWidth / Bun.sliceAnsi).
 *
 * JS String.prototype.padEnd/padStart count ESC sequences as characters, so
 * padding colored text misaligns columns. These wrap Bun's native ANSI-aware
 * width/slice primitives (verified on 1.4.0: stringWidth counts visible cells
 * through color codes; sliceAnsi keeps ANSI intact). No repo consumer has the
 * misalignment bug yet - this is the ready primitive for terminal tables.
 *
 * @see https://bun.com/blog/bun-v1.4 (stringWidth / sliceAnsi)
 */

/** Visible (ANSI-ignored) width of a string. */
export function visibleWidth(value: string): number {
  return Bun.stringWidth(value);
}

/**
 * Pad to a visible width, appending plain spaces AFTER the content. Pass
 * reset-terminated strings (ending in the ANSI reset) so the appended spaces
 * are not colored; with an open color code the spaces inherit it.
 */
export function padAnsi(value: string, width: number, dir: "left" | "right" = "right"): string {
  const visible = Bun.stringWidth(value);
  const fill = Math.max(0, width - visible);
  if (fill === 0) return value;
  const spaces = " ".repeat(fill);
  return dir === "right" ? value + spaces : spaces + value;
}

/**
 * Slice by visible cells, preserving ANSI escapes; optional placeholder
 * inserted when truncation occurs (Bun.sliceAnsi third arg; verified on
 * 1.4.0: 'unicorn' -> 'uni…', negative start -> '…orn').
 */
export function sliceAnsiSafe(
  value: string,
  start: number,
  end?: number,
  placeholder?: string,
): string {
  return placeholder === undefined ? Bun.sliceAnsi(value, start, end) : Bun.sliceAnsi(value, start, end, placeholder);
}

export type StatusMark = "ok" | "WARN" | "FAIL" | "GAP" | "n/a";

/**
 * Format a status line with SEPARATED, DEFAULTED columns:
 *   <indent><mark padded to markWidth>  <label>: <detail>
 * Every audit tool prints status rows; this keeps the mark column the
 * same width regardless of mark length (ok/n/a are 2-3 chars, WARN/FAIL
 * are 4), so the label column aligns across ALL tools (pitfalls 30).
 * @param mark one of ok/WARN/FAIL/GAP/n/a (any string works)
 * @param label the check name
 * @param detail optional detail after ': '
 * @param opts indent (default 2 spaces), markWidth (default 6), sep (default 2 spaces)
 */
export function statusLine(
  mark: string,
  label: string,
  detail?: string,
  opts?: { indent?: number; markWidth?: number; sep?: number },
): string {
  const indent = opts?.indent ?? 2;
  const markWidth = opts?.markWidth ?? 6;
  const sep = opts?.sep ?? 2;
  const pad = " ".repeat(indent) + padAnsi(mark, markWidth) + " ".repeat(sep);
  return detail === undefined || detail.length === 0 ? pad + label : pad + label + ": " + detail;
}
