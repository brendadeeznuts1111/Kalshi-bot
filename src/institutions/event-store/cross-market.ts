/**
 * Cross-market validation signals — compare Kalshi mid prices against
 * Polymarket and Pinnacle odds to flag discrepancies.
 *
 * Odds are supplied by the live V2 reconciliation path. This module owns only
 * event-store queries, signal computation, formatting, and surface helpers.
 */
import type { Database } from "bun:sqlite";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import type { CrossMarketOdds, CrossMarketSignal } from "./types.ts";
import type { SeriesTicker } from "./brands.ts";
import { unbrand } from "./brands.ts";

// ── Helpers ─────────────────────────────────────────────────────

/** Mid price from a BookSnapshot (or null if book is crossed / empty). */
function bookMidCents(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  return Math.round((bestBid + bestAsk) / 2);
}

/** Cents → implied probability (0–1). */
function centsToProb(cents: number): number {
  return cents / 100;
}

// ── Signal computation ──────────────────────────────────────────

export type EventBookRow = {
  eventId: string;
  ticker: string;
  tournament: string;
  playerA: string;
  playerB: string;
  surface: string;
  levelsJson: string;
};

/**
 * Query the event store for all events that have at least one book_tick,
 * returning the latest levels_json for each.
 */
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

/**
 * Build cross-market signals by comparing Kalshi mid prices against
 * Polymarket and Pinnacle odds for each event with book data.
 */
export function computeCrossMarketSignals(
  events: EventBookRow[],
  oddsMap: Map<string, CrossMarketOdds>,
): CrossMarketSignal[] {
  const signals: CrossMarketSignal[] = [];

  for (const row of events) {
    let book: BookSnapshot;
    try {
      book = JSON.parse(row.levelsJson) as BookSnapshot;
    } catch {
      continue;
    }

    const midCents = bookMidCents(book);
    if (midCents == null) continue;

    const kalshiProb = centsToProb(midCents);
    const odds = oddsMap.get(row.ticker);
    const polyProb = odds?.polymarketProb ?? null;
    const pinnyProb = odds?.pinnacleProb ?? null;

    const deviationPoly = polyProb !== null ? kalshiProb - polyProb : 0;
    const deviationPinny = pinnyProb !== null ? kalshiProb - pinnyProb : 0;
    const absDeviation = Math.max(
      polyProb !== null ? Math.abs(deviationPoly) : 0,
      pinnyProb !== null ? Math.abs(deviationPinny) : 0,
    );

    // Only include events with > 1 % deviation
    if (absDeviation <= 0.01) continue;

    signals.push({
      eventId: row.eventId,
      title: row.tournament || row.ticker,
      playerA: row.playerA,
      playerB: row.playerB,
      kalshiMidCents: midCents,
      kalshiProb,
      polymarketProb: polyProb,
      pinnacleProb: pinnyProb,
      deviationPoly,
      deviationPinny,
      absDeviation,
    });
  }

  signals.sort((a, b) => b.absDeviation - a.absDeviation);
  return signals;
}

// ── Formatting ──────────────────────────────────────────────────

/**
 * Render the top-N cross-market signals as a human-readable table.
 */
export function formatSignalTable(signals: CrossMarketSignal[], topN = 10): string[] {
  if (signals.length === 0) return ["No cross-market signals with |deviation| > 1%."];

  const top = signals.slice(0, topN);
  const header = `${"Event".padEnd(28)} ${"Players".padEnd(24)} Kalshi   Poly    Pinny   Dev`;
  const sep = "-".repeat(80);
  const rows = top.map((s) => {
    const eventLabel = (s.title.length > 25 ? s.title.slice(0, 24) + "…" : s.title).padEnd(28);
    const players = `${s.playerA.slice(0, 11)} vs ${s.playerB.slice(0, 11)}`.padEnd(24);
    const kProb = (s.kalshiProb * 100).toFixed(1).padStart(5) + "%";
    const pProb = s.polymarketProb !== null ? (s.polymarketProb * 100).toFixed(1).padStart(5) + "%" : "  —  ";
    const piProb = s.pinnacleProb !== null ? (s.pinnacleProb * 100).toFixed(1).padStart(5) + "%" : "  —  ";
    // Use the larger absolute deviation for the display
    const dev =
      Math.abs(s.deviationPoly) >= Math.abs(s.deviationPinny) ? s.deviationPoly : s.deviationPinny;
    const sign = dev > 0 ? "+" : "";
    const devStr = `${sign}${(dev * 100).toFixed(1)}%`.padStart(7);
    return `${eventLabel} ${players} ${kProb} ${pProb} ${piProb} ${devStr}`;
  });

  return [header, sep, ...rows];
}

/**
 * Build the full signals block: heading + table + summary line.
 */
export function buildSignalsBlock(signals: CrossMarketSignal[], topN = 10): string[] {
  const lines: string[] = [];
  if (signals.length === 0) {
    lines.push("Cross-market signals: none with |deviation| > 1%.");
    return lines;
  }
  lines.push(`Cross-market signals: ${signals.length} events with |deviation| > 1%`);
  lines.push("");
  lines.push(...formatSignalTable(signals, topN));
  return lines;
}

// ── Surface edge (warehouse win-rate differential) ──────────────

/** Surface-specific win rate stats for a player. */
export type SurfaceStats = { wins: number; losses: number; apps: number; winRate: number };

/**
 * Parse the surfaces JSON from player_profiles (e.g. `{"Hard":{"wins":5,"losses":2,"apps":7}}`)
 * into a map of surface → SurfaceStats.
 */
export function parseSurfaceStats(raw: string | null): Map<string, SurfaceStats> {
  const out = new Map<string, SurfaceStats>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, { wins?: number; losses?: number; apps?: number }>;
    for (const [surface, stats] of Object.entries(parsed)) {
      const apps = stats.apps ?? 0;
      const wins = stats.wins ?? 0;
      const losses = stats.losses ?? 0;
      out.set(surface.toLowerCase(), {
        wins,
        losses,
        apps,
        winRate: apps > 0 ? wins / apps : 0,
      });
    }
  } catch { /* ignore malformed JSON */ }
  return out;
}

export type EdgeScaling = "dampened" | "linear" | "sigmoid";

/**
 * Compute surface edge between two players using warehouse win rates.
 * Returns the scaled win-rate difference (range: -100 to +100).
 * Positive = playerA is favored on this surface.
 * Returns 0 if either player has < 3 apps on the surface.
 *
 * Scaling options:
 *   "dampened" (default) — caps at ±50 for 100pt diff, safe for display
 *   "linear" — raw diff, full -100..+100 range
 *   "sigmoid" — smooth S-curve, preserves extremes, full range
 */
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

  let scaled: number;
  switch (scaling) {
    case "linear":
      scaled = diff;
      break;
    case "sigmoid":
      scaled = 100 * (2 / (1 + Math.exp(-0.05 * diff)) - 1);
      break;
    case "dampened":
    default:
      scaled = diff * (1 - Math.abs(diff) / 200);
      break;
  }

  return Math.round(Math.max(-100, Math.min(100, scaled)));
}
