/**
 * constants.ts — Single source of truth for regulatory domain constants.
 *
 * No magic strings or numbers should live outside this file.
 */

// ── Play lifecycle ──
export const PLAY_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  PENDING: "pending",
} as const;

export const DEFAULT_COUNTRY_CODE = "US";

// ── License status ──
export const LICENSE_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  EXPIRED: "expired",
  PENDING: "pending",
} as const;

// ── Bet types (canonical set) ──
export const BET_TYPE = {
  STRAIGHT: "straight",
  PARLAY: "parlay",
  TEASER: "teaser",
  OVER_UNDER: "over_under",
  MONEYLINE: "moneyline",
  PROP: "prop",
} as const;

// ── HTTP headers used by middleware ──
export const HEADER = {
  CONTENT_TYPE: "content-type",
  X_FORWARDED_FOR: "x-forwarded-for",
  X_REAL_IP: "x-real-ip",
  X_NODE_ID: "x-node-id",
  X_USER_ID: "x-user-id",
  X_RATE_LIMIT_LIMIT: "x-ratelimit-limit",
  X_RATE_LIMIT_REMAINING: "x-ratelimit-remaining",
  X_RATE_LIMIT_RESET: "x-ratelimit-reset",
  RETRY_AFTER: "retry-after",
} as const;

// ── Content types ──
export const CONTENT_TYPE = {
  JSON: "application/json",
  HTML: "text/html; charset=utf-8",
} as const;

// ── HTTP status codes ──
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ── Rate limiter defaults ──
export const RATE_LIMIT = {
  DEFAULT_WINDOW_MS: 60_000,
  DEFAULT_MAX: 100,
  FALLBACK_IP: "unknown",
} as const;

// ── User defaults ──
export const DEFAULT_USER_ID = "anonymous";

// ── SQL scope-injection marker ──
export const SCOPE_INJECTION_MARKER = "/*scope-injected*/";

// ── Violation alerting defaults ──
export const ALERT = {
  DEFAULT_WINDOW_SECONDS: 300,
  DEFAULT_THRESHOLD: 10,
  DEFAULT_SUMMARY_MINUTES: 60,
  TOP_REASONS_LIMIT: 5,
  TOP_STATES_LIMIT: 5,
  RECENT_LIMIT: 20,
} as const;

// ── Database table names ──
export const TABLE = {
  PLAYS: "plays",
  PLAY_ANALYSIS: "play_analysis",
  MARKET_SNAPSHOTS: "market_snapshots",
  PARTNER_STATE_LICENSES: "partner_state_licenses",
  REGULATORY_LIMITS: "regulatory_limits",
  REGULATORY_VIOLATIONS: "regulatory_violations",
  SELF_EXCLUSIONS: "self_exclusions",
  MIGRATIONS: "_regulatory_migrations",
  POLYMARKET_MARKETS: "polymarket_markets",
  POLYMARKET_TICKS: "polymarket_ticks",
  POLYMARKET_LINE_MOVES: "polymarket_line_moves",
  REGULATORY_AUDIT_LOG: "regulatory_audit_log",
} as const;

// ── Special rule keys ──
export const SPECIAL_RULE = {
  MAX_DAILY_TOTAL: "max_daily_total",
  REQUIRE_IDENTITY_VERIFICATION: "require_identity_verification",
  COOLING_OFF_MINUTES: "cooling_off_minutes",
} as const;

// ── SQL transaction commands ──
export const TX = {
  BEGIN_IMMEDIATE: "BEGIN IMMEDIATE",
  COMMIT: "COMMIT",
  ROLLBACK: "ROLLBACK",
} as const;

// ── SQLite time function ──
export const SQL_UNIXEPOCH = "unixepoch()";

// ── Migration / sweeper defaults ──
export const MIGRATION = {
  DEFAULT_RETENTION_DAYS: 90,
} as const;

// ── Polymarket line-movement defaults ──
export const POLYMARKET = {
  DEFAULT_DELTA_BP_THRESHOLD: 500,      // 5% move
  DEFAULT_MIN_VOLUME_24HR: 1_000,
  DEFAULT_TRACKING_WINDOW_SECONDS: 300, // 5 min
  DEFAULT_MAX_SPREAD: 0.05,
  DEFAULT_FETCH_LIMIT: 50,
  STEAM_LOOKBACK_SECONDS: 60,           // bets placed 60s before line move
} as const;

// ── Agent role identifiers ──
export const AGENT_ROLE = {
  COMPLIANCE: "compliance",
  OPS: "ops",
  MARKET_DATA: "market_data",
  ADMIN: "admin",
  ORCHESTRATOR: "orchestrator",
} as const;
