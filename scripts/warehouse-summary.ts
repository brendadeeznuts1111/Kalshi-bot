#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/utils#bun-main
// @see https://bun.com/docs/runtime/sqlite
/**
 * Tennis event-store warehouse summary — one-liner CLI / bunx binary.
 *
 *   bunx tennis-warehouse
 *   bunx tennis-warehouse --db ./custom.db
 *   bunx tennis-warehouse --format json
 *   bunx tennis-warehouse --format csv
 *   bun run warehouse:summary
 *
 * Default DB: research/cache/event-store.db (DEFAULT_EVENT_STORE_DB).
 */
import { parseArgs } from "node:util";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  countEvents,
  countOddsTicks,
  formatEventStoreSummary,
  summarizeEventsByTourSurfaceYear,
} from "../src/institutions/event-store/summary.ts";
import type { EventStoreSummaryRow } from "../src/institutions/event-store/types.ts";

export type WarehouseFormat = "table" | "json" | "csv";

export type WarehouseSummaryOptions = {
  dbPath?: string | undefined;
  format?: WarehouseFormat;
  help?: boolean;
};

export function parseWarehouseSummaryArgv(argv: string[]): WarehouseSummaryOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      format: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      h: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  let format: WarehouseFormat = "table";
  if (values.json === true) format = "json";
  if (typeof values.format === "string") {
    const f = values.format.toLowerCase();
    if (f === "json" || f === "csv" || f === "table") format = f;
  }

  return {
    dbPath: typeof values.db === "string" ? values.db : undefined,
    format,
    help: values.help === true || values.h === true,
  };
}

export function formatSummaryCsv(rows: EventStoreSummaryRow[]): string {
  const lines = ["tour,surface,year,count"];
  for (const row of rows) {
    lines.push(
      [row.tour, row.surface, row.year, String(row.count)]
        .map((c) => (c.includes(",") || c.includes('"') ? `"${c.replaceAll('"', '""')}"` : c))
        .join(","),
    );
  }
  return lines.join("\n");
}

export function printWarehouseHelp(): void {
  console.log(`tennis-warehouse — tennis event-store warehouse summary

Usage:
  bunx tennis-warehouse [options]
  bun run warehouse:summary -- [options]

Options:
  --db <path>          Event-store SQLite path (default: research/cache/event-store.db)
  --format table|json|csv   Output format (default: table)
  --json               Alias for --format json
  -h, --help           Show this help

Examples:
  bunx tennis-warehouse
  bunx tennis-warehouse --db ./research/cache/event-store.db
  bunx tennis-warehouse --format json
  bunx tennis-warehouse --format csv > warehouse.csv
`);
}

export async function runWarehouseSummary(opts: WarehouseSummaryOptions): Promise<number> {
  if (opts.help) {
    printWarehouseHelp();
    return 0;
  }

  await ensureEventStoreDir();
  const dbPath = opts.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const format = opts.format ?? "table";
  const db = openEventStore({ dbPath });

  const summaryRows = summarizeEventsByTourSurfaceYear(db);
  const totals = {
    events: countEvents(db),
    oddsTicks: countOddsTicks(db),
  };

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          kind: "tennis-warehouse-summary",
          dbPath,
          totals,
          byTourSurfaceYear: summaryRows,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (format === "csv") {
    console.log(formatSummaryCsv(summaryRows));
    return 0;
  }

  console.log(`Tennis warehouse: ${dbPath}`);
  console.log(`Totals: ${totals.events} events, ${totals.oddsTicks} odds ticks`);
  console.log("");
  console.log(formatEventStoreSummary(summaryRows));
  return 0;
}

if (import.meta.main) {
  const code = await runWarehouseSummary(parseWarehouseSummaryArgv(Bun.argv.slice(2)));
  process.exit(code);
}
