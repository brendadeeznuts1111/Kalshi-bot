/**
 * Fonbet → unified event-store persistence.
 *
 * Upserts catalog rows into skin_events (book_id 'fonbet', inventory_id =
 * the feed's native event id) and persists moneyline odds into odds_ticks
 * via the shared contract — the massey edge-flags pipeline consumes it with
 * zero changes.
 *
 * @see src/institutions/event-store/odds-ticks-store.ts — persistOddsTicks
 * @see src/institutions/massey/edge-flags.ts — consumer
 */
import type { Database } from "bun:sqlite";
import { persistOddsTicks } from "../event-store/odds-ticks-store.ts";
import type { FonbetEventRow } from "./parse.ts";

export const FONBET_BOOK_ID = "fonbet";
export const FONBET_ODDS_SOURCE = "fonbet.oddscorp";

/** Upsert a Fonbet catalog row into skin_events. Returns 1 when inserted/updated. */
export function upsertFonbetEvent(db: Database, row: FonbetEventRow, now: number = Date.now()): number {
  const r = db
    .query(
      `INSERT INTO skin_events (
         partner, inventory_id, odds_event_id, sport, league, home, away,
         feed_id, start_time, status, first_seen, last_updated,
         book_id, inventory_live_product, competition_id
       ) VALUES (
         'fonbet', $inventory_id, $odds_event_id, $sport, $league, $home, $away,
         'oddscorp', $start_time, 'unknown', $now, $now,
         'fonbet', 'oddscorp', $competition_id
       )
       ON CONFLICT(book_id, inventory_id) DO UPDATE SET
         league = excluded.league,
         home = excluded.home,
         away = excluded.away,
         start_time = excluded.start_time,
         last_updated = excluded.last_updated,
         competition_id = excluded.competition_id`,
    )
    .run({
      $inventory_id: row.id,
      $odds_event_id: row.id,
      $sport: row.sport,
      $league: row.league,
      $home: row.home,
      $away: row.away,
      $start_time: row.startAt ?? null,
      $now: now,
      $competition_id: row.competitionId,
    });
  return r.changes;
}

/**
 * Persist a parsed Fonbet event: catalog upsert + moneyline odds ticks.
 * Returns the number of odds_ticks rows written (0 when the event has no
 * usable moneyline prices).
 */
export function persistFonbetEvent(
  db: Database,
  row: FonbetEventRow,
): number {
  upsertFonbetEvent(db, row);
  const ticks: Array<{ eventId: string; source: string; side: "home" | "away"; decimalOdds: number; ts: number }> = [];
  if (row.homeDecimal != null) ticks.push({ eventId: row.id, source: FONBET_ODDS_SOURCE, side: "home", decimalOdds: row.homeDecimal, ts: row.asOf });
  if (row.awayDecimal != null) ticks.push({ eventId: row.id, source: FONBET_ODDS_SOURCE, side: "away", decimalOdds: row.awayDecimal, ts: row.asOf });
  return persistOddsTicks(db, ticks);
}
