import type { Database } from "bun:sqlite";
import {
  appendBinaryFillJournalEntries,
  appendBinarySettlementJournalEntry,
  appendCancellationJournalEntry,
  appendExecutionJournalEntry,
  appendOrderJournalEntry,
  getExecutionJournalEntryBySourceKey,
  projectExecutionJournal,
  type ExecutionJournalIdentity,
  type ExecutionJournalProjection,
} from "./execution-journal.ts";
import {
  applyProviderLifecycleBatchInTransaction,
  applyProviderOrderSettlementInTransaction,
  getProviderOrderFillTotals,
  getProviderOrderLifecycle,
  type ProviderLifecycleBatch,
  type ProviderLifecycleIngestResult,
  type ProviderLifecycleSide,
  type ProviderOrderLifecycle,
} from "./provider-lifecycle.ts";

export interface ProviderLifecycleJournalContext {
  partnerCode: string;
  skin: string;
  currency: string;
  partnerSplitBps: number;
}

export interface ProviderLifecycleJournalResult {
  ingest: ProviderLifecycleIngestResult;
  journalEntriesAppended: number;
  projection: ExecutionJournalProjection;
}

/** Atomically persist a complete lifecycle batch and its immutable journal deltas. */
export function ingestProviderLifecycleWithJournal(
  db: Database,
  batch: ProviderLifecycleBatch,
  context: ProviderLifecycleJournalContext,
): ProviderLifecycleJournalResult {
  validateContext(context);
  const transaction = db.transaction(() => {
    const before = new Map<string, ProviderOrderLifecycle | null>();
    for (const order of batch.orders) {
      before.set(
        order.providerOrderId,
        getProviderOrderLifecycle(db, batch.provider, batch.outId, order.providerOrderId),
      );
    }
    const ingest = applyProviderLifecycleBatchInTransaction(db, batch);
    let journalEntriesAppended = 0;
    for (const snapshot of batch.orders) {
      const order = getProviderOrderLifecycle(
        db,
        batch.provider,
        batch.outId,
        snapshot.providerOrderId,
      );
      if (order === null) throw new Error("provider lifecycle order disappeared during ingestion");
      if (order.reservationId === null) continue;
      assertReservationContext(db, batch, context, order);
      const identity = journalIdentity(batch, context, order);
      const orderSource = lifecycleSource(batch, order.providerOrderId, "order");
      const orderResult = appendOrderJournalEntry(db, {
        ...identity,
        sourceKey: orderSource,
        orderedQuantity: order.orderedQuantity,
        unitPriceMinor: order.unitPriceMinor,
        createdAtMs: order.firstObservedAtMs,
      });
      if (orderResult.created) journalEntriesAppended++;
      journalEntriesAppended += appendReservationBindingAdjustment(db, identity, order);
      const priorCancelled = before.get(order.providerOrderId)?.cancelledQuantity ?? 0;
      if (order.cancelledQuantity > priorCancelled) {
        const cancelledDelta = order.cancelledQuantity - priorCancelled;
        const sourceKey = lifecycleSource(
          batch,
          order.providerOrderId,
          `cancel:${order.cancelledQuantity}`,
        );
        if (getExecutionJournalEntryBySourceKey(db, sourceKey) === null) {
          appendCancellationJournalEntry(db, {
            ...identity,
            sourceKey,
            cancelledQuantity: cancelledDelta,
            unitPriceMinor: order.unitPriceMinor,
            createdAtMs: batch.observedAtMs,
          });
          journalEntriesAppended++;
        }
      } else if (order.cancelledQuantity < priorCancelled) {
        const restored = safeProduct(
          priorCancelled - order.cancelledQuantity,
          order.unitPriceMinor,
        );
        const sourceKey = lifecycleSource(
          batch,
          order.providerOrderId,
          `cancel-correction:${order.cancelledQuantity}`,
        );
        if (getExecutionJournalEntryBySourceKey(db, sourceKey) === null) {
          appendExecutionJournalEntry(db, {
            ...identity,
            sourceKey,
            kind: "adjustment",
            cashDeltaMinor: 0,
            openExposureDeltaMinor: restored,
            realizedPnlDeltaMinor: 0,
            feeDeltaMinor: 0,
            partnerSplitDeltaMinor: 0,
            metadata: { priorCancelled, correctedCancelled: order.cancelledQuantity },
            createdAtMs: batch.observedAtMs,
          });
          journalEntriesAppended++;
        }
      }
    }
    for (const fill of batch.fills) {
      const order = getProviderOrderLifecycle(db, batch.provider, batch.outId, fill.providerOrderId);
      if (order === null) throw new Error("provider fill order disappeared during ingestion");
      if (order.reservationId === null) continue;
      assertReservationContext(db, batch, context, order);
      const baseSource = lifecycleSource(batch, fill.providerOrderId, fill.sourceKey);
      if (getExecutionJournalEntryBySourceKey(db, `${baseSource}:principal`) !== null) continue;
      appendBinaryFillJournalEntries(db, {
        ...journalIdentity(batch, context, order),
        fillSourceKey: baseSource,
        quantity: fill.quantity,
        unitPriceMinor: fill.unitPriceMinor,
        feeMinor: fill.feeMinor ?? 0,
        partnerSplitBps: context.partnerSplitBps,
        createdAtMs: fill.providerCreatedAtMs ?? 0,
      });
      journalEntriesAppended += fill.feeMinor ? 2 : 1;
    }
    return {
      ingest,
      journalEntriesAppended,
      projection: projection(db, batch, context),
    };
  });
  return transaction.immediate();
}

/** Provider-positive settlement updates lifecycle and journal in one transaction. */
export function settleProviderLifecycleWithJournal(
  db: Database,
  input: {
    provider: string;
    outId: string;
    providerOrderId: string;
    evidenceKey: string;
    settledQuantity: number;
    marketResult: ProviderLifecycleSide;
    evidenceAtMs: number;
  },
  context: ProviderLifecycleJournalContext,
): { order: ProviderOrderLifecycle; projection: ExecutionJournalProjection; journalCreated: boolean } {
  validateContext(context);
  const transaction = db.transaction(() => {
    const before = getProviderOrderLifecycle(db, input.provider, input.outId, input.providerOrderId);
    if (before === null) throw new Error("provider lifecycle order not found");
    const totals = getProviderOrderFillTotals(db, input.provider, input.outId, input.providerOrderId);
    if (totals.quantity !== input.settledQuantity || totals.quantity !== before.filledQuantity) {
      throw new Error("settlement requires cursor-complete fills for the entire provider order");
    }
    const order = applyProviderOrderSettlementInTransaction(db, {
      provider: input.provider,
      outId: input.outId,
      providerOrderId: input.providerOrderId,
      evidenceKey: input.evidenceKey,
      settledQuantity: input.settledQuantity,
      observedAtMs: input.evidenceAtMs,
    });
    const batchIdentity = {
      provider: input.provider,
      outId: input.outId,
      environment: order.environment,
    };
    const sourceKey = lifecycleSource(batchIdentity, order.providerOrderId, `settle:${input.evidenceKey}`);
    const journalCreated = appendBinarySettlementJournalEntry(db, {
      ...journalIdentity(batchIdentity, context, order),
      sourceKey,
      quantity: input.settledQuantity,
      unitPriceMinor: order.unitPriceMinor,
      costBasisMinor: totals.costMinor,
      exposureMinor: safeProduct(input.settledQuantity, order.unitPriceMinor),
      side: order.side,
      marketResult: input.marketResult,
      partnerSplitBps: context.partnerSplitBps,
      createdAtMs: input.evidenceAtMs,
    }).created;
    return {
      order,
      journalCreated,
      projection: projectExecutionJournal(db, {
        partnerCode: context.partnerCode,
        outId: input.outId,
        skin: context.skin,
        currency: context.currency,
      }),
    };
  });
  return transaction.immediate();
}

function appendReservationBindingAdjustment(
  db: Database,
  identity: ExecutionJournalIdentity,
  order: ProviderOrderLifecycle,
): number {
  if (order.reservationId === null) return 0;
  const reservation = db.query(
    "SELECT effective_stake AS effectiveStake FROM exposure_reservations WHERE id = $id",
  ).get({ $id: order.reservationId }) as { effectiveStake: number } | null;
  if (reservation === null) throw new Error("provider order reservation no longer exists");
  const providerExposure = safeProduct(order.orderedQuantity, order.unitPriceMinor);
  const delta = providerExposure - reservation.effectiveStake;
  if (delta === 0) return 0;
  const sourceKey = `reservation:${order.reservationId}:provider-binding`;
  if (getExecutionJournalEntryBySourceKey(db, sourceKey) !== null) return 0;
  appendExecutionJournalEntry(db, {
    ...identity,
    sourceKey,
    kind: "adjustment",
    cashDeltaMinor: 0,
    openExposureDeltaMinor: delta,
    realizedPnlDeltaMinor: 0,
    feeDeltaMinor: 0,
    partnerSplitDeltaMinor: 0,
    metadata: { reservationExposure: reservation.effectiveStake, providerExposure },
    createdAtMs: order.firstObservedAtMs,
  });
  return 1;
}

function assertReservationContext(
  db: Database,
  batch: { outId: string },
  context: ProviderLifecycleJournalContext,
  order: ProviderOrderLifecycle,
): void {
  if (order.reservationId === null) return;
  const lane = db.query(
    `SELECT r.partner_code AS partnerCode, r.out_id AS outId, r.skin,
            a.currency
       FROM exposure_reservations r
       JOIN account_authorizations a ON a.id = r.authorization_id
      WHERE r.id = $id`,
  ).get({ $id: order.reservationId }) as {
    partnerCode: string; outId: string; skin: string; currency: string;
  } | null;
  if (lane === null) throw new Error("provider order reservation no longer exists");
  if (lane.partnerCode !== context.partnerCode || lane.outId !== batch.outId ||
      lane.skin !== context.skin || lane.currency !== context.currency) {
    throw new Error("provider lifecycle journal context does not match the reservation lane");
  }
}

function journalIdentity(
  batch: { provider: string; outId: string },
  context: ProviderLifecycleJournalContext,
  order: ProviderOrderLifecycle,
): ExecutionJournalIdentity {
  return {
    partnerCode: context.partnerCode,
    outId: batch.outId,
    skin: context.skin,
    provider: batch.provider,
    currency: context.currency,
    reservationId: order.reservationId,
    providerOrderId: order.providerOrderId,
  };
}

function projection(
  db: Database,
  batch: { outId: string },
  context: ProviderLifecycleJournalContext,
) {
  return projectExecutionJournal(db, {
    partnerCode: context.partnerCode,
    outId: batch.outId,
    skin: context.skin,
    currency: context.currency,
  });
}

function lifecycleSource(
  batch: { provider: string; outId: string; environment: string },
  orderId: string,
  event: string,
): string {
  const plain = `lifecycle:${batch.provider}:${batch.environment}:${batch.outId}:${orderId}:${event}`;
  if (plain.length <= 480) return plain;
  const digest = new Bun.CryptoHasher("sha256").update(plain).digest("hex");
  return `lifecycle:sha256:${digest}`;
}

function safeProduct(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("lifecycle journal amount overflow");
  return value;
}

function validateContext(context: ProviderLifecycleJournalContext): void {
  for (const [label, value] of [
    ["partner code", context.partnerCode],
    ["skin", context.skin],
    ["currency", context.currency],
  ] as const) {
    if (!value.trim() || /\p{Cc}/u.test(value)) throw new TypeError(`${label} is invalid`);
  }
  if (!Number.isSafeInteger(context.partnerSplitBps) ||
      context.partnerSplitBps < 0 || context.partnerSplitBps > 10_000) {
    throw new TypeError("partner split basis points must be from 0 to 10000");
  }
}
