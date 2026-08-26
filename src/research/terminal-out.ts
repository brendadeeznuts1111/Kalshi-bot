// @see https://bun.com/docs/runtime/utils#bun-stringwidth
// @see https://bun.com/docs/runtime/utils#bun-wrapansi
// @see https://bun.com/docs/runtime/utils#bun-stripansi
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
import {
  formatInspectTableFromRows,
  type TableFieldSpec,
} from "../lib/table-schema.ts";
import { githubRepoWebUrl } from "./patterns.ts";
import { COLORS } from "../lib/color/palette.ts";

/** Native Bun terminal output — TTY-gated tables and OSC 8 links. */

const DEFAULT_TTY_COLUMNS = 80;

export function isTtyStdout(): boolean {
  return Boolean(process.stdout.isTTY);
}

/** Terminal width for wrapping; falls back when stdout is not a TTY. */
export function ttyColumns(fallback = DEFAULT_TTY_COLUMNS): number {
  const cols = process.stdout.columns;
  return typeof cols === "number" && cols > 0 ? cols : fallback;
}


/**
 * Wrap text to the TTY width. Preserves ANSI + OSC 8 hyperlinks.
 * No-op wrap when `columns` is huge (non-TTY / piped).
 */
export function wrapDisplay(
  input: string,
  columns: number = ttyColumns(),
  options?: Parameters<typeof Bun.wrapAnsi>[2],
): string {
  if (!input || columns < 2) return input;
  return Bun.wrapAnsi(input, columns, {
    hard: false,
    wordWrap: true,
    trim: false,
    ...options,
  });
}

/** Pad/truncate by visible columns (`Bun.stringWidth`), not UTF-16 length. */
export function padDisplay(str: string, width: number, align: "left" | "right" = "left"): string {
  const visible = Bun.stringWidth(str);
  if (visible === width) return str;
  if (visible > width) {
    if (width <= 1) return Bun.stripANSI(str).slice(0, Math.max(0, width));
    // Native width-aware truncation: preserves ANSI + OSC 8, ellipsis inside styles.
    return Bun.sliceAnsi(str, 0, width, { ellipsis: "…" });
  }
  const pad = " ".repeat(width - visible);
  return align === "right" ? pad + str : str + pad;
}

/** OSC 8 terminal hyperlink — Bun.stringWidth counts visible text only. */
export function terminalLink(text: string, url: string): string {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

/**
 * Status row with defaulted, separated columns (audit/report tooling).
 * Bun has no row formatter - this is additive, built on the native
 * primitives above. Color-agnostic: pass a PRE-PAINTED mark (e.g.
 * Bun.color('green','ansi') + text + reset); Bun.stringWidth ignores
 * the ANSI when measuring, so colored marks align by VISIBLE width
 * (pitfalls 31).
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
  const padded = padDisplay(mark, markWidth);
  const pad = " ".repeat(indent) + padded + " ".repeat(sep);
  return detail === undefined || detail.length === 0 ? pad + label : pad + label + ": " + detail;
}

/**
 * Brand-colored status mark, composed from Bun's utils (pitfalls 32):
 * Bun.color(key, 'ansi') auto-detects TTY ('' when disabled/non-TTY, so
 * the mark falls back to plain text) and Bun.stringWidth ignores the
 * ANSI so statusLine columns still align. Colors come from the brand
 * palette (src/lib/color/palette.ts) - NOT ad-hoc green/red.
 */
export function brandMark(mark: string, colorKey: "ok" | "warn" | "bad"): string {
  // Brand palette SSOT: tennis green / middleware yellow / trading red.
  const hex = { ok: COLORS.tennis, warn: COLORS.middleware, bad: COLORS.trading }[colorKey];
  const open = Bun.color(hex, "ansi") ?? "";
  return open ? open + mark + "\u001b[0m" : mark;
}

export type BrandSemantic = "pass" | "fail" | "warn" | "info";

/**
 * A cell that renders as a brand-colored token inside Bun.inspect.table
 * (and Bun.inspect). Verified API composition (pitfalls 32-33):
 *  - [Bun.inspect.custom] symbol renders the cell custom in tables
 *    (probe: [[OK]] in a table cell);
 *  - opts.stylize(_, 'string') gives STANDARD token coloring respecting
 *    the colors toggle (colors:true -> green token, false/undefined ->
 *    plain; verified);
 *  - brand semantics use Bun.color(key,'ansi') directly (stylize can't
 *    express custom semantics; Bun.color returns a STRING, not fn).
 * CORRECTED vs the pasted factory: Bun.term undefined, bgGreen null,
 * Bun.color is not callable, stripANSI (all-caps), opts only carries
 * {stylize, depth, colors} in the custom handler.
 */
export type BrandCell = {
  raw: string;
  semantic: BrandSemantic;
  meta?: Record<string, unknown> | undefined;
  [Bun.inspect.custom]: (depth: number, opts: Bun.BunInspectOptions, inspect: typeof Bun.inspect) => string;
};

export function brandCell(
  raw: string,
  semantic: BrandSemantic,
  meta?: Record<string, unknown>,
): BrandCell {
  const hex = {
    pass: COLORS.tennis,
    fail: COLORS.trading,
    warn: COLORS.middleware,
    info: COLORS.research,
  }[semantic];
  const styled = (s: string): string => {
    const open = Bun.color(hex, "ansi") ?? "";
    return open ? open + s + "\u001b[0m" : s;
  };
  return {
    raw,
    semantic,
    meta,
    [Bun.inspect.custom](depth, opts, inspect) {
      if (!opts.colors) return this.raw;
      const colored = styled(this.raw);
      if (depth === 0) return "[" + this.semantic + " " + this.raw + "...]";
      if (this.meta) {
        // opts is BunInspectOptions (typed) - spreading it into the nested
        // inspect call carries colors/depth/sorted through fully typed.
        const extra = inspect(this.meta, { ...opts, depth: depth - 1 });
        return colored + " " + Bun.stripANSI(extra);
      }
      return colored;
    },
  };
}

export function repoTerminalLink(fullName: string, hyperlinks = isTtyStdout()): string {
  if (!hyperlinks) return fullName;
  const slash = fullName.indexOf("/");
  if (slash <= 0) return fullName;
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);
  if (!repo) return fullName;
  try {
    return terminalLink(fullName, githubRepoWebUrl(owner, repo));
  } catch {
    return fullName;
  }
}

/** Research shortlist column schema (desk TTY). */
export const SHORTLIST_FIELD_SCHEMA = [
  { key: "#", type: "number", description: "Rank (1-based)", group: "meta", align: "right" },
  { key: "repo", type: "string", description: "owner/name (OSC 8 link in TTY)", group: "repo" },
  { key: "score", type: "number", description: "Total score", group: "score", align: "right" },
  { key: "auth", type: "number", description: "Auth/API component", group: "score", align: "right" },
  { key: "orders", type: "number", description: "Order realism component", group: "score", align: "right" },
  { key: "tests", type: "number", description: "Tests/CI component", group: "score", align: "right" },
  { key: "risk", type: "number", description: "Risk controls component", group: "score", align: "right" },
  { key: "license", type: "string", description: "ok | UNLICENSED", group: "meta" },
] as const satisfies readonly TableFieldSpec[];

export const SHORTLIST_DEFAULT_COLUMNS = [
  "#",
  "repo",
  "score",
  "auth",
  "orders",
  "tests",
  "risk",
  "license",
] as const;

export const SHORTLIST_COMPACT_COLUMNS = ["#", "repo", "score", "badge", "license"] as const;

export function formatInspectTable(
  rows: Record<string, unknown>[],
  columns: string[],
  options?: { colors?: boolean },
): string {
  if (!rows.length) return "";
  return formatInspectTableFromRows(rows, columns, {
    colors: options?.colors ?? isTtyStdout(),
  });
}

export function printInspectTable(
  rows: Record<string, unknown>[],
  columns: string[],
  stream: { write: (chunk: string) => boolean | void } = process.stdout,
  options?: { colors?: boolean },
): void {
  const table = formatInspectTable(rows, columns, options);
  if (table) stream.write(table);
}

export type ShortlistRowInput = {
  repo: { fullName: string; license: { unlicensed: boolean } };
  score: {
    total: number;
    authApi: number;
    orderRealism: number;
    testsCi?: number;
    riskControls?: number;
  };
};

export function shortlistTableRows(
  items: ShortlistRowInput[],
  options?: { hyperlinks?: boolean },
): Array<Record<string, string | number>> {
  const links = options?.hyperlinks !== false && isTtyStdout();
  return items.map((s, i) => ({
    "#": i + 1,
    repo: repoTerminalLink(s.repo.fullName, links),
    score: s.score.total,
    auth: s.score.authApi,
    orders: s.score.orderRealism,
    tests: s.score.testsCi ?? 0,
    risk: s.score.riskControls ?? 0,
    license: s.repo.license.unlicensed ? "UNLICENSED" : "ok",
  }));
}

export type LiftTableRow = {
  component: string;
  repo: string;
  score: string;
  badge: string;
};

export function liftTableRows(
  rows: LiftTableRow[],
  options?: { hyperlinks?: boolean },
): LiftTableRow[] {
  const links = options?.hyperlinks !== false && isTtyStdout();
  if (!links) return rows;
  return rows.map((row) =>
    row.repo && row.repo !== "—"
      ? { ...row, repo: repoTerminalLink(row.repo, true) }
      : row,
  );
}

export type ShortlistSummaryRow = {
  fullName: string;
  total: number;
  badge: string;
  license: string;
};

export function shortlistSummaryTableRows(
  items: ShortlistSummaryRow[],
  options?: { hyperlinks?: boolean },
): Array<Record<string, string | number>> {
  const links = options?.hyperlinks !== false && isTtyStdout();
  return items.map((s, i) => ({
    "#": i + 1,
    repo: repoTerminalLink(s.fullName, links),
    score: s.total,
    badge: s.badge,
    license: s.license,
  }));
}
