-- Canonical event store — L2 SSOT for cross-venue joins (event_id).
-- Live recorder and alpha programs write into these tables; they do not own the schema.

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
  source TEXT NOT NULL,
  source_row_hash TEXT NOT NULL UNIQUE,
  ingested_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_tour_surface_start ON events (tour, surface, start_ts);
CREATE INDEX IF NOT EXISTS idx_events_tournament ON events (tournament, start_ts);

CREATE TABLE IF NOT EXISTS markets (
  market_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  venue TEXT NOT NULL,
  ticker TEXT NOT NULL,
  yes_side_label TEXT NOT NULL DEFAULT '',
  side_code TEXT NOT NULL DEFAULT '',
  competitor_id TEXT,
  rules_blob TEXT,
  settlement_ts TEXT,
  UNIQUE (ticker)
);

CREATE INDEX IF NOT EXISTS idx_markets_event ON markets (event_id);

CREATE TABLE IF NOT EXISTS book_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  ticker TEXT,
  ts INTEGER NOT NULL,
  seq INTEGER,
  levels_json TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_book_ticks_event_ts ON book_ticks (event_id, ts);

CREATE TABLE IF NOT EXISTS odds_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events (event_id),
  source TEXT NOT NULL,
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
  resolved_ts TEXT NOT NULL
);
