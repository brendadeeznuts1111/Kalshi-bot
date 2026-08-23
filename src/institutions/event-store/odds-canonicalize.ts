/**
 * Backfills that unify the odds data model: canonical match_key joins and
 * the home/away side vocabulary (docs/DATA_MODEL.md steps 2–3).
 *
 * - `backfillMatchKeys` copies match_key onto odds_ticks rows whose
 *   event_id is linked through event_links (stadion or kalshi side).
 * - `canonicalizeOddsSides` rewrites winner/loser sides to home/away by
 *   resolving the winning/losing competitor against events.player_a/b.
 *
 * Idempotent: match_key only fills NULL/empty rows; sides only rewrite
 * winner/loser rows that resolve unambiguously.
 *
 * @see docs/DATA_MODEL.md — the unified model
 * @see src/institutions/event-store/event-identity.ts — vocabulary SSOT
 */
import type { Database } from "bun:sqlite";
import { normalizeSideToHomeAway } from "./event-identity.ts";

export type BackfillResult = { updated: number };

/** Copy match_key from event_links onto linked odds_ticks rows. */
export function backfillMatchKeys(db: Database): BackfillResult {
  const r = db.run(
    `UPDATE odds_ticks
     SET match_key = (
       SELECT COALESCE(
         (SELECT el.match_key FROM event_links el
          WHERE el.stadion_event_id = odds_ticks.event_id AND el.match_key != '' LIMIT 1),
         (SELECT el.match_key FROM event_links el
          WHERE el.kalshi_event_id = odds_ticks.event_id AND el.match_key != '' LIMIT 1)
       )
     )
     WHERE (match_key IS NULL OR match_key = '')
       AND EXISTS (
         SELECT 1 FROM event_links el
         WHERE (el.stadion_event_id = odds_ticks.event_id OR el.kalshi_event_id = odds_ticks.event_id)
           AND el.match_key != ''
       )`,
  );
  return { updated: r.changes };
}

/** Rewrite winner/loser odds rows to home/away via events competitor names. */
export function canonicalizeOddsSides(db: Database): BackfillResult {
  const rows = db
    .query(
      `SELECT ot.id AS id, ot.side AS side, e.player_a AS player_a, e.player_b AS player_b,
              e.winner AS winner, e.loser AS loser
       FROM odds_ticks ot
       JOIN events e ON e.event_id = ot.event_id
       WHERE ot.side IN ('winner','loser')`,
    )
    .all() as Array<{ id: number; side: string; player_a: string; player_b: string; winner: string; loser: string }>;
  let updated = 0;
  for (const row of rows) {
    const competitor = row.side === "winner" ? row.winner : row.loser;
    const side = normalizeSideToHomeAway(row.side, {
      competitor,
      home: row.player_a,
      away: row.player_b,
    });
    if (side != null) {
      db.run("UPDATE odds_ticks SET side = ? WHERE id = ?", [side, row.id]);
      updated++;
    }
  }
  return { updated };
}
