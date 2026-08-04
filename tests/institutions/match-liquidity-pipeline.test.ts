// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  formatMatchLiquidityPipelineLines,
  runMatchLiquidityPipeline,
} from "../../src/institutions/event-store/match-liquidity-pipeline.ts";
import { parseLiquidityScheduleCli } from "../../tools/match-liquidity-schedule-cli.ts";
import { previewFireTimes } from "../../src/research/schedule-cli.ts";

const tightBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 45, size: 10 }],
  asks: [{ priceCents: 48, size: 10 }],
};

describe("match-liquidity-pipeline", () => {
  test("offline pipeline recomputes without network", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round,
         player_a, player_b, winner, loser, start_ts, outcome,
         source, source_row_hash, ingested_at, corpus
       ) VALUES (
         'pipe1', 'ATP', 'MS', 'Pipe Cup', '', 'Hard', '', 'R32',
         'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
         'test', 'h-pipe1', $ing, 'trading'
       )`,
    ).run({ $ing: now });
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, market_kind,
         volume_fp, volume_24h_fp, source
       ) VALUES ('m-pipe1', 'pipe1', 'kalshi', 'TICK-PIPE', 'match_winner', '2000', '900', 'test')`,
    ).run();
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, levels_json, source
       ) VALUES ('pipe1', 'TICK-PIPE', 'match_winner', $ts, $json, 'test')`,
    ).run({ $ts: now, $json: JSON.stringify(tightBook) });

    const result = await runMatchLiquidityPipeline({
      db,
      fetchVolume: false,
      groundHtml: false,
      snapshot: false,
    });
    expect(result.recomputeRows).toBe(1);
    expect(result.summary.tradable).toBe(1);
    expect(result.backfill).toBeNull();
    const lines = formatMatchLiquidityPipelineLines(result);
    expect(lines.some((l) => l.includes("tradable=1"))).toBe(true);
  });

  test("schedule CLI parse + preview fires", () => {
    const opts = parseLiquidityScheduleCli(["preview", "--schedule=*/30 * * * *", "--count=2"]);
    expect(opts?.command).toBe("preview");
    expect(opts?.schedule).toBe("*/30 * * * *");
    const times = previewFireTimes(opts!.schedule, 2);
    expect(times.length).toBe(2);
    expect(times[1]!.getTime()).toBeGreaterThan(times[0]!.getTime());
  });
});
