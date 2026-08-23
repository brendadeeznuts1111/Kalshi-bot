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

/** Slice by visible cells, preserving the ANSI escapes around the kept text. */
export function sliceAnsiSafe(value: string, start: number, end?: number): string {
  return Bun.sliceAnsi(value, start, end);
}
