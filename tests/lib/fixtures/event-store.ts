/**
 * Canonical in-memory event-store schema for tests.
 *
 * One source of truth so store tests never drift from the real schema
 * (the recurring 'table has no column' failures). Mirrors the columns the
 * store queries actually touch - extend here when a query joins more.
 *
 * @see docs/AGENT-PITFALLS.md section 4 (fixture mirroring)
 */
import { Database } from "bun:sqlite";

export function makeEventStoreDb(): Database {
  const db = new Database(":memory:");
  db.run(
    `CREATE TABLE skin_events (
       id INTEGER PRIMARY KEY, partner TEXT, inventory_id TEXT, ls_id TEXT,
       odds_event_id TEXT, sport TEXT, league TEXT, home TEXT, away TEXT,
       feed_id TEXT, start_time INTEGER, status TEXT, first_seen INTEGER,
       last_updated INTEGER, skin_id TEXT, book_id TEXT,
       inventory_live_product TEXT, competition_id TEXT, match_key TEXT,
       UNIQUE(book_id, inventory_id)
     )`,
  );
  db.run(
    `CREATE TABLE odds_ticks (
       id INTEGER PRIMARY KEY, event_id TEXT, source TEXT,
       source_url TEXT DEFAULT '', fetched_ts INTEGER,
       corpus TEXT DEFAULT 'trading', ts INTEGER, side TEXT,
       decimal_odds REAL, implied_prob REAL, limit_context TEXT, match_key TEXT
     )`,
  );
  db.run(
    `CREATE TABLE events (
       event_id TEXT PRIMARY KEY, player_a TEXT, player_b TEXT,
       winner TEXT, loser TEXT
     )`,
  );
  db.run(
    `CREATE TABLE event_links (
       stadion_event_id TEXT, kalshi_event_id TEXT, match_key TEXT, status TEXT
     )`,
  );
  return db;
}
