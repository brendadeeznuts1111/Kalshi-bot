#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
/**
 * Record Kalshi book ticks for ITF / tennis ladder markets.
 *
 * Target selection (first match wins):
 *   --ticker / --event  explicit
 *   --top=N             volume sampling override
 *   --all-open          every open ITF book (vanity / bulk; not the default)
 *   --watch             lead-aligned watch-set (explicit; also the default)
 *   --ws                authenticated orderbook WebSocket on watch-set (needs API key)
 *   bare / --loop       defaults to watch-set (not all-open)
 *
 * After any Kalshi sync, refreshes Stadion↔Kalshi event_links (skip with --bridge=false).
 * --dry-run: resolve tickers only; no sync / book writes / bridge.
 */
import { parseArgs } from "node:util";
import {
  DEFAULT_ITF_RETAIN_DAYS,
  fetchOpenItfMarkets,
  recordEventLadder,
  recordKalshiBookTicks,
  recordTopItfEvents,
  syncAndRecordOpenItfBooks,
  syncItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { formatVolumeFp } from "../../src/institutions/event-store/itf-calendar-format.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import { bridgeStadionToKalshi, type BridgeSummary } from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";
import { listRecordTickers } from "../../src/institutions/event-store/watch-set.ts";
import { runKalshiWsWatchRecorder } from "../../src/institutions/event-store/kalshi-ws-recorder.ts";

type RecordOncePayload = {
  dryRun: boolean;
  mode: "ticker" | "event" | "top" | "watch" | "all";
  sync: Awaited<ReturnType<typeof syncItfEvents>> | null;
  bridge: BridgeSummary | null;
  rows: Awaited<ReturnType<typeof recordTopItfEvents>>["rows"] | null;
  watch: { events: number; tickers: number } | null;
  record: Awaited<ReturnType<typeof recordKalshiBookTicks>> | null;
  tickers: string[];
};

export async function runTennisRecordCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      /** Continuous poll loop (default is one-shot). */
      loop: { type: "boolean", default: false },
      ticker: { type: "string" },
      event: { type: "string" },
      /** When set with --event, skip ladder expansion (single series only). */
      "winners-only": { type: "boolean", default: false },
      top: { type: "string" },
      /** Lead-aligned watch-set (same membership as tennis:live). */
      watch: { type: "boolean", default: false },
      /** Bulk: every open ITF market (opt-in; bare CLI defaults to watch-set). */
      "all-open": { type: "boolean", default: false },
      /**
       * Authenticated Kalshi orderbook WebSocket on the watch-set.
       * Requires KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH (or KALSHI_PRIVATE_KEY).
       */
      ws: { type: "boolean", default: false },
      /** Optional WS session length in seconds (0 = until Ctrl+C). */
      "ws-seconds": { type: "string" },
      /** Minutes before start_ts — aligned with tennis:live --lead (default 5). */
      lead: { type: "string" },
      "min-volume": { type: "string" },
      sync: { type: "boolean", default: false },
      /** After Kalshi sync, refresh event_links (default true). */
      bridge: { type: "boolean", default: true },
      /** Closed/settled lookback days for Kalshi sync (default 3; 0 = open-only). */
      "retain-days": { type: "string" },
      /** Resolve targets only — no sync / book_ticks / bridge writes. */
      "dry-run": { type: "boolean", default: false },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const minVolume = values["min-volume"] ? Number(values["min-volume"]) : undefined;
  const leadMinutes = values.lead ? Number(values.lead) : 5;
  const dryRun = values["dry-run"] === true;
  const doBridge = values.bridge !== false && !dryRun;
  const retainDays =
    typeof values["retain-days"] === "string" && Number.isFinite(Number(values["retain-days"]))
      ? Number(values["retain-days"])
      : DEFAULT_ITF_RETAIN_DAYS;

  const explicitTop = typeof values.top === "string";
  const explicitTicker = typeof values.ticker === "string";
  const explicitEvent = typeof values.event === "string";
  const allOpen = values["all-open"] === true;
  /**
   * Default target is lead-aligned watch-set (same as tennis:live).
   * Opt into bulk open books with --all-open; --top/--event/--ticker stay explicit.
   */
  const watchMode =
    !allOpen && !explicitTop && !explicitTicker && !explicitEvent;

  const maybeBridge = (didSync: boolean): BridgeSummary | null => {
    if (!didSync || !doBridge) return null;
    return bridgeStadionToKalshi(db);
  };

  if (values.ws === true) {
    if (values.sync === true && !dryRun) {
      const sync = await syncItfEvents(db, { retainDays });
      const bridge = maybeBridge(true);
      if (!values.json) {
        console.log(
          `Sync: ${sync.eventsUpserted} events · Bridge: linked=${bridge?.linked ?? 0}`,
        );
      }
    }
    const { events, tickers } = listRecordTickers(db, {
      leadMinutes,
      limit: 40,
      clearStale: !dryRun,
    });
    if (dryRun) {
      const payload = {
        dryRun: true,
        mode: "ws-watch" as const,
        watch: { events: events.length, tickers: tickers.length },
        tickers,
        note: "Would subscribe orderbook_delta (needs KALSHI_API_KEY_ID + private key)",
      };
      console.log(values.json ? JSON.stringify(payload, null, 2) : [
        `record (dry-run)  mode=ws-watch  watch_events=${events.length} tickers=${tickers.length}`,
        ...tickers.slice(0, 20).map((t) => `  ${t}`),
        tickers.length > 20 ? `  … ${tickers.length - 20} more` : "",
      ].filter(Boolean).join("\n"));
      return 0;
    }
    const wsSeconds =
      typeof values["ws-seconds"] === "string" && Number.isFinite(Number(values["ws-seconds"]))
        ? Number(values["ws-seconds"])
        : 0;
    const ac = new AbortController();
    const onSig = () => ac.abort();
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);
    if (!values.json) {
      console.log(
        `Tennis WS recorder — watch-set ${events.length} events / ${tickers.length} tickers` +
          (wsSeconds > 0 ? ` · ${wsSeconds}s` : " · Ctrl+C to stop"),
      );
    }
    try {
      const summary = await runKalshiWsWatchRecorder(db, {
        leadMinutes,
        limit: 40,
        durationMs: wsSeconds > 0 ? wsSeconds * 1000 : 0,
        signal: ac.signal,
      });
      if (values.json) {
        console.log(JSON.stringify({ mode: "ws-watch", summary }, null, 2));
      } else {
        console.log(
          `WS: ticks=${summary.ticksRecorded} snapshots=${summary.snapshots} deltas=${summary.deltas}` +
            ` gaps=${summary.seqGaps} errors=${summary.errors} subscribed=${summary.subscribed}`,
        );
      }
    } finally {
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
    }
    return 0;
  }

  const runOnce = async (): Promise<RecordOncePayload> => {
    if (explicitTicker) {
      const ticker = values.ticker as string;
      if (dryRun) {
        return {
          dryRun,
          mode: "ticker",
          sync: null,
          bridge: null,
          rows: null,
          watch: null,
          record: null,
          tickers: [ticker],
        };
      }
      const record = await recordKalshiBookTicks(db, [ticker], {
        syncFirst: values.sync === true,
      });
      const bridge = maybeBridge(values.sync === true);
      return {
        dryRun,
        mode: "ticker",
        sync: null,
        bridge,
        rows: null,
        watch: null,
        record,
        tickers: [ticker],
      };
    }

    if (explicitEvent) {
      const eventTicker = values.event as string;
      if (dryRun) {
        return {
          dryRun,
          mode: "event",
          sync: null,
          bridge: null,
          rows: null,
          watch: null,
          record: null,
          tickers: [eventTicker],
        };
      }
      if (values["winners-only"]) {
        if (values.sync) {
          await syncItfEvents(db, { eventTickers: [eventTicker], retainDays });
        }
        const markets = await fetchOpenItfMarkets();
        const tickers = markets.filter((m) => m.event_ticker === eventTicker).map((m) => m.ticker);
        const record = await recordKalshiBookTicks(db, tickers, { syncFirst: !values.sync });
        return {
          dryRun,
          mode: "event",
          sync: null,
          bridge: maybeBridge(true),
          rows: null,
          watch: null,
          record,
          tickers,
        };
      }
      const record = await recordEventLadder(db, eventTicker, {
        syncFirst: values.sync === true,
      });
      return {
        dryRun,
        mode: "event",
        sync: null,
        bridge: maybeBridge(values.sync === true),
        rows: null,
        watch: null,
        record,
        tickers: [],
      };
    }

    if (explicitTop) {
      const topN = Number(values.top) || 10;
      if (dryRun) {
        return {
          dryRun,
          mode: "top",
          sync: null,
          bridge: null,
          rows: null,
          watch: null,
          record: null,
          tickers: [],
        };
      }
      const result = await recordTopItfEvents(db, {
        top: topN,
        minVolume: Number.isFinite(minVolume) ? minVolume : undefined,
        syncFirst: true,
      });
      return {
        dryRun,
        mode: "top",
        sync: null,
        bridge: maybeBridge(true),
        rows: result.rows,
        watch: null,
        record: result.record,
        tickers: result.rows.flatMap((r) => r.legs.map((l) => l.ticker)),
      };
    }

    if (watchMode) {
      let sync: Awaited<ReturnType<typeof syncItfEvents>> | null = null;
      if (values.sync === true && !dryRun) {
        sync = await syncItfEvents(db, { retainDays });
      }
      const bridge = maybeBridge(sync != null);
      const { events, tickers } = listRecordTickers(db, {
        leadMinutes,
        limit: 40,
        clearStale: !dryRun,
      });
      if (dryRun) {
        return {
          dryRun,
          mode: "watch",
          sync: null,
          bridge: null,
          rows: null,
          watch: { events: events.length, tickers: tickers.length },
          record: {
            ticksRecorded: 0,
            marketsPolled: tickers.length,
            errors: 0,
            eventCount: events.length,
          },
          tickers,
        };
      }
      const record = await recordKalshiBookTicks(db, tickers);
      return {
        dryRun,
        mode: "watch",
        sync,
        bridge,
        rows: null,
        watch: { events: events.length, tickers: tickers.length },
        record,
        tickers,
      };
    }

    const minVol = Number.isFinite(minVolume) ? minVolume : undefined;
    if (dryRun) {
      return {
        dryRun,
        mode: "all",
        sync: null,
        bridge: null,
        rows: null,
        watch: null,
        record: null,
        tickers: [],
      };
    }
    if (values.sync) {
      const sync = await syncItfEvents(db, { retainDays });
      const bridge = maybeBridge(true);
      const markets = await fetchOpenItfMarkets();
      const tickers = markets.map((m) => m.ticker);
      const record = await recordKalshiBookTicks(db, tickers);
      return {
        dryRun,
        mode: "all",
        sync,
        bridge,
        rows: null,
        watch: null,
        record,
        tickers,
      };
    }
    const result = await syncAndRecordOpenItfBooks(db, { minVolume: minVol });
    return {
      dryRun,
      mode: "all",
      sync: result.sync,
      bridge: maybeBridge(true),
      rows: null,
      watch: null,
      record: result.record,
      tickers: [],
    };
  };

  const emit = (payload: RecordOncePayload) => {
    if (values.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (payload.dryRun) {
      console.log(
        `record (dry-run)  mode=${payload.mode}` +
          (payload.watch ?
            `  watch_events=${payload.watch.events} tickers=${payload.watch.tickers}`
          : `  tickers=${payload.tickers.length}`),
      );
      for (const t of payload.tickers.slice(0, 20)) console.log(`  ${t}`);
      if (payload.tickers.length > 20) {
        console.log(`  … ${payload.tickers.length - 20} more`);
      }
      return;
    }
    if (payload.sync) {
      console.log(
        `Sync: ${payload.sync.eventsUpserted} events, ${payload.sync.marketsUpserted} market rows` +
          (payload.sync.eventsSkipped ? ` · skipped ${payload.sync.eventsSkipped} ambiguous` : ""),
      );
      for (const a of payload.sync.anomalies.slice(0, 5)) {
        console.log(`  anomaly: ${a}`);
      }
    }
    if (payload.bridge) {
      console.log(
        `Bridge: linked=${payload.bridge.linked} unmatched=${payload.bridge.unmatched}` +
          ` ambiguous=${payload.bridge.ambiguous} resolutions+=${payload.bridge.resolutionsPropagated}`,
      );
    }
    if (payload.watch) {
      console.log(
        `Watch: ${payload.watch.events} events · ${payload.watch.tickers} tickers (lead=${leadMinutes}m)`,
      );
    }
    if (payload.rows?.length) {
      console.log(
        `Top ${payload.rows.length} by lifetime volume (prefer --sort=flow on calendar for capacity):`,
      );
      for (const row of payload.rows) {
        console.log(
          `  vol24h ${formatVolumeFp(row.totalVolume24hFp).padStart(6)}  fav ${row.favoriteMidCents ?? "—"}¢  ${row.matchup.slice(0, 44)}`,
        );
      }
    }
    if (payload.record) {
      const { record } = payload;
      console.log(
        `Record: ${record.ticksRecorded}/${record.marketsPolled} ticks · ${record.eventCount} events · ${record.errors} errors`,
      );
      if (record.coverageLine) {
        console.log(`Ladder: ${record.coverageLine}`);
      }
    }
  };

  if (!values.loop) {
    emit(await runOnce());
    return 0;
  }

  const intervalMs = Number(Bun.env.TENNIS_RECORD_INTERVAL_MS ?? 30_000);
  const modeHint = watchMode ? `watch lead=${leadMinutes}m` : "targets";
  console.log(
    `Tennis recorder loop — every ${intervalMs / 1000}s (${modeHint}${dryRun ? ", dry-run" : ""}) — Ctrl+C to stop`,
  );
  console.log("Default --event expands full ladder; set TENNIS_RECORD_INTERVAL_MS lower for live games.");
  for (;;) {
    try {
      emit(await runOnce());
    } catch (err) {
      console.error(`record error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await Bun.sleep(intervalMs);
  }
}

if (import.meta.main) {
  process.exit(await runTennisRecordCli(process.argv.slice(2)));
}
