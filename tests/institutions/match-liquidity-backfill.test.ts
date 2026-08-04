// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { asKalshiEventTicker, asKalshiMarketTicker } from "../../src/institutions/event-store/brands.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { recomputeMatchLiquidity, getMatchLiquidity } from "../../src/institutions/event-store/match-liquidity.ts";
import {
  applyMarketVolumeWire,
  backfillQuotedMarketVolumes,
  listQuotedZeroVolumeTickers,
} from "../../src/institutions/event-store/match-liquidity-backfill.ts";
import type { KalshiMarketWire } from "../../src/bot/kalshi-events-api.ts";

const tightBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 48, size: 10 }],
  asks: [{ priceCents: 50, size: 10 }],
};

describe("match-liquidity-backfill", () => {
  test("applyMarketVolumeWire + backfill with mock fetch", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const ticker = "KXTEST-TICK-YES";
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round,
         player_a, player_b, winner, loser, start_ts, outcome,
         source, source_row_hash, ingested_at, corpus
       ) VALUES (
         'bf1', 'ATP', 'MS', 'Backfill Cup', '', 'Hard', '', 'R32',
         'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
         'test', 'h-bf1', $ing, 'trading'
       )`,
    ).run({ $ing: now });
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, market_kind, source
       ) VALUES ('m-bf1', 'bf1', 'kalshi', $t, 'match_winner', 'test')`,
    ).run({ $t: ticker });
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, levels_json, source
       ) VALUES ('bf1', $t, 'match_winner', $ts, $json, 'test')`,
    ).run({ $t: ticker, $ts: now, $json: JSON.stringify(tightBook) });
    recomputeMatchLiquidity(db, "bf1");
    expect(getMatchLiquidity(db, "bf1")!.liquidityOk).toBe(false);
    expect(listQuotedZeroVolumeTickers(db).some((x) => x.eventId === "bf1")).toBe(true);

    const wire: KalshiMarketWire = {
      ticker: asKalshiMarketTicker(ticker),
      event_ticker: asKalshiEventTicker("KXTEST-EVT"),
      status: "active",
      volume_fp: "9000",
      volume_24h_fp: "1200",
    };
    expect(applyMarketVolumeWire(db, asKalshiMarketTicker(ticker), wire)).toBe(true);
    recomputeMatchLiquidity(db, "bf1");
    const row = getMatchLiquidity(db, "bf1")!;
    expect(row.volumeFp).toBe(9000);
    expect(row.volume24hFp).toBe(1200);
    expect(row.liquidityOk).toBe(true);
    expect(row.tradable).toBe(true);

    // mock full backfill path
    db.query(`UPDATE markets SET volume_fp=NULL, volume_24h_fp=NULL WHERE ticker=$t`).run({ $t: ticker });
    recomputeMatchLiquidity(db, "bf1");
    const result = await backfillQuotedMarketVolumes(db, {
      pauseMs: 0,
      fetchMarket: async () => wire,
    });
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(getMatchLiquidity(db, "bf1")!.tradable).toBe(true);
  });
});
