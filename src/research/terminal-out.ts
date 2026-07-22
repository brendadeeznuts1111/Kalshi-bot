// @see https://bun.com/docs/runtime/utils#bun-stringwidth
// @see https://bun.com/docs/runtime/utils#bun-wrapansi
// @see https://bun.com/docs/runtime/utils#bun-stripansi
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
import { githubRepoWebUrl } from "./patterns.ts";

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

/** Strip colors / OSC sequences for plain logs and width-safe truncation. */
export function plainDisplay(str: string): string {
  return Bun.stripANSI(str);
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
    if (width <= 1) return plainDisplay(str).slice(0, Math.max(0, width));
    // Truncate the plain visible text so we never split mid-ANSI sequence.
    const plain = plainDisplay(str);
    let out = "";
    let w = 0;
    for (const ch of plain) {
      const cw = Bun.stringWidth(ch);
      if (w + cw > width - 1) break;
      out += ch;
      w += cw;
    }
    return `${out}…`;
  }
  const pad = " ".repeat(width - visible);
  return align === "right" ? pad + str : str + pad;
}

/** OSC 8 terminal hyperlink — Bun.stringWidth counts visible text only. */
export function terminalLink(text: string, url: string): string {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
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

export function formatInspectTable(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  if (!rows.length) return "";
  const table = Bun.inspect.table(rows, columns, { colors: isTtyStdout() });
  return table.endsWith("\n") ? table : `${table}\n`;
}

export function printInspectTable(
  rows: Record<string, unknown>[],
  columns: string[],
  stream: { write: (chunk: string) => boolean | void } = process.stdout,
): void {
  const table = formatInspectTable(rows, columns);
  if (table) stream.write(table);
}

export type ShortlistRowInput = {
  repo: { fullName: string; license: { unlicensed: boolean } };
  score: { total: number; authApi: number; orderRealism: number };
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
