#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/utils#bun-main
import { parseArgs } from "node:util";
import { ingestTennisHistoryFiles } from "../../src/institutions/event-store/ingest-tennis-history.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import {
  countEvents,
  countOddsTicks,
  formatEventStoreSummary,
  summarizeEventsByTourSurfaceYear,
} from "../../src/institutions/event-store/summary.ts";

export type TennisEventsCliOptions = {
  ingest?: string[];
  dbPath?: string;
  json?: boolean;
};

export function parseTennisEventsArgv(argv: string[]): TennisEventsCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      ingest: { type: "string", multiple: true },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });
  return {
    ingest: values.ingest?.filter((v): v is string => typeof v === "string"),
    dbPath: typeof values.db === "string" ? values.db : undefined,
    json: values.json === true,
  };
}

export async function runTennisEventsCli(opts: TennisEventsCliOptions): Promise<number> {
  await ensureEventStoreDir();
  const dbPath = opts.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });

  let ingestSummary = null;
  if (opts.ingest?.length) {
    ingestSummary = await ingestTennisHistoryFiles(db, opts.ingest);
  }

  const summaryRows = summarizeEventsByTourSurfaceYear(db);
  const payload = {
    dbPath,
    ingest: ingestSummary,
    totals: {
      events: countEvents(db),
      oddsTicks: countOddsTicks(db),
    },
    byTourSurfaceYear: summaryRows,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Event store: ${dbPath}`);
    if (ingestSummary) {
      console.log(
        `Ingest: +${ingestSummary.eventsInserted} events, ${ingestSummary.eventsSkipped} skipped, +${ingestSummary.oddsInserted} odds ticks`,
      );
    }
    console.log(`Totals: ${payload.totals.events} events, ${payload.totals.oddsTicks} odds ticks`);
    console.log("");
    console.log(formatEventStoreSummary(summaryRows));
  }

  return 0;
}

if (import.meta.main) {
  const code = await runTennisEventsCli(parseTennisEventsArgv(process.argv.slice(2)));
  process.exit(code);
}
