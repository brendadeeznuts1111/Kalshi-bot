// @see https://bun.com/docs/test — bun:test
// @see https://bun.com/docs/runtime/sqlite — bun:sqlite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  loadMarketLiquidityByTicker,
  linkCurrentBoardEvents,
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

  test("loadMarketLiquidityByTicker preserves 24h zero separately from lifetime", () => {
    db.run(
      `INSERT INTO markets (market_id, ticker, volume_fp, volume_24h_fp, open_interest_fp)
       VALUES ('m1', 'KX-A', '100', '250', '40'),
              ('m2', 'KX-B', '90', null, '10'),
              ('m3', 'KX-C', null, null, null),
              ('m4', 'KX-D', '500', '0.00', '1')`,
    );
    const map = loadMarketLiquidityByTicker(db as never);
    expect(map.get("KX-A")).toEqual({ volume24h: 250, volumeLifetime: 100, openInterest: 40 });
    expect(map.get("KX-B")).toEqual({ volume24h: 0, volumeLifetime: 90, openInterest: 10 });
    expect(map.get("KX-C")).toEqual({ volume24h: 0, volumeLifetime: 0, openInterest: 0 });
    expect(map.get("KX-D")).toEqual({ volume24h: 0, volumeLifetime: 500, openInterest: 1 });
  });

  test("parseLoggerArgv accepts --dry-run as once + dryRun", () => {
    const opts = parseLoggerArgv(["--dry-run"]);
    expect(opts.dryRun).toBe(true);
    expect(opts.once).toBe(true);
  });

  test("linkCurrentBoardEvents prefers the current player-A market once per event", () => {
    db.run(`CREATE TABLE events (
      event_id TEXT PRIMARY KEY,
      tournament TEXT,
      player_a TEXT,
      player_b TEXT,
      surface TEXT
    )`);
    db.run(
      `INSERT INTO events VALUES ('event-1', 'Toronto', 'Alpha One', 'Beta Two', 'Hard')`,
    );
    db.run(`ALTER TABLE markets ADD COLUMN event_id TEXT`);
    db.run(`ALTER TABLE markets ADD COLUMN yes_side_label TEXT`);
    db.run(
      `INSERT INTO markets (market_id, event_id, ticker, yes_side_label)
       VALUES ('a', 'event-1', 'KXATPMATCH-26AUG04ONETWO-ONE', 'Alpha One'),
              ('b', 'event-1', 'KXATPMATCH-26AUG04ONETWO-TWO', 'Beta Two')`,
    );
    const board = {
      generatedAt: "2026-08-04T00:00:00Z",
      eventCount: 1,
      marketCount: 2,
      series: [
        {
          series: "KXATPMATCH",
          state: "ok",
          events: [
            {
              markets: [
                {
                  ticker: "KXATPMATCH-26AUG04ONETWO-TWO",
                  player: "Beta Two",
                  yesBidCents: 40,
                  yesAskCents: 42,
                  volume24h: 25,
                  openInterest: 8,
                },
                {
                  ticker: "KXATPMATCH-26AUG04ONETWO-ONE",
                  player: "Alpha One",
                  yesBidCents: 58,
                  yesAskCents: 60,
                  volume24h: 30,
                  openInterest: 9,
                },
              ],
            },
          ],
        },
      ],
    };

    const linked = linkCurrentBoardEvents(db as never, board as never);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.ticker).toBe("KXATPMATCH-26AUG04ONETWO-ONE");
    expect(JSON.parse(linked[0]!.levelsJson)).toMatchObject({
      volume24h: 30,
      openInterest: 9,
    });
  });
});
