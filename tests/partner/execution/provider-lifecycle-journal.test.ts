import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { asExposureReservationId } from "../../../src/partner/execution/domain.ts";
import { appendReservationJournalEntry } from "../../../src/partner/execution/execution-journal.ts";
import {
  ingestProviderLifecycleAccountWithJournal,
  ingestProviderLifecycleWithJournal,
  settleProviderLifecycleWithJournal,
} from "../../../src/partner/execution/provider-lifecycle-journal.ts";
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
} from "../../../src/partner/registry.ts";
import type { ProviderLifecycleBatch } from "../../../src/partner/execution/provider-lifecycle.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const NOW = 1_700_000_000_000;
const CONTEXT = {
  partnerCode: "SPORTS",
  skin: "main",
  currency: "USD",
  partnerSplitBps: 5_000,
};

describe("provider lifecycle journal projection service", () => {
  test("deduplicates ingestion and projects partial cancel through settlement", () => {
    const db = new Database(":memory:");
    migrateExecutionSchema(db, NOW);
    seedReservation(db);
    const first = ingestProviderLifecycleWithJournal(db, batch(), CONTEXT);
    expect(first.journalEntriesAppended).toBe(3);
    expect(first.projection).toMatchObject({
      cashDeltaMinor: -164,
      openExposureMinor: 400,
      realizedPnlMinor: -4,
      feesMinor: 4,
      partnerSplitMinor: -2,
    });

    const duplicate = ingestProviderLifecycleWithJournal(
      db,
      { ...batch(), observedAtMs: NOW + 1 },
      CONTEXT,
    );
    expect(duplicate.journalEntriesAppended).toBe(0);
    expect(duplicate.projection).toEqual(first.projection);

    const cancelled = ingestProviderLifecycleWithJournal(db, batch({
      observedAtMs: NOW + 2,
      orders: [{ ...batch().orders[0]!, status: "cancelled", remainingQuantity: 0 }],
    }), CONTEXT);
    expect(cancelled.projection).toMatchObject({
      cashDeltaMinor: -164,
      openExposureMinor: 160,
      realizedPnlMinor: -4,
      feesMinor: 4,
    });

    const settled = settleProviderLifecycleWithJournal(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "market:KXTEST:yes",
      settledQuantity: 4,
      marketResult: "yes",
      evidenceAtMs: NOW + 3,
    }, CONTEXT);
    expect(settled.journalCreated).toBeTrue();
    expect(settled.projection).toMatchObject({
      cashDeltaMinor: 236,
      openExposureMinor: 0,
      realizedPnlMinor: 236,
      feesMinor: 4,
      partnerSplitMinor: 118,
    });
    expect(settleProviderLifecycleWithJournal(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "market:KXTEST:yes",
      settledQuantity: 4,
      marketResult: "yes",
      evidenceAtMs: NOW + 3,
    }, CONTEXT).journalCreated).toBeFalse();
    expect(() => settleProviderLifecycleWithJournal(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "market:KXTEST:yes",
      settledQuantity: 4,
      marketResult: "no",
      evidenceAtMs: NOW + 3,
    }, CONTEXT)).toThrow(/source key.*different terms/);
    expect(db.query("SELECT COUNT(*) AS count FROM execution_journal_entries").get())
      .toEqual({ count: 6 });
    db.close();
  });

  test("records unlinked account orders without attributing them to an authorized ledger", () => {
    const db = new Database(":memory:");
    migrateExecutionSchema(db, NOW);
    const result = ingestProviderLifecycleWithJournal(
      db,
      batch({
        orders: [{ ...batch().orders[0]!, reservationId: null }],
      }),
      CONTEXT,
    );
    expect(result.ingest.ordersInserted).toBe(1);
    expect(result.journalEntriesAppended).toBe(0);
    expect(db.query("SELECT COUNT(*) AS count FROM execution_journal_entries").get())
      .toEqual({ count: 0 });
    db.close();
  });

  test("derives independent journal lanes for multiple skins on one provider account", () => {
    const db = new Database(":memory:");
    migrateExecutionSchema(db, NOW);
    ensurePartnerRegistrySchema(db);
    upsertPartner(db, {
      id: "partner-sports",
      name: "Sports",
      profitSplit: 0.25,
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
    seedReservation(db);
    seedSecondSkinReservation(db);
    db.exec("UPDATE exposure_reservations SET partner_split_bps = 2500");
    db.exec("UPDATE partners SET profit_split = 0.9 WHERE id = 'partner-sports'");
    const secondOrder = {
      ...batch().orders[0]!,
      providerOrderId: "order-2",
      clientOrderId: "client-2",
      reservationId: asExposureReservationId(2),
      filledQuantity: 10,
      remainingQuantity: 0,
      status: "executed" as const,
    };
    const secondFill = {
      ...batch().fills[0]!,
      sourceKey: "fill:fill-2",
      providerOrderId: "order-2",
      quantity: 10,
      feeMinor: 0,
    };
    const result = ingestProviderLifecycleAccountWithJournal(db, batch({
      orders: [batch().orders[0]!, secondOrder],
      fills: [batch().fills[0]!, secondFill],
    }));
    expect(result.linkedOrders).toBe(2);
    expect(result.orphanOrders).toBe(0);
    expect(db.query(
      `SELECT skin, COUNT(*) AS count FROM execution_journal_entries
       GROUP BY skin ORDER BY skin`,
    ).all()).toEqual([
      { skin: "dark", count: 3 },
      { skin: "main", count: 4 },
    ]);
    expect(db.query(
      `SELECT COALESCE(SUM(partner_split_delta_minor), 0) AS split
         FROM execution_journal_entries WHERE skin = 'main'`,
    ).get()).toEqual({ split: -1 });
    db.close();
  });
});

function batch(overrides: Partial<ProviderLifecycleBatch> = {}): ProviderLifecycleBatch {
  return {
    provider: "kalshi",
    outId: "out-SPORTS-1",
    environment: "demo",
    observedAtMs: NOW,
    ordersCursorComplete: true,
    fillsCursorComplete: true,
    orders: [{
      providerOrderId: "order-1",
      clientOrderId: "client-1",
      reservationId: asExposureReservationId(1),
      ticker: "KXTEST",
      side: "yes",
      action: "buy",
      unitPriceMinor: 40,
      orderedQuantity: 10,
      filledQuantity: 4,
      remainingQuantity: 6,
      status: "working",
      providerUpdatedAtMs: NOW,
    }],
    fills: [{
      sourceKey: "fill:fill-1",
      providerOrderId: "order-1",
      ticker: "KXTEST",
      side: "yes",
      action: "buy",
      quantity: 4,
      unitPriceMinor: 40,
      feeMinor: 4,
      providerCreatedAtMs: NOW,
    }],
    ...overrides,
  };
}

function seedReservation(db: Database): void {
  db.exec(`
    INSERT INTO account_authorization_requests (
      partner_code, out_id, provider, skin, permission_scope,
      requested_max_stake, requested_max_win, max_win_basis,
      currency, valid_from_ms, request_hash, telegram_chat_id,
      telegram_message_id, status, created_at_ms, updated_at_ms
    ) VALUES (
      'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade',
      400, 1000, 'profit', 'USD', 1, '${"0".repeat(64)}', '-123',
      '1', 'approved', ${NOW}, ${NOW}
    );
    INSERT INTO account_authorizations (
      request_id, partner_code, out_id, provider, skin, permission_scope,
      approved_max_stake, approved_max_win, max_win_basis, currency,
      valid_from_ms, approval_hash, telegram_chat_id, telegram_message_id,
      telegram_approving_user_id, created_at_ms, updated_at_ms
    ) VALUES (
      1, 'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade',
      400, 1000, 'profit', 'USD', 1, '${"0".repeat(64)}', '-123', '2',
      '789', ${NOW}, ${NOW}
    );
    INSERT INTO exposure_reservations (
      idempotency_key, partner_code, out_id, skin, provider, authorization_id,
      requested_stake, effective_stake, market_id, selection, decimal_odds,
      status, reservation_expires_at_ms, placement_owner, ticket_id,
      created_at_ms, updated_at_ms
    ) VALUES (
      'journal-test', 'SPORTS', 'out-SPORTS-1', 'main', 'kalshi', 1,
      400, 400, 'KXTEST', 'yes', 2.5, 'confirmed', ${NOW + 60_000},
      'owner', 'order-1', ${NOW}, ${NOW}
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
}

function seedSecondSkinReservation(db: Database): void {
  db.exec(`
    INSERT INTO account_authorization_requests (
      partner_code, out_id, provider, skin, permission_scope,
      requested_max_stake, requested_max_win, max_win_basis,
      currency, valid_from_ms, request_hash, telegram_chat_id,
      telegram_message_id, status, created_at_ms, updated_at_ms
    ) VALUES (
      'SPORTS', 'out-SPORTS-1', 'kalshi', 'dark', 'live_trade',
      400, 1000, 'profit', 'USD', 1, '${"0".repeat(64)}', '-123',
      '3', 'approved', ${NOW}, ${NOW}
    );
    INSERT INTO account_authorizations (
      request_id, partner_code, out_id, provider, skin, permission_scope,
      approved_max_stake, approved_max_win, max_win_basis, currency,
      valid_from_ms, approval_hash, telegram_chat_id, telegram_message_id,
      telegram_approving_user_id, created_at_ms, updated_at_ms
    ) VALUES (
      2, 'SPORTS', 'out-SPORTS-1', 'kalshi', 'dark', 'live_trade',
      400, 1000, 'profit', 'USD', 1, '${"0".repeat(64)}', '-123', '4',
      '789', ${NOW}, ${NOW}
    );
    INSERT INTO exposure_reservations (
      idempotency_key, partner_code, out_id, skin, provider, authorization_id,
      requested_stake, effective_stake, market_id, selection, decimal_odds,
      status, reservation_expires_at_ms, placement_owner, ticket_id,
      created_at_ms, updated_at_ms
    ) VALUES (
      'journal-test-dark', 'SPORTS', 'out-SPORTS-1', 'dark', 'kalshi', 2,
      400, 400, 'KXTEST', 'yes', 2.5, 'confirmed', ${NOW + 60_000},
      'owner', 'order-2', ${NOW}, ${NOW}
    );
  `);
  appendReservationJournalEntry(db, {
    partnerCode: "SPORTS",
    outId: "out-SPORTS-1",
    skin: "dark",
    provider: "kalshi",
    currency: "USD",
    reservationId: asExposureReservationId(2),
    providerOrderId: null,
    sourceKey: "reservation:2",
    exposureMinor: 400,
    createdAtMs: NOW,
  });
}
