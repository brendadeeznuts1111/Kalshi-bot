-- Canonical event store — L2 SSOT for cross-venue joins (event_id).
-- Live recorder and alpha programs write into these tables; they do not own the schema.
--
-- Provenance is mandatory on fact rows before primary ingest:
--   source / source_url / fetched_ts (+ ingested_at).
-- corpus = 'trading' | 'research-only' — research compilations never feed p_model.

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  tour TEXT NOT NULL,
  level TEXT NOT NULL,
  tournament TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  round TEXT NOT NULL,
  best_of INTEGER,
  player_a TEXT NOT NULL,
  player_b TEXT NOT NULL,
  winner TEXT NOT NULL,
  loser TEXT NOT NULL,
  start_ts TEXT NOT NULL,
  outcome TEXT NOT NULL,
  /** e.g. 6-3 6-4 — empty when source omits set scores. */
  score_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER,
  source_row_hash TEXT NOT NULL UNIQUE,
  ingested_at INTEGER NOT NULL,
  corpus TEXT NOT NULL DEFAULT 'trading'
);

CREATE INDEX IF NOT EXISTS idx_events_tour_surface_start ON events (tour, surface, start_ts);
CREATE INDEX IF NOT EXISTS idx_events_tournament ON events (tournament, start_ts);
CREATE INDEX IF NOT EXISTS idx_events_corpus ON events (corpus);

CREATE TABLE IF NOT EXISTS markets (
  market_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  venue TEXT NOT NULL,
  ticker TEXT NOT NULL,
  series TEXT NOT NULL DEFAULT '',
  market_kind TEXT NOT NULL DEFAULT 'match_winner',
  yes_side_label TEXT NOT NULL DEFAULT '',
  side_code TEXT NOT NULL DEFAULT '',
  competitor_id TEXT,
  rules_blob TEXT,
  settlement_ts TEXT,
  source TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER,
  UNIQUE (ticker)
);

CREATE INDEX IF NOT EXISTS idx_markets_event ON markets (event_id);
CREATE INDEX IF NOT EXISTS idx_markets_kind ON markets (market_kind);

/**
 * Orderbook samples. `ts` is the primary query clock (indexed).
 * REST poll: ts = recv_ts, source_clock='recv' (no Kalshi server book timestamp today).
 * Future WS can set ts to exchange time and keep recv_ts as local receive.
 */
CREATE TABLE IF NOT EXISTS book_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  ticker TEXT,
  market_kind TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  recv_ts INTEGER,
  source_clock TEXT NOT NULL DEFAULT 'recv',
  seq INTEGER,
  levels_json TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_book_ticks_event_ts ON book_ticks (event_id, ts);
CREATE INDEX IF NOT EXISTS idx_book_ticks_kind_ts ON book_ticks (market_kind, ts);

CREATE TABLE IF NOT EXISTS odds_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER,
  corpus TEXT NOT NULL DEFAULT 'trading',
  ts INTEGER NOT NULL,
  side TEXT NOT NULL,
  decimal_odds REAL NOT NULL,
  implied_prob REAL,
  limit_context TEXT NOT NULL DEFAULT 'closing'
);

CREATE INDEX IF NOT EXISTS idx_odds_ticks_event_source_ts ON odds_ticks (event_id, source, ts);

CREATE TABLE IF NOT EXISTS resolutions (
  event_id TEXT PRIMARY KEY REFERENCES events (event_id),
  outcome INTEGER NOT NULL,
  winner TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER,
  corpus TEXT NOT NULL DEFAULT 'trading',
  resolved_ts TEXT NOT NULL
);

/**
 * Stadion (primary results) ↔ Kalshi (markets/ticks) bridge.
 * Separate event_id namespaces stay intact; this table is the only join.
 * status=linked is unique on both sides; ambiguous/unmatched never invent a pair.
 */
CREATE TABLE IF NOT EXISTS event_links (
  stadion_event_id TEXT NOT NULL PRIMARY KEY,
  kalshi_event_id TEXT,
  status TEXT NOT NULL,
  match_key TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'surname_day_lane',
  detail TEXT NOT NULL DEFAULT '',
  linked_at INTEGER NOT NULL,
  CHECK (status IN ('linked', 'ambiguous', 'unmatched'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_links_kalshi_linked
  ON event_links (kalshi_event_id)
  WHERE status = 'linked' AND kalshi_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_links_status ON event_links (status);
CREATE INDEX IF NOT EXISTS idx_event_links_match_key ON event_links (match_key);

/**
 * Latest Kalshi /live_data score per Kalshi event_id (competitor-UUID mint).
 * source_clock is always 'recv' — Kalshi live_data has no per-point server clock.
 * is_live gates early-start watch (status≠not_started OR score already moving).
 */
CREATE TABLE IF NOT EXISTS live_scores (
  event_id TEXT PRIMARY KEY REFERENCES events (event_id),
  event_ticker TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  updated_ts INTEGER NOT NULL,
  source_clock TEXT NOT NULL DEFAULT 'recv',
  status TEXT NOT NULL DEFAULT '',
  match_status TEXT NOT NULL DEFAULT '',
  sets_home INTEGER NOT NULL DEFAULT 0,
  sets_away INTEGER NOT NULL DEFAULT 0,
  games_home INTEGER NOT NULL DEFAULT 0,
  games_away INTEGER NOT NULL DEFAULT 0,
  points_home INTEGER NOT NULL DEFAULT 0,
  points_away INTEGER NOT NULL DEFAULT 0,
  server_competitor_id TEXT,
  competitor1_id TEXT,
  competitor2_id TEXT,
  is_live INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'kalshi-live-data',
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_live_scores_live ON live_scores (is_live, updated_ts);
CREATE INDEX IF NOT EXISTS idx_live_scores_ticker ON live_scores (event_ticker);

/** Append-only score changes (recv-clocked) for latency / aging studies. */
CREATE TABLE IF NOT EXISTS score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  event_ticker TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source_clock TEXT NOT NULL DEFAULT 'recv',
  status TEXT NOT NULL DEFAULT '',
  sets_home INTEGER NOT NULL DEFAULT 0,
  sets_away INTEGER NOT NULL DEFAULT 0,
  games_home INTEGER NOT NULL DEFAULT 0,
  games_away INTEGER NOT NULL DEFAULT 0,
  points_home INTEGER NOT NULL DEFAULT 0,
  points_away INTEGER NOT NULL DEFAULT 0,
  server_competitor_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'kalshi-live-data',
  source_url TEXT NOT NULL DEFAULT '',
  fetched_ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_event_ts ON score_snapshots (event_id, ts);
