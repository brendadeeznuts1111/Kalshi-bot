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
