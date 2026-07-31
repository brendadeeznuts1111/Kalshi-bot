// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  OFFICIAL_URLS,
  OFFICIAL_URL_PROBES,
  resolveProbeUrl,
} from "../../src/institutions/official-urls.ts";

describe("OFFICIAL_URLS probes", () => {
  test("API bases get exchange/status (or sports) probes", () => {
    const prod = resolveProbeUrl(
      "kalshi",
      "tradeApiV2Base",
      OFFICIAL_URLS.kalshi.tradeApiV2Base,
    );
    expect(prod?.url).toBe(
      "https://external-api.kalshi.com/trade-api/v2/exchange/status",
    );

    const odds = resolveProbeUrl(
      "oddsApi",
      "apiBaseV4",
      OFFICIAL_URLS.oddsApi.apiBaseV4,
    );
    expect(odds?.url).toContain("/sports");
    expect(odds?.okStatuses).toContain(401);

    const ws = resolveProbeUrl(
      "kalshi",
      "tradeApiWsV2",
      OFFICIAL_URLS.kalshi.tradeApiWsV2,
    );
    expect(ws).toBeNull();
  });

  test("docs paths use current Kalshi docs tree", () => {
    expect(OFFICIAL_URLS.kalshi.seriesList).toContain("/market/get-series-list");
    expect(OFFICIAL_URLS.kalshi.portfolioOrders).toContain("/orders/get-orders");
  });

  test("every probe key maps to a real catalog entry", () => {
    for (const key of Object.keys(OFFICIAL_URL_PROBES)) {
      const [cat, ...rest] = key.split(".");
      const field = rest.join(".");
      const bucket = OFFICIAL_URLS[cat as keyof typeof OFFICIAL_URLS] as
        | Record<string, string>
        | undefined;
      expect(bucket?.[field], `missing OFFICIAL_URLS.${key}`).toBeTruthy();
    }
  });
});
