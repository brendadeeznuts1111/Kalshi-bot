import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { asReconciliationOwner } from "../../../src/partner/execution/domain.ts";
import {
  claimUnknownReservations,
  computeDailyUsage,
  computeOutstandingExposure,
  recoverStalePlacingReservations,
} from "../../../src/partner/execution/reservation.ts";
import { runExecutionMaintenance } from "../../../src/partner/execution/maintenance.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";
import {
  asOutId,
  asPartnerCode,
  asSkinId,
} from "../../../src/partner/authorization/domain.ts";

const NOW_MS = 1_700_000_100_000;

function setup(): Database {
  const db = new Database(":memory:");
  migrateExecutionSchema(db, NOW_MS - 100_000);
  db.run("PRAGMA foreign_keys = OFF");
  return db;
}

function insertReservation(
  db: Database,
  input: {
    key: string;
    status: "placing" | "unknown";
    updatedAtMs: number;
    provider?: string;
  },
): number {
  const row = db.query(
    `INSERT INTO exposure_reservations (
       idempotency_key, partner_code, out_id, skin, provider, authorization_id,
       requested_stake, effective_stake, market_id, selection, decimal_odds,
       status, reservation_expires_at_ms, placement_owner, created_at_ms, updated_at_ms
     ) VALUES (
       $key, 'SPORTS', 'out-SPORTS-1', 'main', $provider, 999,
       800, 800, 'market-1', 'yes', 2.0,
       $status, $expiresAtMs, 'placement-worker', $createdAtMs, $updatedAtMs
     ) RETURNING id`,
  ).get({
    $key: input.key,
    $provider: input.provider ?? "kalshi",
    $status: input.status,
    $expiresAtMs: NOW_MS + 30_000,
    $createdAtMs: NOW_MS - 120_000,
    $updatedAtMs: input.updatedAtMs,
  }) as { id: number };
  return row.id;
}

const lane = {
  partnerCode: asPartnerCode("SPORTS"),
  outId: asOutId("out-SPORTS-1"),
  skin: asSkinId("main"),
};

describe("execution maintenance", () => {
  test("recovers only stale placing rows while preserving exposure and provenance", () => {
    const db = setup();
    const staleId = insertReservation(db, {
      key: "stale",
      status: "placing",
      updatedAtMs: NOW_MS - 60_000,
    });
    insertReservation(db, {
      key: "fresh",
      status: "placing",
      updatedAtMs: NOW_MS - 59_999,
    });
    expect(computeOutstandingExposure(db, lane)).toBe(1_600);
    expect(recoverStalePlacingReservations(db, {
      nowMs: NOW_MS,
      staleAfterMs: 60_000,
      provider: "KALSHI",
    })).toBe(1);
    const recovered = db.query(
      `SELECT status, placement_owner AS placementOwner,
        next_reconciliation_at_ms AS nextAt, provider_response_json AS response
       FROM exposure_reservations WHERE id = $id`,
    ).get({ $id: staleId }) as {
      status: string;
      placementOwner: string;
      nextAt: number;
      response: string;
    };
    expect(recovered).toMatchObject({
      status: "unknown",
      placementOwner: "placement-worker",
      nextAt: NOW_MS,
    });
    expect(JSON.parse(recovered.response)).toMatchObject({ recovery: "stale_placing" });
    expect(computeOutstandingExposure(db, lane)).toBe(1_600);
    expect(computeDailyUsage(db, lane, NOW_MS - 200_000)).toBe(1_600);
    expect(recoverStalePlacingReservations(db, {
      nowMs: NOW_MS,
      staleAfterMs: 60_000,
    })).toBe(0);
    db.close();
  });

  test("reports bounded backlog ages plus due and leased unknown counts", () => {
    const db = setup();
    insertReservation(db, {
      key: "stale-placing",
      status: "placing",
      updatedAtMs: NOW_MS - 70_000,
    });
    insertReservation(db, {
      key: "due-unknown",
      status: "unknown",
      updatedAtMs: NOW_MS - 30_000,
    });
    insertReservation(db, {
      key: "leased-unknown",
      status: "unknown",
      updatedAtMs: NOW_MS - 20_000,
    });
    claimUnknownReservations(db, {
      provider: "kalshi",
      owner: asReconciliationOwner("health-worker"),
      nowMs: NOW_MS,
      leaseDurationMs: 10_000,
      limit: 1,
    });
    db.query(
      `INSERT INTO account_authorization_receipt_outbox
       (dedupe_key, telegram_chat_id, payload_json, status, attempts,
        available_at_ms, created_at_ms, updated_at_ms)
       VALUES ('maintenance-receipt', '-1', '{"text":"pending"}', 'pending', 0,
        $createdAtMs, $createdAtMs, $createdAtMs)`,
    ).run({ $createdAtMs: NOW_MS - 45_000 });
    db.query(
      `UPDATE exposure_reservations SET reconciliation_attempts = 2,
       reconciliation_result = 'conflict' WHERE idempotency_key = 'due-unknown'`,
    ).run();
    db.exec(`
      INSERT INTO provider_order_lifecycle (
        provider, out_id, environment, provider_order_id, ticker, side, action,
        unit_price_minor, ordered_quantity, filled_quantity, remaining_quantity,
        cancelled_quantity, provider_status, first_observed_at_ms, last_observed_at_ms
      ) VALUES (
        'kalshi', 'out-SPORTS-1', 'demo', 'order-fill-lag', 'market-1', 'yes', 'buy',
        40, 1, 1, 0, 0, 'executed', ${NOW_MS - 5_000}, ${NOW_MS}
      );
      INSERT INTO provider_order_fills (
        order_lifecycle_id, provider, out_id, source_key, provider_order_id,
        ticker, side, action, quantity, unit_price_minor,
        provider_created_at_ms, observed_at_ms
      ) VALUES (
        last_insert_rowid(), 'kalshi', 'out-SPORTS-1', 'fill-lag', 'order-fill-lag',
        'market-1', 'yes', 'buy', 1, 40, ${NOW_MS - 2_500}, ${NOW_MS}
      );
    `);
    const result = runExecutionMaintenance(db, NOW_MS, {
      placingStaleAfterMs: 60_000,
      balanceExposureDriftByOut: { "out-SPORTS-1": 7 },
    });
    expect(result).toEqual({
      releasedPending: 0,
      recoveredStalePlacing: 1,
      placing: 0,
      unknown: 3,
      dueUnknown: 2,
      leasedUnknown: 1,
      oldestPlacingAgeMs: null,
      oldestUnknownAgeMs: 30_000,
      pendingReceipts: 1,
      leasedReceipts: 0,
      deadReceipts: 0,
      oldestPendingReceiptAgeMs: 45_000,
      accountingDriftOuts: 0,
      maximumCashDriftMinor: 0,
      maximumPositionDriftContracts: 0,
      outs: [{
        outId: "out-SPORTS-1",
        placing: 0,
        unknown: 3,
        dueUnknown: 2,
        leasedUnknown: 1,
        oldestPlacingAgeMs: null,
        oldestUnknownAgeMs: 30_000,
        reconciliationAttempts: 2,
        reconciliationErrors: 0,
        reconciliationConflicts: 1,
        maxFillLagMs: 2_500,
        balanceExposureDriftCents: 7,
      }],
    });
    db.close();
  });
});
