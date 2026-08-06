import { describe, expect, test } from "bun:test";
import { asSeriesTicker } from "../../src/institutions/event-store/brands.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { runRegisteredSourceInventory } from "../../src/institutions/event-store/source-inventory-runner.ts";
import { listSourceEvents } from "../../src/institutions/event-store/source-market-store.ts";
import {
  createKalshiEventsInventoryAdapter,
  createKalshiEventsSourceAdapter,
} from "../../src/institutions/market-registry/adapters/kalshi-events.ts";
import {
  asSourceInventoryRunId,
  SOURCE,
  SPORT,
  unbrand,
} from "../../src/institutions/market-registry/brands.ts";
import {
  kalshiBindingForSeries,
  registrationFor,
  SPORTS_SOURCE_REGISTRY,
} from "../../src/institutions/market-registry/registry.ts";
import type { SourceFetchRequest } from "../../src/institutions/market-registry/types.ts";

const competitorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const series = asSeriesTicker("KXATPSETWINNER");
const binding = kalshiBindingForSeries(series)!;
const registration = registrationFor(SOURCE.kalshi, SPORT.tennis)!;
const tableSeries = asSeriesTicker("KXTABLETENNISMATCH");
const tableBinding = kalshiBindingForSeries(tableSeries)!;
const wtaSetSeries = asSeriesTicker("KXWTASETWINNER");
const wtaSetBinding = kalshiBindingForSeries(wtaSetSeries)!;

function request(overrides: Partial<SourceFetchRequest> = {}): SourceFetchRequest {
  return {
    selector: binding.selector,
    pageIndex: 0,
    limit: 200,
    ...overrides,
  };
}

function marketWire(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "KXATPSETWINNER-26AUG04TEST-A",
    event_ticker: "KXATPSETWINNER-26AUG04TEST",
    title: "Player A to win set 1",
    market_type: "binary",
    status: "active",
    yes_sub_title: "Player A",
    no_sub_title: "Player A",
    volume_fp: "125.5",
    volume_24h_fp: "25",
    open_interest_fp: "44",
    yes_bid_dollars: "0.61",
    yes_ask_dollars: "0.64",
    no_bid_dollars: "0.36",
    no_ask_dollars: "0.39",
    last_price_dollars: "0.62",
    occurrence_datetime: "2026-08-04T12:00:00Z",
    close_time: "2026-08-04T13:00:00Z",
    expected_expiration_time: "2026-08-05T13:00:00Z",
    updated_time: "2026-08-04T11:30:00Z",
    custom_strike: { tennis_competitor: competitorId },
    result: "",
    ...overrides,
  };
}

function eventWire(overrides: Record<string, unknown> = {}) {
  return {
    event_ticker: "KXATPSETWINNER-26AUG04TEST",
    series_ticker: "KXATPSETWINNER",
    title: "Player A vs Player B set winner",
    last_updated_ts: "2026-08-04T11:45:00Z",
    markets: [marketWire()],
    ...overrides,
  };
}

describe("Kalshi nested-events inventory adapter", () => {
  test("fetches the registered series as atomic nested events", async () => {
    let requestedUrl: URL | undefined;
    const adapter = createKalshiEventsSourceAdapter({
      now: () => 1_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json({ events: [eventWire()], cursor: "next-page" });
      },
    });
    const sourceRequest = request({ cursor: "current-page" });
    const wire = await adapter.fetchPage(sourceRequest);
    const page = adapter.parsePage(wire, sourceRequest);
    const [observation] = adapter.project(page, binding);

    expect(requestedUrl?.pathname).toBe("/trade-api/v2/events");
    expect(requestedUrl?.searchParams.get("series_ticker")).toBe("KXATPSETWINNER");
    expect(requestedUrl?.searchParams.get("status")).toBe("open");
    expect(requestedUrl?.searchParams.get("with_nested_markets")).toBe("true");
    expect(requestedUrl?.searchParams.get("cursor")).toBe("current-page");
    expect(page).toMatchObject({ nextCursor: "next-page", exhausted: false });
    expect(observation).toMatchObject({
      snapshotCompleteness: "partial",
      collectionCompleteness: "complete",
      eventType: "match",
      participantFormat: "singles",
      startsAtMs: Date.parse("2026-08-04T12:00:00Z"),
      participants: [{ id: competitorId, ordinal: 0, label: "Player A" }],
    });
    const firstMarket = observation?.markets?.[0];
    expect(firstMarket).toMatchObject({
      title: "Player A to win set 1",
      closesAtMs: Date.parse("2026-08-04T13:00:00Z"),
      subjectParticipantId: competitorId,
      volume: 125.5,
      volume24h: 25,
      openInterest: 44,
    });
    expect(firstMarket).not.toHaveProperty("liquidity");
    expect(
      firstMarket?.outcomes?.map((row) => ({
        key: unbrand(row.outcome),
        participantId: row.participantId ? unbrand(row.participantId) : null,
        bid: row.bid,
        ask: row.ask,
        last: row.last,
      })),
    ).toEqual([
      { key: "yes", participantId: competitorId, bid: 0.61, ask: 0.64, last: 0.62 },
      { key: "no", participantId: null, bid: 0.36, ask: 0.39, last: 0.38 },
    ]);
  });

  test("persists a complete registered tennis selector through the generic runner", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const adapter = createKalshiEventsInventoryAdapter({
      now: () => 1_000,
      fetchImpl: async () => Response.json({ events: [eventWire()], cursor: "" }),
    });
    const results = await runRegisteredSourceInventory(db, {
      adapters: [adapter],
      sports: [SPORT.tennis],
      sources: [SOURCE.kalshi],
      pageSize: 200,
      now: () => 900,
      mintRunId: (_source, _sport, targetBinding) =>
        asSourceInventoryRunId(`kalshi:${unbrand(targetBinding.selector.scope)}`),
      registry: {
        sports: SPORTS_SOURCE_REGISTRY.sports,
        sources: SPORTS_SOURCE_REGISTRY.sources,
        adapters: [adapter.definition],
        integrations: [
          {
            ...registration,
            declaredCapabilities: ["inventory"],
            operationalCapabilities: ["inventory"],
            competitions: [binding],
          },
        ],
      },
    });

    expect(results).toMatchObject([{ state: "complete", observedEventCount: 1 }]);
    expect(listSourceEvents(db, { source: SOURCE.kalshi, sport: SPORT.tennis })).toEqual([
      expect.objectContaining({ title: "Player A vs Player B set winner" }),
    ]);
    db.close();
  });

  test("omits unavailable partial scalars instead of clearing stored values", () => {
    const adapter = createKalshiEventsSourceAdapter({ now: () => 1_000 });
    const sparseMarket = marketWire({
      occurrence_datetime: undefined,
      close_time: undefined,
      updated_time: undefined,
      result: undefined,
      volume_fp: undefined,
      volume_24h_fp: undefined,
      open_interest_fp: undefined,
      yes_bid_dollars: undefined,
      yes_ask_dollars: undefined,
      no_bid_dollars: undefined,
      no_ask_dollars: undefined,
      last_price_dollars: undefined,
    });
    const sourceRequest = request();
    const page = adapter.parsePage(
      {
        payload: { events: [eventWire({ markets: [sparseMarket] })], cursor: "" },
        observedAtMs: 1_000,
      },
      sourceRequest,
    );
    const [observation] = adapter.project(page, binding);
    const projectedMarket = observation?.markets?.[0];

    expect(observation).not.toHaveProperty("startsAtMs");
    for (const field of ["closesAtMs", "result", "volume", "volume24h", "openInterest"] as const) {
      expect(projectedMarket).not.toHaveProperty(field);
    }
    for (const outcome of projectedMarket?.outcomes ?? []) {
      for (const field of ["probability", "bid", "ask", "last", "lastTradeAtMs"] as const) {
        expect(outcome).not.toHaveProperty(field);
      }
    }
  });

  test("projects table tennis with its distinct sport and identity field", () => {
    const adapter = createKalshiEventsSourceAdapter({ now: () => 1_000 });
    const tableRequest: SourceFetchRequest = {
      selector: tableBinding.selector,
      pageIndex: 0,
      limit: 200,
    };
    const tableEvent = {
      ...eventWire(),
      event_ticker: "KXTABLETENNISMATCH-26AUG04TEST",
      series_ticker: "KXTABLETENNISMATCH",
      title: "Table Player A vs Table Player B",
      markets: [
        marketWire({
          ticker: "KXTABLETENNISMATCH-26AUG04TEST-A",
          event_ticker: "KXTABLETENNISMATCH-26AUG04TEST",
          yes_sub_title: "Table Player A",
          no_sub_title: "Table Player A",
          custom_strike: { table_tennis_competitor: competitorId },
        }),
      ],
    };
    const page = adapter.parsePage(
      { payload: { events: [tableEvent], cursor: "" }, observedAtMs: 1_000 },
      tableRequest,
    );
    const [observation] = adapter.project(page, tableBinding);
    expect(observation).toMatchObject({
      sport: SPORT.tableTennis,
      participantFormat: "singles",
      participants: [{ id: competitorId, label: "Table Player A" }],
      markets: [{ subjectParticipantId: competitorId }],
    });
  });

  test("preserves verified WTA set-winner participant identities", () => {
    const adapter = createKalshiEventsSourceAdapter({ now: () => 1_000 });
    const wtaRequest: SourceFetchRequest = {
      selector: wtaSetBinding.selector,
      pageIndex: 0,
      limit: 200,
    };
    const wtaEvent = {
      ...eventWire(),
      event_ticker: "KXWTASETWINNER-26AUG04TEST",
      series_ticker: "KXWTASETWINNER",
      markets: [
        marketWire({
          ticker: "KXWTASETWINNER-26AUG04TEST-A",
          event_ticker: "KXWTASETWINNER-26AUG04TEST",
        }),
      ],
    };
    const page = adapter.parsePage(
      { payload: { events: [wtaEvent], cursor: "" }, observedAtMs: 1_000 },
      wtaRequest,
    );
    expect(adapter.project(page, wtaSetBinding)[0]).toMatchObject({
      participants: [{ id: competitorId, label: "Player A" }],
      markets: [{ subjectParticipantId: competitorId }],
    });
  });

  test("rejects malformed quotes, timestamps, and inconsistent event starts", () => {
    const adapter = createKalshiEventsSourceAdapter({ now: () => 1_000 });
    const cases = [
      eventWire({ markets: [marketWire({ yes_bid_dollars: "1.1" })] }),
      eventWire({ markets: [marketWire({ volume_fp: "-1" })] }),
      eventWire({ markets: [marketWire({ close_time: "not-a-date" })] }),
      eventWire({ markets: [marketWire({ market_type: "scalar" })] }),
      eventWire({ markets: [marketWire({ yes_sub_title: "" })] }),
      eventWire({
        markets: [
          marketWire(),
          marketWire({
            ticker: "KXATPSETWINNER-26AUG04TEST-B",
            occurrence_datetime: "2026-08-04T12:01:00Z",
          }),
        ],
      }),
    ];
    for (const event of cases) {
      const sourceRequest = request();
      const page = adapter.parsePage(
        { payload: { events: [event], cursor: "" }, observedAtMs: 1_000 },
        sourceRequest,
      );
      expect(() => adapter.project(page, binding)).toThrow();
    }
  });

  test("rejects invalid limits and repeated cursors without fetching or retiring", async () => {
    let fetched = false;
    const adapter = createKalshiEventsSourceAdapter({
      fetchImpl: async () => {
        fetched = true;
        return Response.json({ events: [], cursor: "" });
      },
    });
    for (const limit of [0, -1, 1.5, 201]) {
      await expect(adapter.fetchPage(request({ limit }))).rejects.toThrow(
        "safe integer in [1, 200]",
      );
    }
    expect(fetched).toBe(false);
    const repeated = request({ cursor: "same" });
    expect(() =>
      adapter.parsePage(
        { payload: { events: [], cursor: "same" }, observedAtMs: 1_000 },
        repeated,
      ),
    ).toThrow("cursor did not advance");
  });
});
