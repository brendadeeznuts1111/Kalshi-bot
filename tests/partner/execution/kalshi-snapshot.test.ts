import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  type ApprovedAuthorization,
  type AuthorizationPolicy,
} from "../../../src/partner/authorization/domain.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
  asMarketSelection,
} from "../../../src/partner/execution/domain.ts";
import {
  createKalshiExecutionSnapshotLoader,
  loadKalshiMarketExecutionQuote,
} from "../../../src/partner/execution/kalshi-snapshot.ts";

const NOW_MS = 1_700_000_000_000;

function database(levelsJson = JSON.stringify({
  ts: NOW_MS - 100,
  seq: 1,
  bids: [{ priceCents: 60, size: 4 }, { priceCents: 55, size: 20 }],
  asks: [{ priceCents: 65, size: 3 }, { priceCents: 70, size: 10 }],
})): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE book_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT,
      ts INTEGER NOT NULL,
      recv_ts INTEGER,
      levels_json TEXT NOT NULL,
      source TEXT NOT NULL
    );
  `);
  db.query(
    `INSERT INTO book_ticks (ticker, ts, recv_ts, levels_json, source)
     VALUES ('KXTEST', $ts, $ts, $levels, 'kalshi-ws')`,
  ).run({ $ts: NOW_MS - 100, $levels: levelsJson });
  return db;
}

describe("Kalshi execution snapshot loader", () => {
  test("derives YES and NO executable liquidity in minor units", () => {
    const db = database();
    const yes = loadKalshiMarketExecutionQuote(db, {
      ticker: "KXTEST",
      side: "yes",
      nowMs: NOW_MS,
      maxAgeMs: 1_000,
    });
    const no = loadKalshiMarketExecutionQuote(db, {
      ticker: "KXTEST",
      side: "no",
      nowMs: NOW_MS,
      maxAgeMs: 1_000,
    });
    expect(yes).toMatchObject({
      priceCents: 65,
      availableContracts: 3,
      marketLiquidity: 195,
      fresh: true,
    });
    expect(no).toMatchObject({
      priceCents: 40,
      availableContracts: 4,
      marketLiquidity: 160,
      fresh: true,
    });
    expect(yes.decimalOdds).toBeCloseTo(100 / 65);
    db.close();
  });

  test("marks stale or future-dated books not fresh", () => {
    const db = database();
    expect(loadKalshiMarketExecutionQuote(db, {
      ticker: "KXTEST",
      side: "yes",
      nowMs: NOW_MS + 2_000,
      maxAgeMs: 1_000,
    }).fresh).toBeFalse();
    expect(loadKalshiMarketExecutionQuote(db, {
      ticker: "KXTEST",
      side: "yes",
      nowMs: NOW_MS - 200,
      maxAgeMs: 1_000,
    }).fresh).toBeFalse();
    db.close();
  });

  test("fails closed for missing, malformed, crossed, and empty books", () => {
    const missing = database();
    expect(() => loadKalshiMarketExecutionQuote(missing, {
      ticker: "OTHER",
      side: "yes",
      nowMs: NOW_MS,
    })).toThrow(/No Kalshi book snapshot/);
    missing.close();

    for (const levels of [
      "not-json",
      JSON.stringify({ bids: [{ priceCents: 70, size: 1 }], asks: [{ priceCents: 65, size: 1 }] }),
      JSON.stringify({ bids: [], asks: [] }),
    ]) {
      const db = database(levels);
      expect(() => loadKalshiMarketExecutionQuote(db, {
        ticker: "KXTEST",
        side: "yes",
        nowMs: NOW_MS,
      })).toThrow();
      db.close();
    }
  });

  test("binds gate freshness to the executable quote price", async () => {
    const db = database();
    const currentPolicy = policy();
    const authorization = {} as ApprovedAuthorization;
    const request = {
      partnerCode: currentPolicy.partnerCode,
      outId: currentPolicy.outId,
      skin: currentPolicy.skin,
      marketId: asMarketId("KXTEST"),
      selection: asMarketSelection("yes"),
      idempotencyKey: asExecutionIdempotencyKey("quote-bind"),
      requestedStake: 100,
      decimalOdds: 100 / 65,
    };
    const load = createKalshiExecutionSnapshotLoader({
      db,
      side: "yes",
      now: () => NOW_MS,
      maxAgeMs: 1_000,
      loadCurrentPolicy: () => currentPolicy,
      loadSitePerBetMax: () => 1_000,
      loadAvailableBalance: () => 5_000,
      isProviderSessionValid: () => true,
      isRiskHealthy: () => true,
    });
    expect(await load(authorization, request)).toMatchObject({
      oddsFresh: true,
      marketLiquidity: 195,
      stakeQuantum: 65,
      sitePerBetMax: 1_000,
      availableBalance: 5_000,
    });
    expect(await load(authorization, { ...request, decimalOdds: 2 })).toMatchObject({
      oddsFresh: false,
    });
    db.close();
  });
});

function policy(): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("kalshi"),
    skin: asSkinId("demo"),
    scope: "live_trade",
    maxStake: 10_000,
    maxWin: 20_000,
    maxWinBasis: "profit",
    dailyLimit: null,
    exposureLimit: null,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: null,
  };
}
