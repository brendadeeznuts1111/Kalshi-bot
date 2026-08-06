// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  buildLiquidityBoardPayload,
  deskFlagsFromRow,
  getMatchLiquidity,
  listDeskLiquidityByEventId,
  recomputeMatchLiquidity,
} from "../../src/institutions/event-store/match-liquidity.ts";
import { createResearchServer } from "../../src/research/serve.ts";
import { SPORT } from "../../src/institutions/market-registry/brands.ts";
import {
  attachDeskLiquidityToBoard,
  type TennisBoard,
} from "../../src/research/tennis-events.ts";

const tightBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 48, size: 10 }],
  asks: [{ priceCents: 51, size: 10 }],
};

describe("liquidity board + HQ API", () => {
  test("buildLiquidityBoardPayload binds glossary concepts", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round,
         player_a, player_b, winner, loser, start_ts, outcome,
         source, source_row_hash, ingested_at, corpus
       ) VALUES (
         'board1', 'ATP', 'MS', 'Chip Cup', '', 'Hard', '', 'R32',
         'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
         'test', 'h-board1', $ing, 'trading'
       )`,
    ).run({ $ing: now });
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, market_kind,
         volume_fp, volume_24h_fp, source
       ) VALUES ('m-b1', 'board1', 'kalshi', 'TICK-B1', 'match_winner', '3000', '1000', 'test')`,
    ).run();
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, levels_json, source
       ) VALUES ('board1', 'TICK-B1', 'match_winner', $ts, $json, 'test')`,
    ).run({ $ts: now, $json: JSON.stringify(tightBook) });
    recomputeMatchLiquidity(db, "board1");

    const board = buildLiquidityBoardPayload(db);
    expect(board.schemaVersion).toBe(1);
    expect(board.concepts.tradable).toBe("desk.tradable");
    expect(board.concepts.quoted).toBe("desk.quoted");
    expect(board.concepts.liquidityOk).toBe("liquidity_ok");
    expect(board.summary.tradable).toBe(1);
    expect(board.top.length).toBeGreaterThanOrEqual(1);
    expect(board.byTournament.some((t) => t.tournament === "Chip Cup")).toBe(true);
  });

  test("GET /api/liquidity and /api/kpi expose tradable chips", async () => {
    const server = createResearchServer({ port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const board = await fetch(`${base}/api/liquidity`).then((r) => r.json());
      expect(board.schemaVersion).toBe(1);
      expect(board.concepts.tradable).toBe("desk.tradable");
      expect(Array.isArray(board.top)).toBe(true);

      const kpi = await fetch(`${base}/api/kpi`).then((r) => r.json());
      expect(typeof kpi.tradable_matches).toBe("number");
      expect(typeof kpi.tight_markets).toBe("number");
      expect(typeof kpi.quoted_books).toBe("number");
    } finally {
      server.stop(true);
    }
  });

  test("listDeskLiquidityByEventId + attachDeskLiquidityToBoard filters tradable", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    // Internal hash event_id (store) + Kalshi market tickers (board joins on eventTicker)
    const hashId = "hash-desk-evt-1";
    const eventTicker = "KXATPMATCH-26AUG01SONGRI";
    const marketA = `${eventTicker}-SON`;
    const marketB = `${eventTicker}-GRI`;
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round,
         player_a, player_b, winner, loser, start_ts, outcome,
         source, source_row_hash, ingested_at, corpus
       ) VALUES (
         $id, 'ATP', 'MS', 'Desk Cup', '', 'Hard', '', 'R16',
         'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
         'test', 'h-desk1', $ing, 'trading'
       )`,
    ).run({ $id: hashId, $ing: now });
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, market_kind,
         volume_fp, volume_24h_fp, source
       ) VALUES
         ('m-d1', $id, 'kalshi', $t1, 'match_winner', '3000', '1000', 'test'),
         ('m-d2', $id, 'kalshi', $t2, 'match_winner', '3000', '1000', 'test')`,
    ).run({ $id: hashId, $t1: marketA, $t2: marketB });
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, levels_json, source
       ) VALUES ($id, $t1, 'match_winner', $ts, $json, 'test')`,
    ).run({ $id: hashId, $t1: marketA, $ts: now, $json: JSON.stringify(tightBook) });
    recomputeMatchLiquidity(db, hashId);

    const index = listDeskLiquidityByEventId(db);
    // Internal id + market ticker + stripped event ticker (board key)
    expect(index.get(hashId)?.tradable).toBe(true);
    expect(index.get(marketA)?.tradable).toBe(true);
    expect(index.get(eventTicker)?.tradable).toBe(true);
    expect(index.get(eventTicker)?.quoted).toBe(true);

    const row = getMatchLiquidity(db, hashId);
    expect(row).not.toBeNull();
    expect(deskFlagsFromRow(row!).tradable).toBe(true);

    const stub: TennisBoard = {
      generatedAt: new Date().toISOString(),
      eventCount: 2,
      marketCount: 2,
      series: [
        {
          series: "KXATPMATCH" as TennisBoard["series"][0]["series"],
          state: "ok",
          events: [
            {
              sport: SPORT.tennis,
              eventTicker,
              title: "A vs B",
              subTitle: null,
              series: "KXATPMATCH",
              league: "ATP",
              tour: "ATP",
              level: "tour",
              competition: null,
              tournament: "Desk Cup",
              round: "R16",
              city: null,
              country: null,
              countryCode: null,
              tier: "250",
              surface: "Hard",
              occurrenceMs: now,
              markets: [
                {
                  ticker: marketA,
                  player: "A",
                  playerCountry: null,
                  playerCountryCode: null,
                  status: "active",
                  yesBidCents: 48,
                  yesAskCents: 51,
                  lastCents: 50,
                  volume24h: 1000,
                  openInterest: null,
                  competitorId: null,
                },
              ],
            },
            {
              sport: SPORT.tennis,
              eventTicker: "desk-evt-thin",
              title: "Thin",
              subTitle: null,
              series: "KXATPMATCH",
              league: "ATP",
              tour: "ATP",
              level: "tour",
              competition: null,
              tournament: "Desk Cup",
              round: null,
              city: null,
              country: null,
              countryCode: null,
              tier: "250",
              surface: "Hard",
              occurrenceMs: now,
              markets: [
                {
                  ticker: "TICK-THIN",
                  player: "X",
                  playerCountry: null,
                  playerCountryCode: null,
                  status: "active",
                  yesBidCents: null,
                  yesAskCents: null,
                  lastCents: null,
                  volume24h: 0,
                  openInterest: null,
                  competitorId: null,
                },
              ],
            },
          ],
        },
      ],
    };

    const attached = attachDeskLiquidityToBoard(stub, index, { liquidity: "all" });
    expect(attached.series[0]!.events[0]!.deskLiquidity?.tradable).toBe(true);
    expect(attached.series[0]!.events[1]!.deskLiquidity).toBeUndefined();

    const tradableOnly = attachDeskLiquidityToBoard(stub, index, {
      liquidity: "tradable",
      dropEmptySeries: false,
    });
    expect(tradableOnly.eventCount).toBe(1);
    expect(tradableOnly.series[0]!.events[0]!.eventTicker).toBe(eventTicker);
  });
});
