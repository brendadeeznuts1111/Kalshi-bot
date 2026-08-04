// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  applyEventStoreSchema,
  migrateEventStoreColumns,
  openEventStore,
} from "../../src/institutions/event-store/open-db.ts";

describe("open-db", () => {
  test("new databases expose provenance columns", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const eventCols = (db.query("PRAGMA table_info(events)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(eventCols).toContain("source_url");
    expect(eventCols).toContain("fetched_ts");
    expect(eventCols).toContain("corpus");
    const marketCols = (db.query("PRAGMA table_info(markets)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(marketCols).toContain("market_kind");
    expect(marketCols).toContain("source_url");
    const bookCols = (db.query("PRAGMA table_info(book_ticks)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(bookCols).toContain("recv_ts");
    expect(bookCols).toContain("source_clock");
  });

  test("migrateEventStoreColumns is idempotent", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    migrateEventStoreColumns(db);
    migrateEventStoreColumns(db);
    const cols = (db.query("PRAGMA table_info(book_ticks)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(cols).toContain("market_kind");
    expect(cols).toContain("source_url");
    expect(cols).toContain("recv_ts");
    expect(cols).toContain("source_clock");
  });

  test("adds provider-scoped inventory tables without rebuilding legacy events", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    db.run(
      `INSERT INTO events (
         event_id, tour, level, tournament, surface, round, player_a, player_b,
         winner, loser, start_ts, outcome, source, source_row_hash, ingested_at
       ) VALUES (
         'legacy-event', 'ATP', 'tour', 'Toronto', 'Hard', 'R32', 'A', 'B',
         'A', 'B', '2026-08-04T00:00:00Z', '1', 'fixture', 'legacy-hash', 1
       )`,
    );
    applyEventStoreSchema(db);

    const tables = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    expect(tables).toContain("source_events");
    expect(tables).toContain("source_event_participants");
    expect(tables).toContain("source_markets");
    expect(tables).toContain("source_market_outcomes");
    expect(db.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 1 });
    const indexes = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    expect(indexes).toContain("idx_source_events_inventory");
  });
});
