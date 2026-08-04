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
    expect(tables).toContain("source_inventory_runs");
    expect(tables).toContain("source_inventory_run_pages");
    expect(tables).toContain("source_metadata_runs");
    expect(tables).toContain("source_metadata_run_pages");
    expect(tables).toContain("source_metadata_run_entities");
    expect(tables).toContain("source_metadata_entities");
    expect(tables).toContain("source_metadata_classifications");
    expect(tables).toContain("source_event_selectors");
    expect(tables).toContain("source_event_participants");
    expect(tables).toContain("source_markets");
    expect(tables).toContain("source_market_outcomes");
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all(),
    ).toContainEqual({ name: "active_source_metadata_classifications" });
    expect(db.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 1 });
    const indexes = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    expect(indexes).toContain("idx_source_events_inventory");
    expect(indexes).toContain("idx_source_inventory_one_running");
    expect(indexes).toContain("idx_source_metadata_one_running");
    expect(indexes).toContain("idx_source_metadata_entities_active");
    expect(indexes).toContain("idx_source_metadata_classification_state");
    expect(indexes).toContain("idx_source_metadata_classification_registry");
    const selectorColumns = new Set(
      (db.query("PRAGMA table_info(source_event_selectors)").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    expect(selectorColumns).toContain("active");
    expect(selectorColumns).toContain("retired_at_ms");
    expect(selectorColumns).toContain("last_seen_run_id");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("rebuilds a lifecycle-era selector table that lacks run fencing", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    db.run("DROP INDEX IF EXISTS idx_source_event_selectors_active");
    db.run("DROP INDEX IF EXISTS idx_source_event_selectors_scope");
    db.run("DROP TABLE source_event_selectors");
    db.run(`CREATE TABLE source_event_selectors (
      source_key TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      selector_scope TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      selector_kind TEXT NOT NULL,
      selector_parameters_json TEXT NOT NULL CHECK (json_valid(selector_parameters_json)),
      active INTEGER NOT NULL DEFAULT 1,
      retired_at_ms INTEGER,
      first_observed_at_ms INTEGER NOT NULL,
      last_observed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (source_key, source_event_id, selector_scope),
      FOREIGN KEY (source_key, source_event_id)
        REFERENCES source_events (source_key, source_event_id)
    )`);
    db.run(
      `INSERT INTO source_events (
         source_key, source_event_id, sport_key, title, adapter_id, selector_kind,
         selector_scope, selector_parameters_json, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         'polymarket', 'legacy-source-event', 'table_tennis', 'Legacy',
         'polymarket-gamma-v1', 'polymarket_tag', 'polymarket:tag:103767',
         '{"tagId":"103767"}', 1, 1
       )`,
    );
    db.run(
      `INSERT INTO source_event_selectors VALUES (
         'polymarket', 'legacy-source-event', 'polymarket:tag:103767',
         'polymarket-gamma-v1', 'polymarket_tag', '{"tagId":"103767"}', 1, NULL, 1, 1
       )`,
    );

    applyEventStoreSchema(db);
    expect(
      db
        .query(
          `SELECT source_event_id AS eventId, active, retired_at_ms AS retiredAtMs,
                last_seen_run_id AS lastSeenRunId
         FROM source_event_selectors`,
        )
        .get(),
    ).toEqual({
      eventId: "legacy-source-event",
      active: 1,
      retiredAtMs: null,
      lastSeenRunId: null,
    });
    expect(() =>
      db.run(
        `UPDATE source_event_selectors SET last_seen_run_id = 'missing-run'
         WHERE source_event_id = 'legacy-source-event'`,
      ),
    ).toThrow();
  });

  test("preserves valid run fences while adding a missing selector foreign key", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    db.run("DROP INDEX IF EXISTS idx_source_event_selectors_active");
    db.run("DROP INDEX IF EXISTS idx_source_event_selectors_scope");
    db.run("DROP TABLE source_event_selectors");
    db.run(`CREATE TABLE source_event_selectors (
      source_key TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      selector_scope TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      selector_kind TEXT NOT NULL,
      selector_parameters_json TEXT NOT NULL CHECK (json_valid(selector_parameters_json)),
      active INTEGER NOT NULL DEFAULT 1,
      retired_at_ms INTEGER,
      last_seen_run_id TEXT,
      first_observed_at_ms INTEGER NOT NULL,
      last_observed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (source_key, source_event_id, selector_scope),
      FOREIGN KEY (source_key, source_event_id)
        REFERENCES source_events (source_key, source_event_id)
    )`);
    const selectorParameters =
      '{"tagId":"103767","tagSlug":"table-tennis","sport":"table_tennis"}';
    db.query(
      `INSERT INTO source_events (
         source_key, source_event_id, sport_key, title, adapter_id, selector_kind,
         selector_scope, selector_parameters_json, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         'polymarket', 'resumed-source-event', 'table_tennis', 'Resumed',
         'polymarket-gamma-v1', 'polymarket_tag', 'polymarket:tag:103767',
         $selectorParameters, 1, 250
       )`,
    ).run({ $selectorParameters: selectorParameters });
    db.query(
      `INSERT INTO source_inventory_runs (
         source_key, inventory_run_id, sport_key, selector_scope, adapter_id,
         selector_kind, selector_parameters_json, state, started_at_ms,
         checkpoint_at_ms, next_cursor, page_count
       ) VALUES (
         'polymarket', 'resume-run', 'table_tennis', 'polymarket:tag:103767',
         'polymarket-gamma-v1', 'polymarket_tag', $selectorParameters,
         'running', 100, 200, 'cursor-1', 1
       )`,
    ).run({ $selectorParameters: selectorParameters });
    db.query(
      `INSERT INTO source_event_selectors VALUES (
         'polymarket', 'resumed-source-event', 'polymarket:tag:103767',
         'polymarket-gamma-v1', 'polymarket_tag', $selectorParameters,
         1, NULL, 'resume-run', 1, 250
       )`,
    ).run({ $selectorParameters: selectorParameters });

    applyEventStoreSchema(db);
    expect(
      db.query(
        `SELECT active, retired_at_ms AS retiredAtMs, last_seen_run_id AS lastSeenRunId
         FROM source_event_selectors`,
      ).get(),
    ).toEqual({ active: 1, retiredAtMs: null, lastSeenRunId: "resume-run" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("abandons running Kalshi scans that cannot resume under the event-page adapter", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    db.query(
      `INSERT INTO source_inventory_runs (
         source_key, inventory_run_id, sport_key, selector_scope, adapter_id,
         selector_kind, selector_parameters_json, state, started_at_ms
       ) VALUES (
         'kalshi', 'legacy-kalshi-run', 'tennis', 'kalshi:series:KXATPMATCH',
         'kalshi-markets-v1', 'kalshi_series', '{"series":"KXATPMATCH"}',
         'running', 100
       )`,
    ).run();

    applyEventStoreSchema(db);
    expect(
      db.query(
        `SELECT state, finished_at_ms AS finishedAtMs, error_detail AS detail
         FROM source_inventory_runs WHERE inventory_run_id = 'legacy-kalshi-run'`,
      ).get(),
    ).toEqual({
      state: "abandoned",
      finishedAtMs: 100,
      detail: "migration: kalshi-markets-v1 replaced by kalshi-events-v1",
    });
    db.close();
  });
});
