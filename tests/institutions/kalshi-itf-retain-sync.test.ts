// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { ITF_SERIES_TICKERS } from "../../src/alpha/ticker-formats/itf.ts";
import type { KalshiFetchImpl, KalshiMarketWire } from "../../src/bot/kalshi-events-api.ts";
import { fetchKalshiMarketsPage } from "../../src/bot/kalshi-events-api.ts";
import {
  fetchRetainedItfMarkets,
  settlementFromKalshiMarkets,
  syncItfEvents,
} from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { asCanonicalEventId, type CanonicalEventId } from "../../src/institutions/event-store/types.ts";

const COMP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW_MS = Date.UTC(2026, 6, 22, 12, 0, 0); // 2026-07-22T12:00:00Z
const MIN_TS = Math.floor(NOW_MS / 1000) - 3 * 86_400;

function wire(
  partial: Partial<KalshiMarketWire> & Pick<KalshiMarketWire, "ticker" | "event_ticker" | "status">,
): KalshiMarketWire {
  return {
    yes_sub_title: partial.yes_sub_title,
    custom_strike: partial.custom_strike,
    result: partial.result,
    occurrence_datetime: partial.occurrence_datetime ?? "2026-07-22T10:00:00Z",
    ...partial,
  };
}

const OPEN_EVENT = "KXITFWMATCH-26JUL22PENKUL";
const CLOSED_EVENT = "KXITFWMATCH-26JUL21SMIJON";

const OPEN_MARKETS: KalshiMarketWire[] = [
  wire({
    ticker: `${OPEN_EVENT}-PEN`,
    event_ticker: OPEN_EVENT,
    status: "open",
    yes_sub_title: "Pen",
    custom_strike: { tennis_competitor: COMP_A },
  }),
  wire({
    ticker: `${OPEN_EVENT}-KUL`,
    event_ticker: OPEN_EVENT,
    status: "open",
    yes_sub_title: "Kul",
    custom_strike: { tennis_competitor: COMP_B },
  }),
];

const CLOSED_MARKETS: KalshiMarketWire[] = [
  wire({
    ticker: `${CLOSED_EVENT}-SMI`,
    event_ticker: CLOSED_EVENT,
    status: "closed",
    yes_sub_title: "Smith",
    custom_strike: { tennis_competitor: COMP_A },
    result: "yes",
    occurrence_datetime: "2026-07-21T14:00:00Z",
  }),
  wire({
    ticker: `${CLOSED_EVENT}-JON`,
    event_ticker: CLOSED_EVENT,
    status: "closed",
    yes_sub_title: "Jones",
    custom_strike: { tennis_competitor: COMP_B },
    result: "no",
    occurrence_datetime: "2026-07-21T14:00:00Z",
  }),
];

/** Same closed ticker also returned under settled (dedupe proof). */
const SETTLED_DUP: KalshiMarketWire[] = [
  wire({
    ticker: `${CLOSED_EVENT}-SMI`,
    event_ticker: CLOSED_EVENT,
    status: "settled",
    yes_sub_title: "Smith",
    custom_strike: { tennis_competitor: COMP_A },
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

describe("kalshi markets query params", () => {
  test("fetchKalshiMarketsPage passes min_close_ts / min_settled_ts", async () => {
    let seen = "";
    const fetchImpl: KalshiFetchImpl = async (input) => {
      seen = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify({ markets: [] }), { status: 200 });
    };
    await fetchKalshiMarketsPage(
      { series_ticker: "KXITFWMATCH", status: "closed", min_close_ts: 1_700_000_000 },
      { fetchImpl, baseUrl: "https://example.test/trade-api/v2" },
    );
    expect(seen).toContain("min_close_ts=1700000000");
    expect(seen).toContain("status=closed");

    await fetchKalshiMarketsPage(
      { series_ticker: "KXITFWMATCH", status: "settled", min_settled_ts: 1_700_000_001 },
      { fetchImpl, baseUrl: "https://example.test/trade-api/v2" },
    );
    expect(seen).toContain("min_settled_ts=1700000001");
    expect(seen).toContain("status=settled");
  });
});

describe("settlementFromKalshiMarkets", () => {
  test("maps result=yes to yes_side_label winner", () => {
    const s = settlementFromKalshiMarkets(CLOSED_MARKETS);
    expect(s).toEqual({ winner: "Smith", loser: "Jones", outcome: "completed" });
  });
});

describe("fetchRetainedItfMarkets / syncItfEvents", () => {
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
      [`${CLOSED_EVENT}-JON`, `${CLOSED_EVENT}-SMI`, `${OPEN_EVENT}-KUL`, `${OPEN_EVENT}-PEN`].sort(),
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
      .get({ $ticker: `${CLOSED_EVENT}-SMI` }) as {
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
      .get({ $ticker: `${OPEN_EVENT}-PEN` }) as { winner: string; outcome: string };
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
      .get({ $p: `${CLOSED_EVENT}%` }) as { n: number };
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
        custom_strike: { tennis_competitor: COMP_A },
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
      wire({
        ticker: `${event}-BAR`,
        event_ticker: event,
        status: "open",
        yes_sub_title: "Bar",
        custom_strike: { tennis_competitor: COMP_B },
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
                custom_strike: { tennis_competitor: COMP_A },
              },
              {
                ticker: `${event}-BAR`,
                event_ticker: event,
                status: "open",
                yes_sub_title: "Bar",
                custom_strike: { tennis_competitor: COMP_B },
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
      .get({ $ticker: `${CLOSED_EVENT}-SMI` }) as { eventId: CanonicalEventId };
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
});
