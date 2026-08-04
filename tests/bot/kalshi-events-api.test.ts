import { describe, expect, test } from "bun:test";
import {
  competitorIdForMarket,
  parseKalshiEventsPageWire,
  parseKalshiMarketWire,
} from "../../src/bot/kalshi-events-api.ts";
import { IDENTITY } from "../../src/institutions/market-registry/brands.ts";
import { unbrand } from "../../src/institutions/event-store/brands.ts";
import { asSeriesTicker } from "../../src/institutions/event-store/brands.ts";

const ids = {
  tennis: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  doubles: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tableTennis: "cccccccc-cccc-cccc-cccc-cccccccccccc",
} as const;

describe("Kalshi market wire identities", () => {
  test("parses every registry-supported competitor field without collapsing them", () => {
    const market = parseKalshiMarketWire({
      ticker: "KXIDENTITY-TEST-A",
      event_ticker: "KXIDENTITY-TEST",
      status: "open",
      custom_strike: {
        tennis_competitor: ids.tennis,
        tennis_doubles_competitor: ids.doubles,
        table_tennis_competitor: ids.tableTennis,
      },
    });
    expect(market).not.toBeNull();
    expect(unbrand(competitorIdForMarket(market!, IDENTITY.tennisCompetitor)!)).toBe(
      ids.tennis,
    );
    expect(unbrand(competitorIdForMarket(market!, IDENTITY.tennisDoublesCompetitor)!)).toBe(
      ids.doubles,
    );
    expect(unbrand(competitorIdForMarket(market!, IDENTITY.tableTennisCompetitor)!)).toBe(
      ids.tableTennis,
    );
    expect(competitorIdForMarket(market!, IDENTITY.none)).toBeUndefined();
    expect(competitorIdForMarket(market!, IDENTITY.literalOutcome)).toBeUndefined();
  });

  test("drops malformed UUIDs instead of smuggling bare provider strings inward", () => {
    const market = parseKalshiMarketWire({
      ticker: "KXIDENTITY-TEST-A",
      event_ticker: "KXIDENTITY-TEST",
      status: "open",
      custom_strike: { table_tennis_competitor: "not-a-uuid" },
    });
    expect(market?.custom_strike).toBeUndefined();
  });
});

describe("Kalshi strict nested event pages", () => {
  const series = asSeriesTicker("KXATPSETWINNER");
  const event = {
    event_ticker: "KXATPSETWINNER-26AUG04TEST",
    series_ticker: "KXATPSETWINNER",
    title: "Player A vs Player B set winner",
    last_updated_ts: "2026-08-04T11:00:00Z",
    markets: [
      {
        ticker: "KXATPSETWINNER-26AUG04TEST-A",
        event_ticker: "KXATPSETWINNER-26AUG04TEST",
        title: "Player A to win set 1",
        market_type: "binary",
        status: "active",
        custom_strike: { tennis_competitor: ids.tennis },
      },
    ],
  };

  test("requires an explicit cursor and preserves empty-cursor terminal semantics", () => {
    expect(() => parseKalshiEventsPageWire({ events: [event] }, series)).toThrow(
      "cursor string required",
    );
    expect(parseKalshiEventsPageWire({ events: [event], cursor: "" }, series)).toMatchObject({
      events: [{ title: event.title }],
    });
    expect(parseKalshiEventsPageWire({ events: [], cursor: "next" }, series)).toEqual({
      events: [],
      nextCursor: "next",
    });
  });

  test("rejects selector, parent, duplicate, and identity drift without dropping rows", () => {
    expect(() =>
      parseKalshiEventsPageWire(
        { events: [{ ...event, markets: [] }], cursor: "" },
        series,
      ),
    ).toThrow("markets must not be empty");
    expect(() =>
      parseKalshiEventsPageWire(
        { events: [{ ...event, series_ticker: "KXOTHER" }], cursor: "" },
        series,
      ),
    ).toThrow("series selector drift");
    expect(() =>
      parseKalshiEventsPageWire(
        {
          events: [
            {
              ...event,
              markets: [{ ...event.markets[0], event_ticker: "KXOTHER-EVENT" }],
            },
          ],
          cursor: "",
        },
        series,
      ),
    ).toThrow("parent drift");
    expect(() =>
      parseKalshiEventsPageWire({ events: [event, event], cursor: "" }, series),
    ).toThrow("duplicate event");
    expect(() =>
      parseKalshiEventsPageWire(
        {
          events: [
            {
              ...event,
              markets: [
                {
                  ...event.markets[0],
                  custom_strike: { tennis_competitor: "not-a-uuid" },
                },
              ],
            },
          ],
          cursor: "",
        },
        series,
      ),
    ).toThrow("valid competitor id required");
  });
});
