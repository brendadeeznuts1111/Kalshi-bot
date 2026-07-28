/**
 * console-depth.ts — project-wide SSOT for object-inspection verbosity.
 *
 * Official Bun references:
 *   - Depth control (`--console-depth`, bunfig `[console] depth`):
 *     https://bun.com/docs/runtime/console
 *   - CLI flag reference: https://bun.com/docs/runtime
 *   - Bun.inspect (#bun-inspect) / .custom (#bun-inspect-custom) /
 *     .table (#bun-inspect-table-…) / Bun.stringWidth /
 *     Bun.stripANSI / Bun.wrapAnsi: https://bun.com/docs/runtime/utils
 *   - Bun.markdown.ansi (AnsiTheme): https://bun.com/docs/runtime/markdown#ansi-terminal-output
 *   - Bun.color: https://bun.com/docs/runtime/color
 *   - Bun.env / .env files: https://bun.com/docs/runtime/environment-variables
 *   - Bun.sliceAnsi: https://bun.com/reference/bun/sliceAnsi
 *   - TTY primitives (isTTY, columns): https://bun.com/docs/runtime/nodejs-compat#nodetty
 *   - Type definitions (pinned commit):
 *     https://github.com/oven-sh/bun/tree/98f664962ffe4c6ba9b38382babc623ef0ba8693/packages/bun-types
 *     (tracking branch: https://github.com/oven-sh/bun/tree/main/packages/bun-types)
 *
 * Native layers (for plain console.log):
 *   --console-depth=N flag  >  bunfig.toml [console] depth (= 6 in this repo)
 *   >  Bun default (2). The runtime does NOT read BUN_CONSOLE_DEPTH itself,
 *   and util.inspect.defaultOptions.depth is a no-op in Bun 1.4.
 *
 * This module covers the gaps the native layers don't reach: explicit
 * Bun.inspect calls, TTY-aware colors, compact/table modes, and forwarding
 * depth to child processes.
 *
 * Control plane (highest wins):
 *   1. explicit `depth` argument
 *   2. `--console-depth=N` in process args
 *   3. `BUN_CONSOLE_DEPTH` env (set it in the project root .env)
 *   4. DEFAULT_DEPTH (4)
 *
 * .env note: Bun auto-loads .env with precedence .env < .env.{NODE_ENV}
 * < .env.local — a local override of BUN_CONSOLE_DEPTH wins silently.
 * NO_COLOR / FORCE_COLOR are official Bun env vars (documented on the
 * environment-variables page); Bun's precedence is FORCE_COLOR > NO_COLOR,
 * matching shouldColor() below.
 * https://bun.com/docs/runtime/environment-variables
 *
 * For class-level customization of printed output, implement
 * `[Bun.inspect.custom]()` on the class (see utils docs above).
 */

const DEFAULT_DEPTH = 4;

function parseDepth(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function argDepth(): number | null {
  const idx = Bun.argv.findIndex(a => a === '--console-depth');
  if (idx !== -1) return parseDepth(Bun.argv[idx + 1]);
  const eq = Bun.argv.find(a => a.startsWith('--console-depth='));
  return eq ? parseDepth(eq.split('=')[1]) : null;
}

/**
 * Effective console depth for this process.
 * @see https://bun.com/docs/runtime/console — depth precedence (flag > bunfig)
 * @see https://bun.com/docs/runtime — `--console-depth` CLI flag
 */
export function getConsoleDepth(): number {
  return argDepth() ?? parseDepth(Bun.env.BUN_CONSOLE_DEPTH) ?? DEFAULT_DEPTH;
}

/**
 * TTY-aware color decision, honoring the standard FORCE_COLOR / NO_COLOR
 * env conventions (Bun documents both as official env vars, precedence
 * FORCE_COLOR > NO_COLOR). Never emit ANSI when piped unless forced.
 * @see https://bun.com/docs/runtime/environment-variables#configuring-bun — NO_COLOR / FORCE_COLOR
 * @see https://bun.com/docs/runtime/nodejs-compat#nodetty — process.stdout.isTTY
 */
export function shouldColor(): boolean {
  if (Bun.env.FORCE_COLOR && Bun.env.FORCE_COLOR !== '0') return true;
  if (Bun.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}

/**
 * Terminal width in columns (fallback 80).
 * @see https://bun.com/docs/runtime/nodejs-compat#nodetty — tty.WriteStream.columns
 */
export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

export type InspectOptions = {
  depth?: number;
  colors?: boolean;
  /** Single-line output. NOTE: the official BunInspectOptions surface is
   *  exactly {colors, depth, sorted, compact} — boolean compact only.
   *  https://bun.com/reference/bun/BunInspectOptions */
  compact?: boolean;
  /** Sort object keys alphabetically, recursively — deterministic output
   *  for snapshots/diffs. https://bun.com/reference/bun/BunInspectOptions */
  sorted?: boolean;
};

/**
 * Wire-edge Bun.inspect — accepts runtime `unknown` before typed use inward.
 * Only official BunInspectOptions fields are exposed — runtime-verified
 * on Bun 1.4.0: `getters`, `maxArrayLength`, and `maxStringLength` are
 * silently ignored by Bun.inspect, so they are deliberately absent.
 * @see https://bun.com/docs/runtime/utils#bun-inspect — Bun.inspect
 * @see https://bun.com/reference/bun/BunInspectOptions — colors / depth / sorted / compact
 */
export function inspectFromUnknown(value: unknown, options: InspectOptions = {}): string {
  return Bun.inspect(value, {
    depth: options.depth ?? getConsoleDepth(),
    colors: options.colors ?? shouldColor(),
    compact: options.compact,
    sorted: options.sorted,
  });
}

/** Bun.inspect with the project depth + TTY-aware colors applied. */
export function inspect<T>(value: T, options: InspectOptions = {}): string {
  return inspectFromUnknown(value, options);
}

/**
 * console.log replacement: project depth, colors only on a real TTY.
 * @see https://bun.com/docs/runtime/utils#bun-inspect
 * @see https://bun.com/docs/runtime/console
 */
export function logDepthFromUnknown(value: unknown, options: InspectOptions = {}): void {
  console.info(inspectFromUnknown(value, options));
}

export function logDepth<T>(value: T, options: InspectOptions = {}): void {
  logDepthFromUnknown(value, options);
}

/**
 * Single-line compact log for high-frequency output (hot paths, watch loops).
 * @see https://bun.com/docs/runtime/utils#bun-inspect — `compact` option
 */
export function logCompactFromUnknown(value: unknown, options: InspectOptions = {}): void {
  console.info(inspectFromUnknown(value, { compact: true, ...options }));
}

export function logCompact<T>(value: T, options: InspectOptions = {}): void {
  logCompactFromUnknown(value, options);
}

/**
 * Deterministic log with keys sorted alphabetically (recursive) — stable
 * output for snapshots, diffs, and golden-file comparisons.
 * @see https://bun.com/reference/bun/BunInspectOptions — `sorted`
 */
export function logSortedFromUnknown(value: unknown, options: InspectOptions = {}): void {
  console.info(inspectFromUnknown(value, { sorted: true, ...options }));
}

export function logSorted<T>(value: T, options: InspectOptions = {}): void {
  logSortedFromUnknown(value, options);
}

/**
 * Bun.inspect.table(tabularData, properties?, options?) — returns a string (unlike console.table).
 * Overloads match docs: options alone as 2nd arg, or properties then options.
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
 */
export function logTableFromUnknown(
  data: unknown,
  columns?: string[],
  options: { colors?: boolean } = {}
): void {
  const rows = (Array.isArray(data) ? data : [data]) as object[];
  const opts = { colors: options.colors ?? shouldColor() };
  // Docs: (data, options) OR (data, properties, options) — never pass undefined properties.
  console.info(
    columns?.length ? Bun.inspect.table(rows, columns, opts) : Bun.inspect.table(rows, opts)
  );
}

export function logTable<T extends object>(
  data: T | T[],
  columns?: string[],
  options: { colors?: boolean } = {}
): void {
  logTableFromUnknown(data, columns, options);
}

/**
 * The symbol Bun uses to implement Bun.inspect. Override via `[inspectCustom]()`
 * on a class to customize how objects are printed (identical to util.inspect.custom).
 * @see https://bun.com/docs/runtime/utils#bun-inspect-custom — Bun.inspect.custom
 */
export const inspectCustom = Bun.inspect.custom;

const ANSI_RESET = '\x1b[0m';

/**
 * Colorize text via Bun.color. Uses the "ansi" output format, which
 * auto-detects the terminal's color depth (ansi-16m / ansi-256 / ansi-16)
 * from the environment and returns "" when stdout supports no color —
 * the docs-recommended form. ansi-256 kept as a belt-and-braces fallback.
 * @see https://bun.com/docs/runtime/color — "ansi" auto-detection
 */
export function colorize(text: string, color: string): string {
  if (!shouldColor()) return text;
  const code = Bun.color(color, 'ansi') || Bun.color(color, 'ansi-256') || '';
  return code ? `${code}${text}${ANSI_RESET}` : text;
}

/**
 * FactoryWager theme over Bun.markdown.ansi — TTY columns, NO_COLOR-aware colors,
 * OSC 8 hyperlinks on by default. kittyGraphics stays opt-in.
 *
 * Bun AnsiTheme defaults differ: columns=80, hyperlinks=false, colors=true.
 *
 * @see https://bun.com/docs/runtime/markdown#ansi-terminal-output — Bun.markdown.ansi
 * @see https://bun.com/docs/runtime/markdown#available-overrides — Bun.markdown.react tag overrides
 * @see https://bun.com/blog/bun-v1.3.12 — bun ./file.md (zero-overhead file path)
 */
export type AnsiMarkdownTheme = Bun.markdown.AnsiTheme;

export function ansiMarkdown(
  input: string | NodeJS.TypedArray | DataView<ArrayBuffer> | ArrayBufferLike,
  theme?: AnsiMarkdownTheme
): string {
  return Bun.markdown.ansi(input, {
    columns: theme?.columns ?? termWidth(),
    colors: theme?.colors ?? shouldColor(),
    hyperlinks: theme?.hyperlinks ?? true,
    kittyGraphics: theme?.kittyGraphics ?? false,
    ...(theme?.light !== undefined ? { light: theme.light } : {}),
  });
}

/**
 * Visual width of a string (ANSI-aware, emoji = 2). Thin alias of Bun.stringWidth.
 * Options mirror the Bun API: countAnsiEscapeCodes (default false),
 * ambiguousIsNarrow (default true).
 * @see https://bun.com/docs/runtime/utils#bun-stringwidth
 */
export function widthOf(
  text: string,
  options: { countAnsiEscapeCodes?: boolean; ambiguousIsNarrow?: boolean } = {}
): number {
  return Bun.stringWidth(text, options);
}

/**
 * Pad a string on the right to a visual column width (ANSI/emoji safe).
 * @see https://bun.com/docs/runtime/utils#bun-stringwidth
 */
export function padEndWidth(text: string, width: number, fill = ' '): string {
  const missing = width - Bun.stringWidth(text);
  return missing > 0 ? text + fill.repeat(missing) : text;
}

/**
 * Truncate to a visual column width without breaking ANSI codes or graphemes.
 * @see https://bun.com/reference/bun/sliceAnsi — Bun.sliceAnsi semantics
 */
export function truncateWidth(text: string, width: number): string {
  return Bun.stringWidth(text) <= width ? text : Bun.sliceAnsi(text, 0, width);
}

/**
 * Wrap text to a column width, ANSI- and grapheme-safe: Bun.wrapAnsi
 * closes and re-opens styles per row so every line renders standalone —
 * doing this by hand is error-prone, so always prefer it over manual
 * slicing for multi-line layout. Defaults match Bun (word boundaries, trim).
 * @see https://bun.com/docs/runtime/utils#bun-wrapansi
 */
export function wrapText(
  text: string,
  columns: number,
  options: { hard?: boolean; wordWrap?: boolean; trim?: boolean; ambiguousIsNarrow?: boolean } = {}
): string {
  return Bun.wrapAnsi(text, columns, options);
}

/**
 * CLI args to forward the effective depth to a child `bun` process.
 * @see https://bun.com/docs/runtime/console — `--console-depth` flag
 */
export function depthArgs(): string[] {
  return [`--console-depth=${getConsoleDepth()}`];
}

/**
 * Env overlay to forward the effective depth to a child process.
 * @see https://bun.com/docs/runtime/console
 */
export function withConsoleDepth<T extends Record<string, string | undefined>>(
  env: T
): T & { BUN_CONSOLE_DEPTH: string } {
  return { ...env, BUN_CONSOLE_DEPTH: String(getConsoleDepth()) };
}
