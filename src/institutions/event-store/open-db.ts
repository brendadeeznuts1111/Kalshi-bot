// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { mkdirSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { ensureCacheDir } from "../../research/cache.ts";
import { DEFAULT_EVENT_STORE_DB, SCHEMA_SQL_PATH } from "./paths.ts";

let defaultDb: Database | null = null;

export type OpenEventStoreOptions = {
  dbPath?: string;
  readonly?: boolean;
};

/** Columns added after initial CREATE — applied via ALTER so existing DBs stay compatible. */
const SCHEMA_COLUMN_MIGRATIONS: Array<{ table: string; column: string; decl: string }> = [
  { table: "events", column: "source_url", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "events", column: "fetched_ts", decl: "INTEGER" },
  { table: "events", column: "corpus", decl: "TEXT NOT NULL DEFAULT 'trading'" },
  { table: "events", column: "score_text", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "markets", column: "series", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "markets", column: "market_kind", decl: "TEXT NOT NULL DEFAULT 'match_winner'" },
  { table: "markets", column: "source", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "markets", column: "source_url", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "markets", column: "fetched_ts", decl: "INTEGER" },
  { table: "markets", column: "volume_fp", decl: "TEXT" },
  { table: "markets", column: "volume_24h_fp", decl: "TEXT" },
  { table: "markets", column: "open_interest_fp", decl: "TEXT" },
  { table: "markets", column: "yes_bid_size_fp", decl: "TEXT" },
  { table: "markets", column: "yes_ask_size_fp", decl: "TEXT" },
  { table: "book_ticks", column: "market_kind", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "book_ticks", column: "source_url", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "book_ticks", column: "recv_ts", decl: "INTEGER" },
  { table: "book_ticks", column: "source_clock", decl: "TEXT NOT NULL DEFAULT 'recv'" },
  { table: "odds_ticks", column: "source_url", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "odds_ticks", column: "fetched_ts", decl: "INTEGER" },
  { table: "odds_ticks", column: "corpus", decl: "TEXT NOT NULL DEFAULT 'trading'" },
  { table: "resolutions", column: "source_url", decl: "TEXT NOT NULL DEFAULT ''" },
  { table: "resolutions", column: "fetched_ts", decl: "INTEGER" },
  { table: "resolutions", column: "corpus", decl: "TEXT NOT NULL DEFAULT 'trading'" },
];

export async function ensureEventStoreDir(): Promise<void> {
  await ensureCacheDir();
}

export function openEventStore(options: OpenEventStoreOptions = {}): Database {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  if (!options.readonly && dbPath === DEFAULT_EVENT_STORE_DB && defaultDb) {
    return defaultDb;
  }
  if (dbPath !== ":memory:" && !options.readonly) {
    mkdirSync(dbPath.replace(/\/[^/]+$/, ""), { recursive: true });
  }
  const db = new Database(dbPath, {
    create: !options.readonly,
    readonly: options.readonly,
  });
  // Enforce REFERENCES on book_ticks / markets / live_scores (SQLite defaults off).
  db.run("PRAGMA foreign_keys = ON;");
  if (!options.readonly && dbPath !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL;");
  }
  if (!options.readonly) {
    applyEventStoreSchema(db);
  }
  if (!options.readonly && dbPath === DEFAULT_EVENT_STORE_DB) {
    defaultDb = db;
  }
  return db;
}

export function applyEventStoreSchema(db: Database): void {
  const sql = readFileSync(SCHEMA_SQL_PATH, "utf8");
  db.exec(sql);
  // Player profiles table — not in schema.sql because it was added post-hoc.
  db.run(`CREATE TABLE IF NOT EXISTS player_profiles (
    player_name TEXT PRIMARY KEY,
    first_seen_ts INTEGER NOT NULL,
    last_seen_ts INTEGER NOT NULL,
    appearances INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    win_rate REAL,
    surfaces TEXT NOT NULL DEFAULT '{}',
    avg_kalshi_volume_fp REAL,
    best_of INTEGER,
    corpus TEXT NOT NULL DEFAULT 'trading'
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_player_profiles_win_rate ON player_profiles (win_rate)`);
  migrateEventStoreColumns(db);
}

export function migrateEventStoreColumns(db: Database): void {
  for (const { table, column, decl } of SCHEMA_COLUMN_MIGRATIONS) {
    if (!tableHasColumn(db, table, column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }
}

function tableHasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export function resetDefaultEventStoreForTests(): void {
  defaultDb = null;
}
