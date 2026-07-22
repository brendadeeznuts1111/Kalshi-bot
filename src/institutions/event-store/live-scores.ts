/**
 * Kalshi /live_data poller → live_scores + score_snapshots.
 * Watch set: occurrence within lead window OR already is_live (early start).
 *
 * @see https://docs.kalshi.com/api-reference/live-data/get-live-data
 */
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/utils#bun-nanoseconds
// @see https://bun.com/docs/runtime/utils#bun-sleep
import type { Database } from "bun:sqlite";
import { parseItfEventTicker } from "../../alpha/ticker-formats/itf.ts";
import {
  fetchKalshiLiveData,
  fetchKalshiMilestonesForEvent,
  isLiveScoreStatus,
  pickTennisMilestone,
  type KalshiFetchImpl,
  type KalshiLiveDataWire,
} from "../../bot/kalshi-live-data.ts";
import { warmKalshiApiNetwork } from "../../bot/kalshi-network.ts";
import { mapPool } from "../../research/pool.ts";
import { asCanonicalEventId, type CanonicalEventId } from "./types.ts";

const KALSHI_SOURCE = "kalshi-api";
const LIVE_SOURCE = "kalshi-live-data";

export type CompetitorLabel = {
  competitorId: string;
  label: string;
};

export type WatchEvent = {
  eventId: CanonicalEventId;
  eventTicker: string;
  startTs: string;
  competitorIds: string[];
  /** Sorted event-store labels (localeCompare) — not live_data home/away. */
  playerA: string;
  playerB: string;
  /** Markets competitor_id → yes_side_label for c1/c2 scoreboard remap. */
  competitors: CompetitorLabel[];
};

/** One watch-set event after a poll attempt (dry-run or write). */
/** Coarsest change between two fingerprints (for cadence / REST adequacy). */
export type ScoreTransitionKind =
  | "first"
  | "none"
  | "point"
  | "game"
  | "set"
  | "status"
  | "server"
  | "mixed";

export type LivePollRow = {
  eventTicker: string;
  eventId: CanonicalEventId;
  startTs: string;
  playerA: string;
  playerB: string;
  /** live_data competitor1/2 display names (UUID-mapped); empty if unknown. */
  c1Label: string;
  c2Label: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  milestoneId: string | null;
  status: string | null;
  matchStatus: string | null;
  isLive: boolean;
  setsHome: number | null;
  setsAway: number | null;
  gamesHome: number | null;
  gamesAway: number | null;
  pointsHome: number | null;
  pointsAway: number | null;
  /** Kalshi live_data: 1 = competitor1, 2 = competitor2, 0 = unknown. */
  serverSide: 0 | 1 | 2 | null;
  /** Would-write / did-write this pass. */
  upserted: boolean;
  snapshot: boolean;
  /** Writer would retire event from watch (terminal live status). */
  wouldRetire: boolean;
  /** Coarsest scoreboard delta vs prev live_scores row (or first). */
  transition: ScoreTransitionKind;
  /** Keys present on live_data.details — canary schema probe. */
  detailsKeys: string[];
  /** Expected detail keys missing after parse (schema drift). */
  missingDetailKeys: string[];
  error: string | null;
};

export type LivePollSummary = {
  watched: number;
  polled: number;
  /** Rows written (or that would be written when dryRun). */
  upserted: number;
  snapshotsAppended: number;
  live: number;
  milestoneMissing: number;
  /** Terminal-status rows that would leave the watch set. */
  wouldRetire: number;
  errors: string[];
  dryRun: boolean;
  /** Per-event scoreboard from this pass (includes milestone misses + errors). */
  rows: LivePollRow[];
  /** Stale is_live flags cleared at poll start (writer only; 0 in dry-run). */
  staleLiveCleared: number;
  /** Wall time for this poll pass (Bun.nanoseconds). */
  durationMs: number;
  /** Fetch concurrency used (1 = sequential). */
  concurrency: number;
};

/** Kalshi live_data.details keys the tennis parser depends on. */
export const LIVE_DATA_REQUIRED_DETAIL_KEYS = [
  "competitor1_id",
  "competitor2_id",
  "competitor1_overall_score",
  "competitor2_overall_score",
  "competitor1_current_round_score",
  "competitor2_current_round_score",
  "competitor1_round_scores",
  "competitor2_round_scores",
  "completed_rounds",
  "status",
  "match_status",
  "server",
] as const;

/** Resolve live_data competitor UUID → market yes_side_label. */
export function labelForCompetitor(
  competitors: readonly CompetitorLabel[],
  competitorId: string | null | undefined,
): string {
  if (!competitorId) return "";
  const hit = competitors.find((c) => c.competitorId === competitorId);
  return hit?.label ?? "";
}

/**
 * Compact tennis score line for CLI / logs.
 * Matchup order is live_data c1 vs c2 (UUID-mapped), same axis as sets/games/pts.
 */
export function formatLiveScoreLine(row: Pick<
  LivePollRow,
  | "eventTicker"
  | "c1Label"
  | "c2Label"
  | "status"
  | "matchStatus"
  | "isLive"
  | "setsHome"
  | "setsAway"
  | "gamesHome"
  | "gamesAway"
  | "pointsHome"
  | "pointsAway"
  | "serverSide"
  | "error"
  | "milestoneId"
>): string {
  if (row.error) return `${row.eventTicker}  ! ${row.error}`;
  if (!row.milestoneId && row.status == null) {
    return `${row.eventTicker}  milestone_missing`;
  }
  const c1 = row.c1Label || "c1";
  const c2 = row.c2Label || "c2";
  const matchup = `${c1} vs ${c2}`;
  const sets = `${row.setsHome ?? 0}-${row.setsAway ?? 0}`;
  const games = `${row.gamesHome ?? 0}-${row.gamesAway ?? 0}`;
  const pts = `${row.pointsHome ?? 0}-${row.pointsAway ?? 0}`;
  const srv =
    row.serverSide === 1 ? "c1"
    : row.serverSide === 2 ? "c2"
    : "-";
  const flag = row.isLive ? "LIVE" : (row.status ?? "—");
  const ms = row.matchStatus ? `/${row.matchStatus}` : "";
  return `${row.eventTicker}  ${matchup}  ${flag}${ms}  sets ${sets}  games ${games}  pts ${pts}  srv=${srv}`;
}

export type LiveScoresPollOptions = {
  /** Minutes before occurrence_ts to start polling (default 5). */
  leadMinutes?: number;
  /** Cap events polled this pass (default 40). */
  limit?: number;
  /** Explicit event tickers; skips watch-set selection. */
  eventTickers?: string[];
  fetchImpl?: KalshiFetchImpl;
  /**
   * Pause between sequential fetches (default 200).
   * Ignored when concurrency > 1 (parallel fetch, serial write).
   */
  pauseMs?: number;
  /**
   * Parallel milestone/live_data fetches via mapPool (default TENNIS_LIVE_CONCURRENCY or 4).
   * Writes always serial so dry-run ≡ writer against SQLite.
   */
  concurrency?: number;
  /** Fetch + classify only — no live_scores / score_snapshots writes. */
  dryRun?: boolean;
  /** Skip Kalshi dns.prefetch / fetch.preconnect (tests). */
  skipNetworkWarmup?: boolean;
};

function scoreFingerprint(s: {
  status: string;
  setsHome: number;
  setsAway: number;
  gamesHome: number;
  gamesAway: number;
  pointsHome: number;
  pointsAway: number;
  serverCompetitorId: string | null;
}): string {
  return [
    s.status,
    s.setsHome,
    s.setsAway,
    s.gamesHome,
    s.gamesAway,
    s.pointsHome,
    s.pointsAway,
    s.serverCompetitorId ?? "",
  ].join("|");
}

type ScoreFingerprintRow = {
  status: string;
  sets_home: number;
  sets_away: number;
  games_home: number;
  games_away: number;
  points_home: number;
  points_away: number;
  server_competitor_id: string | null;
};

export type LiveScoreWritePlan = {
  upserted: true;
  snapshot: boolean;
  isLive: boolean;
  wouldRetire: boolean;
  transition: ScoreTransitionKind;
  prevFingerprint: string | null;
  nextFingerprint: string;
};

/** Classify coarsest scoreboard delta (point < game < set < status/server). */
export function classifyScoreTransition(
  prev: {
    status: string;
    setsHome: number;
    setsAway: number;
    gamesHome: number;
    gamesAway: number;
    pointsHome: number;
    pointsAway: number;
    serverCompetitorId: string | null;
  } | null,
  next: {
    status: string;
    setsHome: number;
    setsAway: number;
    gamesHome: number;
    gamesAway: number;
    pointsHome: number;
    pointsAway: number;
    serverCompetitorId: string | null;
  },
): ScoreTransitionKind {
  if (!prev) return "first";
  const kinds: ScoreTransitionKind[] = [];
  if (prev.status !== next.status) kinds.push("status");
  if (prev.setsHome !== next.setsHome || prev.setsAway !== next.setsAway) kinds.push("set");
  if (prev.gamesHome !== next.gamesHome || prev.gamesAway !== next.gamesAway) kinds.push("game");
  if (prev.pointsHome !== next.pointsHome || prev.pointsAway !== next.pointsAway) {
    kinds.push("point");
  }
  if ((prev.serverCompetitorId ?? "") !== (next.serverCompetitorId ?? "")) {
    kinds.push("server");
  }
  if (kinds.length === 0) return "none";
  if (kinds.length === 1) return kinds[0]!;
  // Prefer coarsest structural change for REST adequacy (game/set miss matters most).
  if (kinds.includes("set")) return "set";
  if (kinds.includes("game")) return "game";
  if (kinds.includes("point")) return "point";
  if (kinds.includes("status")) return "status";
  return "mixed";
}

function readPrevScoreState(
  db: Database,
  eventId: CanonicalEventId,
): {
  status: string;
  setsHome: number;
  setsAway: number;
  gamesHome: number;
  gamesAway: number;
  pointsHome: number;
  pointsAway: number;
  serverCompetitorId: string | null;
} | null {
  const prev = db
    .query(
      `SELECT status, sets_home, sets_away, games_home, games_away, points_home, points_away,
              server_competitor_id
       FROM live_scores WHERE event_id = $id`,
    )
    .get({ $id: eventId }) as ScoreFingerprintRow | null;
  if (!prev) return null;
  return {
    status: prev.status,
    setsHome: prev.sets_home,
    setsAway: prev.sets_away,
    gamesHome: prev.games_home,
    gamesAway: prev.games_away,
    pointsHome: prev.points_home,
    pointsAway: prev.points_away,
    serverCompetitorId: prev.server_competitor_id,
  };
}

/**
 * Write-boundary plan shared by dry-run and real upsert.
 * Dry-run must match these counts or it lies about the writer (canary worthless).
 */
export function planLiveScoreWrite(
  db: Database,
  eventId: CanonicalEventId,
  live: KalshiLiveDataWire,
): LiveScoreWritePlan {
  const next = {
    status: live.status,
    setsHome: live.setsHome,
    setsAway: live.setsAway,
    gamesHome: live.gamesHome,
    gamesAway: live.gamesAway,
    pointsHome: live.pointsHome,
    pointsAway: live.pointsAway,
    serverCompetitorId: live.serverCompetitorId,
  };
  const prev = readPrevScoreState(db, eventId);
  const nextFp = scoreFingerprint(next);
  const prevFp = prev ? scoreFingerprint(prev) : null;
  return {
    upserted: true,
    snapshot: prevFp !== nextFp,
    isLive: isLiveScoreStatus(live.status, live),
    wouldRetire: isTerminalLiveStatus(live.status),
    transition: classifyScoreTransition(prev, next),
    prevFingerprint: prevFp,
    nextFingerprint: nextFp,
  };
}

/** Missing keys among LIVE_DATA_REQUIRED_DETAIL_KEYS. */
export function missingLiveDataDetailKeys(details: Record<string, unknown>): string[] {
  return LIVE_DATA_REQUIRED_DETAIL_KEYS.filter((k) => !(k in details));
}

/** Fail-loud canary verdict for scheduled dry-run smoke (schema / API drift). */
export type LiveCanaryVerdict = {
  ok: boolean;
  /** 0 = pass, 2 = fail (cron-friendly). */
  exitCode: number;
  reasons: string[];
  /** Soft warnings (logged, do not fail cron). */
  warnings: string[];
};

export function evaluateLiveCanary(summary: LivePollSummary): LiveCanaryVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (summary.errors.length > 0) {
    reasons.push(`errors=${summary.errors.length}: ${summary.errors.slice(0, 3).join("; ")}`);
  }
  if (summary.watched > 0 && summary.polled === 0) {
    reasons.push("watched>0 but polled=0 (fetch path dead)");
  }
  if (summary.live > 0 && summary.upserted === 0) {
    reasons.push("live>0 but would_upsert/upserted=0 (write-boundary plan dead)");
  }
  if (summary.watched > 0 && summary.milestoneMissing === summary.watched) {
    reasons.push("all watched events missing milestones");
  }

  const polledRows = summary.rows.filter((r) => r.status != null || r.detailsKeys.length > 0);
  const missingShape = polledRows.filter((r) => r.missingDetailKeys.length > 0);
  if (missingShape.length > 0) {
    const sample = missingShape[0]!;
    reasons.push(
      `wire_shape_drift: ${missingShape.length}/${polledRows.length} rows missing detail keys` +
        ` (e.g. ${sample.eventTicker}: ${sample.missingDetailKeys.slice(0, 4).join(",")})`,
    );
  }

  // Live but zero scores and empty status can mean parse fell through to defaults.
  const suspicious = summary.rows.filter(
    (r) =>
      r.isLive &&
      r.status === "" &&
      (r.setsHome ?? 0) + (r.setsAway ?? 0) + (r.gamesHome ?? 0) + (r.gamesAway ?? 0) === 0,
  );
  if (suspicious.length > 0) {
    warnings.push(
      `live_with_empty_status: ${suspicious.map((r) => r.eventTicker).slice(0, 3).join(",")}`,
    );
  }

  // Daytime watch with zero would_upsert is fatal only when something looks live-ish.
  if (summary.watched >= 5 && summary.upserted === 0 && summary.polled > 0) {
    warnings.push("watched>=5 polled>0 but would_upsert=0 (unexpected — check filters)");
  }

  return {
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : 2,
    reasons,
    warnings,
  };
}

export type SnapshotCadenceEvent = {
  eventId: CanonicalEventId;
  eventTicker: string;
  snapshots: number;
  spanMs: number;
  medianGapMs: number | null;
  p90GapMs: number | null;
  maxGapMs: number | null;
  transitions: Record<"point" | "game" | "set" | "status" | "server" | "first" | "other", number>;
  /**
   * REST adequacy vs assumed poll interval:
   * - ok: median gap ≤ 1.5× interval
   * - borderline: median ≤ 3× interval
   * - miss: median > 3× interval (game books will reprice between polls)
   * - insufficient_data: < 3 snapshots
   */
  restVerdict: "ok" | "borderline" | "miss" | "insufficient_data";
};

export type SnapshotCadenceReport = {
  assumedIntervalMs: number;
  events: SnapshotCadenceEvent[];
  totals: {
    events: number;
    snapshots: number;
    gameTransitions: number;
    setTransitions: number;
    pointTransitions: number;
    restMiss: number;
    restBorderline: number;
  };
};

function percentileNearest(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Analyze score_snapshots gaps + transition kinds — decides REST vs WebSocket.
 * Call after an aging loop (or dry-run multi-pass with writes) has accumulated rows.
 */
export function analyzeScoreSnapshotCadence(
  db: Database,
  options: {
    eventTicker?: string;
    /** Assumed REST poll interval for restVerdict (default TENNIS_LIVE_INTERVAL_MS / 10s). */
    intervalMs?: number;
    /** Only snapshots with ts >= now − windowMs (default 6h). */
    windowMs?: number;
    limitEvents?: number;
  } = {},
): SnapshotCadenceReport {
  const intervalMs = options.intervalMs ?? Number(Bun.env.TENNIS_LIVE_INTERVAL_MS ?? 10_000);
  const windowMs = options.windowMs ?? 6 * 3600_000;
  const floorTs = Date.now() - windowMs;
  const limitEvents = options.limitEvents ?? 40;

  const tickerFilter = options.eventTicker
    ? `AND event_ticker = $ticker`
    : "";
  const params: Record<string, string | number> = { $floor: floorTs };
  if (options.eventTicker) params.$ticker = options.eventTicker;

  const rows = db
    .query(
      `SELECT event_id, event_ticker, ts, status,
              sets_home, sets_away, games_home, games_away, points_home, points_away,
              server_competitor_id
       FROM score_snapshots
       WHERE ts >= $floor ${tickerFilter}
       ORDER BY event_id ASC, ts ASC`,
    )
    .all(params) as Array<{
    event_id: string;
    event_ticker: string;
    ts: number;
    status: string;
    sets_home: number;
    sets_away: number;
    games_home: number;
    games_away: number;
    points_home: number;
    points_away: number;
    server_competitor_id: string | null;
  }>;

  type Acc = {
    eventId: CanonicalEventId;
    eventTicker: string;
    ts: number[];
    transitions: SnapshotCadenceEvent["transitions"];
    prev: {
      status: string;
      setsHome: number;
      setsAway: number;
      gamesHome: number;
      gamesAway: number;
      pointsHome: number;
      pointsAway: number;
      serverCompetitorId: string | null;
    } | null;
  };
  const byEvent = new Map<string, Acc>();

  for (const r of rows) {
    let acc = byEvent.get(r.event_id);
    if (!acc) {
      acc = {
        eventId: asCanonicalEventId(r.event_id),
        eventTicker: r.event_ticker,
        ts: [],
        transitions: {
          point: 0,
          game: 0,
          set: 0,
          status: 0,
          server: 0,
          first: 0,
          other: 0,
        },
        prev: null,
      };
      byEvent.set(r.event_id, acc);
    }
    const next = {
      status: r.status,
      setsHome: r.sets_home,
      setsAway: r.sets_away,
      gamesHome: r.games_home,
      gamesAway: r.games_away,
      pointsHome: r.points_home,
      pointsAway: r.points_away,
      serverCompetitorId: r.server_competitor_id,
    };
    const kind = classifyScoreTransition(acc.prev, next);
    if (kind === "first") acc.transitions.first++;
    else if (kind === "point") acc.transitions.point++;
    else if (kind === "game") acc.transitions.game++;
    else if (kind === "set") acc.transitions.set++;
    else if (kind === "status") acc.transitions.status++;
    else if (kind === "server") acc.transitions.server++;
    else acc.transitions.other++;
    acc.ts.push(r.ts);
    acc.prev = next;
  }

  const events: SnapshotCadenceEvent[] = [];
  for (const acc of byEvent.values()) {
    if (events.length >= limitEvents) break;
    const gaps: number[] = [];
    for (let i = 1; i < acc.ts.length; i++) {
      gaps.push(acc.ts[i]! - acc.ts[i - 1]!);
    }
    gaps.sort((a, b) => a - b);
    const medianGapMs = percentileNearest(gaps, 0.5);
    const p90GapMs = percentileNearest(gaps, 0.9);
    const maxGapMs = gaps.length ? gaps[gaps.length - 1]! : null;
    const spanMs =
      acc.ts.length >= 2 ? acc.ts[acc.ts.length - 1]! - acc.ts[0]! : 0;
    let restVerdict: SnapshotCadenceEvent["restVerdict"] = "insufficient_data";
    if (acc.ts.length >= 3 && medianGapMs != null) {
      if (medianGapMs <= intervalMs * 1.5) restVerdict = "ok";
      else if (medianGapMs <= intervalMs * 3) restVerdict = "borderline";
      else restVerdict = "miss";
    }
    events.push({
      eventId: acc.eventId,
      eventTicker: acc.eventTicker,
      snapshots: acc.ts.length,
      spanMs,
      medianGapMs,
      p90GapMs,
      maxGapMs,
      transitions: acc.transitions,
      restVerdict,
    });
  }

  // Prefer events with most snapshots first for the report face.
  events.sort((a, b) => b.snapshots - a.snapshots);

  const totals = {
    events: events.length,
    snapshots: events.reduce((n, e) => n + e.snapshots, 0),
    gameTransitions: events.reduce((n, e) => n + e.transitions.game, 0),
    setTransitions: events.reduce((n, e) => n + e.transitions.set, 0),
    pointTransitions: events.reduce((n, e) => n + e.transitions.point, 0),
    restMiss: events.filter((e) => e.restVerdict === "miss").length,
    restBorderline: events.filter((e) => e.restVerdict === "borderline").length,
  };

  return { assumedIntervalMs: intervalMs, events, totals };
}

/** Resolve event_ticker from a stored market ticker (ITF shape). */
export function eventTickerFromMarketTicker(ticker: string): string | null {
  return parseItfEventTicker(ticker);
}

/** Hours after start_ts a non-live scheduled event stays on the watch set. */
const WATCH_PAST_GRACE_HOURS = 6;
/** Clear is_live when live_scores.updated_ts older than this (stuck in_progress). */
export const LIVE_STALE_MS = 45 * 60_000;

function isTerminalLiveStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "ended" || s === "final" || s === "closed" || s === "cancelled";
}

function loadCompetitorLabels(db: Database, eventId: CanonicalEventId): CompetitorLabel[] {
  const rows = db
    .query(
      `SELECT competitor_id AS competitor_id, yes_side_label AS label
       FROM markets
       WHERE event_id = $id
         AND competitor_id IS NOT NULL AND competitor_id != ''
       ORDER BY ticker ASC`,
    )
    .all({ $id: eventId }) as Array<{ competitor_id: string; label: string }>;
  const seen = new Set<string>();
  const out: CompetitorLabel[] = [];
  for (const r of rows) {
    if (seen.has(r.competitor_id)) continue;
    seen.add(r.competitor_id);
    out.push({ competitorId: r.competitor_id, label: r.label?.trim() || r.competitor_id });
  }
  return out;
}

/**
 * Force is_live=0 when the score row has not been refreshed within staleMs.
 * Prevents stuck in_progress from pinning watch-set slots forever.
 */
export function clearStaleLiveFlags(
  db: Database,
  options: { staleMs?: number; nowMs?: number } = {},
): number {
  const staleMs = options.staleMs ?? LIVE_STALE_MS;
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = nowMs - staleMs;
  const result = db
    .query(
      `UPDATE live_scores SET is_live = 0
       WHERE is_live = 1 AND updated_ts < $cutoff`,
    )
    .run({ $cutoff: cutoff });
  return result.changes;
}

/**
 * Events due within leadMinutes OR already marked is_live.
 * Kalshi REST "active" alone is not used — mirrors ghost-trader scheduler rule.
 *
 * Non-live rows also need start_ts >= now−grace (default 6h) so finished
 * `outcome=scheduled` stubs cannot starve the LIMIT with ancient dates.
 * Prefer is_live, then soonest start.
 */
export function listWatchEvents(
  db: Database,
  options: {
    leadMinutes?: number;
    limit?: number;
    pastGraceHours?: number;
    staleMs?: number;
    nowMs?: number;
    /** Default true. Set false for dry-run/canary (no live_scores writes). */
    clearStale?: boolean;
  } = {},
): WatchEvent[] {
  const leadMinutes = options.leadMinutes ?? 5;
  const limit = options.limit ?? 40;
  const pastGraceHours = options.pastGraceHours ?? WATCH_PAST_GRACE_HOURS;
  const nowMs = options.nowMs ?? Date.now();
  if (options.clearStale !== false) {
    clearStaleLiveFlags(db, { staleMs: options.staleMs, nowMs });
  }
  const leadMs = leadMinutes * 60_000;
  const cutoffIso = new Date(nowMs + leadMs).toISOString();
  const floorIso = new Date(nowMs - pastGraceHours * 3600_000).toISOString();
  const staleFloor = nowMs - (options.staleMs ?? LIVE_STALE_MS);

  const rows = db
    .query(
      `SELECT e.event_id AS event_id,
              e.start_ts AS start_ts,
              e.player_a AS player_a,
              e.player_b AS player_b,
              (
                SELECT m.ticker FROM markets m
                WHERE m.event_id = e.event_id AND m.ticker != ''
                ORDER BY CASE m.market_kind WHEN 'match_winner' THEN 0 ELSE 1 END
                LIMIT 1
              ) AS sample_ticker,
              (
                SELECT GROUP_CONCAT(DISTINCT m.competitor_id)
                FROM markets m
                WHERE m.event_id = e.event_id AND m.competitor_id IS NOT NULL AND m.competitor_id != ''
              ) AS competitor_ids,
              COALESCE((
                SELECT ls.is_live FROM live_scores ls
                WHERE ls.event_id = e.event_id AND ls.is_live = 1 AND ls.updated_ts >= $staleFloor
              ), 0) AS is_live
       FROM events e
       WHERE e.source = $source
         AND e.outcome = 'scheduled'
         AND (
           COALESCE((
             SELECT ls.is_live FROM live_scores ls
             WHERE ls.event_id = e.event_id AND ls.is_live = 1 AND ls.updated_ts >= $staleFloor
           ), 0) = 1
           OR (e.start_ts <= $cutoff AND e.start_ts >= $floor)
         )
       ORDER BY is_live DESC, e.start_ts ASC
       LIMIT $limit`,
    )
    .all({
      $source: KALSHI_SOURCE,
      $cutoff: cutoffIso,
      $floor: floorIso,
      $staleFloor: staleFloor,
      $limit: limit,
    }) as Array<{
    event_id: string;
    start_ts: string;
    player_a: string;
    player_b: string;
    sample_ticker: string | null;
    competitor_ids: string | null;
    is_live: number;
  }>;

  const out: WatchEvent[] = [];
  for (const r of rows) {
    if (!r.sample_ticker) continue;
    const eventTicker = eventTickerFromMarketTicker(r.sample_ticker);
    if (!eventTicker) continue;
    const eventId = asCanonicalEventId(r.event_id);
    const competitors = loadCompetitorLabels(db, eventId);
    out.push({
      eventId,
      eventTicker,
      startTs: r.start_ts,
      playerA: r.player_a ?? "",
      playerB: r.player_b ?? "",
      competitorIds: (r.competitor_ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      competitors,
    });
  }
  return out;
}

export function listWatchEventsForTickers(db: Database, eventTickers: string[]): WatchEvent[] {
  const out: WatchEvent[] = [];
  for (const et of eventTickers) {
    const row = db
      .query(
        `SELECT e.event_id AS event_id, e.start_ts AS start_ts,
                e.player_a AS player_a, e.player_b AS player_b,
                (
                  SELECT GROUP_CONCAT(DISTINCT m.competitor_id)
                  FROM markets m
                  WHERE m.event_id = e.event_id AND m.competitor_id IS NOT NULL AND m.competitor_id != ''
                ) AS competitor_ids
         FROM events e
         JOIN markets m ON m.event_id = e.event_id
         WHERE e.source = $source AND m.ticker LIKE $prefix
         LIMIT 1`,
      )
      .get({ $source: KALSHI_SOURCE, $prefix: `${et}-%` }) as
      | {
          event_id: string;
          start_ts: string;
          player_a: string;
          player_b: string;
          competitor_ids: string | null;
        }
      | null;
    if (!row) continue;
    const eventId = asCanonicalEventId(row.event_id);
    out.push({
      eventId,
      eventTicker: et,
      startTs: row.start_ts,
      playerA: row.player_a ?? "",
      playerB: row.player_b ?? "",
      competitorIds: (row.competitor_ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      competitors: loadCompetitorLabels(db, eventId),
    });
  }
  return out;
}

function competitorsAlign(
  live: KalshiLiveDataWire,
  expected: string[],
): boolean {
  if (expected.length < 2) return true;
  const got = [live.competitor1Id, live.competitor2Id].filter(Boolean) as string[];
  if (got.length < 2) return true;
  const exp = new Set(expected);
  return got.every((id) => exp.has(id));
}

function upsertLiveScore(
  db: Database,
  eventId: CanonicalEventId,
  eventTicker: string,
  live: KalshiLiveDataWire,
  meta: { sourceUrl: string; fetchedTs: number },
): { upserted: boolean; snapshot: boolean } {
  const plan = planLiveScoreWrite(db, eventId, live);
  const isLive = plan.isLive ? 1 : 0;

  db.query(
    `INSERT INTO live_scores (
       event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
       sets_home, sets_away, games_home, games_away, points_home, points_away,
       server_competitor_id, competitor1_id, competitor2_id, is_live, details_json,
       source, source_url, fetched_ts
     ) VALUES (
       $event_id, $event_ticker, $milestone_id, $updated_ts, 'recv', $status, $match_status,
       $sets_home, $sets_away, $games_home, $games_away, $points_home, $points_away,
       $server, $c1, $c2, $is_live, $details,
       $source, $source_url, $fetched_ts
     )
     ON CONFLICT (event_id) DO UPDATE SET
       event_ticker = excluded.event_ticker,
       milestone_id = excluded.milestone_id,
       updated_ts = excluded.updated_ts,
       status = excluded.status,
       match_status = excluded.match_status,
       sets_home = excluded.sets_home,
       sets_away = excluded.sets_away,
       games_home = excluded.games_home,
       games_away = excluded.games_away,
       points_home = excluded.points_home,
       points_away = excluded.points_away,
       server_competitor_id = excluded.server_competitor_id,
       competitor1_id = excluded.competitor1_id,
       competitor2_id = excluded.competitor2_id,
       is_live = excluded.is_live,
       details_json = excluded.details_json,
       source_url = excluded.source_url,
       fetched_ts = excluded.fetched_ts`,
  ).run({
    $event_id: eventId,
    $event_ticker: eventTicker,
    $milestone_id: live.milestoneId,
    $updated_ts: meta.fetchedTs,
    $status: live.status,
    $match_status: live.matchStatus,
    $sets_home: live.setsHome,
    $sets_away: live.setsAway,
    $games_home: live.gamesHome,
    $games_away: live.gamesAway,
    $points_home: live.pointsHome,
    $points_away: live.pointsAway,
    $server: live.serverCompetitorId,
    $c1: live.competitor1Id,
    $c2: live.competitor2Id,
    $is_live: isLive,
    $details: JSON.stringify(live.details),
    $source: LIVE_SOURCE,
    $source_url: meta.sourceUrl,
    $fetched_ts: meta.fetchedTs,
  });

  // Drop finished matches from watch membership (Stadion bridge may later set completed+winner).
  if (isTerminalLiveStatus(live.status)) {
    db.query(
      `UPDATE events SET outcome = CASE
         WHEN winner != '' AND outcome = 'scheduled' THEN 'completed'
         WHEN outcome = 'scheduled' THEN 'unknown'
         ELSE outcome
       END
       WHERE event_id = $id AND source = $source`,
    ).run({ $id: eventId, $source: KALSHI_SOURCE });
  }

  if (plan.snapshot) {
    db.query(
      `INSERT INTO score_snapshots (
         event_id, event_ticker, milestone_id, ts, source_clock, status,
         sets_home, sets_away, games_home, games_away, points_home, points_away,
         server_competitor_id, details_json, source, source_url, fetched_ts
       ) VALUES (
         $event_id, $event_ticker, $milestone_id, $ts, 'recv', $status,
         $sets_home, $sets_away, $games_home, $games_away, $points_home, $points_away,
         $server, $details, $source, $source_url, $fetched_ts
       )`,
    ).run({
      $event_id: eventId,
      $event_ticker: eventTicker,
      $milestone_id: live.milestoneId,
      $ts: meta.fetchedTs,
      $status: live.status,
      $sets_home: live.setsHome,
      $sets_away: live.setsAway,
      $games_home: live.gamesHome,
      $games_away: live.gamesAway,
      $points_home: live.pointsHome,
      $points_away: live.pointsAway,
      $server: live.serverCompetitorId,
      $details: JSON.stringify(live.details),
      $source: LIVE_SOURCE,
      $source_url: meta.sourceUrl,
      $fetched_ts: meta.fetchedTs,
    });
  }

  return { upserted: plan.upserted, snapshot: plan.snapshot };
}

const milestoneCache = new Map<string, { id: string; at: number }>();
const MILESTONE_TTL_MS = 30 * 60 * 1000;

async function resolveMilestoneId(
  eventTicker: string,
  fetchImpl?: KalshiFetchImpl,
): Promise<string | null> {
  const cached = milestoneCache.get(eventTicker);
  if (cached && Date.now() - cached.at < MILESTONE_TTL_MS) return cached.id;
  const milestones = await fetchKalshiMilestonesForEvent(eventTicker, { fetchImpl });
  const pick = pickTennisMilestone(milestones);
  if (!pick) return null;
  milestoneCache.set(eventTicker, { id: pick.id, at: Date.now() });
  return pick.id;
}

function emptyPollRow(w: WatchEvent, patch: Partial<LivePollRow> = {}): LivePollRow {
  return {
    eventTicker: w.eventTicker,
    eventId: w.eventId,
    startTs: w.startTs,
    playerA: w.playerA,
    playerB: w.playerB,
    c1Label: "",
    c2Label: "",
    competitor1Id: null,
    competitor2Id: null,
    milestoneId: null,
    status: null,
    matchStatus: null,
    isLive: false,
    setsHome: null,
    setsAway: null,
    gamesHome: null,
    gamesAway: null,
    pointsHome: null,
    pointsAway: null,
    serverSide: null,
    upserted: false,
    snapshot: false,
    wouldRetire: false,
    transition: "none",
    detailsKeys: [],
    missingDetailKeys: [],
    error: null,
    ...patch,
  };
}

type FetchedWatch = {
  w: WatchEvent;
  milestoneId: string | null;
  data: KalshiLiveDataWire | null;
  sourceUrl: string;
  fetchedTs: number;
  fetchError: string | null;
};

async function fetchWatchLive(
  w: WatchEvent,
  fetchImpl?: KalshiFetchImpl,
): Promise<FetchedWatch> {
  try {
    const milestoneId = await resolveMilestoneId(w.eventTicker, fetchImpl);
    if (!milestoneId) {
      return {
        w,
        milestoneId: null,
        data: null,
        sourceUrl: "",
        fetchedTs: Date.now(),
        fetchError: null,
      };
    }
    const { data, sourceUrl, fetchedTs } = await fetchKalshiLiveData(milestoneId, {
      fetchImpl,
    });
    return { w, milestoneId, data, sourceUrl, fetchedTs, fetchError: null };
  } catch (err) {
    return {
      w,
      milestoneId: null,
      data: null,
      sourceUrl: "",
      fetchedTs: Date.now(),
      fetchError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One poll pass over the watch set (or explicit tickers). */
export async function pollLiveScores(
  db: Database,
  options: LiveScoresPollOptions = {},
): Promise<LivePollSummary> {
  const t0 = Bun.nanoseconds();
  const dryRun = options.dryRun === true;
  const concurrency = Math.max(
    1,
    Math.floor(
      options.concurrency ??
        Number(Bun.env.TENNIS_LIVE_CONCURRENCY ?? 4),
    ),
  );
  if (!options.skipNetworkWarmup && !options.fetchImpl) {
    warmKalshiApiNetwork();
  }
  // Stale sweep is a live_scores write — skip on dry-run (canary must be write-free).
  const staleLiveCleared = dryRun ? 0 : clearStaleLiveFlags(db);
  const summary: LivePollSummary = {
    watched: 0,
    polled: 0,
    upserted: 0,
    snapshotsAppended: 0,
    live: 0,
    milestoneMissing: 0,
    wouldRetire: 0,
    errors: [],
    dryRun,
    rows: [],
    staleLiveCleared,
    durationMs: 0,
    concurrency,
  };

  const watch =
    options.eventTickers?.length ?
      listWatchEventsForTickers(db, options.eventTickers)
    : listWatchEvents(db, {
        leadMinutes: options.leadMinutes,
        limit: options.limit,
        // Poll already ran clearStale above when !dryRun; avoid double write.
        clearStale: false,
      });
  summary.watched = watch.length;
  const pauseMs = options.pauseMs ?? 200;

  // Parallel fetch (mapPool) when concurrency > 1; sequential with pause otherwise.
  let fetched: FetchedWatch[];
  if (concurrency <= 1) {
    fetched = [];
    for (const w of watch) {
      fetched.push(await fetchWatchLive(w, options.fetchImpl));
      if (pauseMs > 0) await Bun.sleep(pauseMs);
    }
  } else {
    fetched = await mapPool(watch, concurrency, (w) =>
      fetchWatchLive(w, options.fetchImpl),
    );
  }

  // Serial classify + write — dry-run plan ≡ writer, no SQLite write races.
  for (const f of fetched) {
    const { w, milestoneId, data, sourceUrl, fetchedTs, fetchError } = f;
    if (fetchError) {
      summary.errors.push(`${w.eventTicker}:${fetchError}`);
      summary.rows.push(emptyPollRow(w, { error: fetchError }));
      continue;
    }
    if (!milestoneId) {
      summary.milestoneMissing++;
      summary.rows.push(emptyPollRow(w, { error: "milestone_missing" }));
      continue;
    }
    summary.polled++;
    if (!data) {
      summary.rows.push(emptyPollRow(w, { milestoneId, error: "live_data_empty" }));
      continue;
    }
    const detailsKeys = Object.keys(data.details);
    const missingDetailKeys = missingLiveDataDetailKeys(data.details);
    const c1Label = labelForCompetitor(w.competitors, data.competitor1Id);
    const c2Label = labelForCompetitor(w.competitors, data.competitor2Id);
    if (!competitorsAlign(data, w.competitorIds)) {
      const err = `competitor_mismatch`;
      summary.errors.push(`${err}:${w.eventTicker}`);
      summary.rows.push(
        emptyPollRow(w, {
          milestoneId,
          detailsKeys,
          missingDetailKeys,
          competitor1Id: data.competitor1Id,
          competitor2Id: data.competitor2Id,
          c1Label,
          c2Label,
          error: err,
        }),
      );
      continue;
    }
    const plan = planLiveScoreWrite(db, w.eventId, data);
    let upserted = false;
    let snapshot = false;
    if (dryRun) {
      upserted = plan.upserted;
      snapshot = plan.snapshot;
      if (upserted) summary.upserted++;
      if (snapshot) summary.snapshotsAppended++;
    } else {
      const wrote = upsertLiveScore(db, w.eventId, w.eventTicker, data, {
        sourceUrl,
        fetchedTs,
      });
      upserted = wrote.upserted;
      snapshot = wrote.snapshot;
      if (upserted) summary.upserted++;
      if (snapshot) summary.snapshotsAppended++;
    }
    if (plan.isLive) summary.live++;
    if (plan.wouldRetire) summary.wouldRetire++;
    summary.rows.push(
      emptyPollRow(w, {
        milestoneId,
        status: data.status,
        matchStatus: data.matchStatus,
        isLive: plan.isLive,
        setsHome: data.setsHome,
        setsAway: data.setsAway,
        gamesHome: data.gamesHome,
        gamesAway: data.gamesAway,
        pointsHome: data.pointsHome,
        pointsAway: data.pointsAway,
        serverSide: data.serverSide,
        competitor1Id: data.competitor1Id,
        competitor2Id: data.competitor2Id,
        c1Label,
        c2Label,
        upserted,
        snapshot,
        wouldRetire: plan.wouldRetire,
        transition: plan.transition,
        detailsKeys,
        missingDetailKeys,
      }),
    );
  }

  summary.durationMs = Math.round((Bun.nanoseconds() - t0) / 1e6);
  return summary;
}

export function getLiveScore(
  db: Database,
  eventId: CanonicalEventId,
): {
  eventTicker: string;
  status: string;
  isLive: boolean;
  setsHome: number;
  setsAway: number;
  gamesHome: number;
  gamesAway: number;
  pointsHome: number;
  pointsAway: number;
  updatedTs: number;
} | null {
  const row = db
    .query(
      `SELECT event_ticker, status, is_live, sets_home, sets_away, games_home, games_away,
              points_home, points_away, updated_ts
       FROM live_scores WHERE event_id = $id`,
    )
    .get({ $id: eventId }) as
    | {
        event_ticker: string;
        status: string;
        is_live: number;
        sets_home: number;
        sets_away: number;
        games_home: number;
        games_away: number;
        points_home: number;
        points_away: number;
        updated_ts: number;
      }
    | null;
  if (!row) return null;
  return {
    eventTicker: row.event_ticker,
    status: row.status,
    isLive: row.is_live === 1,
    setsHome: row.sets_home,
    setsAway: row.sets_away,
    gamesHome: row.games_home,
    gamesAway: row.games_away,
    pointsHome: row.points_home,
    pointsAway: row.points_away,
    updatedTs: row.updated_ts,
  };
}

/** Early-start set for a future recorder/WS scheduler. */
export function listLiveEventIds(db: Database): CanonicalEventId[] {
  return (
    db.query(`SELECT event_id FROM live_scores WHERE is_live = 1`).all() as Array<{
      event_id: string;
    }>
  ).map((r) => asCanonicalEventId(r.event_id));
}
