// @see https://bun.com/docs/runtime/html-rewriter
/**
 * Extract the ratings table from a Massey HTML document using Bun HTMLRewriter.
 *
 * Native-fetch fast path: when Cloudflare is not challenging, the ratings page
 * is plain HTML and this extractor avoids spinning up a WebView. HTMLRewriter is
 * a Bun-native streaming API (no DOM, no third-party parser).
 */

export type ExtractedTable = {
  headers: string[];
  rows: string[][];
};

type CellAcc = { text: string };
type RowAcc = { cells: CellAcc[]; isHeader: boolean };
type TableAcc = { rows: RowAcc[] };

/** Minimal entity decode for cell text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&#39;/g, String.fromCharCode(39))
    .replace(/&nbsp;/g, " ");
}

/**
 * Parse the largest table in the document (the ratings table).
 * Returns null when no usable table is found.
 */
export async function extractRatingsTableFromHtml(html: string): Promise<ExtractedTable | null> {
  const tables: TableAcc[] = [];
  const tableStack: TableAcc[] = [];
  let curTable: TableAcc | null = null;
  let curRow: RowAcc | null = null;
  let curCell: CellAcc | null = null;

  await new HTMLRewriter()
    .on("table", {
      element(el) {
        const frame: TableAcc = { rows: [] };
        tables.push(frame);
        tableStack.push(frame);
        curTable = frame;
        curRow = null;
        curCell = null;
        el.onEndTag(() => {
          tableStack.pop();
          curTable = tableStack[tableStack.length - 1] ?? null;
          curRow = null;
          curCell = null;
        });
      },
    })
    .on("tr", {
      element(el) {
        if (!curTable) return;
        const row: RowAcc = { cells: [], isHeader: false };
        curTable.rows.push(row);
        curRow = row;
        curCell = null;
        el.onEndTag(() => {
          curRow = null;
          curCell = null;
        });
      },
    })
    .on("th", {
      element(el) {
        if (!curRow) return;
        curRow.isHeader = true;
        curCell = { text: "" };
        curRow.cells.push(curCell);
        el.onEndTag(() => { curCell = null; });
      },
      text(chunk) {
        if (curCell) curCell.text += chunk.text;
      },
    })
    .on("td", {
      element(el) {
        if (!curRow) return;
        curCell = { text: "" };
        curRow.cells.push(curCell);
        el.onEndTag(() => { curCell = null; });
      },
      text(chunk) {
        if (curCell) curCell.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();

  // Pick the table with the most rows; require a header row.
  let best: TableAcc | null = null;
  for (const t of tables) {
    if (t.rows.length > 2 && (!best || t.rows.length > best.rows.length)) best = t;
  }
  if (!best) return null;

  const headerRow = best.rows.find((r) => r.isHeader) ?? best.rows[0];
  const headers = (headerRow?.cells ?? []).map((c) => decodeEntities(c.text.trim()));
  const rows: string[][] = [];
  for (const r of best.rows) {
    if (r === headerRow || r.isHeader) continue;
    rows.push(r.cells.map((c) => decodeEntities(c.text.trim())));
  }
  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}
