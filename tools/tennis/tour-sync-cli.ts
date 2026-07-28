#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import {
  TOUR_SERIES_TICKERS,
} from "../../src/alpha/ticker-formats/tour.ts";
import {
  syncTennisEvents,
  DEFAULT_ITF_RETAIN_DAYS,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import { bridgeStadionToKalshi } from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";

export async function runTourSyncCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      sync: { type: "boolean", default: false },
      "retain-days": { type: "string" },
      db: { type: "string" },
      bridge: { type: "boolean", default: true },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (!values.sync) {
    console.log("Tour sync CLI — ATP/WTA/Challenger markets from Kalshi");
    console.log("");
    console.log("Usage: bun run tennis:tour -- --sync [--retain-days=3] [--bridge]");
    console.log("");
    console.log("Series synced:");
    for (const s of TOUR_SERIES_TICKERS) {
      console.log(`  ${s}`);
    }
    return 0;
  }

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const retainDays =
    typeof values["retain-days"] === "string" && Number.isFinite(Number(values["retain-days"]))
      ? Number(values["retain-days"])
      : DEFAULT_ITF_RETAIN_DAYS;

  const summary = await syncTennisEvents(db, {
    series: TOUR_SERIES_TICKERS,
    retainDays,
  });

  const bridge = values.bridge !== false ? bridgeStadionToKalshi(db) : null;

  if (!values.json) {
    const by = summary.marketsSeenByStatus;
    console.log(
      `Synced Tour: ${summary.eventsUpserted} events, ${summary.marketsUpserted} markets` +
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
  } else {
    console.log(JSON.stringify({ summary, bridge }, null, 2));
  }

  return 0;
}

if (import.meta.main) {
  process.exit(await runTourSyncCli(process.argv.slice(2)));
}
