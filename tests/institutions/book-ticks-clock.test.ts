// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { recordKalshiBookTicks } from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import { migrateEventStoreColumns, openEventStore } from "../../src/institutions/event-store/open-db.ts";

const EVENT = "KXITFMATCH-26JUL22SANALV";
const TICKER_A = `${EVENT}-SAN`;
const TICKER_B = `${EVENT}-ALV`;
const EVENT_ID = "kalshi|test|book-ticks-clock";

function seedMarkets(db: ReturnType<typeof openEventStore>): void {
  const now = Date.now();
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $id, 'ITF', 'KXITFMATCH', 'W15', '', 'Hard', '', 'R32', NULL,
      'San', 'Alv', '', '', $start, 'scheduled', 'test', '', $now,
      $hash, $now, 'trading'
    )`,
  ).run({
    $id: EVENT_ID,
    $start: new Date(now).toISOString(),
    $now: now,
    $hash: `t|${EVENT}`,
  });
  db.query(
    `INSERT INTO markets (
      market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
      source, fetched_ts
    ) VALUES
      ('kalshi:${TICKER_A}', $id, 'kalshi', $a, 'KXITFMATCH', 'match_winner', 'San', 'SAN', 'test', $now),
      ('kalshi:${TICKER_B}', $id, 'kalshi', $b, 'KXITFMATCH', 'match_winner', 'Alv', 'ALV', 'test', $now)`,
  ).run({ $id: EVENT_ID, $a: TICKER_A, $b: TICKER_B, $now: now });
}

function emptyBook(): BookSnapshot {
  return { ts: 0, bids: [], asks: [], seq: 0 };
}

describe("book_ticks dual-clock provenance", () => {
  test("schema exposes recv_ts and source_clock; migration is idempotent", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const cols = (db.query("PRAGMA table_info(book_ticks)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(cols).toContain("recv_ts");
    expect(cols).toContain("source_clock");
    migrateEventStoreColumns(db);
    migrateEventStoreColumns(db);
    const again = (db.query("PRAGMA table_info(book_ticks)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(again).toContain("recv_ts");
    expect(again).toContain("source_clock");
  });

  test("REST path stamps per-ticker recv_ts with source_clock=recv and ts=recv_ts", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedMarkets(db);

    let call = 0;
    const fetchBook = async (_ticker: string): Promise<BookSnapshot> => {
      call++;
      if (call > 1) {
        await Bun.sleep(5);
      }
      return emptyBook();
    };

    const summary = await recordKalshiBookTicks(db, [TICKER_A, TICKER_B], {
      fetchBook,
      syncFirst: false,
    });
    expect(summary.ticksRecorded).toBe(2);
    expect(summary.errors).toBe(0);

    const rows = db
      .query(
        `SELECT ticker, ts, recv_ts, source_clock
         FROM book_ticks
         ORDER BY recv_ts ASC`,
      )
      .all() as Array<{ ticker: string; ts: number; recv_ts: number; source_clock: string }>;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.recv_ts).toBeGreaterThan(0);
      expect(row.source_clock).toBe("recv");
      expect(row.ts).toBe(row.recv_ts);
    }
    // Fetch order was A then B (with delay); second response must have a later recv_ts.
    expect(rows[0]!.ticker).toBe(TICKER_A);
    expect(rows[1]!.ticker).toBe(TICKER_B);
    expect(rows[1]!.recv_ts).toBeGreaterThan(rows[0]!.recv_ts);
  });
});
