#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { ITF_SERIES_TICKERS, isItfSeriesTicker } from "../../src/alpha/ticker-formats/itf.ts";
import {
  formatItfCalendarByDate,
  formatItfCalendarTable,
  formatItfEventDetail,
  formatItfStats,
} from "../../src/institutions/event-store/itf-calendar-format.ts";
import {
  buildItfCalendarRows,
  fetchItfCalendarRow,
  fetchOpenItfMarkets,
  filterItfCalendarRows,
  summarizeItfCalendar,
  syncOpenItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runItfCalendarCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      sync: { type: "boolean", default: false },
      date: { type: "string" },
      today: { type: "boolean", default: false },
      series: { type: "string" },
      "min-volume": { type: "string" },
      sort: { type: "string" },
      limit: { type: "string" },
      event: { type: "string" },
      "group-by-date": { type: "boolean", default: false },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (typeof values.event === "string") {
    const row = await fetchItfCalendarRow(values.event);
    if (!row) {
      console.error(`Event not found in open ITF markets: ${values.event}`);
      return 1;
    }
    console.log(values.json ? JSON.stringify(row, null, 2) : formatItfEventDetail(row));
    return 0;
  }

  const dateFilter =
    values.today ? todayIso() : typeof values.date === "string" ? values.date : undefined;
  const seriesFilter =
    typeof values.series === "string" && isItfSeriesTicker(values.series) ? values.series : undefined;
  const minVolume = values["min-volume"] ? Number(values["min-volume"]) : undefined;
  const sort = values.sort === "volume" ? "volume" : "time";
  const limit = values.limit ? Number(values.limit) : 40;

  if (values.sync) {
    await ensureEventStoreDir();
    const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
    const db = openEventStore({ dbPath });
    const summary = await syncOpenItfEvents(db);
    if (!values.json) {
      console.log(
        `Synced ITF: ${summary.eventsUpserted} events, ${summary.marketsUpserted} markets (${summary.marketsSeen} open legs)\n`,
      );
    }
  }

  const markets = await fetchOpenItfMarkets();
  const allRows = buildItfCalendarRows(markets);
  const stats = summarizeItfCalendar(allRows, markets.length);
  const rows = filterItfCalendarRows(allRows, {
    date: dateFilter,
    series: seriesFilter,
    minVolume: Number.isFinite(minVolume) ? minVolume : undefined,
    sort,
    limit: Number.isFinite(limit) ? limit : 40,
  });

  if (values.json) {
    console.log(JSON.stringify({ stats, rows }, null, 2));
    return 0;
  }

  console.log("Kalshi ITF calendar — https://kalshi.com/calendar/sports/tennis/itf\n");
  console.log(formatItfStats(stats));
  console.log("");
  if (values["group-by-date"]) {
    console.log(formatItfCalendarByDate(rows));
  } else {
    console.log(formatItfCalendarTable(rows));
  }
  console.log("\nFilters: --date=YYYY-MM-DD  --today  --series=KXITFDOUBLES  --sort=volume  --min-volume=1000");
  console.log("Detail:  bun run tennis:itf -- --event=KXITFDOUBLES-26JUL21DONMARDELHOY");
  console.log("Sync:    bun run tennis:itf -- --sync");
  return 0;
}

if (import.meta.main) {
  process.exit(await runItfCalendarCli(process.argv.slice(2)));
}
