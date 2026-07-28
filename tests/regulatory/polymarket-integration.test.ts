/**
 * tests/regulatory/polymarket-integration.test.ts
 *
 * Tests for Polymarket Gamma API client + line-movement tracker.
 * Uses mocked fetch to avoid live network calls.
 */

import { describe, expect, test } from "bun:test";
import {
  fetchPolymarketMarkets,
  fetchPolymarketMarket,
  marketToTick,
  PolymarketLineTracker,
  type PolymarketMarket,
  type PolymarketFetchImpl,
} from "../../src/regulatory/integrations/polymarket";
import { OFFICIAL_URLS } from "../../src/institutions/official-urls";

function mockFetch(responseBody: unknown, status = 200): PolymarketFetchImpl {
  return async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function mockMarket(overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  return {
    id: "m1",
    slug: "test-market",
    question: "Will it rain?",
    description: "Test market",
    conditionId: "c1",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.6, 0.4],
    volume: 100000,
    volume24hr: 5000,
    volume1wk: 20000,
    volume1mo: 50000,
    liquidity: 10000,
    liquidityClob: 8000,
    openInterest: 5000,
    lastTradePrice: 0.6,
    bestBid: 0.58,
    bestAsk: 0.62,
    spread: 0.04,
    active: true,
    closed: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    endDate: "2026-12-31T23:59:59Z",
    ...overrides,
  };
}

describe("fetchPolymarketMarkets", () => {
  test("returns normalized markets from Gamma API", async () => {
    const raw = [
      {
        id: "m1",
        slug: "market-1",
        question: "Q1",
        conditionId: "c1",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.6","0.4"]',
        volume: "100000",
        volume24hr: "5000",
        liquidity: "10000",
        liquidityClob: "8000",
        lastTradePrice: "0.6",
        bestBid: "0.58",
        bestAsk: "0.62",
        active: true,
        closed: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ];

    const markets = await fetchPolymarketMarkets({
      fetchImpl: mockFetch(raw),
    });

    expect(markets.length).toBe(1);
    expect(markets[0].slug).toBe("market-1");
    expect(markets[0].outcomes).toEqual(["Yes", "No"]);
    expect(markets[0].outcomePrices).toEqual([0.6, 0.4]);
    expect(markets[0].volume).toBe(100000);
  });

  test("uses OFFICIAL_URLS.polymarket.gammaApiBase as default base", async () => {
    let capturedUrl: string | undefined;
    const spyFetch: PolymarketFetchImpl = async (input) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await fetchPolymarketMarkets({ fetchImpl: spyFetch });
    expect(capturedUrl).toContain(OFFICIAL_URLS.polymarket.gammaApiBase);
  });

  test("retries on 429 and succeeds", async () => {
    let calls = 0;
    const retryFetch: PolymarketFetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 });
      }
      return new Response(
        JSON.stringify([{
          id: "m1", slug: "retry-test", question: "Q", conditionId: "c1",
          outcomes: '["Yes","No"]', outcomePrices: '["0.6","0.4"]',
          volume: "1000", volume24hr: "100", liquidity: "500",
          lastTradePrice: "0.6", active: true, closed: false,
          createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
        }]),
        { status: 200 },
      );
    };

    const markets = await fetchPolymarketMarkets({
      fetchImpl: retryFetch, retries: 2, backoffMs: 1, jitter: 0,
    });
    expect(calls).toBe(2);
    expect(markets[0].slug).toBe("retry-test");
  });

  test("throws on non-2xx response", async () => {
    const badFetch = mockFetch({ error: "Rate limited" }, 429);
    await expect(fetchPolymarketMarkets({ fetchImpl: badFetch })).rejects.toThrow("Polymarket API");
  });
});

describe("fetchPolymarketMarket", () => {
  test("returns single market by id", async () => {
    const raw = {
      id: "m2",
      slug: "market-2",
      question: "Q2",
      conditionId: "c2",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.7","0.3"]',
      volume: "200000",
      volume24hr: "10000",
      liquidity: "20000",
      lastTradePrice: "0.7",
      active: true,
      closed: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    };

    const market = await fetchPolymarketMarket("m2", { fetchImpl: mockFetch(raw) });
    expect(market.id).toBe("m2");
    expect(market.outcomePrices).toEqual([0.7, 0.3]);
  });
});

describe("marketToTick", () => {
  test("converts market to tick snapshot", () => {
    const market = mockMarket({
      slug: "tick-test",
      outcomePrices: [0.55, 0.45],
      lastTradePrice: 0.55,
      bestBid: 0.53,
      bestAsk: 0.57,
      spread: 0.04,
      volume24hr: 3000,
      volume: 50000,
      liquidityClob: 4000,
    });

    const now = 1_700_000_000_000;
    const tick = marketToTick(market, now);

    expect(tick.slug).toBe("tick-test");
    expect(tick.yesPrice).toBe(0.55);
    expect(tick.noPrice).toBe(0.45);
    expect(tick.bestBid).toBe(0.53);
    expect(tick.bestAsk).toBe(0.57);
    expect(tick.spread).toBe(0.04);
    expect(tick.volume24hr).toBe(3000);
    expect(tick.volumeTotal).toBe(50000);
    expect(tick.liquidity).toBe(4000);
    expect(tick.timestamp).toBe(Math.floor(now / 1000));
  });

  test("falls back to lastTradePrice when outcomePrices missing", () => {
    const market = mockMarket({
      outcomePrices: [],
      lastTradePrice: 0.65,
    });

    const tick = marketToTick(market);
    expect(tick.yesPrice).toBe(0.65);
    expect(tick.noPrice).toBe(0.35);
  });
});

describe("PolymarketLineTracker", () => {
  test("detects significant line move above threshold", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500, // 5%
      minVolume24hr: 1000,
      windowSeconds: 300,
      maxSpread: 0.05,
    });

    const t1 = {
      slug: "test",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    };

    const t2 = {
      slug: "test",
      yesPrice: 0.56,
      noPrice: 0.44,
      bestBid: 0.55,
      bestAsk: 0.57,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1100,
    };

    // First tick establishes baseline
    expect(tracker.ingest(t1)).toEqual([]);
    // Second tick triggers move: (0.56-0.50)/0.50 = 12% = 1200 bp
    const moves = tracker.ingest(t2);
    expect(moves.length).toBe(1);
    expect(moves[0].direction).toBe("up");
    expect(moves[0].deltaBp).toBe(1200);
  });

  test("ignores move below threshold", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 1000, // 10%
      minVolume24hr: 1000,
      windowSeconds: 300,
      maxSpread: 0.05,
    });

    const t1 = { ...marketToTick(mockMarket()), timestamp: 1000 };
    const t2 = {
      ...marketToTick(mockMarket({ lastTradePrice: 0.55 })),
      timestamp: 1100,
    };

    tracker.ingest(t1);
    const moves = tracker.ingest(t2);
    expect(moves.length).toBe(0);
  });

  test("ignores move with insufficient volume", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500,
      minVolume24hr: 5000,
      windowSeconds: 300,
      maxSpread: 0.05,
    });

    const t1 = {
      slug: "test",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 100,
      volumeTotal: 1000,
      liquidity: 500,
      timestamp: 1000,
    };

    const t2 = {
      slug: "test",
      yesPrice: 0.6,
      noPrice: 0.4,
      bestBid: 0.59,
      bestAsk: 0.61,
      spread: 0.02,
      volume24hr: 100,
      volumeTotal: 1000,
      liquidity: 500,
      timestamp: 1100,
    };

    tracker.ingest(t1);
    expect(tracker.ingest(t2)).toEqual([]);
  });

  test("ignores move with too-wide spread", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500,
      minVolume24hr: 1000,
      windowSeconds: 300,
      maxSpread: 0.02, // very tight
    });

    const t1 = {
      slug: "test",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.48,
      bestAsk: 0.52,
      spread: 0.04, // too wide
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    };

    const t2 = {
      slug: "test",
      yesPrice: 0.56,
      noPrice: 0.44,
      bestBid: 0.54,
      bestAsk: 0.58,
      spread: 0.04, // too wide
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1100,
    };

    tracker.ingest(t1);
    expect(tracker.ingest(t2)).toEqual([]);
  });

  test("tracks multiple slugs independently", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500,
      minVolume24hr: 1000,
      windowSeconds: 300,
      maxSpread: 0.05,
    });

    const slugA_t1 = {
      slug: "A",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    };

    const slugA_t2 = {
      slug: "A",
      yesPrice: 0.6,
      noPrice: 0.4,
      bestBid: 0.59,
      bestAsk: 0.61,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1100,
    };

    const slugB_t1 = {
      slug: "B",
      yesPrice: 0.3,
      noPrice: 0.7,
      bestBid: 0.29,
      bestAsk: 0.31,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    };

    tracker.ingest(slugA_t1);
    tracker.ingest(slugB_t1);
    const moves = tracker.ingest(slugA_t2);
    expect(moves.length).toBe(1);
    expect(moves[0].slug).toBe("A");
  });

  test("status returns tracked slug counts", () => {
    const tracker = new PolymarketLineTracker();
    tracker.ingest({
      slug: "s1",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    });
    tracker.ingest({
      slug: "s2",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    });

    const status = tracker.status();
    expect(Object.keys(status)).toContain("s1");
    expect(Object.keys(status)).toContain("s2");
  });

  test("reset clears all history", () => {
    const tracker = new PolymarketLineTracker();
    tracker.ingest({
      slug: "s1",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 2000,
      volumeTotal: 10000,
      liquidity: 5000,
      timestamp: 1000,
    });
    expect(Object.keys(tracker.status()).length).toBe(1);
    tracker.reset();
    expect(Object.keys(tracker.status()).length).toBe(0);
  });
});
