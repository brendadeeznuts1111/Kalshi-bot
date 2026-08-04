// @see https://bun.com/docs/test — bun:test
// @see https://bun.com/docs/runtime/sqlite — bun:sqlite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  loadMarketLiquidityByTicker,
  linkCurrentBoardEvents,
  parseLoggerArgv,
} from "../../scripts/price-logger.ts";
import { queryEventsWithBooks } from "../../src/institutions/event-store/cross-market.ts";
import { asSeriesTicker } from "../../src/institutions/event-store/brands.ts";
import { SPORT } from "../../src/institutions/market-registry/brands.ts";

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
              sport: SPORT.tennis,
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

    const tableBoard = structuredClone(board);
    tableBoard.series[0]!.events[0]!.sport = SPORT.tableTennis;
    expect(() => linkCurrentBoardEvents(db as never, tableBoard as never)).toThrow(
      "cannot ingest a non-tennis board",
    );
  });

  test("book fallback stays inside the registry trade-series allowlist", () => {
    db.run(`CREATE TABLE events (
      event_id TEXT PRIMARY KEY,
      tournament TEXT,
      player_a TEXT,
      player_b TEXT,
      surface TEXT,
      start_ts TEXT
    )`);
    db.run(`ALTER TABLE markets ADD COLUMN event_id TEXT`);
    db.run(`ALTER TABLE markets ADD COLUMN series TEXT NOT NULL DEFAULT ''`);
    db.run(`CREATE TABLE book_ticks (
      id INTEGER PRIMARY KEY,
      event_id TEXT,
      ticker TEXT,
      ts INTEGER,
      levels_json TEXT
    )`);
    db.run(
      `INSERT INTO events VALUES
       ('tennis-event', 'Toronto', 'Alpha', 'Beta', 'Hard', '2026-08-04'),
       ('table-event', 'WTT', 'Gamma', 'Delta', '', '2026-08-04')`,
    );
    db.run(
      `INSERT INTO markets (market_id, event_id, ticker, series) VALUES
       ('tennis-market', 'tennis-event', 'KXATPMATCH-26AUG04ALPBET-ALP', 'KXATPMATCH'),
       ('table-market', 'table-event', 'KXTABLETENNISMATCH-26AUG04GAMDEL-GAM', 'KXTABLETENNISMATCH')`,
    );
    db.run(
      `INSERT INTO book_ticks (event_id, ticker, ts, levels_json) VALUES
       ('tennis-event', 'KXATPMATCH-26AUG04ALPBET-ALP', 1, '{"bids":[],"asks":[]}'),
       ('table-event', 'KXTABLETENNISMATCH-26AUG04GAMDEL-GAM', 1, '{"bids":[],"asks":[]}')`,
    );

    const rows = queryEventsWithBooks(db, [asSeriesTicker("KXATPMATCH")]);
    expect(rows.map((row) => row.eventId)).toEqual(["tennis-event"]);
  });
});
