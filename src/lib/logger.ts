/**
 * Terminal-safe logger built on Bun.inspect + sliceAnsi.
 *
 * Probe-verified against Bun 1.4.0 (repo baseline):
 * - Bun.inspect supports exactly four options: colors, depth, compact, sorted.
 *   maxArrayLength / maxStringLength / breakLength / showHidden / getters /
 *   numericSeparator / top-level stylize are all IGNORED on 1.4.0.
 * - Bun.enableANSIColors is the runtime truth for console colorization
 *   (TTY + FORCE_COLOR + NO_COLOR + [console] colors). There is no
 *   "isTerminal" export in "bun".
 * - sliceAnsi(input, start, end, { ellipsis }) truncates by visible column
 *   width, preserves ANSI, and counts the ellipsis inside the budget.
 *
 * @see docs/BUN_INSPECT.md
 */
import { inspect, sliceAnsi } from "bun";

export interface LogOptions {
  /** Max nested-object depth for inspect. Default 4. */
  depth?: number;
  /** Single-line output when true; multi-line when false. Default false. */
  compact?: boolean;
  /** Sort object keys alphabetically. Default true. */
  sorted?: boolean;
  /** Truncate each line to this many visible columns. 0 disables. Default: terminal width. */
  columns?: number;
  /** Ellipsis marker, counted inside the width budget. Default "…". */
  ellipsis?: string;
}

const DEFAULT_COLUMNS = 80;

const DEFAULTS: Required<LogOptions> = {
  depth: 4,
  compact: false,
  sorted: true,
  columns: DEFAULT_COLUMNS,
  ellipsis: "…",
};

/** Visible width of stdout in columns; falls back to 80 when piped/unknown. */
export function terminalColumns(): number {
  // process.stdout is a stream.Writable at the type level; columns is a
  // WriteStream field that is "undefined" when stdout is not a TTY.
  const columns = (process.stdout as unknown as { columns?: number }).columns;
  return typeof columns === "number" && columns > 0 ? columns : DEFAULT_COLUMNS;
}

/** Format one value with the supported inspect options, truncating per line. */
export function formatValue(value: unknown, options: LogOptions = {}): string {
  const { depth, compact, sorted, columns, ellipsis } = {
    ...DEFAULTS,
    ...options,
  };
  const raw = inspect(value, {
    colors: Bun.enableANSIColors,
    depth,
    compact,
    sorted,
  });
  if (columns <= 0) return raw;
  return raw
    .split("\n")
    .map((line) => sliceAnsi(line, 0, columns, { ellipsis }))
    .join("\n");
}

/**
 * console.log that inspects every argument and fits each line to the terminal
 * width — colors preserved, no awkward wrapping.
 */
export function log(...args: unknown[]): void {
  console.log(args.map((arg) => formatValue(arg)).join(" "));
}

/** Alias for the "logSafe" recipe name. */
export const logSafe = log;
