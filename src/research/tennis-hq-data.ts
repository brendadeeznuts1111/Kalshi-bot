/**
 * Tennis HQ data plane — joins Kalshi TennisBoard to event-store enrichment.
 * Identity join: competitor_id ↔ markets.yes_side_label ↔ player_profiles.player_name
 *
 * @see tennis-events.ts (Kalshi board)
 * @see docs/TENNIS_PROGRAM_ARCHETYPES.md
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { midFromBookSnapshot } from "../bot/kalshi-book-parse.ts";
import type { BookSnapshot } from "../institutions/alpha-signal-types.ts";
import { openEventStore } from "../institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";
import { fetchLiveCrossMarketOdds } from "../institutions/event-store/cross-market-live.ts";
import type { CrossMarketOdds } from "../institutions/event-store/types.ts";
import { asSeriesTicker, trySeriesTicker } from "../institutions/event-store/brands.ts";
import { SOURCE, SPORT, type SportKey } from "../institutions/market-registry/brands.ts";
import {
  ADAPTERS,
  kalshiReconciliationSemanticsForSeries,
} from "../institutions/market-registry/registry.ts";
import {
  KALSHI_BOOK_SOURCE_REST,
  KALSHI_BOOK_SOURCE_WS,
} from "../institutions/event-store/tennis-lane-constants.ts";
import { eventTickerFromMarket } from "./hq-data.ts";
import {
  fetchTennisBoard,
  type TennisBoard,
  type TennisEventView,
  type TennisMarketView,
} from "./tennis-events.ts";
import {
  capLastSeenAtMs,
  eventVolumeSqlForDb,
  parseSurfaceStats,
  type SurfaceStats,
} from "./player-profile-meta.ts";
import {
  computeSurfaceEdge,
  hasReliableSurfaceSample,
  MIN_SURFACE_EDGE_APPEARANCES,
  normalizeTennisSurface,
  type EdgeScaling,
  type SurfacePerformance,
} from "./tennis-surface-edge.ts";

const LIVE_SCORE_STALE_MS = 15 * 60 * 1000;
export const HEALTHY_CROSS_VENUE_MATCH_RATE = 0.85;
const POLYMARKET_STALE_FOR_MS = (() => {
  const policy = ADAPTERS.find((adapter) => adapter.source === SOURCE.polymarket)?.cachePolicy;
  if (!policy) throw new Error("Polymarket cache policy missing from registry");
  return policy.staleForMs;
})();

// ── Payload types ──

export type TennisMatchStatus = "scheduled" | "live" | "ended" | "unknown";

export type TennisHqSources = {
  kalshiBoard: "ok" | "unavailable";
  eventStore: "ok" | "absent";
  liveScores: "ok" | "stale" | "empty";
  books: { restWatch: number; wsWatch: number };
};

export type TennisDataHealth = {
  source: "live-cache" | "snapshots" | "unavailable";
  state: "healthy" | "degraded" | "critical" | "unavailable";
  targetEvents: number;
  matchedEvents: number;
  unmatchedEvents: number;
  matchRate: number;
  staleVolumeEvents: number;
  staleQuoteEvents: number;
  kalshiVolume24h: number;
  kalshiVolumeLifetime: number;
  polymarketVolume24h: number;
  polymarketVolumeLifetime: number;
  lastSnapshotAt: number | null;
};

export type TennisSideBook = {
  midCents: number | null;
  bidSize: number | null;
  askSize: number | null;
  source: typeof KALSHI_BOOK_SOURCE_REST | typeof KALSHI_BOOK_SOURCE_WS | string;
  ageSec: number;
};

export type PlayerProfileStub = {
  playerName: string;
  competitorIds: string[];
  appearances: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Same contract as /api/profiles — see player-profile-meta.ts */
  avgKalshiVolumeFp: number | null;
  surfaces: Record<string, SurfaceStats>;
  lastSeenAtMs: number | null;
};

export type TennisHqSide = {
  ticker: string;
  playerName: string | null;
  competitorId: string | null;
  yesBidCents: number | null;
  yesAskCents: number | null;
  lastCents: number | null;
  volume24h: number | null;
  openInterest: number | null;
  book: TennisSideBook | null;
  profile: PlayerProfileStub | null;
};

/** Score home/away are Kalshi c1/c2 (competitor1/2), not alphabetical player_a/b. */
export type TennisHqScore = {
  sets: [number, number];
  games: [number, number];
  points: [number, number];
  serverCompetitorId: string | null;
  updatedMs: number;
  isLive: boolean;
};

export type TennisHqEvent = {
  sport: SportKey;
  eventTicker: string;
  eventId: string | null;
  title: string | null;
  series: string;
  competition: string | null;
  surface: string | null;
  /** Warehouse player_a relative to player_b, in dampened percentage points. */
  surfaceEdge: number;
  surfaceEdgePlayers: [string | null, string | null];
  surfaceEdgeSamples: [number, number];
  surfaceEdgeReliable: boolean;
  surfaceEdgeEvidence:
    | "ready"
    | "missing-surface"
    | "missing-player"
    | "insufficient-sample";
  surfaceEdgeScaling: EdgeScaling;
  occurrenceMs: number | null;
  status: TennisMatchStatus;
  score: TennisHqScore | null;
  sides: TennisHqSide[];
};

export type TennisHqPayload = {
  generatedAt: string;
  sources: TennisHqSources;
  dataHealth: TennisDataHealth;
  liveBoard: TennisHqEvent[];
  profilesIndex: {
    total: number;
    topByVolume: PlayerProfileStub[];
  };
};

export type PlayerRecentEvent = {
  eventId: string;
  eventTicker: string | null;
  opponent: string;
  startTs: string;
  outcome: "win" | "loss" | "unknown";
  winner: string;
  scoreText: string;
  surface: string;
  volumeFp: number | null;
  lastMidCents: number | null;
};

export type PlayerProfileDetail = PlayerProfileStub & {
  recentEvents: PlayerRecentEvent[];
};

export type PlayerProfileDetailResult =
  | { state: "ok"; profile: PlayerProfileDetail }
  | { state: "not_found"; playerName: string };

export type BuildTennisHqPayloadOptions = {
  nowMs?: number;
  dbPath?: string;
  /** Test hook — reuse an open store connection (e.g. :memory: fixture). */
  db?: Database;
  /** Test hook — inject board without Kalshi fetch. */
  board?: TennisBoard;
  fetchBoard?: typeof fetchTennisBoard;
  /** Test hook. Inject a result map, or false to keep the payload snapshot-only. */
  crossMarketOdds?: Map<string, CrossMarketOdds> | false;
  surfaceEdge?: {
    minSampleSize?: number;
    scaling?: EdgeScaling;
  };
};

export type GetPlayerDetailOptions = {
  dbPath?: string;
  /** Test hook — reuse an open store connection. */
  db?: Database;
};

// ── Internal store row types ──

type MarketRow = {
  ticker: string;
  event_id: string;
  yes_side_label: string;
  competitor_id: string | null;
  volume_fp: string | null;
  volume_24h_fp: string | null;
  open_interest_fp: string | null;
  event_surface: string | null;
  event_player_a: string | null;
  event_player_b: string | null;
};

type LiveScoreRow = {
  event_id: string;
  event_ticker: string;
  updated_ts: number;
  is_live: number;
  sets_home: number;
  sets_away: number;
  games_home: number;
  games_away: number;
  points_home: number;
  points_away: number;
  server_competitor_id: string | null;
  status: string;
  match_status: string;
};

type BookTickRow = {
  ticker: string;
  ts: number;
  source: string;
  levels_json: string;
};

type ProfileRow = {
  player_name: string;
  appearances: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_kalshi_volume_fp: number | null;
  surfaces: string;
  last_seen_ts: number;
};

type SurfacePerformanceRow = {
  player_name: string;
  surface: string;
  appearances: number;
  wins: number;
};

type SurfacePerformanceByPlayer = Map<string, Map<string, SurfacePerformance>>;

// ── SQL helpers ──

function inClause(prefix: string, values: readonly string[]): { placeholders: string; params: Record<string, string> } {
  if (values.length === 0) return { placeholders: "NULL", params: {} };
  const params: Record<string, string> = {};
  const placeholders = values.map((v, i) => {
    const key = `$${prefix}${i}`;
    params[key] = v;
    return key;
  }).join(", ");
  return { placeholders, params };
}

function parseSurfaces(raw: string | null | undefined) {
  return parseSurfaceStats(raw);
}

function parseBookJson(json: string): BookSnapshot | null {
  try {
    return JSON.parse(json) as BookSnapshot;
  } catch {
    return null;
  }
}

function isTerminalLiveStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "ended" || s === "final" || s === "closed" || s === "cancelled";
}

function isClosedMarketStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "closed" || s === "settled" || s === "finalized";
}

function determineStatus(
  markets: TennisMarketView[],
  score: LiveScoreRow | null | undefined,
): TennisMatchStatus {
  if (score?.is_live === 1) return "live";
  if (score && isTerminalLiveStatus(score.status)) return "ended";
  if (markets.some((m) => isClosedMarketStatus(m.status))) return "ended";
  if (markets.some((m) => m.status === "active" || m.status === "open")) return "scheduled";
  if (score) return "unknown";
  return "unknown";
}

function loadMarketsByTicker(db: Database, tickers: readonly string[]): Map<string, MarketRow> {
  const map = new Map<string, MarketRow>();
  if (tickers.length === 0) return map;
  const { placeholders, params } = inClause("t", tickers);
  const rows = db
    .query(
      `SELECT m.ticker, m.event_id, m.yes_side_label, m.competitor_id,
              m.volume_fp, m.volume_24h_fp, m.open_interest_fp,
              e.surface AS event_surface, e.player_a AS event_player_a,
              e.player_b AS event_player_b
       FROM markets m
       LEFT JOIN events e ON e.event_id = m.event_id
       WHERE m.ticker IN (${placeholders})`,
    )
    .all(params) as MarketRow[];
  for (const r of rows) map.set(r.ticker, r);
  return map;
}

function loadSurfacePerformance(
  db: Database,
  names: readonly string[],
): SurfacePerformanceByPlayer {
  const byPlayer: SurfacePerformanceByPlayer = new Map();
  if (names.length === 0) return byPlayer;
  const { placeholders, params } = inClause("sp", names);
  const rows = db
    .query(
      `WITH player_surface AS (
         SELECT winner AS player_name, LOWER(TRIM(surface)) AS surface, 1 AS won
         FROM events
         WHERE winner != '' AND loser != '' AND TRIM(surface) != ''
           AND LOWER(TRIM(surface)) NOT IN ('unknown', 'n/a')
         UNION ALL
         SELECT loser AS player_name, LOWER(TRIM(surface)) AS surface, 0 AS won
         FROM events
         WHERE winner != '' AND loser != '' AND TRIM(surface) != ''
           AND LOWER(TRIM(surface)) NOT IN ('unknown', 'n/a')
       )
       SELECT player_name, surface, COUNT(*) AS appearances, SUM(won) AS wins
       FROM player_surface
       WHERE player_name IN (${placeholders})
       GROUP BY player_name, surface`,
    )
    .all(params) as SurfacePerformanceRow[];

  for (const row of rows) {
    const surfaces = byPlayer.get(row.player_name) ?? new Map();
    surfaces.set(row.surface, {
      appearances: row.appearances,
      wins: row.wins,
      winRate: row.appearances > 0 ? row.wins / row.appearances : 0,
    });
    byPlayer.set(row.player_name, surfaces);
  }
  return byPlayer;
}

function loadLiveScores(
  db: Database,
  eventIds: readonly string[],
  eventTickers: readonly string[],
): { byEventId: Map<string, LiveScoreRow>; byEventTicker: Map<string, LiveScoreRow> } {
  const byEventId = new Map<string, LiveScoreRow>();
  const byEventTicker = new Map<string, LiveScoreRow>();
  if (eventIds.length === 0 && eventTickers.length === 0) {
    return { byEventId, byEventTicker };
  }
  const idClause = eventIds.length > 0 ? inClause("eid", eventIds) : { placeholders: "NULL", params: {} };
  const tickerClause = eventTickers.length > 0 ? inClause("et", eventTickers) : { placeholders: "NULL", params: {} };
  const rows = db
    .query(
      `SELECT event_id, event_ticker, updated_ts, is_live,
              sets_home, sets_away, games_home, games_away,
              points_home, points_away, server_competitor_id,
              status, match_status
       FROM live_scores
       WHERE event_id IN (${idClause.placeholders})
          OR event_ticker IN (${tickerClause.placeholders})`,
    )
    .all({ ...idClause.params, ...tickerClause.params }) as LiveScoreRow[];
  for (const r of rows) {
    byEventId.set(r.event_id, r);
    byEventTicker.set(r.event_ticker, r);
  }
  return { byEventId, byEventTicker };
}

function loadLatestBooks(db: Database, tickers: readonly string[]): Map<string, BookTickRow> {
  const map = new Map<string, BookTickRow>();
  if (tickers.length === 0) return map;
  const { placeholders, params } = inClause("b", tickers);
  const rows = db
    .query(
      `SELECT bt.ticker, bt.ts, bt.source, bt.levels_json
       FROM book_ticks bt
       WHERE bt.id IN (
         SELECT MAX(id) FROM book_ticks WHERE ticker IN (${placeholders}) GROUP BY ticker
       )`,
    )
    .all(params) as BookTickRow[];
  for (const r of rows) map.set(r.ticker, r);
  return map;
}

function loadProfileRows(db: Database, names: readonly string[]): Map<string, ProfileRow> {
  const map = new Map<string, ProfileRow>();
  if (names.length === 0) return map;
  const { placeholders, params } = inClause("n", names);
  const rows = db
    .query(
      `SELECT player_name, appearances, wins, losses, win_rate,
              avg_kalshi_volume_fp, surfaces, last_seen_ts
       FROM player_profiles
       WHERE player_name IN (${placeholders})`,
    )
    .all(params) as ProfileRow[];
  for (const r of rows) map.set(r.player_name, r);
  return map;
}

function loadCompetitorIdsByName(db: Database, names: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (names.length === 0) return map;
  const { placeholders, params } = inClause("l", names);
  const rows = db
    .query(
      `SELECT yes_side_label, competitor_id
       FROM markets
       WHERE yes_side_label IN (${placeholders})
         AND competitor_id IS NOT NULL AND competitor_id != ''`,
    )
    .all(params) as Array<{ yes_side_label: string; competitor_id: string }>;
  for (const r of rows) {
    const list = map.get(r.yes_side_label) ?? [];
    if (!list.includes(r.competitor_id)) list.push(r.competitor_id);
    map.set(r.yes_side_label, list);
  }
  return map;
}

function loadTopProfileRows(db: Database, limit: number): ProfileRow[] {
  return db
    .query(
      `SELECT player_name, appearances, wins, losses, win_rate,
              avg_kalshi_volume_fp, surfaces, last_seen_ts
       FROM player_profiles
       ORDER BY avg_kalshi_volume_fp DESC NULLS LAST, appearances DESC
       LIMIT ?`,
    )
    .all(limit) as ProfileRow[];
}

function countProfiles(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM player_profiles").get() as { n: number } | null;
  return row?.n ?? 0;
}

function toProfileStub(
  row: ProfileRow,
  competitorIds: string[],
): PlayerProfileStub {
  return {
    playerName: row.player_name,
    competitorIds,
    appearances: row.appearances,
    wins: row.wins,
    losses: row.losses,
    winRate: row.win_rate,
    avgKalshiVolumeFp: row.avg_kalshi_volume_fp,
    surfaces: parseSurfaces(row.surfaces),
    lastSeenAtMs: capLastSeenAtMs(row.last_seen_ts),
  };
}

function bookFromTick(tick: BookTickRow | undefined, nowMs: number): TennisSideBook | null {
  if (!tick) return null;
  const book = parseBookJson(tick.levels_json);
  if (!book) return null;
  return {
    midCents: midFromBookSnapshot(book),
    bidSize: book.bids[0]?.size ?? null,
    askSize: book.asks[0]?.size ?? null,
    source: tick.source,
    ageSec: Math.max(0, Math.round((nowMs - tick.ts) / 1000)),
  };
}

function scoreFromRow(row: LiveScoreRow | null | undefined): TennisHqScore | null {
  if (!row) return null;
  return {
    sets: [row.sets_home, row.sets_away],
    games: [row.games_home, row.games_away],
    points: [row.points_home, row.points_away],
    serverCompetitorId: row.server_competitor_id,
    updatedMs: row.updated_ts,
    isLive: row.is_live === 1,
  };
}

function resolveEventId(
  eventTicker: string,
  markets: TennisMarketView[],
  marketByTicker: Map<string, MarketRow>,
  scoresByTicker: Map<string, LiveScoreRow>,
): string | null {
  for (const m of markets) {
    const row = marketByTicker.get(m.ticker);
    if (row?.event_id) return row.event_id;
  }
  const score = scoresByTicker.get(eventTicker);
  return score?.event_id ?? null;
}

function enrichSide(
  market: TennisMarketView,
  marketByTicker: Map<string, MarketRow>,
  bookByTicker: Map<string, BookTickRow>,
  profileByName: Map<string, ProfileRow>,
  competitorIdsByName: Map<string, string[]>,
  nowMs: number,
): TennisHqSide {
  const name = market.player;
  const profileRow = name ? profileByName.get(name) : undefined;
  const competitorIds = name ? (competitorIdsByName.get(name) ?? []) : [];
  return {
    ticker: market.ticker,
    playerName: name,
    competitorId: market.competitorId,
    yesBidCents: market.yesBidCents,
    yesAskCents: market.yesAskCents,
    lastCents: market.lastCents,
    volume24h: market.volume24h,
    openInterest: market.openInterest,
    book: bookFromTick(bookByTicker.get(market.ticker), nowMs),
    profile: profileRow ? toProfileStub(profileRow, competitorIds) : null,
  };
}

function enrichEvent(
  event: TennisEventView,
  ctx: {
    marketByTicker: Map<string, MarketRow>;
    scoresByEventId: Map<string, LiveScoreRow>;
    scoresByEventTicker: Map<string, LiveScoreRow>;
    bookByTicker: Map<string, BookTickRow>;
    profileByName: Map<string, ProfileRow>;
    competitorIdsByName: Map<string, string[]>;
    surfacePerformanceByPlayer: SurfacePerformanceByPlayer;
    surfaceEdgeConfig: {
      minSampleSize: number;
      scaling: EdgeScaling;
    };
    nowMs: number;
  },
): TennisHqEvent {
  const eventId = resolveEventId(
    event.eventTicker,
    event.markets,
    ctx.marketByTicker,
    ctx.scoresByEventTicker,
  );
  const scoreRow =
    (eventId ? ctx.scoresByEventId.get(eventId) : undefined) ??
    ctx.scoresByEventTicker.get(event.eventTicker);
  const storeSurface = event.markets
    .map((market) => ctx.marketByTicker.get(market.ticker)?.event_surface)
    .find((surface): surface is string => Boolean(surface?.trim()));
  const storeEvent = event.markets
    .map((market) => ctx.marketByTicker.get(market.ticker))
    .find((market) => market?.event_player_a || market?.event_player_b);
  const surface = event.surface ?? storeSurface ?? null;
  const surfaceKey = normalizeTennisSurface(surface);
  const playerA = storeEvent?.event_player_a || event.markets[0]?.player || null;
  const playerB = storeEvent?.event_player_b || event.markets[1]?.player || null;
  const performanceA =
    playerA && surfaceKey
      ? ctx.surfacePerformanceByPlayer.get(playerA)?.get(surfaceKey)
      : undefined;
  const performanceB =
    playerB && surfaceKey
      ? ctx.surfacePerformanceByPlayer.get(playerB)?.get(surfaceKey)
      : undefined;
  const surfaceEdgeSamples: [number, number] = [
    performanceA?.appearances ?? 0,
    performanceB?.appearances ?? 0,
  ];
  const surfaceEdgeReliable = hasReliableSurfaceSample(
    performanceA,
    performanceB,
    ctx.surfaceEdgeConfig.minSampleSize,
  );
  const surfaceEdgeEvidence = !surfaceKey
    ? "missing-surface"
    : !playerA || !playerB
      ? "missing-player"
      : surfaceEdgeReliable
        ? "ready"
        : "insufficient-sample";
  return {
    sport: event.sport,
    eventTicker: event.eventTicker,
    eventId,
    title: event.title,
    series: event.series,
    competition: event.competition,
    surface,
    surfaceEdge: computeSurfaceEdge(performanceA, performanceB, ctx.surfaceEdgeConfig),
    surfaceEdgePlayers: [playerA, playerB],
    surfaceEdgeSamples,
    surfaceEdgeReliable,
    surfaceEdgeEvidence,
    surfaceEdgeScaling: ctx.surfaceEdgeConfig.scaling,
    occurrenceMs: event.occurrenceMs,
    status: determineStatus(event.markets, scoreRow),
    score: scoreFromRow(scoreRow),
    sides: event.markets.map((m) =>
      enrichSide(
        m,
        ctx.marketByTicker,
        ctx.bookByTicker,
        ctx.profileByName,
        ctx.competitorIdsByName,
        ctx.nowMs,
      ),
    ),
  };
}

function collectBoardEvents(board: TennisBoard): TennisEventView[] {
  const out: TennisEventView[] = [];
  for (const s of board.series) {
    if (s.state === "ok") out.push(...s.events);
  }
  return out;
}

function deriveLiveScoresSource(
  events: TennisHqEvent[],
  nowMs: number,
): TennisHqSources["liveScores"] {
  const scores = events.map((e) => e.score).filter((s): s is TennisHqScore => s != null);
  if (scores.length === 0) return "empty";
  const fresh = scores.some(
    (s) => s.isLive || nowMs - s.updatedMs <= LIVE_SCORE_STALE_MS,
  );
  return fresh ? "ok" : "stale";
}

function deriveBooksSource(events: TennisHqEvent[]): TennisHqSources["books"] {
  let restWatch = 0;
  let wsWatch = 0;
  for (const e of events) {
    for (const side of e.sides) {
      if (!side.book) continue;
      if (side.book.source === KALSHI_BOOK_SOURCE_WS) wsWatch++;
      else if (side.book.source === KALSHI_BOOK_SOURCE_REST) restWatch++;
    }
  }
  return { restWatch, wsWatch };
}

function unavailableDataHealth(targetEvents: number): TennisDataHealth {
  return {
    source: "unavailable",
    state: "unavailable",
    targetEvents,
    matchedEvents: 0,
    unmatchedEvents: targetEvents,
    matchRate: 0,
    staleVolumeEvents: 0,
    staleQuoteEvents: 0,
    kalshiVolume24h: 0,
    kalshiVolumeLifetime: 0,
    polymarketVolume24h: 0,
    polymarketVolumeLifetime: 0,
    lastSnapshotAt: null,
  };
}

export function classifyTennisDataHealth(
  targetEvents: number,
  matchedEvents: number,
  staleQuoteEvents = 0,
): TennisDataHealth["state"] {
  if (targetEvents <= 0) return "unavailable";
  if (matchedEvents <= 0) return "critical";
  if (matchedEvents / targetEvents < HEALTHY_CROSS_VENUE_MATCH_RATE) return "degraded";
  return staleQuoteEvents > 0 ? "degraded" : "healthy";
}

export function loadTennisDataHealth(
  db: Database,
  eventIds: readonly string[],
  nowMs = Date.now(),
): TennisDataHealth {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  const unavailable = unavailableDataHealth(uniqueEventIds.length);
  if (uniqueEventIds.length === 0) return unavailable;
  const exists = db
    .query(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'price_snapshots'",
    )
    .get() as { ok: number } | null;
  if (!exists) return unavailable;

  try {
    const { placeholders, params } = inClause("health", uniqueEventIds);
    const rows = db
      .query(
        `WITH ranked AS (
           SELECT event_id, ts, poly_prob, kalshi_volume_24h,
                  kalshi_volume_lifetime, stale_volume,
                  poly_volume_24h, poly_volume_lifetime,
                  polymarket_event_id, polymarket_match_method,
                  kalshi_series, event_type, participant_format,
                  poly_observed_at_ms, poly_cache_state,
                  ROW_NUMBER() OVER (
                    PARTITION BY event_id ORDER BY ts DESC, id DESC
                  ) AS rank
           FROM price_snapshots
           WHERE event_id IN (${placeholders})
         )
         SELECT ts,
                poly_prob AS polyProb,
                stale_volume AS staleVolume,
                kalshi_volume_24h AS kalshiVolume24h,
                kalshi_volume_lifetime AS kalshiVolumeLifetime,
                poly_volume_24h AS polymarketVolume24h,
                poly_volume_lifetime AS polymarketVolumeLifetime,
                polymarket_event_id AS polymarketEventId,
                polymarket_match_method AS polymarketMatchMethod,
                kalshi_series AS kalshiSeries,
                event_type AS eventType,
                participant_format AS participantFormat,
                poly_observed_at_ms AS polyObservedAtMs,
                poly_cache_state AS polyCacheState
         FROM ranked
         WHERE rank = 1`,
      )
      .all(params) as Array<{
      ts: number;
      polyProb: number | null;
      staleVolume: number;
      kalshiVolume24h: number;
      kalshiVolumeLifetime: number;
      polymarketVolume24h: number;
      polymarketVolumeLifetime: number;
      polymarketEventId: string | null; // brand-ok — opaque external provider primary key
      polymarketMatchMethod: string | null;
      kalshiSeries: string | null;
      eventType: string | null;
      participantFormat: string | null;
      polyObservedAtMs: number | null;
      polyCacheState: string | null;
    }>;
    let matchedEvents = 0;
    let staleQuoteEvents = 0;
    let staleVolumeEvents = 0;
    let kalshiVolume24h = 0;
    let kalshiVolumeLifetime = 0;
    let polymarketVolume24h = 0;
    let polymarketVolumeLifetime = 0;
    let lastSnapshotAt: number | null = null;
    for (const row of rows) {
      staleVolumeEvents += row.staleVolume === 1 ? 1 : 0;
      kalshiVolume24h += row.kalshiVolume24h ?? 0;
      kalshiVolumeLifetime += row.kalshiVolumeLifetime ?? 0;
      lastSnapshotAt = Math.max(lastSnapshotAt ?? 0, row.ts);
      const series = trySeriesTicker(row.kalshiSeries);
      const semantics = series ? kalshiReconciliationSemanticsForSeries(series) : null;
      const exactLane =
        semantics?.sport === SPORT.tennis &&
        semantics.eventType === row.eventType &&
        semantics.participantFormat === row.participantFormat;
      const hasQuoteIdentity =
        row.polyProb !== null &&
        row.polymarketEventId !== null &&
        row.polymarketMatchMethod !== null;
      const quoteAgeMs =
        row.polyObservedAtMs === null ? null : nowMs - row.polyObservedAtMs;
      const withinStaleWindow =
        quoteAgeMs !== null && quoteAgeMs >= 0 && quoteAgeMs <= POLYMARKET_STALE_FOR_MS;
      if (!exactLane || !hasQuoteIdentity) continue;
      if (!withinStaleWindow) {
        staleQuoteEvents++;
        continue;
      }
      matchedEvents++;
      polymarketVolume24h += row.polymarketVolume24h ?? 0;
      polymarketVolumeLifetime += row.polymarketVolumeLifetime ?? 0;
      if (row.polyCacheState !== "healthy") staleQuoteEvents++;
    }
    const targetEvents = uniqueEventIds.length;
    return {
      source: "snapshots",
      state: classifyTennisDataHealth(targetEvents, matchedEvents, staleQuoteEvents),
      targetEvents,
      matchedEvents,
      unmatchedEvents: Math.max(0, targetEvents - matchedEvents),
      matchRate: targetEvents > 0 ? matchedEvents / targetEvents : 0,
      staleVolumeEvents,
      staleQuoteEvents,
      kalshiVolume24h,
      kalshiVolumeLifetime,
      polymarketVolume24h,
      polymarketVolumeLifetime,
      lastSnapshotAt,
    };
  } catch {
    return unavailable;
  }
}

function liveDataHealth(
  events: readonly TennisEventView[],
  oddsByTicker: Map<string, CrossMarketOdds>,
  snapshots: TennisDataHealth,
  nowMs: number,
): TennisDataHealth {
  const targets = events.filter(
    (event) =>
      event.markets.length >= 2 &&
      Boolean(event.markets[0]?.player) &&
      Boolean(event.markets[1]?.player),
  );
  let matchedEvents = 0;
  let kalshiVolume24h = 0;
  let polymarketVolume24h = 0;
  let polymarketVolumeLifetime = 0;
  let staleQuoteEvents = 0;
  for (const event of targets) {
    kalshiVolume24h += event.markets.reduce(
      (sum, market) => sum + (market.volume24h ?? 0),
      0,
    );
    const odds = oddsByTicker.get(event.eventTicker);
    const series = trySeriesTicker(event.series);
    const semantics = series ? kalshiReconciliationSemanticsForSeries(series) : null;
    const proof = odds?.reconciliation;
    const exactLane =
      semantics !== null &&
      proof !== null &&
      proof !== undefined &&
      proof.kalshiSeries === series &&
      proof.sport === SPORT.tennis &&
      proof.sport === semantics.sport &&
      proof.eventType === semantics.eventType &&
      proof.participantFormat === semantics.participantFormat;
    if (!exactLane || odds?.polymarketProb === null || odds?.polymarketProb === undefined) continue;
    const quoteAgeMs = nowMs - proof.polymarketObservedAtMs;
    if (quoteAgeMs < 0 || quoteAgeMs > POLYMARKET_STALE_FOR_MS) {
      staleQuoteEvents++;
      continue;
    }
    matchedEvents++;
    polymarketVolume24h += odds.polymarketVolume24h ?? 0;
    polymarketVolumeLifetime += odds.polymarketVolumeLifetime ?? 0;
    if (proof.polymarketCacheState !== "healthy") staleQuoteEvents++;
  }
  const targetEvents = targets.length;
  return {
    source: "live-cache",
    state: classifyTennisDataHealth(targetEvents, matchedEvents, staleQuoteEvents),
    targetEvents,
    matchedEvents,
    unmatchedEvents: Math.max(0, targetEvents - matchedEvents),
    matchRate: targetEvents > 0 ? matchedEvents / targetEvents : 0,
    staleVolumeEvents: snapshots.staleVolumeEvents,
    staleQuoteEvents,
    kalshiVolume24h,
    kalshiVolumeLifetime: snapshots.kalshiVolumeLifetime,
    polymarketVolume24h,
    polymarketVolumeLifetime,
    lastSnapshotAt: snapshots.lastSnapshotAt,
  };
}

function openReadonlyDb(dbPath: string): Database | null {
  try {
    return openEventStore({ dbPath, readonly: true });
  } catch {
    return null; // missing/unreadable DB — try/catch replaces the old existsSync guard
  }
}

function resolveEventTickerForEvent(db: Database, eventId: string): string | null {
  const live = db
    .query("SELECT event_ticker FROM live_scores WHERE event_id = $id LIMIT 1")
    .get({ $id: eventId }) as { event_ticker: string } | null;
  if (live?.event_ticker) return live.event_ticker;
  const market = db
    .query("SELECT ticker FROM markets WHERE event_id = $id ORDER BY ticker ASC LIMIT 1")
    .get({ $id: eventId }) as { ticker: string } | null;
  return market?.ticker ? eventTickerFromMarket(market.ticker) : null;
}

// ── Public API ──

export async function buildTennisHqPayload(
  options: BuildTennisHqPayloadOptions = {},
): Promise<TennisHqPayload> {
  const nowMs = options.nowMs ?? Date.now();
  const fetchBoard = options.fetchBoard ?? fetchTennisBoard;
  const board = options.board ?? (await fetchBoard({ nowMs }));
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const surfaceEdgeConfig = {
    minSampleSize: Math.max(
      1,
      Math.floor(
        options.surfaceEdge?.minSampleSize ?? MIN_SURFACE_EDGE_APPEARANCES,
      ),
    ),
    scaling: options.surfaceEdge?.scaling ?? "dampened",
  } satisfies { minSampleSize: number; scaling: EdgeScaling };

  const kalshiBoardOk = board.series.some((s) => s.state === "ok");
  const flatEvents = collectBoardEvents(board);
  if (flatEvents.some((event) => event.sport !== SPORT.tennis)) {
    throw new Error("Tennis HQ cannot ingest a non-tennis board");
  }

  const allMarketTickers = flatEvents.flatMap((e) => e.markets.map((m) => m.ticker));
  const allPlayerNames = [
    ...new Set(
      flatEvents.flatMap((e) => e.markets.map((m) => m.player).filter((n): n is string => Boolean(n))),
    ),
  ];
  const allEventTickers = flatEvents.map((e) => e.eventTicker);

  const ownedDb = options.db ?? openReadonlyDb(dbPath);
  const db = ownedDb;
  if (!db) {
    return {
      generatedAt: new Date(nowMs).toISOString(),
      sources: {
        kalshiBoard: kalshiBoardOk ? "ok" : "unavailable",
        eventStore: "absent",
        liveScores: "empty",
        books: { restWatch: 0, wsWatch: 0 },
      },
      dataHealth: unavailableDataHealth(flatEvents.length),
      liveBoard: flatEvents.map((e) => ({
        sport: e.sport,
        eventTicker: e.eventTicker,
        eventId: null,
        title: e.title,
        series: e.series,
        competition: e.competition,
        surface: e.surface,
        surfaceEdge: 0,
        surfaceEdgePlayers: [
          e.markets[0]?.player ?? null,
          e.markets[1]?.player ?? null,
        ],
        surfaceEdgeSamples: [0, 0],
        surfaceEdgeReliable: false,
        surfaceEdgeEvidence: e.surface
          ? "insufficient-sample"
          : "missing-surface",
        surfaceEdgeScaling: surfaceEdgeConfig.scaling,
        occurrenceMs: e.occurrenceMs,
        status: determineStatus(e.markets, null),
        score: null,
        sides: e.markets.map((m) => ({
          ticker: m.ticker,
          playerName: m.player,
          competitorId: m.competitorId,
          yesBidCents: m.yesBidCents,
          yesAskCents: m.yesAskCents,
          lastCents: m.lastCents,
          volume24h: m.volume24h,
          openInterest: m.openInterest,
          book: null,
          profile: null,
        })),
      })),
      profilesIndex: { total: 0, topByVolume: [] },
    };
  }

  try {
    const marketByTicker = loadMarketsByTicker(db, allMarketTickers);
    const eventIds = [...new Set([...marketByTicker.values()].map((m) => m.event_id))];
    const { byEventId: scoresByEventId, byEventTicker: scoresByEventTicker } = loadLiveScores(
      db,
      eventIds,
      allEventTickers,
    );
    const bookByTicker = loadLatestBooks(db, allMarketTickers);
    const profileByName = loadProfileRows(db, allPlayerNames);
    const competitorIdsByName = loadCompetitorIdsByName(db, allPlayerNames);
    const surfacePerformanceByPlayer = loadSurfacePerformance(db, allPlayerNames);

    const ctx = {
      marketByTicker,
      scoresByEventId,
      scoresByEventTicker,
      bookByTicker,
      profileByName,
      competitorIdsByName,
      surfacePerformanceByPlayer,
      surfaceEdgeConfig,
      nowMs,
    };

    const liveBoard = flatEvents.map((e) => enrichEvent(e, ctx));
    const snapshotHealth = loadTennisDataHealth(
      db,
      liveBoard.map((event) => event.eventId).filter((id): id is string => id !== null),
      nowMs,
    );
    let dataHealth = snapshotHealth;
    try {
      const oddsByTicker =
        options.crossMarketOdds === false
          ? null
          : options.crossMarketOdds ??
            (options.board
              ? null
              : await fetchLiveCrossMarketOdds(
                  flatEvents
                    .filter((event) => event.markets.length >= 2)
                    .map((event) => ({
                      ticker: event.eventTicker,
                      playerA: event.markets[0]?.player ?? "",
                      playerB: event.markets[1]?.player ?? "",
                      tournament: event.tournament ?? event.competition ?? undefined,
                      series: asSeriesTicker(event.series),
                    })),
                ));
      if (oddsByTicker) {
        dataHealth = liveDataHealth(flatEvents, oddsByTicker, snapshotHealth, nowMs);
      }
    } catch {
      // Persisted snapshot health remains available when the live venue is down.
    }
    const topRows = loadTopProfileRows(db, 20);
    const allCompetitorIds = loadCompetitorIdsByName(
      db,
      topRows.map((r) => r.player_name),
    );

    return {
      generatedAt: new Date(nowMs).toISOString(),
      sources: {
        kalshiBoard: kalshiBoardOk ? "ok" : "unavailable",
        eventStore: "ok",
        liveScores: deriveLiveScoresSource(liveBoard, nowMs),
        books: deriveBooksSource(liveBoard),
      },
      dataHealth,
      liveBoard,
      profilesIndex: {
        total: countProfiles(db),
        topByVolume: topRows.map((r) =>
          toProfileStub(r, allCompetitorIds.get(r.player_name) ?? []),
        ),
      },
    };
  } finally {
    if (!options.db) db.close();
  }
}

export function getPlayerDetail(
  playerName: string,
  options: GetPlayerDetailOptions = {},
): PlayerProfileDetailResult {
  const name = playerName.trim();
  if (!name) return { state: "not_found", playerName: "" };

  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const db = options.db ?? openReadonlyDb(dbPath);
  if (!db) return { state: "not_found", playerName: name };

  try {
    const profileRow = db
      .query(
        `SELECT player_name, appearances, wins, losses, win_rate,
                avg_kalshi_volume_fp, surfaces, last_seen_ts
         FROM player_profiles WHERE player_name = ?`,
      )
      .get(name) as ProfileRow | null;

    const eventVolSql = eventVolumeSqlForDb(db);
    const eventRows = db
      .query(
        `SELECT e.event_id, e.player_a, e.player_b, e.start_ts, e.outcome,
                e.winner, e.loser, e.score_text, e.surface,
                (SELECT ${eventVolSql}
                   FROM markets m WHERE m.event_id = e.event_id) AS volume_fp
         FROM events e
         WHERE e.corpus = 'trading'
           AND (e.player_a = ? OR e.player_b = ?)
         ORDER BY e.start_ts DESC
         LIMIT 50`,
      )
      .all(name, name) as Array<{
      event_id: string;
      player_a: string;
      player_b: string;
      start_ts: string;
      outcome: string;
      winner: string;
      loser: string;
      score_text: string;
      surface: string;
      volume_fp: number;
    }>;

    if (!profileRow && eventRows.length === 0) {
      return { state: "not_found", playerName: name };
    }

    const competitorIds = loadCompetitorIdsByName(db, [name]).get(name) ?? [];
    const stub: PlayerProfileStub = profileRow
      ? toProfileStub(profileRow, competitorIds)
      : {
          playerName: name,
          competitorIds,
          appearances: 0,
          wins: 0,
          losses: 0,
          winRate: null,
          avgKalshiVolumeFp: null,
          surfaces: {},
          lastSeenAtMs: null,
        };

    const recentEvents: PlayerRecentEvent[] = eventRows.map((row) => {
      const opponent = row.player_a === name ? row.player_b : row.player_a;
      let outcome: "win" | "loss" | "unknown" = "unknown";
      if (row.winner === name) outcome = "win";
      else if (row.loser === name) outcome = "loss";

      const midRow = db
        .query(
          `SELECT bt.levels_json
           FROM book_ticks bt
           INNER JOIN markets m ON m.ticker = bt.ticker
           WHERE m.event_id = $eid AND m.yes_side_label = $name
           ORDER BY bt.id DESC
           LIMIT 1`,
        )
        .get({ $eid: row.event_id, $name: name }) as { levels_json: string } | null;
      const book = midRow ? parseBookJson(midRow.levels_json) : null;

      return {
        eventId: row.event_id,
        eventTicker: resolveEventTickerForEvent(db, row.event_id),
        opponent,
        startTs: row.start_ts,
        outcome,
        winner: row.winner,
        scoreText: row.score_text,
        surface: row.surface,
        volumeFp: row.volume_fp > 0 ? row.volume_fp : null,
        lastMidCents: book ? midFromBookSnapshot(book) : null,
      };
    });

    return {
      state: "ok",
      profile: { ...stub, recentEvents },
    };
  } finally {
    if (!options.db) db.close();
  }
}
