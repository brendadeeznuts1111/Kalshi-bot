// @see https://orm.drizzle.team/docs/get-started-sqlite#bun-sqlite
/**
 * Drizzle ORM schema for the event store.
 *
 * This is a parallel SSOT to schema.sql — both define the same tables.
 * New code should prefer Drizzle queries; legacy raw SQL is preserved.
 *
 * Usage:
 *   import { db } from "./client.ts";
 *   const rows = db.select().from(events).where(eq(events.tour, "ITF-M"));
 */
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
//  Core event-store tables (legacy)
// ─────────────────────────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  eventId: text("event_id").primaryKey(),
  tour: text("tour").notNull(),
  level: text("level").notNull(),
  tournament: text("tournament").notNull(),
  location: text("location").notNull().default(""),
  surface: text("surface").notNull(),
  court: text("court").notNull().default(""),
  round: text("round").notNull(),
  bestOf: integer("best_of"),
  playerA: text("player_a").notNull(),
  playerB: text("player_b").notNull(),
  winner: text("winner").notNull(),
  loser: text("loser").notNull(),
  startTs: text("start_ts").notNull(),
  outcome: text("outcome").notNull(),
  scoreText: text("score_text").notNull().default(""),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts"),
  sourceRowHash: text("source_row_hash").notNull().unique(),
  ingestedAt: integer("ingested_at").notNull(),
  corpus: text("corpus").notNull().default("trading"),
  stateCode: text("state_code"), // ← regulatory compliance (nullable)
});

export const markets = sqliteTable("markets", {
  marketId: text("market_id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.eventId),
  venue: text("venue").notNull(),
  ticker: text("ticker").notNull().unique(),
  series: text("series").notNull().default(""),
  marketKind: text("market_kind").notNull().default("match_winner"),
  yesSideLabel: text("yes_side_label").notNull().default(""),
  sideCode: text("side_code").notNull().default(""),
  competitorId: text("competitor_id"),
  rulesBlob: text("rules_blob"),
  settlementTs: text("settlement_ts"),
  source: text("source").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts"),
  volumeFp: text("volume_fp"),
  volume24hFp: text("volume_24h_fp"),
  openInterestFp: text("open_interest_fp"),
  yesBidSizeFp: text("yes_bid_size_fp"),
  yesAskSizeFp: text("yes_ask_size_fp"),
  stateCode: text("state_code"), // ← regulatory compliance (nullable)
});

export const bookTicks = sqliteTable("book_ticks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().references(() => events.eventId),
  ticker: text("ticker"),
  marketKind: text("market_kind").notNull().default(""),
  ts: integer("ts", { mode: "number" }).notNull(),
  recvTs: integer("recv_ts", { mode: "number" }),
  sourceClock: text("source_clock").notNull().default("recv"),
  seq: integer("seq", { mode: "number" }),
  levelsJson: text("levels_json").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
});

export const oddsTicks = sqliteTable("odds_ticks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().references(() => events.eventId),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts", { mode: "number" }),
  corpus: text("corpus").notNull().default("trading"),
  ts: integer("ts", { mode: "number" }).notNull(),
  side: text("side").notNull(),
  decimalOdds: real("decimal_odds").notNull(),
  impliedProb: real("implied_prob"),
  limitContext: text("limit_context").notNull().default("closing"),
});

export const resolutions = sqliteTable("resolutions", {
  eventId: text("event_id").primaryKey().references(() => events.eventId),
  outcome: integer("outcome", { mode: "number" }).notNull(),
  winner: text("winner").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts", { mode: "number" }),
  corpus: text("corpus").notNull().default("trading"),
  resolvedTs: text("resolved_ts").notNull(),
});

export const eventLinks = sqliteTable("event_links", {
  stadionEventId: text("stadion_event_id").primaryKey(),
  kalshiEventId: text("kalshi_event_id"),
  status: text("status").notNull(),
  matchKey: text("match_key").notNull(),
  method: text("method").notNull().default("surname_day_lane"),
  detail: text("detail").notNull().default(""),
  linkedAt: integer("linked_at", { mode: "number" }).notNull(),
}, (table) => ({
  kalshiLinkedIdx: uniqueIndex("idx_event_links_kalshi_linked").on(table.kalshiEventId),
}));

export const liveScores = sqliteTable("live_scores", {
  eventId: text("event_id").primaryKey().references(() => events.eventId),
  eventTicker: text("event_ticker").notNull(),
  milestoneId: text("milestone_id").notNull(),
  updatedTs: integer("updated_ts", { mode: "number" }).notNull(),
  sourceClock: text("source_clock").notNull().default("recv"),
  status: text("status").notNull().default(""),
  matchStatus: text("match_status").notNull().default(""),
  setsHome: integer("sets_home", { mode: "number" }).notNull().default(0),
  setsAway: integer("sets_away", { mode: "number" }).notNull().default(0),
  gamesHome: integer("games_home", { mode: "number" }).notNull().default(0),
  gamesAway: integer("games_away", { mode: "number" }).notNull().default(0),
  pointsHome: integer("points_home", { mode: "number" }).notNull().default(0),
  pointsAway: integer("points_away", { mode: "number" }).notNull().default(0),
  serverCompetitorId: text("server_competitor_id"),
  competitor1Id: text("competitor1_id"),
  competitor2Id: text("competitor2_id"),
  isLive: integer("is_live", { mode: "number" }).notNull().default(0),
  detailsJson: text("details_json").notNull().default("{}"),
  source: text("source").notNull().default("kalshi-live-data"),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts", { mode: "number" }),
});

export const scoreSnapshots = sqliteTable("score_snapshots", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().references(() => events.eventId),
  eventTicker: text("event_ticker").notNull(),
  milestoneId: text("milestone_id").notNull(),
  ts: integer("ts", { mode: "number" }).notNull(),
  sourceClock: text("source_clock").notNull().default("recv"),
  status: text("status").notNull().default(""),
  setsHome: integer("sets_home", { mode: "number" }).notNull().default(0),
  setsAway: integer("sets_away", { mode: "number" }).notNull().default(0),
  gamesHome: integer("games_home", { mode: "number" }).notNull().default(0),
  gamesAway: integer("games_away", { mode: "number" }).notNull().default(0),
  pointsHome: integer("points_home", { mode: "number" }).notNull().default(0),
  pointsAway: integer("points_away", { mode: "number" }).notNull().default(0),
  serverCompetitorId: text("server_competitor_id"),
  detailsJson: text("details_json").notNull().default("{}"),
  source: text("source").notNull().default("kalshi-live-data"),
  sourceUrl: text("source_url").notNull().default(""),
  fetchedTs: integer("fetched_ts", { mode: "number" }),
});

export const playerProfiles = sqliteTable("player_profiles", {
  playerName: text("player_name").primaryKey(),
  firstSeenTs: integer("first_seen_ts", { mode: "number" }).notNull(),
  lastSeenTs: integer("last_seen_ts", { mode: "number" }).notNull(),
  appearances: integer("appearances", { mode: "number" }).notNull().default(0),
  wins: integer("wins", { mode: "number" }).notNull().default(0),
  losses: integer("losses", { mode: "number" }).notNull().default(0),
  winRate: real("win_rate"),
  surfaces: text("surfaces").notNull().default("{}"),
  avgKalshiVolumeFp: real("avg_kalshi_volume_fp"),
  bestOf: integer("best_of", { mode: "number" }),
  corpus: text("corpus").notNull().default("trading"),
});

/**
 * Per-(player, opponent) head-to-head aggregates — derived from events+markets.
 * The opponent dimension player_profiles lacks: match count, W/L, and average
 * Kalshi market volume for the matchup. Wipe-and-rebuild derived table.
 */
export const playerOpponentProfiles = sqliteTable(
  "player_opponent_profiles",
  {
    playerName: text("player_name").notNull(),
    opponentName: text("opponent_name").notNull(),
    firstSeenTs: integer("first_seen_ts", { mode: "number" }).notNull(),
    lastSeenTs: integer("last_seen_ts", { mode: "number" }).notNull(),
    matches: integer("matches", { mode: "number" }).notNull().default(0),
    wins: integer("wins", { mode: "number" }).notNull().default(0),
    losses: integer("losses", { mode: "number" }).notNull().default(0),
    winRate: real("win_rate"),
    avgKalshiVolumeFp: real("avg_kalshi_volume_fp"),
    corpus: text("corpus").notNull().default("trading"),
  },
  (t) => [uniqueIndex("player_opponent_profiles_pk").on(t.playerName, t.opponentName)],
);

// ─────────────────────────────────────────────────────────────────────────────
//  Regulatory compliance tables (state-level + per-user)
// ─────────────────────────────────────────────────────────────────────────────

/** Plays — the canonical "bet" entity scoped by partner × state × user */
export const plays = sqliteTable("plays", {
  playId: text("play_id").primaryKey(),
  nodeId: text("node_id").notNull(),
  userId: text("user_id").notNull().default("anonymous"),
  countryCode: text("country_code").notNull().default("US"),
  sportId: text("sport_id").notNull(),
  marketId: text("market_id").notNull(),
  stateCode: text("state_code"), // nullable
  wagerAmount: real("wager_amount").notNull(),
  betType: text("bet_type").notNull(), // "straight" | "parlay" | "teaser"
  status: text("status").notNull().default("pending"), // "pending" | "accepted" | "rejected" | "settled"
  placedAt: integer("placed_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

/** Play analysis — post-hoc enrichment per play */
export const playAnalysis = sqliteTable("play_analysis", {
  analysisId: text("analysis_id").primaryKey(),
  playId: text("play_id").notNull(),
  nodeId: text("node_id").notNull(),
  userId: text("user_id").notNull().default("anonymous"),
  countryCode: text("country_code").notNull().default("US"),
  sportId: text("sport_id").notNull(),
  marketId: text("market_id").notNull(),
  stateCode: text("state_code"), // nullable
  modelScore: real("model_score"),
  edgeBp: real("edge_bp"), // edge in basis points
  confidence: real("confidence"),
  analyzedAt: integer("analyzed_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

/** Market snapshots — point-in-time book state per partner × state */
export const marketSnapshots = sqliteTable("market_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  nodeId: text("node_id").notNull(),
  userId: text("user_id"), // nullable
  countryCode: text("country_code").notNull().default("US"),
  sportId: text("sport_id").notNull(),
  marketId: text("market_id").notNull(),
  stateCode: text("state_code"), // nullable
  yesPrice: real("yes_price"),
  noPrice: real("no_price"),
  volume24h: real("volume_24h"),
  openInterest: real("open_interest"),
  capturedAt: integer("captured_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

/** Self-exclusion list — users barred from betting */
export const selfExclusions = sqliteTable("self_exclusions", {
  userId: text("user_id").notNull(),
  nodeId: text("node_id").notNull(),
  reason: text("reason").notNull().default("self-requested"),
  excludedAt: integer("excluded_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  expiresAt: integer("expires_at", { mode: "number" }), // NULL = permanent
}, (table) => ({
  pk: uniqueIndex("idx_self_exclusions_pk").on(table.userId, table.nodeId),
}));

/** Regulatory limits per state / sport / market */
export const regulatoryLimits = sqliteTable("regulatory_limits", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  stateCode: text("state_code").notNull(),
  sportId: text("sport_id").notNull(),
  marketId: text("market_id").notNull(),
  maxWager: real("max_wager"),
  minWager: real("min_wager").notNull().default(0),
  allowedBetTypes: text("allowed_bet_types").notNull().default("[]"), // JSON array
  specialRules: text("special_rules"), // JSON blob
  effectiveFrom: integer("effective_from", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  effectiveTo: integer("effective_to", { mode: "number" }),
});

/** Partner state licenses — which node can operate in which state */
export const partnerStateLicenses = sqliteTable("partner_state_licenses", {
  nodeId: text("node_id").notNull(),
  stateCode: text("state_code").notNull(),
  licenseNumber: text("license_number"),
  status: text("status").notNull().$type<"active" | "suspended" | "revoked">().default("active"),
  grantedAt: integer("granted_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => ({
  pk: uniqueIndex("idx_partner_state_licenses_pk").on(table.nodeId, table.stateCode),
}));

/** Audit log for regulatory violations (blocked bets, limit breaches, etc.) */
export const regulatoryViolations = sqliteTable("regulatory_violations", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  nodeId: text("node_id").notNull(),
  userId: text("user_id"), // nullable
  playId: text("play_id"),
  stateCode: text("state_code").notNull(),
  reason: text("reason").notNull(),
  details: text("details"),
  blockedAt: integer("blocked_at", { mode: "number" }).notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});
