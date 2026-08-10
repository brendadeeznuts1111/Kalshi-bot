// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { mkdirSync, readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { isLiveProductId, isSportId, resolveCompetition } from '../../domain/index.ts';
import { ensureCacheDir } from '../../research/cache.ts';
import { DEFAULT_EVENT_STORE_DB, SCHEMA_SQL_PATH } from './paths.ts';

let defaultDb: Database | null = null;

export type OpenEventStoreOptions = {
  dbPath?: string;
  readonly?: boolean;
};

/** Columns added after initial CREATE — applied via ALTER so existing DBs stay compatible. */
const SCHEMA_COLUMN_MIGRATIONS: Array<{ table: string; column: string; decl: string }> = [
  // Buckeye / Fantasy402 stream inventory identity (plive shell covers ezlive too)
  { table: 'skin_events', column: 'skin_id', decl: 'TEXT' },
  { table: 'skin_events', column: 'book_id', decl: 'TEXT' },
  { table: 'skin_events', column: 'inventory_live_product', decl: 'TEXT' },
  { table: 'skin_events', column: 'competition_id', decl: 'TEXT' },
  { table: 'events', column: 'source_url', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'events', column: 'fetched_ts', decl: 'INTEGER' },
  { table: 'events', column: 'corpus', decl: "TEXT NOT NULL DEFAULT 'trading'" },
  { table: 'events', column: 'score_text', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'markets', column: 'series', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'markets', column: 'market_kind', decl: "TEXT NOT NULL DEFAULT 'match_winner'" },
  { table: 'markets', column: 'source', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'markets', column: 'source_url', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'markets', column: 'fetched_ts', decl: 'INTEGER' },
  { table: 'markets', column: 'volume_fp', decl: 'TEXT' },
  { table: 'markets', column: 'volume_24h_fp', decl: 'TEXT' },
  { table: 'markets', column: 'open_interest_fp', decl: 'TEXT' },
  { table: 'markets', column: 'yes_bid_size_fp', decl: 'TEXT' },
  { table: 'markets', column: 'yes_ask_size_fp', decl: 'TEXT' },
  { table: 'book_ticks', column: 'market_kind', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'book_ticks', column: 'source_url', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'book_ticks', column: 'recv_ts', decl: 'INTEGER' },
  { table: 'book_ticks', column: 'source_clock', decl: "TEXT NOT NULL DEFAULT 'recv'" },
  { table: 'odds_ticks', column: 'source_url', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'odds_ticks', column: 'fetched_ts', decl: 'INTEGER' },
  { table: 'odds_ticks', column: 'corpus', decl: "TEXT NOT NULL DEFAULT 'trading'" },
  { table: 'resolutions', column: 'source_url', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'resolutions', column: 'fetched_ts', decl: 'INTEGER' },
  { table: 'resolutions', column: 'corpus', decl: "TEXT NOT NULL DEFAULT 'trading'" },
  { table: 'player_profiles', column: 'country', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'match_key', decl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'price_snapshots', column: 'market_source', decl: "TEXT NOT NULL DEFAULT 'kalshi'" },
  { table: 'price_snapshots', column: 'surface_edge', decl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'price_snapshots', column: 'kalshi_volume_lifetime', decl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'price_snapshots', column: 'stale_volume', decl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'price_snapshots', column: 'poly_volume_24h', decl: 'REAL' },
  { table: 'price_snapshots', column: 'poly_volume_lifetime', decl: 'REAL' },
  { table: 'price_snapshots', column: 'poly_liquidity', decl: 'REAL' },
  { table: 'price_snapshots', column: 'poly_open_interest', decl: 'REAL' },
  { table: 'price_snapshots', column: 'polymarket_event_id', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'polymarket_match_method', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'kalshi_series', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'event_type', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'participant_format', decl: 'TEXT' },
  { table: 'price_snapshots', column: 'poly_observed_at_ms', decl: 'INTEGER' },
  { table: 'price_snapshots', column: 'poly_cache_state', decl: 'TEXT' },
  {
    table: 'source_inventory_runs',
    column: 'registry_fingerprint',
    decl: "TEXT NOT NULL DEFAULT 'legacy:unversioned'",
  },
];

export async function ensureEventStoreDir(): Promise<void> {
  await ensureCacheDir();
}

export function openEventStore(options: OpenEventStoreOptions = {}): Database {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  if (!options.readonly && dbPath === DEFAULT_EVENT_STORE_DB && defaultDb) {
    return defaultDb;
  }
  if (dbPath !== ':memory:' && !options.readonly) {
    mkdirSync(dbPath.replace(/\/[^/]+$/, ''), { recursive: true });
  }
  const db = new Database(dbPath, {
    create: !options.readonly,
    readonly: options.readonly,
  });
  // Enforce REFERENCES on book_ticks / markets / live_scores (SQLite defaults off).
  db.run('PRAGMA foreign_keys = ON;');
  if (!options.readonly && dbPath !== ':memory:') {
    db.run('PRAGMA journal_mode = WAL;');
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
  const sql = readFileSync(SCHEMA_SQL_PATH, 'utf8');
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
  // Per-(player, opponent) head-to-head — derived from events+markets
  db.run(`CREATE TABLE IF NOT EXISTS player_opponent_profiles (
    player_name TEXT NOT NULL,
    opponent_name TEXT NOT NULL,
    first_seen_ts INTEGER NOT NULL,
    last_seen_ts INTEGER NOT NULL,
    matches INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    win_rate REAL,
    avg_kalshi_volume_fp REAL,
    corpus TEXT NOT NULL DEFAULT 'trading',
    PRIMARY KEY (player_name, opponent_name)
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_player_opponent_profiles_player ON player_opponent_profiles (player_name)`
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_player_opponent_profiles_opponent ON player_opponent_profiles (opponent_name)`
  );
  // Skin inventory (Fantasy402 stream-list-v2 under Buckeye, etc.)
  migratePartnerEventsToSkinEvents(db);
  db.run(`CREATE TABLE IF NOT EXISTS skin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner TEXT NOT NULL,
    inventory_id TEXT NOT NULL,
    ls_id TEXT,
    client_event_id TEXT,
    sport TEXT NOT NULL DEFAULT '',
    league TEXT NOT NULL DEFAULT '',
    home TEXT,
    away TEXT,
    feed_id TEXT,
    start_time INTEGER,
    status TEXT NOT NULL DEFAULT 'unknown',
    first_seen INTEGER NOT NULL,
    last_updated INTEGER NOT NULL,
    skin_id TEXT,
    book_id TEXT NOT NULL,
    inventory_live_product TEXT,
    competition_id TEXT,
    UNIQUE(book_id, inventory_id)
  )`);
  migrateSkinEventsStreamIdToInventoryId(db);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_skin_events_partner_sport ON skin_events (partner, sport)`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_book ON skin_events (book_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_last_updated ON skin_events (last_updated)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_competition ON skin_events (competition_id)`);
  // Partner financial registry (outs) — secrets stay in env, not here
  db.run(`CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    profit_split REAL,
    commission_rate REAL,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS betting_accounts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    env_prefix TEXT,
    max_stake REAL NOT NULL DEFAULT 0,
    max_win REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    skin INTEGER,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_betting_accounts_partner ON betting_accounts (partner_id)`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_betting_accounts_provider ON betting_accounts (provider)`);
  db.run(`CREATE TABLE IF NOT EXISTS provider_sport_mappings (
    provider TEXT NOT NULL,
    canonical TEXT NOT NULL,
    stream_bucket TEXT,
    api_sport_id INTEGER,
    widget_sport_id INTEGER,
    label TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (provider, canonical)
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_provider_sport_api ON provider_sport_mappings (provider, api_sport_id)`
  );
  migrateEventStoreColumns(db);
  migrateSkinEventsInventoryIdentity(db);
  migrateSkinEventsBookInventoryUnique(db);
  migrateSkinEventsCompetitionIds(db);
  migrateSourceEventSelectors(db);
  abandonLegacyKalshiInventoryRuns(db);
  abandonUnpinnedSourceInventoryRuns(db);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_price_snapshots_match_health
     ON price_snapshots (poly_prob, stale_volume, ts)`
  );
}

/** An in-flight legacy run cannot prove which registry semantics interpreted earlier pages. */
function abandonUnpinnedSourceInventoryRuns(db: Database): void {
  db.query(
    `UPDATE source_inventory_runs
     SET state = 'abandoned',
         finished_at_ms = MAX(started_at_ms, COALESCE(checkpoint_at_ms, started_at_ms)),
         error_detail = 'migration: inventory run lacked registry fingerprint'
     WHERE state = 'running' AND registry_fingerprint = 'legacy:unversioned'`
  ).run();
}

/** New event-page adapters cannot safely resume cursors minted by the old market-page contract. */
function abandonLegacyKalshiInventoryRuns(db: Database): void {
  db.query(
    `UPDATE source_inventory_runs
     SET state = 'abandoned',
         finished_at_ms = MAX(started_at_ms, COALESCE(checkpoint_at_ms, started_at_ms)),
         error_detail = 'migration: kalshi-markets-v1 replaced by kalshi-events-v1'
     WHERE state = 'running' AND adapter_id = 'kalshi-markets-v1'`
  ).run();
}

/** Rebuild the additive selector table once to add run fencing and its composite FK safely. */
function migrateSourceEventSelectors(db: Database): void {
  const hasActive = tableHasColumn(db, 'source_event_selectors', 'active');
  const hasRetiredAt = tableHasColumn(db, 'source_event_selectors', 'retired_at_ms');
  const hasRunFence = tableHasColumn(db, 'source_event_selectors', 'last_seen_run_id');
  const hasRunForeignKey = (
    db.query('PRAGMA foreign_key_list(source_event_selectors)').all() as Array<{
      table: string;
      from: string;
    }>
  ).some(row => row.table === 'source_inventory_runs' && row.from === 'last_seen_run_id');
  if (hasActive && hasRetiredAt && hasRunFence && hasRunForeignKey) {
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_source_event_selectors_active
       ON source_event_selectors (source_key, selector_scope, active, source_event_id)`
    );
    return;
  }
  const migrate = db.transaction(() => {
    db.run('DROP TABLE IF EXISTS source_event_selectors_next');
    db.run(`CREATE TABLE source_event_selectors_next (
      source_key TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      selector_scope TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      selector_kind TEXT NOT NULL,
      selector_parameters_json TEXT NOT NULL CHECK (json_valid(selector_parameters_json)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      retired_at_ms INTEGER CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0),
      last_seen_run_id TEXT,
      first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
      last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
      PRIMARY KEY (source_key, source_event_id, selector_scope),
      FOREIGN KEY (source_key, source_event_id)
        REFERENCES source_events (source_key, source_event_id),
      FOREIGN KEY (source_key, selector_scope, last_seen_run_id)
        REFERENCES source_inventory_runs (source_key, selector_scope, inventory_run_id)
    )`);
    db.run(
      hasActive && hasRetiredAt && hasRunFence
        ? `INSERT INTO source_event_selectors_next (
             source_key, source_event_id, selector_scope, adapter_id, selector_kind,
             selector_parameters_json, active, retired_at_ms, last_seen_run_id,
             first_observed_at_ms, last_observed_at_ms
           )
           SELECT ses.source_key, ses.source_event_id, ses.selector_scope,
                  ses.adapter_id, ses.selector_kind, ses.selector_parameters_json,
                  ses.active, ses.retired_at_ms,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM source_inventory_runs sir
                    WHERE sir.source_key = ses.source_key
                      AND sir.selector_scope = ses.selector_scope
                      AND sir.inventory_run_id = ses.last_seen_run_id
                  ) THEN ses.last_seen_run_id ELSE NULL END,
                  ses.first_observed_at_ms, ses.last_observed_at_ms
           FROM source_event_selectors ses`
        : hasActive && hasRetiredAt
          ? `INSERT INTO source_event_selectors_next (
             source_key, source_event_id, selector_scope, adapter_id, selector_kind,
             selector_parameters_json, active, retired_at_ms,
             first_observed_at_ms, last_observed_at_ms
           )
           SELECT source_key, source_event_id, selector_scope, adapter_id, selector_kind,
                  selector_parameters_json, active, retired_at_ms,
                  first_observed_at_ms, last_observed_at_ms
           FROM source_event_selectors`
          : `INSERT INTO source_event_selectors_next (
             source_key, source_event_id, selector_scope, adapter_id, selector_kind,
             selector_parameters_json, first_observed_at_ms, last_observed_at_ms
           )
           SELECT source_key, source_event_id, selector_scope, adapter_id, selector_kind,
                  selector_parameters_json, first_observed_at_ms, last_observed_at_ms
           FROM source_event_selectors`
    );
    db.run('DROP TABLE source_event_selectors');
    db.run('ALTER TABLE source_event_selectors_next RENAME TO source_event_selectors');
    db.run(
      `CREATE INDEX idx_source_event_selectors_scope
       ON source_event_selectors (source_key, selector_scope, source_event_id)`
    );
    db.run(
      `CREATE INDEX idx_source_event_selectors_active
       ON source_event_selectors (source_key, selector_scope, active, source_event_id)`
    );
  });
  migrate.immediate();
}

export function migrateEventStoreColumns(db: Database): void {
  for (const { table, column, decl } of SCHEMA_COLUMN_MIGRATIONS) {
    if (!tableHasColumn(db, table, column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }
}

/** Rename legacy partner_events → skin_events (preserves rows + unique key). */
export function migratePartnerEventsToSkinEvents(db: Database): void {
  if (!tableExists(db, 'partner_events')) return;
  if (tableExists(db, 'skin_events')) {
    // Prefer the new name; drop the legacy shell if both somehow exist.
    db.run('DROP TABLE partner_events');
    return;
  }
  db.run('ALTER TABLE partner_events RENAME TO skin_events');
  db.run('DROP INDEX IF EXISTS idx_partner_events_partner_sport');
  db.run('DROP INDEX IF EXISTS idx_partner_events_last_updated');
}

/**
 * Rename legacy skin_events.stream_id → inventory_id (wire name stays at parse only).
 */
export function migrateSkinEventsStreamIdToInventoryId(db: Database): void {
  if (!tableExists(db, 'skin_events')) return;
  if (tableHasColumn(db, 'skin_events', 'inventory_id')) return;
  if (!tableHasColumn(db, 'skin_events', 'stream_id')) return;
  db.run(`ALTER TABLE skin_events RENAME COLUMN stream_id TO inventory_id`);
}

/**
 * Stamp Fantasy402 inventory rows as Buckeye / plive-shell; drop fixture junk.
 * plive + ezlive share this inventory — one row per inventory_id.
 * `partner` is a deprecated mirror of `book_id` (not a seat partner CODE).
 */
export function migrateSkinEventsInventoryIdentity(db: Database): void {
  if (!tableExists(db, 'skin_events')) return;
  if (!tableHasColumn(db, 'skin_events', 'skin_id')) return;
  if (!tableHasColumn(db, 'skin_events', 'book_id')) return;
  // Backfill book_id from legacy partner token when missing.
  db.run(`
    UPDATE skin_events
    SET book_id = COALESCE(NULLIF(TRIM(book_id), ''), NULLIF(TRIM(partner), ''), 'fantasy402')
    WHERE book_id IS NULL OR TRIM(book_id) = ''
  `);
  db.run(`
    UPDATE skin_events
    SET
      skin_id = COALESCE(NULLIF(TRIM(skin_id), ''), 'buckeye'),
      inventory_live_product = COALESCE(NULLIF(TRIM(inventory_live_product), ''), 'plive'),
      partner = book_id
    WHERE book_id = 'fantasy402' OR partner = 'fantasy402'
  `);
  db.run(`
    DELETE FROM skin_events
    WHERE inventory_id = '1' OR league = 'Test League'
  `);
}

function skinEventsHasBookInventoryUnique(db: Database): boolean {
  const tableSql = (
    db
      .query(`SELECT sql AS s FROM sqlite_master WHERE type = 'table' AND name = 'skin_events'`)
      .get() as { s: string | null } | null
  )?.s;
  if (tableSql && /UNIQUE\s*\(\s*book_id\s*,\s*inventory_id\s*\)/i.test(tableSql)) {
    return true;
  }
  const indexes = db.query(`PRAGMA index_list(skin_events)`).all() as Array<{
    name: string;
    unique: number;
  }>;
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const cols = db.query(`PRAGMA index_info('${idx.name.replace(/'/g, "''")}')`).all() as Array<{
      name: string;
    }>;
    const names = cols.map(c => c.name);
    if (names.length === 2 && names.includes('book_id') && names.includes('inventory_id')) {
      return true;
    }
  }
  return false;
}

/**
 * Rebuild UNIQUE(partner, inventory_id) → UNIQUE(book_id, inventory_id).
 * `partner` remains as a deprecated write-through mirror of book_id.
 */
export function migrateSkinEventsBookInventoryUnique(db: Database): void {
  if (!tableExists(db, 'skin_events')) return;
  if (!tableHasColumn(db, 'skin_events', 'book_id')) return;
  if (!tableHasColumn(db, 'skin_events', 'inventory_id')) return;
  if (skinEventsHasBookInventoryUnique(db)) return;

  db.run(`
    UPDATE skin_events
    SET book_id = COALESCE(NULLIF(TRIM(book_id), ''), NULLIF(TRIM(partner), ''), 'fantasy402')
    WHERE book_id IS NULL OR TRIM(book_id) = ''
  `);
  db.run(`UPDATE skin_events SET partner = book_id WHERE book_id IS NOT NULL`);

  db.run('DROP TABLE IF EXISTS skin_events_next');
  db.run(`CREATE TABLE skin_events_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner TEXT NOT NULL,
    inventory_id TEXT NOT NULL,
    ls_id TEXT,
    client_event_id TEXT,
    sport TEXT NOT NULL DEFAULT '',
    league TEXT NOT NULL DEFAULT '',
    home TEXT,
    away TEXT,
    feed_id TEXT,
    start_time INTEGER,
    status TEXT NOT NULL DEFAULT 'unknown',
    first_seen INTEGER NOT NULL,
    last_updated INTEGER NOT NULL,
    skin_id TEXT,
    book_id TEXT NOT NULL,
    inventory_live_product TEXT,
    competition_id TEXT,
    UNIQUE(book_id, inventory_id)
  )`);
  db.run(`
    INSERT INTO skin_events_next (
      id, partner, inventory_id, ls_id, client_event_id, sport, league, home, away,
      feed_id, start_time, status, first_seen, last_updated,
      skin_id, book_id, inventory_live_product, competition_id
    )
    SELECT
      id,
      COALESCE(NULLIF(TRIM(partner), ''), book_id),
      inventory_id, ls_id, client_event_id, sport, league, home, away,
      feed_id, start_time, status, first_seen, last_updated,
      skin_id, book_id, inventory_live_product, competition_id
    FROM skin_events
  `);
  db.run('DROP TABLE skin_events');
  db.run('ALTER TABLE skin_events_next RENAME TO skin_events');
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_skin_events_partner_sport ON skin_events (partner, sport)`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_book ON skin_events (book_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_last_updated ON skin_events (last_updated)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_skin_events_competition ON skin_events (competition_id)`);
}

/**
 * Backfill skin_events.competition_id from seeded Plive league mappings.
 * Unknown / junk leagues stay NULL.
 */
export function migrateSkinEventsCompetitionIds(db: Database): void {
  if (!tableExists(db, 'skin_events')) return;
  if (!tableHasColumn(db, 'skin_events', 'competition_id')) return;
  const rows = db
    .query(
      `SELECT rowid AS rid, sport, league,
              inventory_live_product AS inv,
              competition_id AS competitionId
       FROM skin_events`
    )
    .all() as Array<{
    rid: number;
    sport: string;
    league: string;
    inv: string | null;
    competitionId: string | null;
  }>;
  const upd = db.query(`UPDATE skin_events SET competition_id = $c WHERE rowid = $r`);
  for (const row of rows) {
    const liveRaw = (row.inv ?? '').trim() || 'plive';
    const liveProduct = isLiveProductId(liveRaw) ? liveRaw : 'plive';
    const sport = (row.sport ?? '').trim();
    const hit = resolveCompetition({
      liveProduct,
      league: row.league ?? '',
      sportId: isSportId(sport) ? sport : undefined,
      streamBucket: sport || undefined,
    });
    const next = hit?.competitionId ?? null;
    const prev = row.competitionId?.trim() || null;
    if (next === prev) continue;
    upd.run({ $c: next, $r: row.rid });
  }
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = $n`)
    .get({ $n: table }) as { ok: number } | null;
  return row != null;
}

function tableHasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(r => r.name === column);
}

export function resetDefaultEventStoreForTests(): void {
  defaultDb = null;
}
