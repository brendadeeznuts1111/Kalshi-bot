#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import {
  fetchOpenItfMarkets,
  recordKalshiBookTicks,
  recordTopItfEvents,
  syncAndRecordOpenItfBooks,
  syncOpenItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { formatVolumeFp } from "../../src/institutions/event-store/itf-calendar-format.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";

export async function runTennisRecordCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      once: { type: "boolean", default: true },
      ticker: { type: "string" },
      event: { type: "string" },
      top: { type: "string" },
      "min-volume": { type: "string" },
      sync: { type: "boolean", default: false },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const minVolume = values["min-volume"] ? Number(values["min-volume"]) : undefined;

  const runOnce = async () => {
    if (typeof values.ticker === "string") {
      const record = await recordKalshiBookTicks(db, [values.ticker], {
        syncFirst: values.sync === true,
      });
      return { sync: null, rows: null, record };
    }
    if (typeof values.event === "string") {
      if (values.sync) await syncOpenItfEvents(db, { eventTickers: [values.event] });
      const markets = await fetchOpenItfMarkets();
      const tickers = markets.filter((m) => m.event_ticker === values.event).map((m) => m.ticker);
      const record = await recordKalshiBookTicks(db, tickers, { syncFirst: !values.sync });
      return { sync: null, rows: null, record };
    }
    if (values.top) {
      const topN = Number(values.top) || 10;
      return recordTopItfEvents(db, {
        top: topN,
        minVolume: Number.isFinite(minVolume) ? minVolume : undefined,
        syncFirst: true,
      });
    }
    const minVol = Number.isFinite(minVolume) ? minVolume : undefined;
    if (values.sync) {
      const sync = await syncOpenItfEvents(db);
      const markets = await fetchOpenItfMarkets();
      const tickers = markets.map((m) => m.ticker);
      const record = await recordKalshiBookTicks(db, tickers);
      return { sync, rows: null, record };
    }
    return syncAndRecordOpenItfBooks(db, { minVolume: minVol });
  };

  const emit = (payload: Awaited<ReturnType<typeof runOnce>>) => {
    if (values.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if ("sync" in payload && payload.sync) {
      console.log(
        `Sync: ${payload.sync.eventsUpserted} events, ${payload.sync.marketsUpserted} market rows`,
      );
    }
    if ("rows" in payload && payload.rows?.length) {
      console.log(`Top ${payload.rows.length} by volume:`);
      for (const row of payload.rows) {
        console.log(`  $${formatVolumeFp(row.totalVolumeFp).padStart(6)}  ${row.matchup.slice(0, 50)}`);
      }
    }
    const { record } = payload;
    console.log(
      `Record: ${record.ticksRecorded}/${record.marketsPolled} ticks · ${record.eventCount} events · ${record.errors} errors`,
    );
  };

  if (values.once !== false) {
    emit(await runOnce());
    return 0;
  }

  const intervalMs = Number(Bun.env.TENNIS_RECORD_INTERVAL_MS ?? 30_000);
  console.log(`ITF recorder — every ${intervalMs / 1000}s (Ctrl+C to stop)`);
  for (;;) {
    emit(await runOnce());
    await Bun.sleep(intervalMs);
  }
}

if (import.meta.main) {
  process.exit(await runTennisRecordCli(process.argv.slice(2)));
}
