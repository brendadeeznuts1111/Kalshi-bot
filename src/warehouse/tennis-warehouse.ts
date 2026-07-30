/**
 * Tennis warehouse view — event-store rows + latest book mids for CLI summary.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { midFromBookSnapshot } from "../bot/kalshi-book-parse.ts";
import type { BookSnapshot } from "../institutions/alpha-signal-types.ts";
import {
  asCanonicalEventId,
  tryKalshiEventTicker,
  type CanonicalEventId,
  type KalshiEventTicker,
  unbrand,
} from "../institutions/event-store/brands.ts";
import { eventTickerFromMarket } from "../research/hq-data.ts";
import type { WarehouseEventForSignal } from "./cross-market-signals.ts";

export type TennisWarehouseEvent = WarehouseEventForSignal & {
  tour: string;
  startTs: string;
  volumeFp: number;
  series: string | null;
};

/**
 * Event-level ITF volume rollup for warehouse CLI — not player_profiles.
 * avgVolumeFp here = mean event volume (not avgKalshiVolumeFp on a player).
 * @see docs/PLAYER_PROFILES_META.md
 */
export type ItfVolumeSummary = {
  eventCount: number;
  totalVolumeFp: number;
  /** Mean volume_fp across ITF events in this summary (event entity, not player). */
  avgVolumeFp: number;
  topByVolume: Array<{
    eventId: CanonicalEventId;
    eventTicker: KalshiEventTicker | null;
    matchup: string;
    tour: string;
    volumeFp: number;
  }>;
};

export type TennisWarehouse = {
  lastUpdated: string;
  events: TennisWarehouseEvent[];
  playerCount: number;
  itf: ItfVolumeSummary;
};

function parseBookJson(json: string): BookSnapshot | null {
  try {
    return JSON.parse(json) as BookSnapshot;
  } catch {
    return null;
  }
}

type LatestBookRow = {
  event_id: string;
  ticker: string;
  levels_json: string;
  yes_side_label: string | null;
};

type EventAggRow = {
  event_id: string;
  player_a: string;
  player_b: string;
  tour: string;
  start_ts: string;
  volume_fp: number;
  sample_ticker: string | null;
  series: string | null;
};

function loadLatestBookMids(db: Database): Map<string, Map<string, number>> {
  /** event_id → (normalized yes_side_label → midCents) */
  const byEvent = new Map<string, Map<string, number>>();
  const rows = db
    .query(
      `SELECT bt.event_id AS event_id, bt.ticker AS ticker, bt.levels_json AS levels_json,
              m.yes_side_label AS yes_side_label
       FROM book_ticks bt
       LEFT JOIN markets m ON m.ticker = bt.ticker
       WHERE bt.id IN (SELECT MAX(id) FROM book_ticks GROUP BY ticker)`,
    )
    .all() as LatestBookRow[];

  for (const row of rows) {
    const book = parseBookJson(row.levels_json);
    if (!book) continue;
    const mid = midFromBookSnapshot(book);
    if (mid == null) continue;
    const label = (row.yes_side_label ?? "").trim().toLowerCase();
    let labels = byEvent.get(row.event_id);
    if (!labels) {
      labels = new Map();
      byEvent.set(row.event_id, labels);
    }
    if (label) labels.set(label, mid);
    // Also key by ticker suffix so we always have at least one mid per event.
    labels.set(`__ticker__:${row.ticker}`, mid);
  }
  return byEvent;
}

function resolvePlayerAMid(
  playerA: string,
  mids: Map<string, number> | undefined,
): number | null {
  if (!mids || mids.size === 0) return null;
  const key = playerA.trim().toLowerCase();
  if (key && mids.has(key)) return mids.get(key)!;
  // Fallback: first ticker-keyed mid (deterministic by Map insertion = ticker order from SQL).
  for (const [k, mid] of mids) {
    if (k.startsWith("__ticker__:")) return mid;
  }
  return null;
}

function loadEventAggregates(db: Database): EventAggRow[] {
  return db
    .query(
      `SELECT e.event_id AS event_id,
              e.player_a AS player_a,
              e.player_b AS player_b,
              e.tour AS tour,
              e.start_ts AS start_ts,
              COALESCE(SUM(CAST(COALESCE(m.volume_fp, '0') AS REAL)), 0) AS volume_fp,
              MIN(m.ticker) AS sample_ticker,
              MIN(m.series) AS series
       FROM events e
       LEFT JOIN markets m ON m.event_id = e.event_id
       WHERE e.source = 'kalshi-api'
       GROUP BY e.event_id
       ORDER BY e.start_ts DESC`,
    )
    .all() as EventAggRow[];
}

function toEventTicker(sampleTicker: string | null): KalshiEventTicker | null {
  if (!sampleTicker) return null;
  return tryKalshiEventTicker(eventTickerFromMarket(sampleTicker)) ?? null;
}

export function buildItfVolumeSummary(
  events: readonly TennisWarehouseEvent[],
  topN = 5,
): ItfVolumeSummary {
  const itf = events.filter((e) => (e.series ?? "").startsWith("KXITF") || e.tour.startsWith("ITF"));
  const totalVolumeFp = itf.reduce((n, e) => n + e.volumeFp, 0);
  const topByVolume = [...itf]
    .sort((a, b) => b.volumeFp - a.volumeFp)
    .slice(0, topN)
    .map((e) => ({
      eventId: e.eventId,
      eventTicker: e.eventTicker,
      matchup: `${e.playerA} vs ${e.playerB}`,
      tour: e.tour,
      volumeFp: e.volumeFp,
    }));
  return {
    eventCount: itf.length,
    totalVolumeFp,
    avgVolumeFp: itf.length > 0 ? totalVolumeFp / itf.length : 0,
    topByVolume,
  };
}

export function buildTennisWarehouse(db: Database, options: { nowMs?: number } = {}): TennisWarehouse {
  const nowMs = options.nowMs ?? Date.now();
  const bookMids = loadLatestBookMids(db);
  const aggs = loadEventAggregates(db);

  const events: TennisWarehouseEvent[] = aggs.map((row) => {
    const eventId = asCanonicalEventId(row.event_id);
    const eventTicker = toEventTicker(row.sample_ticker);
    const mids = bookMids.get(row.event_id);
    const kalshiMidCents = resolvePlayerAMid(row.player_a, mids);
    const title =
      eventTicker != null
        ? unbrand(eventTicker)
        : `${row.player_a} vs ${row.player_b}`;
    return {
      eventId,
      eventTicker,
      title,
      playerA: row.player_a || "A",
      playerB: row.player_b || "B",
      kalshiMidCents,
      tour: row.tour,
      startTs: row.start_ts,
      volumeFp: Number(row.volume_fp) || 0,
      series: row.series,
    };
  });

  const playerRow = db
    .query(`SELECT COUNT(*) AS n FROM player_profiles`)
    .get() as { n: number } | null;

  return {
    lastUpdated: new Date(nowMs).toISOString(),
    events,
    playerCount: playerRow?.n ?? 0,
    itf: buildItfVolumeSummary(events),
  };
}

/** Events that have a Kalshi mid — candidates for cross-market signals. */
export function eventsWithKalshiMid(warehouse: TennisWarehouse): WarehouseEventForSignal[] {
  return warehouse.events.filter((e) => e.kalshiMidCents != null);
}
