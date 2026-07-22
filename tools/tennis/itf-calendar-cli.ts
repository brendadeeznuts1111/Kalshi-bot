#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { isItfSeriesTicker } from "../../src/alpha/ticker-formats/itf.ts";
import {
  formatItfCalendarByDate,
  formatItfCalendarTable,
  formatItfEventDetail,
  formatItfStats,
} from "../../src/institutions/event-store/itf-calendar-format.ts";
import type { ItfCalendarSort } from "../../src/institutions/event-store/itf-calendar.ts";
import {
  buildItfCalendarRows,
  DEFAULT_ITF_RETAIN_DAYS,
  enrichItfCalendarDepth,
  fetchItfCalendarRow,
  fetchOpenItfMarkets,
  filterItfCalendarRows,
  summarizeItfCalendar,
  syncItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import { bridgeStadionToKalshi } from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";
import { asKalshiEventTicker } from "../../src/institutions/event-store/brands.ts";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseSort(raw: unknown): ItfCalendarSort {
  if (raw === "time" || raw === "volume" || raw === "flow" || raw === "tradable") return raw;
  return "tradable";
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
      "min-volume-24h": { type: "string" },
      sort: { type: "string" },
      limit: { type: "string" },
      event: { type: "string" },
      depth: { type: "boolean", default: false },
      "group-by-date": { type: "boolean", default: false },
      /** After --sync, refresh Stadion↔Kalshi event_links (default true). */
      bridge: { type: "boolean", default: true },
      /** Closed/settled lookback days for --sync (default 3; 0 = open-only). */
      "retain-days": { type: "string" },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (typeof values.event === "string") {
    const eventTicker = asKalshiEventTicker(values.event);
    let row = await fetchItfCalendarRow(eventTicker);
    if (!row) {
      console.error(`Event not found in open ITF markets: ${values.event}`);
      return 1;
    }
    if (values.depth) {
      const enriched = await enrichItfCalendarDepth([row]);
      row = enriched.rows[0]!;
    }
    console.log(values.json ? JSON.stringify(row, null, 2) : formatItfEventDetail(row));
    return 0;
  }

  const dateFilter =
    values.today ? todayIso() : typeof values.date === "string" ? values.date : undefined;
  const seriesFilter =
    typeof values.series === "string" && isItfSeriesTicker(values.series) ? values.series : undefined;
  const minVolume = values["min-volume"] ? Number(values["min-volume"]) : undefined;
  const minVolume24h = values["min-volume-24h"] ? Number(values["min-volume-24h"]) : undefined;
  const sort = parseSort(values.sort);
  const limit = values.limit ? Number(values.limit) : 40;

  if (values.sync) {
    await ensureEventStoreDir();
    const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
    const db = openEventStore({ dbPath });
    const retainDays =
      typeof values["retain-days"] === "string" && Number.isFinite(Number(values["retain-days"]))
        ? Number(values["retain-days"])
        : DEFAULT_ITF_RETAIN_DAYS;
    const summary = await syncItfEvents(db, { retainDays });
    const bridge = values.bridge !== false ? bridgeStadionToKalshi(db) : null;
    if (!values.json) {
      const by = summary.marketsSeenByStatus;
      console.log(
        `Synced ITF: ${summary.eventsUpserted} events, ${summary.marketsUpserted} markets` +
          ` (${summary.marketsSeen} legs: open=${by.open} closed=${by.closed} settled=${by.settled}; retainDays=${summary.retainDays})`,
      );
      if (summary.eventsSkipped) {
        console.log(`Skipped ${summary.eventsSkipped} ambiguous blob events (hard-fail)`);
      }
      for (const a of summary.anomalies.slice(0, 12)) {
        console.log(`  anomaly: ${a}`);
      }
      if (summary.anomalies.length > 12) {
        console.log(`  … ${summary.anomalies.length - 12} more`);
      }
      if (bridge) {
        console.log(
          `Bridge: linked=${bridge.linked} unmatched=${bridge.unmatched}` +
            ` ambiguous=${bridge.ambiguous} resolutions+=${bridge.resolutionsPropagated}`,
        );
      }
      console.log("");
    }
  }

  const markets = await fetchOpenItfMarkets();
  const allRows = buildItfCalendarRows(markets);
  const stats = summarizeItfCalendar(allRows, markets.length);
  let rows = filterItfCalendarRows(allRows, {
    date: dateFilter,
    series: seriesFilter,
    minVolume: Number.isFinite(minVolume) ? minVolume : undefined,
    minVolume24h: Number.isFinite(minVolume24h) ? minVolume24h : undefined,
    sort,
    limit: Number.isFinite(limit) ? limit : 40,
  });

  if (values.depth) {
    const enriched = await enrichItfCalendarDepth(rows);
    rows = enriched.rows;
    if (!values.json) {
      console.log(`Depth: top-3 levels for ${enriched.polled} legs (${enriched.errors} errors)\n`);
    }
  }

  if (values.json) {
    console.log(JSON.stringify({ stats, rows, sort }, null, 2));
    return 0;
  }

  console.log("Kalshi ITF calendar — https://kalshi.com/calendar/sports/tennis/itf\n");
  console.log(formatItfStats(stats));
  console.log(`Sort: ${sort} (mid-band 30–70¢ / underdog first; deep favorites deprioritized)\n`);
  if (values["group-by-date"]) {
    console.log(formatItfCalendarByDate(rows));
  } else {
    console.log(formatItfCalendarTable(rows));
  }
  console.log(
    "\nFilters: --date=YYYY-MM-DD  --today  --series=KXITFDOUBLES  --sort=tradable|flow|volume|time",
  );
  console.log("         --min-volume-24h=100  --depth  --min-volume=1000");
  console.log("Detail:  bun run tennis:itf -- --event=KXITFDOUBLES-26JUL21DONMARDELHOY --depth");
  console.log("Sync:    bun run tennis:itf -- --sync [--retain-days=3]");
  return 0;
}

if (import.meta.main) {
  process.exit(await runItfCalendarCli(process.argv.slice(2)));
}
