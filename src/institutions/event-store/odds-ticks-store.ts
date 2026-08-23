/**
 * Live-odds persistence contract for massey edge flags.
 *
 * `loadPricedBookEvents` joins the book catalog (`skin_events`) with the
 * latest live odds from `odds_ticks` via `skin_events.odds_event_id` =
 * `odds_ticks.event_id`, mapping sides 'home' / 'away'. This is the table
 * the fantasy402 live capture is expected to fill (Pandora WS → coefficient
 * store → odds_ticks); tennis history odds (sides 'winner'/'loser' under the
 * canonical `events` corpus) are a different join and out of scope here.
 *
 * @see src/institutions/massey/edge-flags.ts — consumer
 */
import type { Database } from "bun:sqlite";
import type { PricedBookEvent } from "../massey/edge-flags.ts";

export type LatestSideOdds = {
  decimal: number;
  ts: number;
};

/** Latest decimal odds per side for one event id (null side = no price). */
export function latestOddsForEvent(
  db: Database,
  eventId: string,
): { home: LatestSideOdds | null; away: LatestSideOdds | null } {
  const rows = db
    .query(
      `SELECT side, decimal_odds, ts FROM odds_ticks
       WHERE event_id = ?
       ORDER BY ts DESC`,
    )
    .all(eventId) as Array<{ side: string; decimal_odds: number; ts: number }>;
  const out: { home: LatestSideOdds | null; away: LatestSideOdds | null } = { home: null, away: null };
  for (const r of rows) {
    const side = r.side === "home" ? "home" : r.side === "away" ? "away" : null;
    if (side && out[side] == null) out[side] = { decimal: r.decimal_odds, ts: r.ts };
  }
  return out;
}

export type OddsTickInsert = {
  eventId: string;
  source: string;
  side: "home" | "away";
  decimalOdds: number;
  ts: number;
};

/**
 * Persist live odds ticks (upsert-ignore on event_id+source+side+ts).
 * corpus 'trading' (open-db default), limit_context 'live'.
 */
export function persistOddsTicks(db: Database, ticks: OddsTickInsert[]): number {
  const stmt = db.prepare(
    `INSERT INTO odds_ticks (
       event_id, source, fetched_ts, corpus, ts, side, decimal_odds, implied_prob, limit_context
     )
     SELECT $event_id, $source, $fetched_ts, 'trading', $ts, $side, $decimal_odds, $implied_prob, 'live'
     WHERE NOT EXISTS (
       SELECT 1 FROM odds_ticks
       WHERE event_id = $event_id AND source = $source AND side = $side AND ts = $ts
     )`,
  );
  let inserted = 0;
  for (const t of ticks) {
    if (!Number.isFinite(t.decimalOdds) || t.decimalOdds <= 1) continue;
    inserted += stmt.run({
      $event_id: t.eventId,
      $source: t.source,
      $fetched_ts: t.ts,
      $ts: t.ts,
      $side: t.side,
      $decimal_odds: t.decimalOdds,
      $implied_prob: 1 / t.decimalOdds,
    }).changes;
  }
  return inserted;
}

/**
 * Book catalog + latest live odds for a sport, deduped by league|home|away.
 * Events without an odds_event_id (or with no odds_ticks rows) come back
 * with null prices — the flags engine skips them.
 */
export function loadPricedBookEvents(db: Database, sport: string): PricedBookEvent[] {
  const rows = db
    .query(
      `SELECT league, home, away, competition_id, odds_event_id FROM skin_events
       WHERE sport = ? AND home IS NOT NULL AND away IS NOT NULL`,
    )
    .all(sport) as Array<{
    league: string;
    home: string;
    away: string;
    competition_id: string | null;
    odds_event_id: string | null;
  }>;
  const seen = new Set<string>();
  const out: PricedBookEvent[] = [];
  for (const row of rows) {
    const key = row.league + "|" + row.home + "|" + row.away;
    if (seen.has(key)) continue;
    seen.add(key);
    const eventId = row.odds_event_id?.trim();
    const odds = eventId ? latestOddsForEvent(db, eventId) : { home: null, away: null };
    out.push({
      league: row.league,
      home: row.home,
      away: row.away,
      competitionId: row.competition_id,
      homeDecimal: odds.home?.decimal ?? null,
      awayDecimal: odds.away?.decimal ?? null,
      asOf: odds.home?.ts ?? odds.away?.ts ?? null,
    });
  }
  return out;
}
