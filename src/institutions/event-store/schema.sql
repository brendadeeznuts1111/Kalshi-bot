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
  volume_fp TEXT,
  volume_24h_fp TEXT,
  open_interest_fp TEXT,
  yes_bid_size_fp TEXT,
  yes_ask_size_fp TEXT,
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

/**
 * Derived match-level liquidity — recomputed after market/book ingest.
 * Keys by event_id (event-store SSOT). Not a second wire identity.
 * liquidity_ok aligns with glossary concept liquidity_ok (desk gate).
 */
CREATE TABLE IF NOT EXISTS match_liquidity (
  event_id TEXT PRIMARY KEY REFERENCES events (event_id),
  tournament TEXT NOT NULL DEFAULT '',
  tour TEXT NOT NULL DEFAULT '',
  sport_key TEXT NOT NULL DEFAULT 'tennis',
  volume_fp REAL NOT NULL DEFAULT 0,
  volume_24h_fp REAL NOT NULL DEFAULT 0,
  open_interest_fp REAL NOT NULL DEFAULT 0,
  spread_cents REAL,
  mid_cents REAL,
  market_count INTEGER NOT NULL DEFAULT 0,
  book_tick_count INTEGER NOT NULL DEFAULT 0,
  crossed INTEGER NOT NULL DEFAULT 0,
  liquidity_ok INTEGER NOT NULL DEFAULT 0,
  tradable INTEGER NOT NULL DEFAULT 0,
  updated_ts INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'event-store'
);

CREATE INDEX IF NOT EXISTS idx_match_liquidity_tournament ON match_liquidity (tournament);
CREATE INDEX IF NOT EXISTS idx_match_liquidity_tour ON match_liquidity (tour);
CREATE INDEX IF NOT EXISTS idx_match_liquidity_ok ON match_liquidity (liquidity_ok);
CREATE INDEX IF NOT EXISTS idx_match_liquidity_sport ON match_liquidity (sport_key);

/** Cross-venue price and capacity snapshots written by scripts/price-logger.ts. */
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  match_key TEXT NOT NULL DEFAULT '',
  market_source TEXT NOT NULL DEFAULT 'kalshi',
  ticker TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kalshi_mid_cents INTEGER,
  kalshi_bid_cents INTEGER,
  kalshi_ask_cents INTEGER,
  kalshi_volume_24h REAL NOT NULL DEFAULT 0,
  kalshi_volume_lifetime REAL NOT NULL DEFAULT 0,
  kalshi_open_interest REAL NOT NULL DEFAULT 0,
  stale_volume INTEGER NOT NULL DEFAULT 0,
  poly_prob REAL,
  poly_volume_24h REAL,
  poly_volume_lifetime REAL,
  poly_liquidity REAL,
  poly_open_interest REAL,
  polymarket_event_id TEXT,
  polymarket_match_method TEXT,
  pinny_prob REAL,
  elo_prob REAL,
  elo_surface TEXT,
  elo_a REAL,
  elo_b REAL,
  rps_flag INTEGER NOT NULL DEFAULT 0,
  div_flag INTEGER NOT NULL DEFAULT 0,
  surface_edge INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'price-logger'
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_event_ts ON price_snapshots (event_id, ts);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_ticker_ts ON price_snapshots (ticker, ts);
CREATE TABLE IF NOT EXISTS logger_health (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  booted_at INTEGER NOT NULL,
  last_snapshot_at INTEGER,
  total_snapshots INTEGER NOT NULL DEFAULT 0,
  total_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_at INTEGER
);

INSERT OR IGNORE INTO logger_health (id, booted_at) VALUES (1, unixepoch() * 1000);

/**
 * Provider-scoped inventory seam. These tables preserve source truth beside the
 * legacy tennis warehouse; they do not imply canonical cross-source matching.
 */
CREATE TABLE IF NOT EXISTS source_events (
  source_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  sport_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  closes_at_ms INTEGER CHECK (closes_at_ms IS NULL OR closes_at_ms >= 0),
  result TEXT,
  starts_at_ms INTEGER CHECK (starts_at_ms IS NULL OR starts_at_ms >= 0),
  event_type TEXT CHECK (event_type IS NULL OR event_type IN ('match', 'tournament')),
  participant_format TEXT CHECK (
    participant_format IS NULL OR participant_format IN ('singles', 'doubles', 'team', 'mixed', 'field')
  ),
  adapter_id TEXT NOT NULL,
  selector_kind TEXT NOT NULL,
  selector_scope TEXT NOT NULL,
  selector_parameters_json TEXT NOT NULL CHECK (json_valid(selector_parameters_json)),
  source_updated_at_ms INTEGER CHECK (source_updated_at_ms IS NULL OR source_updated_at_ms >= 0),
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
  last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
  PRIMARY KEY (source_key, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_source_events_inventory
  ON source_events (sport_key, source_key, source_event_id);

CREATE TABLE IF NOT EXISTS source_event_selectors (
  source_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  selector_scope TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  selector_kind TEXT NOT NULL,
  selector_parameters_json TEXT NOT NULL CHECK (json_valid(selector_parameters_json)),
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
  last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
  PRIMARY KEY (source_key, source_event_id, selector_scope),
  FOREIGN KEY (source_key, source_event_id)
    REFERENCES source_events (source_key, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_source_event_selectors_scope
  ON source_event_selectors (source_key, selector_scope, source_event_id);

CREATE TABLE IF NOT EXISTS source_event_participants (
  source_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_participant_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  retired_at_ms INTEGER CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0),
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
  last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
  PRIMARY KEY (source_key, source_event_id, source_participant_id),
  FOREIGN KEY (source_key, source_event_id)
    REFERENCES source_events (source_key, source_event_id)
);

CREATE TABLE IF NOT EXISTS source_markets (
  source_key TEXT NOT NULL,
  source_market_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_market_type TEXT,
  market_kind TEXT,
  title TEXT NOT NULL,
  status TEXT,
  closes_at_ms INTEGER CHECK (closes_at_ms IS NULL OR closes_at_ms >= 0),
  result TEXT,
  source_updated_at_ms INTEGER CHECK (source_updated_at_ms IS NULL OR source_updated_at_ms >= 0),
  subject_participant_id TEXT,
  volume REAL CHECK (volume IS NULL OR volume >= 0),
  volume_24h REAL CHECK (volume_24h IS NULL OR volume_24h >= 0),
  liquidity REAL CHECK (liquidity IS NULL OR liquidity >= 0),
  clob_liquidity REAL CHECK (clob_liquidity IS NULL OR clob_liquidity >= 0),
  open_interest REAL CHECK (open_interest IS NULL OR open_interest >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  retired_at_ms INTEGER CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0),
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
  last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
  PRIMARY KEY (source_key, source_market_id),
  UNIQUE (source_key, source_market_id, source_event_id),
  FOREIGN KEY (source_key, source_event_id)
    REFERENCES source_events (source_key, source_event_id),
  FOREIGN KEY (source_key, source_event_id, subject_participant_id)
    REFERENCES source_event_participants (source_key, source_event_id, source_participant_id)
);

CREATE INDEX IF NOT EXISTS idx_source_markets_event
  ON source_markets (source_key, source_event_id, source_market_id);

CREATE TABLE IF NOT EXISTS source_market_outcomes (
  source_key TEXT NOT NULL,
  source_market_id TEXT NOT NULL,
  outcome_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_participant_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  label TEXT NOT NULL,
  probability REAL CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  bid REAL CHECK (bid IS NULL OR (bid >= 0 AND bid <= 1)),
  ask REAL CHECK (ask IS NULL OR (ask >= 0 AND ask <= 1)),
  last REAL CHECK (last IS NULL OR (last >= 0 AND last <= 1)),
  last_trade_at_ms INTEGER CHECK (last_trade_at_ms IS NULL OR last_trade_at_ms >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  retired_at_ms INTEGER CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0),
  first_observed_at_ms INTEGER NOT NULL CHECK (first_observed_at_ms >= 0),
  last_observed_at_ms INTEGER NOT NULL CHECK (last_observed_at_ms >= first_observed_at_ms),
  CHECK (bid IS NULL OR ask IS NULL OR bid <= ask),
  PRIMARY KEY (source_key, source_market_id, outcome_key),
  FOREIGN KEY (source_key, source_market_id, source_event_id)
    REFERENCES source_markets (source_key, source_market_id, source_event_id),
  FOREIGN KEY (source_key, source_event_id, source_participant_id)
    REFERENCES source_event_participants (source_key, source_event_id, source_participant_id)
);
