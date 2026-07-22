// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { migrateEventStoreColumns, openEventStore } from "../../src/institutions/event-store/open-db.ts";

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
});
