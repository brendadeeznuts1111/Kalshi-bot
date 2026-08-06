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
  accountingDriftOuts: number;
  maximumCashDriftMinor: number;
  maximumPositionDriftContracts: number;
  outs: ExecutionOutMaintenanceMetric[];
}

export interface ExecutionOutMaintenanceMetric {
  outId: string;
  placing: number;
  unknown: number;
  dueUnknown: number;
  leasedUnknown: number;
  oldestPlacingAgeMs: number | null;
  oldestUnknownAgeMs: number | null;
  reconciliationAttempts: number;
  reconciliationErrors: number;
  reconciliationConflicts: number;
  maxFillLagMs: number | null;
  /** Externally reconciled provider balance/position versus local projection. */
  balanceExposureDriftCents: number | null;
}

/** Bounded maintenance tick; ambiguous/placing outcomes are reported, never auto-released. */
export function runExecutionMaintenance(
  db: Database,
  nowMs = Date.now(),
  options: {
    placingStaleAfterMs?: number;
    provider?: string;
    balanceExposureDriftByOut?: Readonly<Record<string, number | null | undefined>>;
  } = {},
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
  let accounting = { driftOuts: 0, maxCashDrift: 0, maxPositionDrift: 0 };
  try {
    accounting = db.query(
      `WITH latest AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY provider, out_id, environment ORDER BY observed_at_ms DESC, id DESC
         ) AS row_number
         FROM provider_accounting_observations
       )
       SELECT SUM(CASE WHEN cash_drift_minor != 0 OR position_drift_contracts != 0 THEN 1 ELSE 0 END)
                AS driftOuts,
              COALESCE(MAX(ABS(cash_drift_minor)), 0) AS maxCashDrift,
              COALESCE(MAX(position_drift_contracts), 0) AS maxPositionDrift
         FROM latest WHERE row_number = 1`,
    ).get() as typeof accounting;
  } catch {
    // Older/unmigrated stores have no trusted accounting evidence.
  }
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
    accountingDriftOuts: accounting.driftOuts ?? 0,
    maximumCashDriftMinor: accounting.maxCashDrift ?? 0,
    maximumPositionDriftContracts: accounting.maxPositionDrift ?? 0,
    outs: outMetrics(db, nowMs, options.balanceExposureDriftByOut),
  };
}

function outMetrics(
  db: Database,
  nowMs: number,
  driftByOut: Readonly<Record<string, number | null | undefined>> | undefined,
): ExecutionOutMaintenanceMetric[] {
  const rows = db.query(
    `SELECT out_id AS outId,
       SUM(CASE WHEN status = 'placing' THEN 1 ELSE 0 END) AS placing,
       SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknownCount,
       SUM(CASE WHEN status = 'unknown'
         AND (next_reconciliation_at_ms IS NULL OR next_reconciliation_at_ms <= $nowMs)
         AND (reconciliation_owner IS NULL OR reconciliation_lease_expires_at_ms IS NULL
           OR reconciliation_lease_expires_at_ms <= $nowMs) THEN 1 ELSE 0 END) AS dueUnknown,
       SUM(CASE WHEN status = 'unknown' AND reconciliation_owner IS NOT NULL
         AND reconciliation_lease_expires_at_ms > $nowMs THEN 1 ELSE 0 END) AS leasedUnknown,
       MIN(CASE WHEN status = 'placing' THEN updated_at_ms END) AS oldestPlacingAtMs,
       MIN(CASE WHEN status = 'unknown' THEN updated_at_ms END) AS oldestUnknownAtMs,
       SUM(reconciliation_attempts) AS reconciliationAttempts,
       SUM(CASE WHEN reconciliation_result = 'error' THEN 1 ELSE 0 END) AS reconciliationErrors,
       SUM(CASE WHEN reconciliation_result = 'conflict' THEN 1 ELSE 0 END)
         AS reconciliationConflicts
     FROM exposure_reservations GROUP BY out_id ORDER BY out_id`,
  ).all({ $nowMs: nowMs }) as Array<{
    outId: string; placing: number; unknownCount: number; dueUnknown: number;
    leasedUnknown: number; oldestPlacingAtMs: number | null; oldestUnknownAtMs: number | null;
    reconciliationAttempts: number;
    reconciliationErrors: number; reconciliationConflicts: number;
  }>;
  const fillRows = db.query(
    `SELECT out_id AS outId,
       MAX(CASE WHEN provider_created_at_ms IS NOT NULL
         AND observed_at_ms >= provider_created_at_ms
         THEN observed_at_ms - provider_created_at_ms END) AS maxFillLagMs
     FROM provider_order_fills GROUP BY out_id`,
  ).all() as Array<{ outId: string; maxFillLagMs: number | null }>;
  const fillLag = new Map(fillRows.map((row) => [row.outId, row.maxFillLagMs]));
  const outIds = new Set([
    ...rows.map((row) => row.outId),
    ...fillRows.map((row) => row.outId),
    ...Object.keys(driftByOut ?? {}),
  ]);
  const backlog = new Map(rows.map((row) => [row.outId, row]));
  return [...outIds].sort().map((outId) => {
    const row = backlog.get(outId);
    const drift = driftByOut?.[outId];
    if (drift !== undefined && drift !== null &&
        (!Number.isSafeInteger(drift) || drift < 0)) {
      throw new TypeError(`balance/exposure drift for ${outId} must be a non-negative safe integer`);
    }
    return {
      outId,
      placing: row?.placing ?? 0,
      unknown: row?.unknownCount ?? 0,
      dueUnknown: row?.dueUnknown ?? 0,
      leasedUnknown: row?.leasedUnknown ?? 0,
      oldestPlacingAgeMs: ageMs(nowMs, row?.oldestPlacingAtMs ?? null),
      oldestUnknownAgeMs: ageMs(nowMs, row?.oldestUnknownAtMs ?? null),
      reconciliationAttempts: row?.reconciliationAttempts ?? 0,
      reconciliationErrors: row?.reconciliationErrors ?? 0,
      reconciliationConflicts: row?.reconciliationConflicts ?? 0,
      maxFillLagMs: fillLag.get(outId) ?? null,
      balanceExposureDriftCents: drift ?? null,
    };
  });
}

function ageMs(nowMs: number, timestampMs: number | null): number | null {
  return timestampMs === null ? null : Math.max(0, nowMs - timestampMs);
}
