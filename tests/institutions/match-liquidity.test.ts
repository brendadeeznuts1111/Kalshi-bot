// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  assertMatchLiquidityHealthy,
  evaluateLiquidityGates,
  getMatchLiquidity,
  LIQUIDITY_GATES,
  listMatchLiquidityByTournament,
  recomputeMatchLiquidity,
  spreadCentsFromBook,
  toLiquidityApiPayload,
} from "../../src/institutions/event-store/match-liquidity.ts";

function seedEvent(
  db: ReturnType<typeof openEventStore>,
  opts: {
    eventId: string;
    tournament: string;
    tour?: string;
    volume24h?: string;
    volume?: string;
    book?: BookSnapshot;
  },
): void {
  const now = Date.now();
  db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round,
       player_a, player_b, winner, loser, start_ts, outcome,
       source, source_row_hash, ingested_at, corpus
     ) VALUES (
       $id, $tour, 'MS', $tournament, '', 'Hard', '', 'R32',
       'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
       'test', $hash, $ingested, 'trading'
     )`,
  ).run({
    $id: opts.eventId,
    $tour: opts.tour ?? "ATP",
    $tournament: opts.tournament,
    $hash: `hash-${opts.eventId}`,
    $ingested: now,
  });
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, market_kind,
       volume_fp, volume_24h_fp, open_interest_fp, source
     ) VALUES (
       $mid, $eid, 'kalshi', $ticker, 'match_winner',
       $vol, $vol24, '100', 'test'
     )`,
  ).run({
    $mid: `m-${opts.eventId}`,
    $eid: opts.eventId,
    $ticker: `TICK-${opts.eventId}`,
    $vol: opts.volume ?? "1000",
    $vol24: opts.volume24h ?? "800",
  });
  if (opts.book) {
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, recv_ts, source_clock, levels_json, source
       ) VALUES (
         $eid, $ticker, 'match_winner', $ts, $ts, 'recv', $json, 'test'
       )`,
    ).run({
      $eid: opts.eventId,
      $ticker: `TICK-${opts.eventId}`,
      $ts: now,
      $json: JSON.stringify(opts.book),
    });
  }
}

const tightBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 48, size: 50 }],
  asks: [{ priceCents: 51, size: 40 }],
};

const wideBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 40, size: 10 }],
  asks: [{ priceCents: 60, size: 10 }],
};

describe("match-liquidity", () => {
  test("spreadCentsFromBook and gate math", () => {
    expect(spreadCentsFromBook(tightBook)).toBe(3);
    expect(spreadCentsFromBook(wideBook)).toBe(20);

    const ok = evaluateLiquidityGates({
      volume24hFp: 500,
      spreadCents: 15,
      midCents: 50,
      crossed: false,
    });
    expect(ok.liquidityOk).toBe(true);
    expect(ok.tradable).toBe(true);

    const thin = evaluateLiquidityGates({
      volume24hFp: 499,
      spreadCents: 3,
      midCents: 50,
      crossed: false,
    });
    expect(thin.liquidityOk).toBe(false);
    expect(thin.tradable).toBe(false);

    const wide = evaluateLiquidityGates({
      volume24hFp: 1000,
      spreadCents: 16,
      midCents: 50,
      crossed: false,
    });
    expect(wide.liquidityOk).toBe(false);
  });

  test("recompute + get + by-tournament", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEvent(db, {
      eventId: "evt-wim-1",
      tournament: "Wimbledon",
      volume24h: "900",
      book: tightBook,
    });
    seedEvent(db, {
      eventId: "evt-wim-2",
      tournament: "Wimbledon",
      volume24h: "100",
      book: wideBook,
    });
    seedEvent(db, {
      eventId: "evt-uso-1",
      tournament: "US Open",
      volume24h: "2000",
      book: tightBook,
    });

    expect(recomputeMatchLiquidity(db)).toBe(3);

    const row = getMatchLiquidity(db, "evt-wim-1");
    expect(row).not.toBeNull();
    expect(row!.liquidityOk).toBe(true);
    expect(row!.tradable).toBe(true);
    expect(row!.spreadCents).toBe(3);
    expect(row!.volume24hFp).toBe(900);
    expect(row!.sportKey).toBe("tennis");
    expect(row!.tournament).toBe("Wimbledon");

    const thin = getMatchLiquidity(db, "evt-wim-2");
    expect(thin!.liquidityOk).toBe(false);

    const wim = listMatchLiquidityByTournament(db, "Wimbledon");
    expect(wim.length).toBe(2);
    expect(wim[0]!.eventId).toBe("evt-wim-1"); // higher volume first

    const payload = toLiquidityApiPayload(row!);
    expect(payload.gates.minVolume24hFp).toBe(LIQUIDITY_GATES.minVolume24hFp);
    expect(payload.eventId).toBe("evt-wim-1");

    const health = assertMatchLiquidityHealthy(db);
    expect(health.ok).toBe(true);
    expect(health.rowCount).toBe(3);
  });

  test("schema applied on openEventStore", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    expect(assertMatchLiquidityHealthy(db).table).toBe("match_liquidity");
  });
});
