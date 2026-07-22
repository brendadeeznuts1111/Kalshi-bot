// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { ITF_SERIES_TICKERS } from "../../src/alpha/ticker-formats/itf.ts";
import type { KalshiFetchImpl, KalshiMarketWire } from "../../src/bot/kalshi-events-api.ts";
import { fetchKalshiMarketsPage } from "../../src/bot/kalshi-events-api.ts";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import {
  fetchRetainedItfMarkets,
  recordKalshiBookTicks,
  settlementFromKalshiMarkets,
  syncItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  asCompetitorId,
  asKalshiEventTicker,
  asKalshiMarketTicker,
  asSeriesTicker,
  type CanonicalEventId,
} from "../../src/institutions/event-store/brands.ts";
import { asCanonicalEventId } from "../../src/institutions/event-store/types.ts";

const competitor1Id = asCompetitorId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const competitor2Id = asCompetitorId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const NOW_MS = Date.UTC(2026, 6, 22, 12, 0, 0); // 2026-07-22T12:00:00Z
const MIN_TS = Math.floor(NOW_MS / 1000) - 3 * 86_400;

function wire(
  partial: Omit<Partial<KalshiMarketWire>, "ticker" | "event_ticker" | "custom_strike"> & {
    ticker: string;
    event_ticker: string;
    status: string;
    custom_strike?: { tennis_competitor?: string };
  },
): KalshiMarketWire {
  const custom =
    partial.custom_strike?.tennis_competitor ?
      { tennis_competitor: asCompetitorId(partial.custom_strike.tennis_competitor) }
    : undefined;
  return {
    yes_sub_title: partial.yes_sub_title,
    result: partial.result,
    occurrence_datetime: partial.occurrence_datetime ?? "2026-07-22T10:00:00Z",
    ...partial,
    ticker: asKalshiMarketTicker(partial.ticker),
    event_ticker: asKalshiEventTicker(partial.event_ticker),
    custom_strike: custom,
  };
}

const eventTickerOpen = asKalshiEventTicker("KXITFWMATCH-26JUL22PENKUL");
const eventTickerClosed = asKalshiEventTicker("KXITFWMATCH-26JUL21SMIJON");

const OPEN_MARKETS: KalshiMarketWire[] = [
  wire({
    ticker: "KXITFWMATCH-26JUL22PENKUL-PEN",
    event_ticker: "KXITFWMATCH-26JUL22PENKUL",
    status: "open",
    yes_sub_title: "Pen",
    custom_strike: { tennis_competitor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  }),
  wire({
    ticker: "KXITFWMATCH-26JUL22PENKUL-KUL",
    event_ticker: "KXITFWMATCH-26JUL22PENKUL",
    status: "open",
    yes_sub_title: "Kul",
    custom_strike: { tennis_competitor: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
  }),
];

const CLOSED_MARKETS: KalshiMarketWire[] = [
  wire({
    ticker: "KXITFWMATCH-26JUL21SMIJON-SMI",
    event_ticker: "KXITFWMATCH-26JUL21SMIJON",
    status: "closed",
    yes_sub_title: "Smith",
    custom_strike: { tennis_competitor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    result: "yes",
    occurrence_datetime: "2026-07-21T14:00:00Z",
  }),
  wire({
    ticker: "KXITFWMATCH-26JUL21SMIJON-JON",
    event_ticker: "KXITFWMATCH-26JUL21SMIJON",
    status: "closed",
    yes_sub_title: "Jones",
    custom_strike: { tennis_competitor: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    result: "no",
    occurrence_datetime: "2026-07-21T14:00:00Z",
  }),
];

/** Same closed ticker also returned under settled (dedupe proof). */
const SETTLED_DUP: KalshiMarketWire[] = [
  wire({
    ticker: "KXITFWMATCH-26JUL21SMIJON-SMI",
    event_ticker: "KXITFWMATCH-26JUL21SMIJON",
    status: "settled",
    yes_sub_title: "Smith",
    custom_strike: { tennis_competitor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    result: "yes",
    occurrence_datetime: "2026-07-21T14:00:00Z",
  }),
];

function parseQuery(input: string | URL | Request): URLSearchParams {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(href).searchParams;
}

function mockItfFetch(): { fetchImpl: KalshiFetchImpl; calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  const fetchImpl: KalshiFetchImpl = async (input) => {
    const q = parseQuery(input);
    calls.push(q);
    const series = q.get("series_ticker");
    const status = q.get("status");
    let markets: KalshiMarketWire[] = [];
    if (series === "KXITFWMATCH") {
      if (status === "open") markets = OPEN_MARKETS;
      else if (status === "closed") markets = CLOSED_MARKETS;
      else if (status === "settled") markets = SETTLED_DUP;
    }
    return new Response(JSON.stringify({ markets, cursor: undefined }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("kalshi-itf-sync", () => {
  test("fetchKalshiMarketsPage passes min_close_ts / min_settled_ts", async () => {
    let seen = "";
    const fetchImpl: KalshiFetchImpl = async (input) => {
      seen = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify({ markets: [] }), { status: 200 });
    };
    await fetchKalshiMarketsPage(
      { series_ticker: asSeriesTicker("KXITFWMATCH"), status: "closed", min_close_ts: 1_700_000_000 },
      { fetchImpl, baseUrl: "https://example.test/trade-api/v2" },
    );
    expect(seen).toContain("min_close_ts=1700000000");
    expect(seen).toContain("status=closed");

    await fetchKalshiMarketsPage(
      { series_ticker: asSeriesTicker("KXITFWMATCH"), status: "settled", min_settled_ts: 1_700_000_001 },
      { fetchImpl, baseUrl: "https://example.test/trade-api/v2" },
    );
    expect(seen).toContain("min_settled_ts=1700000001");
    expect(seen).toContain("status=settled");
  });

  test("maps result=yes to yes_side_label winner", () => {
    const s = settlementFromKalshiMarkets(CLOSED_MARKETS);
    expect(s).toEqual({ winner: "Smith", loser: "Jones", outcome: "completed" });
  });

  test("retainDays>0 merges open+closed+settled and dedupes by ticker", async () => {
    const { fetchImpl, calls } = mockItfFetch();
    const retained = await fetchRetainedItfMarkets({
      fetchImpl,
      retainDays: 3,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(retained.byStatus).toEqual({ open: 2, closed: 2, settled: 1 });
    expect(retained.markets).toHaveLength(4); // 2 open + 2 closed (settled dup dropped)
    expect(retained.markets.map((m) => m.ticker).sort()).toEqual(
      [
        asKalshiMarketTicker("KXITFWMATCH-26JUL21SMIJON-JON"),
        asKalshiMarketTicker("KXITFWMATCH-26JUL21SMIJON-SMI"),
        asKalshiMarketTicker("KXITFWMATCH-26JUL22PENKUL-KUL"),
        asKalshiMarketTicker("KXITFWMATCH-26JUL22PENKUL-PEN"),
      ].sort(),
    );

    const closedCalls = calls.filter((q) => q.get("status") === "closed");
    expect(closedCalls.length).toBe(ITF_SERIES_TICKERS.length);
    expect(closedCalls.every((q) => q.get("min_close_ts") === String(MIN_TS))).toBe(true);
    const settledCalls = calls.filter((q) => q.get("status") === "settled");
    expect(settledCalls.every((q) => q.get("min_settled_ts") === String(MIN_TS))).toBe(true);
  });

  test("retainDays=0 fetches open only", async () => {
    const { fetchImpl, calls } = mockItfFetch();
    const retained = await fetchRetainedItfMarkets({
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(retained.byStatus).toEqual({ open: 2, closed: 0, settled: 0 });
    expect(retained.markets).toHaveLength(2);
    expect(calls.every((q) => q.get("status") === "open")).toBe(true);
    expect(calls.some((q) => q.has("min_close_ts"))).toBe(false);
  });

  test("syncItfEvents upserts closed event with Kalshi settlement winner", async () => {
    const { fetchImpl } = mockItfFetch();
    const db = openEventStore({ dbPath: ":memory:" });
    const summary = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 3,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(summary.marketsSeen).toBe(4);
    expect(summary.marketsSeenByStatus).toEqual({ open: 2, closed: 2, settled: 1 });
    expect(summary.retainDays).toBe(3);
    expect(summary.eventsUpserted).toBe(2);

    const closed = db
      .query(
        `SELECT e.winner AS winner, e.loser AS loser, e.outcome AS outcome
         FROM events e
         JOIN markets m ON m.event_id = e.event_id
         WHERE m.ticker = $ticker
         LIMIT 1`,
      )
      .get({ $ticker: "KXITFWMATCH-26JUL21SMIJON-SMI" }) as {
      winner: string;
      loser: string;
      outcome: string;
    };
    expect(closed.winner).toBe("Smith");
    expect(closed.loser).toBe("Jones");
    expect(closed.outcome).toBe("completed");

    const open = db
      .query(
        `SELECT e.winner AS winner, e.outcome AS outcome
         FROM events e
         JOIN markets m ON m.event_id = e.event_id
         WHERE m.ticker = $ticker
         LIMIT 1`,
      )
      .get({ $ticker: "KXITFWMATCH-26JUL22PENKUL-PEN" }) as { winner: string; outcome: string };
    expect(open.winner).toBe("");
    expect(open.outcome).toBe("scheduled");
  });

  test("syncItfEvents retainDays=0 does not upsert closed markets", async () => {
    const { fetchImpl, calls } = mockItfFetch();
    const db = openEventStore({ dbPath: ":memory:" });
    const summary = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(summary.marketsSeen).toBe(2);
    expect(summary.marketsSeenByStatus.closed).toBe(0);
    expect(summary.eventsUpserted).toBe(1);
    expect(calls.every((q) => q.get("status") === "open")).toBe(true);

    const closedCount = db
      .query(`SELECT COUNT(*) AS n FROM markets WHERE ticker LIKE $p`)
      .get({ $p: "KXITFWMATCH-26JUL21SMIJON%" }) as { n: number };
    expect(closedCount.n).toBe(0);
  });

  test("occurrence +5m rematerializes same event_id (no source_row_hash abort)", async () => {
    // Unambiguous singles blob FOOBAR = FOO+BAR (same shape as PENKUL).
    const event = "KXITFWMATCH-26JUL22FOOBAR";
    const marketsT0: KalshiMarketWire[] = [
      wire({
        ticker: `${event}-FOO`,
        event_ticker: event,
        status: "open",
        yes_sub_title: "Foo",
        custom_strike: { tennis_competitor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
      wire({
        ticker: `${event}-BAR`,
        event_ticker: event,
        status: "open",
        yes_sub_title: "Bar",
        custom_strike: { tennis_competitor: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
    ];
    let active = marketsT0;
    const fetchImpl: KalshiFetchImpl = async (input) => {
      const q = parseQuery(input);
      const markets = q.get("series_ticker") === "KXITFWMATCH" ? active : [];
      return new Response(JSON.stringify({ markets, cursor: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const db = openEventStore({ dbPath: ":memory:" });
    const first = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(first.anomalies).toEqual([]);
    expect(first.eventsUpserted).toBe(1);
    const id1 = db
      .query(
        `SELECT e.event_id AS id, e.start_ts AS startTs FROM events e
         JOIN markets m ON m.event_id = e.event_id WHERE m.ticker = $t LIMIT 1`,
      )
      .get({ $t: `${event}-FOO` }) as { id: string; startTs: string };

    active = marketsT0.map((m) => ({
      ...m,
      occurrence_datetime: "2026-07-22T10:05:00Z",
    }));
    const second = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(second.anomalies).toEqual([]);
    expect(second.eventsUpserted).toBe(1);
    const id2 = db
      .query(
        `SELECT e.event_id AS id, e.start_ts AS startTs FROM events e
         JOIN markets m ON m.event_id = e.event_id WHERE m.ticker = $t LIMIT 1`,
      )
      .get({ $t: `${event}-FOO` }) as { id: string; startTs: string };
    expect(id2.id).toBe(id1.id);
    expect(id2.startTs).toBe("2026-07-22T10:05:00Z");
    const n = db.query(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
    expect(n.n).toBe(1);
  });

  test("missing occurrence_datetime skips trading upsert", async () => {
    const event = "KXITFWMATCH-26JUL22FOOBAR";
    const fetchImpl: KalshiFetchImpl = async (input) => {
      const q = parseQuery(input);
      const markets =
        q.get("series_ticker") === "KXITFWMATCH"
          ? [
              {
                ticker: `${event}-FOO`,
                event_ticker: event,
                status: "open",
                yes_sub_title: "Foo",
                custom_strike: { tennis_competitor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
              },
              {
                ticker: `${event}-BAR`,
                event_ticker: event,
                status: "open",
                yes_sub_title: "Bar",
                custom_strike: { tennis_competitor: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
              },
            ]
          : [];
      return new Response(JSON.stringify({ markets, cursor: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const db = openEventStore({ dbPath: ":memory:" });
    const summary = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(summary.eventsUpserted).toBe(0);
    expect(summary.eventsSkipped).toBe(1);
    expect(summary.anomalies.some((a) => a.startsWith("missing_occurrence:"))).toBe(true);
  });

  test("missing competitor pair refuses trading upsert", async () => {
    const event = "KXITFWMATCH-26JUL22FOOBAR";
    const fetchImpl: KalshiFetchImpl = async (input) => {
      const q = parseQuery(input);
      const markets =
        q.get("series_ticker") === "KXITFWMATCH"
          ? [
              wire({
                ticker: `${event}-FOO`,
                event_ticker: event,
                status: "open",
                yes_sub_title: "Foo",
              }),
              wire({
                ticker: `${event}-BAR`,
                event_ticker: event,
                status: "open",
                yes_sub_title: "Bar",
              }),
            ]
          : [];
      return new Response(JSON.stringify({ markets, cursor: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const db = openEventStore({ dbPath: ":memory:" });
    const summary = await syncItfEvents(db, {
      fetchImpl,
      retainDays: 0,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    expect(summary.eventsUpserted).toBe(0);
    expect(summary.anomalies.some((a) => a.startsWith("ticker_keyed_event_id:"))).toBe(true);
  });

  test("sync preserves existing bridged winner over Kalshi settlement", async () => {
    const { fetchImpl } = mockItfFetch();
    const db = openEventStore({ dbPath: ":memory:" });
    await syncItfEvents(db, {
      fetchImpl,
      retainDays: 3,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    const row = db
      .query(
        `SELECT e.event_id AS eventId FROM events e
         JOIN markets m ON m.event_id = e.event_id
         WHERE m.ticker = $ticker LIMIT 1`,
      )
      .get({ $ticker: "KXITFWMATCH-26JUL21SMIJON-SMI" }) as { eventId: CanonicalEventId };
    const eventId = asCanonicalEventId(row.eventId);
    db.query(
      `UPDATE events SET winner = 'Bridged Winner', loser = 'Bridged Loser', outcome = 'completed'
       WHERE event_id = $id`,
    ).run({ $id: eventId });

    await syncItfEvents(db, {
      fetchImpl,
      retainDays: 3,
      nowMs: NOW_MS,
      baseUrl: "https://example.test/trade-api/v2",
    });
    const after = db
      .query(`SELECT winner, loser, outcome FROM events WHERE event_id = $id`)
      .get({ $id: eventId }) as { winner: string; loser: string; outcome: string };
    expect(after.winner).toBe("Bridged Winner");
    expect(after.loser).toBe("Bridged Loser");
    expect(after.outcome).toBe("completed");
  });

  test("REST book ticks stamp per-ticker recv_ts with source_clock=recv", async () => {
    const eventTicker = "KXITFMATCH-26JUL22SANALV";
    const marketTickerA = asKalshiMarketTicker("KXITFMATCH-26JUL22SANALV-SAN");
    const marketTickerB = asKalshiMarketTicker("KXITFMATCH-26JUL22SANALV-ALV");
    const eventId = "kalshi|test|book-ticks-rest";
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $id, 'ITF', 'KXITFMATCH', 'W15', '', 'Hard', '', 'R32', NULL,
        'San', 'Alv', '', '', $start, 'scheduled', 'test', '', $now,
        $hash, $now, 'trading'
      )`,
    ).run({
      $id: eventId,
      $start: new Date(now).toISOString(),
      $now: now,
      $hash: `t|${eventTicker}`,
    });
    db.query(
      `INSERT INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        source, fetched_ts
      ) VALUES
        ('kalshi:${marketTickerA}', $id, 'kalshi', $a, 'KXITFMATCH', 'match_winner', 'San', 'SAN', 'test', $now),
        ('kalshi:${marketTickerB}', $id, 'kalshi', $b, 'KXITFMATCH', 'match_winner', 'Alv', 'ALV', 'test', $now)`,
    ).run({ $id: eventId, $a: marketTickerA, $b: marketTickerB, $now: now });

    let call = 0;
    const emptyBook = (): BookSnapshot => ({ ts: 0, bids: [], asks: [], seq: 0 });
    const fetchBook = async (_ticker: typeof marketTickerA): Promise<BookSnapshot> => {
      call++;
      if (call > 1) await Bun.sleep(5);
      return emptyBook();
    };

    const summary = await recordKalshiBookTicks(db, [marketTickerA, marketTickerB], {
      fetchBook,
      syncFirst: false,
    });
    expect(summary.ticksRecorded).toBe(2);
    expect(summary.errors).toBe(0);

    const rows = db
      .query(
        `SELECT ticker, ts, recv_ts, source_clock
         FROM book_ticks
         ORDER BY recv_ts ASC`,
      )
      .all() as Array<{ ticker: string; ts: number; recv_ts: number; source_clock: string }>;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.recv_ts).toBeGreaterThan(0);
      expect(row.source_clock).toBe("recv");
      expect(row.ts).toBe(row.recv_ts);
    }
    expect(rows[0]!.ticker).toBe(marketTickerA);
    expect(rows[1]!.ticker).toBe(marketTickerB);
    expect(rows[1]!.recv_ts).toBeGreaterThan(rows[0]!.recv_ts);
  });
});
