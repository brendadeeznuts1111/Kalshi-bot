import type { Database } from "bun:sqlite";
import {
  recoverStalePlacingReservations,
  releaseExpiredReservations,
} from "./reservation.ts";

export const DEFAULT_PLACING_STALE_AFTER_MS = 60_000;

export interface ExecutionMaintenanceResult {
  releasedPending: number;
  recoveredStalePlacing: number;
  placing: number;
  unknown: number;
  dueUnknown: number;
  leasedUnknown: number;
  oldestPlacingAgeMs: number | null;
  oldestUnknownAgeMs: number | null;
  pendingReceipts: number;
  leasedReceipts: number;
  deadReceipts: number;
  oldestPendingReceiptAgeMs: number | null;
}

/** Bounded maintenance tick; ambiguous/placing outcomes are reported, never auto-released. */
export function runExecutionMaintenance(
  db: Database,
  nowMs = Date.now(),
  options: { placingStaleAfterMs?: number; provider?: string } = {},
): ExecutionMaintenanceResult {
  const releasedPending = releaseExpiredReservations(db, nowMs);
  const recoveredStalePlacing = recoverStalePlacingReservations(db, {
    nowMs,
    staleAfterMs: options.placingStaleAfterMs ?? DEFAULT_PLACING_STALE_AFTER_MS,
    provider: options.provider,
  });
  const counts = db
    .query(
      `SELECT
         SUM(CASE WHEN status = 'placing' THEN 1 ELSE 0 END) AS placing,
         SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknown,
         SUM(CASE WHEN status = 'unknown'
           AND (next_reconciliation_at_ms IS NULL OR next_reconciliation_at_ms <= $nowMs)
           AND (reconciliation_owner IS NULL
             OR reconciliation_lease_expires_at_ms IS NULL
             OR reconciliation_lease_expires_at_ms <= $nowMs)
           THEN 1 ELSE 0 END) AS dueUnknown,
         SUM(CASE WHEN status = 'unknown'
           AND reconciliation_owner IS NOT NULL
           AND reconciliation_lease_expires_at_ms > $nowMs
           THEN 1 ELSE 0 END) AS leasedUnknown,
         MIN(CASE WHEN status = 'placing' THEN updated_at_ms END) AS oldestPlacingAtMs,
         MIN(CASE WHEN status = 'unknown' THEN updated_at_ms END) AS oldestUnknownAtMs
       FROM exposure_reservations`,
    )
    .get({ $nowMs: nowMs }) as {
      placing: number | null;
      unknown: number | null;
      dueUnknown: number | null;
      leasedUnknown: number | null;
      oldestPlacingAtMs: number | null;
      oldestUnknownAtMs: number | null;
    };
  const receipts = db.query(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'pending' AND lease_owner IS NOT NULL
         AND lease_expires_at_ms > $nowMs THEN 1 ELSE 0 END) AS leased,
       SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
       MIN(CASE WHEN status = 'pending' THEN created_at_ms END) AS oldestPendingAtMs
     FROM account_authorization_receipt_outbox`,
  ).get({ $nowMs: nowMs }) as {
    pending: number | null;
    leased: number | null;
    dead: number | null;
    oldestPendingAtMs: number | null;
  };
  return {
    releasedPending,
    recoveredStalePlacing,
    placing: counts.placing ?? 0,
    unknown: counts.unknown ?? 0,
    dueUnknown: counts.dueUnknown ?? 0,
    leasedUnknown: counts.leasedUnknown ?? 0,
    oldestPlacingAgeMs: ageMs(nowMs, counts.oldestPlacingAtMs),
    oldestUnknownAgeMs: ageMs(nowMs, counts.oldestUnknownAtMs),
    pendingReceipts: receipts.pending ?? 0,
    leasedReceipts: receipts.leased ?? 0,
    deadReceipts: receipts.dead ?? 0,
    oldestPendingReceiptAgeMs: ageMs(nowMs, receipts.oldestPendingAtMs),
  };
}

function ageMs(nowMs: number, timestampMs: number | null): number | null {
  return timestampMs === null ? null : Math.max(0, nowMs - timestampMs);
}
