import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  appendBinaryFillJournalEntries,
  appendBinarySettlementJournalEntry,
  appendCancellationJournalEntry,
  appendExecutionJournalEntry,
  appendExecutionJournalReversal,
  appendOrderJournalEntry,
  appendReservationJournalEntry,
  computeProviderJournalDrift,
  listExecutionJournalProjections,
  projectExecutionJournal,
  type ExecutionJournalIdentity,
} from "../../../src/partner/execution/execution-journal.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const NOW = 1_700_000_000_000;

describe("immutable execution journal", () => {
  for (const side of ["yes", "no"] as const) {
    for (const won of [true, false]) {
      test(`${side.toUpperCase()} ${won ? "win" : "loss"} has exact cash, P&L, fees, and split`, () => {
        const db = setup();
        const id = identity(`${side}-${won ? "win" : "loss"}`);
        appendReservationJournalEntry(db, {
          ...id,
          sourceKey: `${id.providerOrderId}:reservation`,
          exposureMinor: 80,
          createdAtMs: NOW,
        });
        appendOrderJournalEntry(db, {
          ...id,
          sourceKey: `${id.providerOrderId}:order`,
          orderedQuantity: 2,
          unitPriceMinor: 40,
          createdAtMs: NOW + 1,
        });
        appendBinaryFillJournalEntries(db, {
          ...id,
          fillSourceKey: `${id.providerOrderId}:fill-1`,
          quantity: 2,
          unitPriceMinor: 40,
          feeMinor: 2,
          partnerSplitBps: 5_000,
          createdAtMs: NOW + 2,
        });
        appendBinarySettlementJournalEntry(db, {
          ...id,
          sourceKey: `${id.providerOrderId}:settlement`,
          quantity: 2,
          unitPriceMinor: 40,
          side,
          marketResult: won ? side : side === "yes" ? "no" : "yes",
          partnerSplitBps: 5_000,
          createdAtMs: NOW + 3,
        });
        expect(projection(db)).toEqual({
          partnerCode: "SPORTS",
          outId: "out-SPORTS-1",
          skin: "main",
          currency: "USD",
          cashDeltaMinor: won ? 118 : -82,
          openExposureMinor: 0,
          realizedPnlMinor: won ? 118 : -82,
          feesMinor: 2,
          partnerSplitMinor: won ? 59 : -41,
          entryCount: 5,
        });
        db.close();
      });
    }
  }

  test("partial fills, fees, cancellation, and settlement project once", () => {
    const db = setup();
    const id = identity("partial");
    appendReservationJournalEntry(db, {
      ...id,
      sourceKey: "partial:reservation",
      exposureMinor: 400,
      createdAtMs: NOW,
    });
    const fillInput = {
      ...id,
      fillSourceKey: "fill:partial-1",
      quantity: 4,
      unitPriceMinor: 40,
      feeMinor: 4,
      partnerSplitBps: 5_000,
      createdAtMs: NOW + 1,
    };
    appendBinaryFillJournalEntries(db, fillInput);
    appendCancellationJournalEntry(db, {
      ...id,
      sourceKey: "partial:cancel",
      cancelledQuantity: 6,
      unitPriceMinor: 40,
      createdAtMs: NOW + 2,
    });
    expect(projection(db)).toMatchObject({
      cashDeltaMinor: -164,
      openExposureMinor: 160,
      realizedPnlMinor: -4,
      feesMinor: 4,
      partnerSplitMinor: -2,
    });

    expect(appendBinaryFillJournalEntries(db, fillInput).fill.sourceKey).toBe("fill:partial-1:principal");
    const settlementInput = {
      ...id,
      sourceKey: "partial:settlement",
      quantity: 4,
      unitPriceMinor: 40,
      side: "yes" as const,
      marketResult: "yes" as const,
      partnerSplitBps: 5_000,
      createdAtMs: NOW + 3,
    };
    expect(appendBinarySettlementJournalEntry(db, settlementInput).created).toBeTrue();
    expect(appendBinarySettlementJournalEntry(db, settlementInput).created).toBeFalse();
    expect(projection(db)).toMatchObject({
      cashDeltaMinor: 236,
      openExposureMinor: 0,
      realizedPnlMinor: 236,
      feesMinor: 4,
      partnerSplitMinor: 118,
      entryCount: 5,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM execution_journal_entries").get())
      .toEqual({ count: 5 });
    db.close();
  });

  test("reversals append the exact inverse without mutating the original", () => {
    const db = setup();
    const original = appendExecutionJournalEntry(db, {
      ...identity("adjustment"),
      sourceKey: "adjustment:1",
      kind: "adjustment",
      cashDeltaMinor: 10,
      openExposureDeltaMinor: 3,
      realizedPnlDeltaMinor: 10,
      feeDeltaMinor: 0,
      partnerSplitDeltaMinor: 5,
      metadata: { reason: "provider correction" },
      createdAtMs: NOW,
    }).entry;
    const reversalInput = {
      sourceKey: "reversal:adjustment:1",
      entryId: original.id,
      reason: "correction withdrawn",
      createdAtMs: NOW + 1,
    };
    expect(appendExecutionJournalReversal(db, reversalInput).created).toBeTrue();
    expect(appendExecutionJournalReversal(db, reversalInput).created).toBeFalse();
    expect(projection(db)).toMatchObject({
      cashDeltaMinor: 0,
      openExposureMinor: 0,
      realizedPnlMinor: 0,
      partnerSplitMinor: 0,
      entryCount: 2,
    });
    expect(db.query(
      "SELECT kind, cash_delta_minor AS cash FROM execution_journal_entries ORDER BY id",
    ).all()).toEqual([
      { kind: "adjustment", cash: 10 },
      { kind: "reversal", cash: -10 },
    ]);
    db.close();
  });

  test("source-key mutation is rejected and provider drift is explicit", () => {
    const db = setup();
    appendExecutionJournalEntry(db, {
      ...identity("drift"),
      sourceKey: "drift:adjustment",
      kind: "adjustment",
      cashDeltaMinor: 25,
      openExposureDeltaMinor: 40,
      realizedPnlDeltaMinor: 0,
      feeDeltaMinor: 0,
      partnerSplitDeltaMinor: 0,
      createdAtMs: NOW,
    });
    expect(() => appendExecutionJournalEntry(db, {
      ...identity("drift"),
      sourceKey: "drift:adjustment",
      kind: "adjustment",
      cashDeltaMinor: 26,
      openExposureDeltaMinor: 40,
      realizedPnlDeltaMinor: 0,
      feeDeltaMinor: 0,
      partnerSplitDeltaMinor: 0,
      createdAtMs: NOW,
    })).toThrow(/source key.*different terms/);
    expect(computeProviderJournalDrift({
      projection: projection(db),
      cashBaselineMinor: 1_000,
      providerCashMinor: 1_020,
      providerOpenExposureMinor: 43,
    })).toEqual({
      expectedCashMinor: 1_025,
      providerCashMinor: 1_020,
      cashDriftMinor: -5,
      expectedOpenExposureMinor: 40,
      providerOpenExposureMinor: 43,
      exposureDriftMinor: 3,
    });
    appendExecutionJournalEntry(db, {
      ...identity("other-skin"),
      skin: "alt",
      sourceKey: "other-skin:adjustment",
      kind: "adjustment",
      cashDeltaMinor: 7,
      openExposureDeltaMinor: 0,
      realizedPnlDeltaMinor: 7,
      feeDeltaMinor: 0,
      partnerSplitDeltaMinor: 3,
      createdAtMs: NOW + 1,
    });
    expect(listExecutionJournalProjections(db, { partnerCode: "SPORTS" }))
      .toMatchObject([
        { outId: "out-SPORTS-1", skin: "alt", cashDeltaMinor: 7, entryCount: 1 },
        { outId: "out-SPORTS-1", skin: "main", cashDeltaMinor: 25, entryCount: 1 },
      ]);
    db.close();
  });
});

function setup(): Database {
  const db = new Database(":memory:");
  migrateExecutionSchema(db, NOW);
  return db;
}

function identity(orderId: string): ExecutionJournalIdentity {
  return {
    partnerCode: "SPORTS",
    outId: "out-SPORTS-1",
    skin: "main",
    provider: "kalshi",
    currency: "USD",
    reservationId: null,
    providerOrderId: orderId,
  };
}

function projection(db: Database) {
  return projectExecutionJournal(db, {
    partnerCode: "SPORTS",
    outId: "out-SPORTS-1",
    skin: "main",
    currency: "USD",
  });
}
