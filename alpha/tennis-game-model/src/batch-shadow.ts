/**
 * Batch shadow runner: process ALL ITF tickers with non-empty book_ticks in event-store.
 * Shadow lines are predictions — outcomes are filled in later by the calibration watcher.
 *
 * Usage (from program root):
 *   bun src/batch-shadow.ts
 *   bun src/batch-shadow.ts --dry-run
 *   bun src/batch-shadow.ts --db=/path/to/event-store.db
 *   bun src/batch-shadow.ts --from=2025-01-01 --to=2025-03-01
 */
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { executeOnce } from "./execute.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function argFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

export type BatchShadowOptions = {
  dbPath?: string | undefined;
  dryRun?: boolean;
  fromDate?: string | undefined; // YYYY-MM-DD
  toDate?: string | undefined;   // YYYY-MM-DD
};

export type BatchShadowSummary = {
  found: number;
  processed: number;
  skipped: number;
  /** Approximate: executeOnce completes without throwing (appendShadowLine is
   *  called inside executeOnce for every non-null signal context). */
  shadowAppended: number;
};

function buildQuery(options: { fromDate?: string | undefined; toDate?: string | undefined }): {
  sql: string;
  params: Record<string, string>;
} {
  const dateConditions: string[] = [];
  const params: Record<string, string> = {};

  if (options.fromDate) {
    dateConditions.push("e.start_ts >= $from");
    params.$from = `${options.fromDate}T00:00:00.000Z`;
  }
  if (options.toDate) {
    dateConditions.push("e.start_ts < $to");
    params.$to = `${options.toDate}T00:00:00.000Z`;
  }

  const whereClause = dateConditions.length
    ? `AND ${dateConditions.join(" AND ")}`
    : "";

  const sql = `
    SELECT DISTINCT bt.event_id AS event_id, bt.ticker AS ticker
    FROM book_ticks bt
    JOIN events e ON e.event_id = bt.event_id
    WHERE bt.ticker LIKE 'KXITF%'
      AND bt.levels_json LIKE '%priceCents%'
      ${whereClause}
    ORDER BY bt.event_id, bt.ticker
  `;

  return { sql, params };
}

export async function runBatchShadow(
  options: BatchShadowOptions = {},
): Promise<BatchShadowSummary> {
  const db = openEventStore({
    dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB,
    readonly: true,
  });

  const { sql, params } = buildQuery({
    fromDate: options.fromDate,
    toDate: options.toDate,
  });

  const rows = db.query(sql).all(params) as Array<{
    event_id: string;
    ticker: string;
  }>;

  console.log(`Found ${rows.length} ITF ticker(s) with non-empty book_ticks`);

  if (options.dryRun) {
    for (const row of rows) {
      console.log(`  ${row.event_id}  ${row.ticker}`);
    }
    return { found: rows.length, processed: 0, skipped: 0, shadowAppended: 0 };
  }

  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await executeOnce({
        ticker: row.ticker,
        eventId: row.event_id,
        ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
        batchMode: true,
      });
      processed++;
    } catch (err) {
      skipped++;
      console.error(`Skip ${row.ticker} (${row.event_id}): ${err}`);
    }
  }

  return {
    found: rows.length,
    processed,
    skipped,
    shadowAppended: processed,
  };
}

if (import.meta.main) {
  const dbPath = arg("db");
  const dryRun = argFlag("dry-run");
  const fromDate = arg("from");
  const toDate = arg("to");

  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    console.error("--from must be YYYY-MM-DD");
    process.exit(1);
  }
  if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    console.error("--to must be YYYY-MM-DD");
    process.exit(1);
  }

  const summary = await runBatchShadow({ dbPath, dryRun, fromDate, toDate });

  console.log("\n=== Batch shadow summary ===");
  console.log(`Found:    ${summary.found}`);
  if (!dryRun) {
    console.log(`Processed: ${summary.processed}`);
    console.log(`Skipped:   ${summary.skipped}`);
    console.log(`Shadow lines appended: ${summary.shadowAppended}`);
  }
}
