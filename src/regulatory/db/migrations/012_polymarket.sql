-- migrations/012_polymarket.sql
-- Polymarket market data + line-movement tracking for regulatory compliance.

-- 1. Polymarket markets — canonical metadata cache -----------------------------
CREATE TABLE IF NOT EXISTS polymarket_markets (
  slug             TEXT PRIMARY KEY,
  question         TEXT NOT NULL,
  description      TEXT,
  condition_id     TEXT NOT NULL,
  resolution_source TEXT,
  outcomes         TEXT NOT NULL DEFAULT '[]',   -- JSON array
  outcome_prices   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  volume           REAL NOT NULL DEFAULT 0,
  volume_24hr      REAL NOT NULL DEFAULT 0,
  liquidity        REAL NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  closed           INTEGER NOT NULL DEFAULT 0,
  end_date         TEXT,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pm_markets_active ON polymarket_markets(active);
CREATE INDEX IF NOT EXISTS idx_pm_markets_closed ON polymarket_markets(closed);

-- 2. Polymarket ticks — time-series price snapshots ----------------------------
CREATE TABLE IF NOT EXISTS polymarket_ticks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  yes_price    REAL NOT NULL,
  no_price     REAL NOT NULL,
  best_bid     REAL NOT NULL,
  best_ask     REAL NOT NULL,
  spread       REAL NOT NULL DEFAULT 0,
  volume_24hr  REAL NOT NULL DEFAULT 0,
  volume_total REAL NOT NULL DEFAULT 0,
  liquidity    REAL NOT NULL DEFAULT 0,
  timestamp    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pm_ticks_slug_time ON polymarket_ticks(slug, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_pm_ticks_time ON polymarket_ticks(timestamp DESC);

-- 3. Polymarket line moves — detected steam / significant price shifts ----------
CREATE TABLE IF NOT EXISTS polymarket_line_moves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK(direction IN ('up','down','flat')),
  old_price      REAL NOT NULL,
  new_price      REAL NOT NULL,
  delta_bp       INTEGER NOT NULL,               -- basis points
  delta_abs      REAL NOT NULL,
  volume_at_move REAL NOT NULL DEFAULT 0,
  detected_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  window_seconds INTEGER NOT NULL DEFAULT 300
);
CREATE INDEX IF NOT EXISTS idx_pm_line_moves_slug ON polymarket_line_moves(slug, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pm_line_moves_detected ON polymarket_line_moves(detected_at DESC);
