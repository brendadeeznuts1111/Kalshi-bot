import type { Database } from "bun:sqlite";
import { ComplianceRepository } from "./compliance-repo.ts";

export interface ExecutionPlaySyncResult {
  scanned: number;
  confirmed: number;
  rejected: number;
  unresolved: number;
}

/** Idempotent cross-database projection. Provider/execution evidence is the
 * authority; proposed and unknown regulatory rows never self-promote. */
export function syncRegulatoryExecutionPlays(
  regulatoryDb: Database,
  executionDb: Database,
  limit = 1_000,
): ExecutionPlaySyncResult {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new TypeError("execution play sync limit must be between 1 and 10000");
  }
  const rows = regulatoryDb.query(
    `SELECT execution_idempotency_key AS idempotencyKey
     FROM plays
     WHERE status IN ('proposed', 'unknown')
       AND execution_idempotency_key IS NOT NULL
     ORDER BY execution_updated_at, play_id
     LIMIT $limit`,
  ).all({ $limit: limit }) as Array<{ idempotencyKey: string }>;
  const repo = new ComplianceRepository(regulatoryDb);
  const result: ExecutionPlaySyncResult = {
    scanned: rows.length, confirmed: 0, rejected: 0, unresolved: 0,
  };
  for (const row of rows) {
    const execution = executionDb.query(
      `SELECT id, status, failure_reason AS reason
       FROM exposure_reservations WHERE idempotency_key = $key`,
    ).get({ $key: row.idempotencyKey }) as {
      id: number; status: string; reason: string | null;
    } | null;
    if (execution?.status === "confirmed" || execution?.status === "settled" ||
        execution?.status === "cancelled") {
      repo.transitionExecutionPlay({
        idempotencyKey: row.idempotencyKey,
        status: "confirmed",
        reservationId: execution.id,
      });
      result.confirmed++;
    } else if (execution?.status === "rejected") {
      repo.transitionExecutionPlay({
        idempotencyKey: row.idempotencyKey,
        status: "rejected",
        reservationId: execution.id,
        reason: execution.reason,
      });
      result.rejected++;
    } else {
      result.unresolved++;
    }
  }
  return result;
}
