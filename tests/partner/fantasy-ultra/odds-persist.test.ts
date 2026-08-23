import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  PANDORA_ODDS_SOURCE,
  partnerMarketsToOddsTicks,
  persistCoefficientMarkets,
} from "../../../src/partner/fantasy-ultra/odds-persist.ts";
import type { PartnerMarket } from "../../../src/partner/types.ts";

const LIMITS = { maxStake: 0, maxWin: 0, currency: "USD", note: "test" };

function market(oddsEventId: string, homePrice: number | null, awayPrice: number | null): PartnerMarket {
  return {
    partner: "fantasy402",
    ticker: "f402:" + oddsEventId + ":m:3",
    name: "ML " + oddsEventId,
    oddsEventId,
    marketId: oddsEventId + ":m:3",
    homePrice,
    awayPrice,
    label: "moneyline",
    limits: LIMITS,
    source: "pandora.eventCoefficients",
  };
}

describe("fantasy402 → odds_ticks capture bridge", () => {
  test("partnerMarketsToOddsTicks maps American prices to decimal sides", () => {
    const ticks = partnerMarketsToOddsTicks([market("1001", -110, 120)], 500);
    expect(ticks).toEqual([
      { eventId: "1001", source: PANDORA_ODDS_SOURCE, side: "home", decimalOdds: 1.9090909090909092, ts: 500 },
      { eventId: "1001", source: PANDORA_ODDS_SOURCE, side: "away", decimalOdds: 2.2, ts: 500 },
    ]);
  });

  test("unpriced sides are skipped", () => {
    const ticks = partnerMarketsToOddsTicks([market("1002", null, 150)], 500);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.side).toBe("away");
    expect(ticks[0]!.decimalOdds).toBe(2.5);
  });

  test("persistCoefficientMarkets writes rows the store can read back", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE odds_ticks (id INTEGER PRIMARY KEY, event_id TEXT, source TEXT, side TEXT, decimal_odds REAL, implied_prob REAL, ts INTEGER, source_url TEXT DEFAULT '', fetched_ts INTEGER, corpus TEXT DEFAULT 'trading', limit_context TEXT)");
    const n = persistCoefficientMarkets(db, [market("2001", -110, 120)], 700);
    expect(n).toBe(2);
    const row = db.query("SELECT event_id, side, decimal_odds, implied_prob, limit_context FROM odds_ticks ORDER BY side").all() as Array<{ event_id: string; side: string; decimal_odds: number; implied_prob: number; limit_context: string }>;
    expect(row).toHaveLength(2);
    expect(row[0]!.event_id).toBe("2001");
    expect(row[0]!.limit_context).toBe("live");
    expect(row[0]!.implied_prob).toBeCloseTo(1 / row[0]!.decimal_odds, 6);
  });
});
