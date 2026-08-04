// @see https://bun.com/docs/runtime/sqlite
/**
 * Offline cross-market helpers for price-logger (event-store queries + surface edge).
 */
import type { Database } from "bun:sqlite";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import type { SeriesTicker } from "./brands.ts";
import { unbrand } from "./brands.ts";

export type CrossMarketOdds = {
  polymarketProb: number | null;
  pinnacleProb: number | null;
};

export type EventBookRow = {
  eventId: string;
  ticker: string;
  tournament: string;
  playerA: string;
  playerB: string;
  surface: string;
  levelsJson: string;
};

function bookMidCents(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  return Math.round((bestBid + bestAsk) / 2);
}

export function queryEventsWithBooks(
  db: Database,
  allowedSeries?: readonly SeriesTicker[],
): EventBookRow[] {
  if (allowedSeries?.length === 0) return [];
  const params = Object.fromEntries(
    (allowedSeries ?? []).map((series, index) => [`$series${index}`, unbrand(series)]),
  );
  const seriesFilter = allowedSeries
    ? `AND m.series IN (${allowedSeries.map((_, index) => `$series${index}`).join(", ")})`
    : "";
  return db
    .query(
      `SELECT e.event_id   AS eventId,
              b.ticker      AS ticker,
              e.tournament  AS tournament,
              e.player_a    AS playerA,
              e.player_b    AS playerB,
              e.surface     AS surface,
              b.levels_json AS levelsJson
       FROM events e
       JOIN (
         SELECT event_id, MAX(ts) AS max_ts
         FROM book_ticks
         GROUP BY event_id
       ) latest ON latest.event_id = e.event_id
       JOIN book_ticks b ON b.event_id = latest.event_id AND b.ts = latest.max_ts
       JOIN markets m ON m.ticker = b.ticker
       WHERE b.levels_json IS NOT NULL
         ${seriesFilter}
       ORDER BY e.start_ts DESC`,
    )
    .all(params) as EventBookRow[];
}

type EdgeScaling = "linear" | "sigmoid" | "dampened";

function parseSurfaceStats(raw: string | null): Map<string, { winRate: number; apps: number }> {
  const out = new Map<string, { winRate: number; apps: number }>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, { winRate?: number; apps?: number }>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.winRate === "number" && typeof v.apps === "number") {
        out.set(k.toLowerCase(), { winRate: v.winRate, apps: v.apps });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function surfaceEdgeFor(
  aSurfaceJson: string | null,
  bSurfaceJson: string | null,
  surface: string,
  scaling: EdgeScaling = "dampened",
): number {
  const aStats = parseSurfaceStats(aSurfaceJson).get(surface.toLowerCase());
  const bStats = parseSurfaceStats(bSurfaceJson).get(surface.toLowerCase());
  if (!aStats || !bStats || aStats.apps < 3 || bStats.apps < 3) return 0;
  const diff = (aStats.winRate - bStats.winRate) * 100;
  switch (scaling) {
    case "linear":
      return diff;
    case "sigmoid":
      return 100 * (2 / (1 + Math.exp(-0.05 * diff)) - 1);
    default:
      return diff * (1 - Math.abs(diff) / 200);
  }
}

// silence unused mid helper for future signal builders
void bookMidCents;
