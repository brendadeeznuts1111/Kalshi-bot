// @see https://bun.com/docs/test — bun:test
// @see https://bun.com/docs/runtime/sqlite — bun:sqlite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  loadMarketLiquidityByTicker,
  parseLoggerArgv,
} from "../../scripts/price-logger.ts";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE markets (
    market_id TEXT PRIMARY KEY,
    ticker TEXT,
    volume_fp TEXT,
    volume_24h_fp TEXT,
    open_interest_fp TEXT
  )`);
  return db;
}

describe("price-logger volume wiring", () => {
  let db: Database;
  beforeEach(() => {
    db = seedDb();
  });
  afterEach(() => {
    db.close();
  });

  test("loadMarketLiquidityByTicker prefers volume_24h_fp over volume_fp", () => {
    db.run(
      `INSERT INTO markets (market_id, ticker, volume_fp, volume_24h_fp, open_interest_fp)
       VALUES ('m1', 'KX-A', '100', '250', '40'),
              ('m2', 'KX-B', '90', null, '10'),
              ('m3', 'KX-C', null, null, null),
              ('m4', 'KX-D', '500', '0.00', '1')`,
    );
    const map = loadMarketLiquidityByTicker(db as never);
    expect(map.get("KX-A")).toEqual({ volume24h: 250, openInterest: 40 });
    expect(map.get("KX-B")).toEqual({ volume24h: 90, openInterest: 10 });
    expect(map.get("KX-C")).toEqual({ volume24h: null, openInterest: null });
    // "0.00" 24h must fall back to lifetime volume_fp
    expect(map.get("KX-D")).toEqual({ volume24h: 500, openInterest: 1 });
  });

  test("parseLoggerArgv accepts --dry-run as once + dryRun", () => {
    const opts = parseLoggerArgv(["--dry-run"]);
    expect(opts.dryRun).toBe(true);
    expect(opts.once).toBe(true);
  });
});
