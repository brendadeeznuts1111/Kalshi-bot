import { describe, expect, test } from "bun:test";
import {
  competitorIdForMarket,
  parseKalshiMarketWire,
} from "../../src/bot/kalshi-events-api.ts";
import { IDENTITY } from "../../src/institutions/market-registry/brands.ts";
import { unbrand } from "../../src/institutions/event-store/brands.ts";

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
