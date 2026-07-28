-- migrations/011_state_regulation.sql
-- State-level regulatory compliance layer — NEW TABLES ONLY.
--
-- NOTE: Adding state_code to existing tables (events, markets, etc.)
-- should be done via Drizzle ORM (`bun run db:push`) or a separate
-- idempotent migration that checks table existence first.
-- This file creates only the new regulatory tables.

-- 1. Plays — canonical bet entity (scoped by partner × state × user) ------------
CREATE TABLE IF NOT EXISTS plays (
  play_id       TEXT PRIMARY KEY,
  node_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL DEFAULT 'anonymous',
  country_code  TEXT NOT NULL DEFAULT 'US',
  sport_id      TEXT NOT NULL,
  market_id     TEXT NOT NULL,
  state_code    TEXT DEFAULT NULL,
  wager_amount  REAL NOT NULL,
  bet_type      TEXT NOT NULL,      -- "straight" | "parlay" | "teaser"
  status        TEXT NOT NULL DEFAULT 'pending',
  placed_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_plays_node_state ON plays(node_id, state_code);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, node_id);
CREATE INDEX IF NOT EXISTS idx_plays_sport_market ON plays(sport_id, market_id);

-- 2. Play analysis — post-hoc enrichment per play ------------------------------
CREATE TABLE IF NOT EXISTS play_analysis (
  analysis_id   TEXT PRIMARY KEY,
  play_id       TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  user_id       TEXT NOT NULL DEFAULT 'anonymous',
  country_code  TEXT NOT NULL DEFAULT 'US',
  sport_id      TEXT NOT NULL,
  market_id     TEXT NOT NULL,
  state_code    TEXT DEFAULT NULL,
  model_score   REAL,
  edge_bp       REAL,
  confidence    REAL,
  analyzed_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_play_analysis_play ON play_analysis(play_id);

-- 3. Market snapshots — point-in-time book state -------------------------------
CREATE TABLE IF NOT EXISTS market_snapshots (
  snapshot_id   TEXT PRIMARY KEY,
  node_id       TEXT NOT NULL,
  user_id       TEXT DEFAULT NULL,
  country_code  TEXT NOT NULL DEFAULT 'US',
  sport_id      TEXT NOT NULL,
  market_id     TEXT NOT NULL,
  state_code    TEXT DEFAULT NULL,
  yes_price     REAL,
  no_price      REAL,
  volume_24h    REAL,
  open_interest REAL,
  captured_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_snapshots_node_state ON market_snapshots(node_id, state_code);

-- 4. Self-exclusion list — users barred from betting --------------------------
CREATE TABLE IF NOT EXISTS self_exclusions (
  user_id      TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT 'self-requested',
  excluded_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER,                       -- NULL = permanent
  PRIMARY KEY (user_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_self_exclusions_expires
  ON self_exclusions(expires_at);

-- 5. Regulatory limits per state / sport / market ------------------------------
CREATE TABLE IF NOT EXISTS regulatory_limits (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  state_code       TEXT NOT NULL,
  sport_id         TEXT NOT NULL,
  market_id        TEXT NOT NULL,
  max_wager        REAL,
  min_wager        REAL NOT NULL DEFAULT 0,
  allowed_bet_types TEXT NOT NULL DEFAULT '[]',  -- JSON array
  special_rules    TEXT,                         -- JSON blob
  effective_from   INTEGER NOT NULL DEFAULT (unixepoch()),
  effective_to     INTEGER                       -- NULL = still active
);
CREATE INDEX IF NOT EXISTS idx_limits_state_sport_market
  ON regulatory_limits(state_code, sport_id, market_id);
CREATE INDEX IF NOT EXISTS idx_limits_effective
  ON regulatory_limits(effective_from, effective_to);

-- 6. Partner state licenses ----------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_state_licenses (
  node_id        TEXT NOT NULL,
  state_code     TEXT NOT NULL,
  license_number TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','suspended','revoked')),
  granted_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (node_id, state_code)
);
CREATE INDEX IF NOT EXISTS idx_licenses_status
  ON partner_state_licenses(status);

-- 7. Regulatory violations audit log -------------------------------------------
CREATE TABLE IF NOT EXISTS regulatory_violations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    TEXT NOT NULL,
  user_id    TEXT DEFAULT NULL,
  play_id    TEXT,
  state_code TEXT NOT NULL,
  reason     TEXT NOT NULL,
  details    TEXT,
  blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_violations_node_state
  ON regulatory_violations(node_id, state_code);
CREATE INDEX IF NOT EXISTS idx_violations_user
  ON regulatory_violations(user_id, node_id);
CREATE INDEX IF NOT EXISTS idx_violations_blocked_at
  ON regulatory_violations(blocked_at DESC);
