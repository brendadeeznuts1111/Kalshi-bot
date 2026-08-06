import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { appendReservationJournalEntry } from "../../../src/partner/execution/execution-journal.ts";
import { asExposureReservationId } from "../../../src/partner/execution/domain.ts";
import { executionIdempotencyKeyToUuid } from "../../../src/partner/execution/kalshi.ts";
import {
  syncKalshiProviderLifecycle,
  type KalshiLifecycleSyncDependencies,
} from "../../../src/partner/execution/kalshi-lifecycle-sync.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
} from "../../../src/partner/registry.ts";

const NOW = 1_700_000_000_000;

describe("Kalshi lifecycle operational sync", () => {
  test("maps deterministic client IDs, persists the journal, and reports account orphans", async () => {
    const db = setup();
    const clientOrderId = executionIdempotencyKeyToUuid("sync-key");
    let providerBalance = 10_000;
    const dependencies: KalshiLifecycleSyncDependencies = {
      now: () => NOW,
      resolveClient: () => ({
        environment: "demo",
        async getLifecyclePage(feed, source) {
          if (feed === "orders" && source === "active") {
            return { items: [order("provider-1", clientOrderId), order("manual-1", "manual")], cursor: "" };
          }
          if (feed === "fills" && source === "active") {
            return { items: [fill("provider-1")], cursor: "" };
          }
          return { items: [], cursor: "" };
        },
        getSettlementPage: () => Promise.resolve({
          items: [{ ticker: "KXTEST", market_result: "yes", settled_time: new Date(NOW).toISOString() }],
          cursor: "",
        }),
        getPositionsPage: () => Promise.resolve({ items: [], cursor: "" }),
        getBalance: () => Promise.resolve({ balanceCents: providerBalance }),
      }),
    };
    const result = await syncKalshiProviderLifecycle(db, dependencies);
    expect(result).toMatchObject({
      failedAccounts: 0,
      orphanProviderOrders: 1,
      orphanConfirmedReservations: 0,
      accounts: [{
        outId: "out-SPORTS-1",
        ok: true,
        linkedOrders: 1,
        orphanProviderOrders: 1,
        journalEntriesAppended: 2,
        settlementsApplied: 1,
        cashDriftMinor: 0,
        positionDriftContracts: 0,
        accountingBaselineCreated: true,
        maxFillObservationLagMs: 1_000,
      }],
    });
    expect(db.query(
      "SELECT reservation_id AS reservationId FROM provider_order_lifecycle WHERE provider_order_id = 'provider-1'",
    ).get()).toEqual({ reservationId: 1 });
    const replay = await syncKalshiProviderLifecycle(db, dependencies);
    expect(replay.accounts[0]?.settlementsApplied).toBe(0);
    expect(db.query("SELECT COUNT(*) AS count FROM provider_order_settlements").get())
      .toEqual({ count: 1 });
    expect(db.query("SELECT COUNT(*) AS count FROM provider_accounting_observations").get())
      .toEqual({ count: 2 });
    providerBalance = 9_990;
    const drifted = await syncKalshiProviderLifecycle(db, dependencies);
    expect(drifted.accountsWithDrift).toBe(1);
    expect(drifted.accounts[0]?.cashDriftMinor).toBe(-10);
    expect(db.query("SELECT COUNT(*) AS count FROM provider_lifecycle_sync_runs").get())
      .toEqual({ count: 3 });
    db.close();
  });

  test("does not mutate lifecycle state when any cursor chain is incomplete", async () => {
    const db = setup();
    const result = await syncKalshiProviderLifecycle(db, {
      maxPagesPerFeed: 1,
      resolveClient: () => ({
        environment: "demo",
        getLifecyclePage: () => Promise.resolve({ items: [], cursor: "more" }),
        getSettlementPage: () => Promise.resolve({ items: [], cursor: "" }),
        getPositionsPage: () => Promise.resolve({ items: [], cursor: "" }),
        getBalance: () => Promise.resolve({ balanceCents: 10_000 }),
      }),
    });
    expect(result.failedAccounts).toBe(1);
    expect(result.accounts[0]?.error).toContain("incomplete");
    expect(db.query("SELECT COUNT(*) AS count FROM provider_order_lifecycle").get())
      .toEqual({ count: 0 });
    expect(db.query("SELECT status FROM provider_lifecycle_sync_runs").get())
      .toEqual({ status: "failed" });
    db.close();
  });

  test("confirms an ambiguous cancellation only from exact cancelled lifecycle evidence", async () => {
    const db = setup();
    db.exec(`
      INSERT INTO authorized_cancellations (
        idempotency_key, reservation_id, ticket_id, partner_code, out_id, skin,
        authorization_id, actor_id, status, created_at_ms, updated_at_ms
      ) VALUES (
        'cancel-sync', 1, 'provider-1', 'SPORTS', 'out-SPORTS-1', 'main',
        1, 'operator-1', 'unknown', ${NOW - 1000}, ${NOW - 1000}
      )
    `);
    const clientOrderId = executionIdempotencyKeyToUuid("sync-key");
    const result = await syncKalshiProviderLifecycle(db, {
      now: () => NOW,
      resolveClient: () => ({
        environment: "demo",
        getLifecyclePage: (feed, source) => Promise.resolve({
          items: feed === "orders" && source === "active"
            ? [{ ...order("provider-1", clientOrderId), status: "cancelled", fill_count: 4, remaining_count: 0 }]
            : feed === "fills" && source === "active" ? [fill("provider-1", 4)] : [],
          cursor: "",
        }),
        getSettlementPage: () => Promise.resolve({ items: [], cursor: "" }),
        getPositionsPage: () => Promise.resolve({
          items: [{ ticker: "KXTEST", position_fp: "4.00" }], cursor: "",
        }),
        getBalance: () => Promise.resolve({ balanceCents: 10_000 }),
      }),
    });
    expect(result.accounts[0]?.unknownCancellationsConfirmed).toBe(1);
    expect(db.query("SELECT status FROM authorized_cancellations WHERE reservation_id = 1").get())
      .toEqual({ status: "confirmed" });
    expect(db.query(
      "SELECT COUNT(*) AS count FROM account_authorization_receipt_outbox WHERE dedupe_key LIKE '%reconciled-confirmed'",
    ).get()).toEqual({ count: 1 });
    db.close();
  });
});

function setup(): Database {
  const db = new Database(":memory:");
  migrateExecutionSchema(db, NOW);
  ensurePartnerRegistrySchema(db);
  upsertPartner(db, {
    id: "partner-sports",
    name: "Sports",
    profitSplit: 0.5,
    commissionRate: null,
    notes: null,
  }, NOW);
  upsertBettingAccount(db, {
    id: "out-SPORTS-1",
    partnerId: "partner-sports",
    provider: "kalshi",
    url: "",
    status: "active",
    envPrefix: null,
    maxStake: 100,
    maxWin: 100,
    currency: "USD",
    skin: null,
    metaJson: "{}",
  }, NOW);
  db.exec(`
    INSERT INTO account_authorization_requests (
      partner_code, out_id, provider, skin, permission_scope,
      requested_max_stake, requested_max_win, max_win_basis, currency,
      valid_from_ms, request_hash, telegram_chat_id, telegram_message_id,
      status, created_at_ms, updated_at_ms
    ) VALUES (
      'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade', 1000, 1000,
      'profit', 'USD', 1, '${"0".repeat(64)}', '-1', '1', 'approved', ${NOW}, ${NOW}
    );
    INSERT INTO account_authorizations (
      request_id, partner_code, out_id, provider, skin, permission_scope,
      approved_max_stake, approved_max_win, max_win_basis, currency,
      valid_from_ms, approval_hash, telegram_chat_id, telegram_message_id,
      telegram_approving_user_id, created_at_ms, updated_at_ms
    ) VALUES (
      1, 'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade', 1000, 1000,
      'profit', 'USD', 1, '${"0".repeat(64)}', '-1', '2', '3', ${NOW}, ${NOW}
    );
    INSERT INTO exposure_reservations (
      idempotency_key, partner_code, out_id, skin, provider, authorization_id,
      requested_stake, effective_stake, market_id, selection, decimal_odds,
      status, reservation_expires_at_ms, placement_owner, ticket_id,
      created_at_ms, updated_at_ms
    ) VALUES (
      'sync-key', 'SPORTS', 'out-SPORTS-1', 'main', 'kalshi', 1, 400, 400,
      'KXTEST', 'yes', 2.5, 'confirmed', ${NOW + 60_000}, 'owner', 'provider-1',
      ${NOW}, ${NOW}
    );
  `);
  appendReservationJournalEntry(db, {
    partnerCode: "SPORTS",
    outId: "out-SPORTS-1",
    skin: "main",
    provider: "kalshi",
    currency: "USD",
    reservationId: asExposureReservationId(1),
    providerOrderId: null,
    sourceKey: "reservation:1",
    exposureMinor: 400,
    createdAtMs: NOW,
  });
  return db;
}

function order(orderId: string, clientOrderId: string): Record<string, unknown> {
  return {
    order_id: orderId,
    client_order_id: clientOrderId,
    ticker: "KXTEST",
    side: "yes",
    action: "buy",
    initial_count: 10,
    fill_count: orderId === "provider-1" ? 10 : 0,
    remaining_count: orderId === "provider-1" ? 0 : 10,
    yes_price: 40,
    status: orderId === "provider-1" ? "executed" : "resting",
    last_update_time: new Date(NOW - 1_000).toISOString(),
  };
}

function fill(orderId: string, count = 10): Record<string, unknown> {
  return {
    fill_id: "fill-1",
    order_id: orderId,
    ticker: "KXTEST",
    side: "yes",
    action: "buy",
    count,
    yes_price: 40,
    created_time: new Date(NOW - 1_000).toISOString(),
  };
}
