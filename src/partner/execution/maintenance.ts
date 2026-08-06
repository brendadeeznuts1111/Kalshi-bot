import type { Database } from "bun:sqlite";
import { releaseExpiredReservations } from "./reservation.ts";

export interface ExecutionMaintenanceResult {
  releasedPending: number;
  placing: number;
  unknown: number;
}

/** Bounded maintenance tick; ambiguous/placing outcomes are reported, never auto-released. */
export function runExecutionMaintenance(
  db: Database,
  nowMs = Date.now(),
): ExecutionMaintenanceResult {
  const releasedPending = releaseExpiredReservations(db, nowMs);
  const counts = db
    .query(
      `SELECT
         SUM(CASE WHEN status = 'placing' THEN 1 ELSE 0 END) AS placing,
         SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown
       FROM exposure_reservations`,
    )
    .get() as { placing: number | null; unknown: number | null };
  return {
    releasedPending,
    placing: counts.placing ?? 0,
    unknown: counts.unknown ?? 0,
  };
}
