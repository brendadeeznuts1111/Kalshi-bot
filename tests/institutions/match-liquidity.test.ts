// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  assertMatchLiquidityHealthy,
  bookHasTopOfBook,
  effectiveVolumeForGate,
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

const emptyBook: BookSnapshot = {
  ts: Date.now(),
  seq: 0,
  bids: [],
  asks: [],
};

describe("match-liquidity", () => {
  test("spreadCentsFromBook and gate math", () => {
    expect(spreadCentsFromBook(tightBook)).toBe(3);
    expect(spreadCentsFromBook(wideBook)).toBe(20);
    expect(bookHasTopOfBook(tightBook)).toBe(true);
    expect(bookHasTopOfBook(emptyBook)).toBe(false);
    expect(effectiveVolumeForGate(0, 900)).toBe(900);
    expect(effectiveVolumeForGate(100, 900)).toBe(100);

    const ok = evaluateLiquidityGates({
      volume24hFp: 500,
      spreadCents: 15,
      midCents: 50,
      crossed: false,
    });
    expect(ok.liquidityOk).toBe(true);
    expect(ok.tradable).toBe(true);
    expect(ok.volumeForGate).toBe(500);

    const thin = evaluateLiquidityGates({
      volume24hFp: 499,
      volumeFp: 0,
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

    // Lifetime fallback when 24h is zero
    const lifetime = evaluateLiquidityGates({
      volume24hFp: 0,
      volumeFp: 2000,
      spreadCents: 5,
      midCents: 45,
      crossed: false,
    });
    expect(lifetime.volumeForGate).toBe(2000);
    expect(lifetime.liquidityOk).toBe(true);
    expect(lifetime.tradable).toBe(true);
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

  test("empty books do not count as quotes; lifetime volume can pass gate", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEvent(db, {
      eventId: "evt-empty",
      tournament: "Shell Cup",
      volume: "5000",
      volume24h: "0",
      book: emptyBook,
    });
    seedEvent(db, {
      eventId: "evt-lifetime-tight",
      tournament: "Shell Cup",
      volume: "5000",
      volume24h: "0",
      book: tightBook,
    });

    expect(recomputeMatchLiquidity(db)).toBe(2);

    const empty = getMatchLiquidity(db, "evt-empty");
    expect(empty!.bookTickCount).toBe(0);
    expect(empty!.spreadCents).toBeNull();
    expect(empty!.liquidityOk).toBe(false);
    expect(empty!.volumeFp).toBe(5000);
    expect(empty!.volume24hFp).toBe(0);

    const tight = getMatchLiquidity(db, "evt-lifetime-tight");
    expect(tight!.bookTickCount).toBe(1);
    expect(tight!.spreadCents).toBe(3);
    expect(tight!.liquidityOk).toBe(true);
    expect(tight!.tradable).toBe(true);
  });

  test("last non-empty book recovers when latest tick is empty shell", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    seedEvent(db, {
      eventId: "evt-stale-quote",
      tournament: "Recover Cup",
      volume: "8000",
      volume24h: "0",
      book: tightBook,
    });
    // Overwrite timeline: insert empty shell *after* the tight book
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, recv_ts, source_clock, levels_json, source
       ) VALUES (
         'evt-stale-quote', 'TICK-evt-stale-quote', 'match_winner', $ts, $ts, 'recv', $json, 'test'
       )`,
    ).run({
      $ts: now + 10_000,
      $json: JSON.stringify(emptyBook),
    });

    recomputeMatchLiquidity(db, "evt-stale-quote");
    const row = getMatchLiquidity(db, "evt-stale-quote");
    expect(row!.bookTickCount).toBe(1);
    expect(row!.spreadCents).toBe(3);
    expect(row!.liquidityOk).toBe(true);
    expect(row!.tradable).toBe(true);
  });
});

describe("match-liquidity REST (no rate limit)", () => {
  test("100 concurrent GETs all 200", async () => {
    const { createResearchServer } = await import("../../src/research/serve.ts");
    const server = createResearchServer({ port: 0 });
    const url = `http://127.0.0.1:${server.port}/api/liquidity/by-tournament/${encodeURIComponent("NoSuch")}?limit=1`;
    try {
      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          fetch(url).then((r) => r.status),
        ),
      );
      const ok = results.filter((s) => s === 200).length;
      expect(ok).toBe(100);
      expect(results.every((s) => s !== 429)).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

