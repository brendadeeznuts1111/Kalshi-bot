import { afterEach, describe, expect, test } from "bun:test";
import { asSeriesTicker, unbrand } from "../../src/institutions/event-store/brands.ts";
import { SPORT } from "../../src/institutions/market-registry/brands.ts";
import {
  kalshiInventorySeriesForSport,
  kalshiReconciliationSeriesForSport,
  kalshiTradeSeriesForSport,
} from "../../src/institutions/market-registry/registry.ts";
import {
  fetchKalshiSportBoard,
  fetchTableTennisInventoryBoard,
  resetTennisBoardCache,
} from "../../src/research/tennis-events.ts";

const IDS = {
  tennis: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  doubles: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  table: "cccccccc-cccc-cccc-cccc-cccccccccccc",
} as const;

function boardFetch(calls: string[]) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const series = url.searchParams.get("series_ticker")!;
    calls.push(series);
    const customStrike =
      series === "KXATPDOUBLES"
        ? { tennis_doubles_competitor: IDS.doubles }
        : series === "KXTABLETENNISMATCH"
          ? { table_tennis_competitor: IDS.table }
          : { tennis_competitor: IDS.tennis };
    const markets = [
        {
          ticker: `${series}-26AUG04ALPBET-ALP`,
          event_ticker: `${series}-26AUG04ALPBET`,
          status: "open",
          yes_sub_title: series === "KXITTFMEN" ? "Field entrant" : "Alpha Player",
          custom_strike: customStrike,
          yes_bid_dollars: "0.45",
          yes_ask_dollars: "0.47",
        },
      ];
    if (series === "KXITTFMEN") {
      markets.push({
        ...markets[0]!,
        ticker: `${series}-26AUG04FIELD-BET`,
        yes_sub_title: "Second entrant",
      });
    }
    return Response.json({
      markets,
    });
  };
}

afterEach(() => resetTennisBoardCache());

describe("registry-driven Kalshi sport boards", () => {
  test("selects exact operational scopes for inventory, reconciliation, and trade", async () => {
    const inventoryCalls: string[] = [];
    await fetchTableTennisInventoryBoard({ fetchImpl: boardFetch(inventoryCalls), nowMs: 1 });
    expect(inventoryCalls.sort()).toEqual(
      kalshiInventorySeriesForSport(SPORT.tableTennis).map(unbrand).sort(),
    );
    expect(inventoryCalls).toHaveLength(8);

    const reconciliationCalls: string[] = [];
    await fetchKalshiSportBoard({
      sport: SPORT.tennis,
      purpose: "reconciliation",
      fetchImpl: boardFetch(reconciliationCalls),
      nowMs: 1,
    });
    expect(reconciliationCalls.sort()).toEqual(
      kalshiReconciliationSeriesForSport(SPORT.tennis).map(unbrand).sort(),
    );

    const tradeCalls: string[] = [];
    await fetchKalshiSportBoard({
      sport: SPORT.tennis,
      purpose: "trade",
      fetchImpl: boardFetch(tradeCalls),
      nowMs: 1,
    });
    expect(tradeCalls.sort()).toEqual(
      kalshiTradeSeriesForSport(SPORT.tennis).map(unbrand).sort(),
    );
  });

  test("isolates cache entries by sport and purpose", async () => {
    const calls: string[] = [];
    const fetchImpl = boardFetch(calls);
    await fetchTableTennisInventoryBoard({ fetchImpl, nowMs: 1 });
    const tableCallCount = calls.length;
    await fetchTableTennisInventoryBoard({ fetchImpl, nowMs: 2 });
    expect(calls).toHaveLength(tableCallCount);

    await fetchKalshiSportBoard({
      sport: SPORT.tennis,
      purpose: "trade",
      fetchImpl,
      nowMs: 2,
    });
    expect(calls).toHaveLength(
      tableCallCount + kalshiTradeSeriesForSport(SPORT.tennis).length,
    );
  });

  test("projects the registry-declared identity and preserves field inventory semantics", async () => {
    const doubles = await fetchKalshiSportBoard({
      sport: SPORT.tennis,
      purpose: "inventory",
      series: [asSeriesTicker("KXATPDOUBLES")],
      fetchImpl: boardFetch([]),
    });
    expect(doubles.series[0]?.events[0]?.markets[0]?.competitorId).toBe(IDS.doubles);

    const table = await fetchKalshiSportBoard({
      sport: SPORT.tableTennis,
      purpose: "inventory",
      series: [
        asSeriesTicker("KXTABLETENNISMATCH"),
        asSeriesTicker("KXITTFMEN"),
      ],
      fetchImpl: boardFetch([]),
    });
    expect(table.series[0]).toMatchObject({
      sport: SPORT.tableTennis,
      purpose: "inventory",
      eventTypes: ["match"],
      participantFormats: ["singles"],
    });
    expect(table.series[0]?.events[0]?.markets[0]?.competitorId).toBe(IDS.table);
    expect(table.series[1]).toMatchObject({
      eventTypes: ["tournament"],
      participantFormats: ["field"],
    });
    expect(table.series[1]?.events[0]?.markets).toHaveLength(2);
    expect(table.series[1]?.events[0]).toMatchObject({
      competition: "ittf",
      title: "ittf",
      tour: null,
      level: null,
      tier: null,
      surface: null,
    });
    expect(table.series[1]?.events[0]?.title).not.toContain(" vs ");
    expect(table.series[1]?.events[0]?.markets[0]).toMatchObject({
      playerCountry: null,
      playerCountryCode: null,
    });

    await expect(
      fetchKalshiSportBoard({
        sport: SPORT.tennis,
        purpose: "inventory",
        series: [asSeriesTicker("KXUNKNOWN")],
        fetchImpl: boardFetch([]),
      }),
    ).rejects.toThrow("not operational for tennis inventory");

    await expect(
      fetchKalshiSportBoard({
        sport: SPORT.tableTennis,
        purpose: "reconciliation",
        series: [asSeriesTicker("KXTABLETENNISMATCH")],
        fetchImpl: boardFetch([]),
      }),
    ).rejects.toThrow("not operational for table_tennis reconciliation");

    await expect(
      fetchKalshiSportBoard({
        sport: SPORT.tableTennis,
        purpose: "trade",
        fetchImpl: boardFetch([]),
      }),
    ).rejects.toThrow("Kalshi trade is not operational for table_tennis");

    await expect(
      fetchKalshiSportBoard({
        sport: SPORT.tennis,
        purpose: "trade",
        series: [asSeriesTicker("KXATPSETWINNER")],
        fetchImpl: boardFetch([]),
      }),
    ).rejects.toThrow("not operational for tennis trade");
  });
});
