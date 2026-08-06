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

/**
 * Persist an account-wide provider snapshot and derive each linked order's
 * journal lane from its immutable reservation. This is the operational entry
 * point for accounts that expose more than one skin.
 */
export function ingestProviderLifecycleAccountWithJournal(
  db: Database,
  batch: ProviderLifecycleBatch,
): ProviderLifecycleJournalResult & { linkedOrders: number; orphanOrders: number } {
  const linkedOrders = batch.orders.filter((order) => order.reservationId !== null).length;
  const orphanOrders = batch.orders.length - linkedOrders;
  const result = ingestWithContextResolver(db, batch, (order) => {
    if (order.reservationId === null) return null;
    return reservationJournalContext(db, batch, order);
  });
  return { ...result, linkedOrders, orphanOrders };
}

/** Atomically persist a complete lifecycle batch and its immutable journal deltas. */
export function ingestProviderLifecycleWithJournal(
  db: Database,
  batch: ProviderLifecycleBatch,
  context: ProviderLifecycleJournalContext,
): ProviderLifecycleJournalResult {
  validateContext(context);
  const result = ingestWithContextResolver(db, batch, (order) => {
    if (order.reservationId === null) return null;
    assertReservationContext(db, batch, context, order);
    return context;
  });
  return { ...result, projection: projection(db, batch, context) };
}

function ingestWithContextResolver(
  db: Database,
  batch: ProviderLifecycleBatch,
  resolveContext: (order: ProviderOrderLifecycle) => ProviderLifecycleJournalContext | null,
): ProviderLifecycleJournalResult {
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
      const context = resolveContext(order);
      if (context === null) throw new Error("linked provider lifecycle order has no journal context");
      validateContext(context);
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
      const context = resolveContext(order);
      if (context === null) throw new Error("linked provider lifecycle fill has no journal context");
      validateContext(context);
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
      projection: aggregateAccountProjection(db, batch),
    };
  });
  return transaction.immediate();
}

function reservationJournalContext(
  db: Database,
  batch: { outId: string },
  order: ProviderOrderLifecycle,
): ProviderLifecycleJournalContext {
  if (order.reservationId === null) throw new Error("provider order has no reservation");
  const row = db.query(
    `SELECT r.partner_code AS partnerCode, r.out_id AS outId, r.skin,
            a.currency, r.partner_split_bps AS partnerSplitBps
       FROM exposure_reservations r
       JOIN account_authorizations a ON a.id = r.authorization_id
      WHERE r.id = $id`,
  ).get({ $id: order.reservationId }) as {
    partnerCode: string;
    outId: string;
    skin: string;
    currency: string;
    partnerSplitBps: number;
  } | null;
  if (row === null) throw new Error("provider order reservation no longer exists");
  if (row.outId !== batch.outId) throw new Error("provider lifecycle out does not match reservation");
  return {
    partnerCode: row.partnerCode,
    skin: row.skin,
    currency: row.currency,
    partnerSplitBps: row.partnerSplitBps,
  };
}

function aggregateAccountProjection(
  db: Database,
  batch: { provider: string; outId: string },
): ExecutionJournalProjection {
  const row = db.query(
    `SELECT COUNT(*) AS entryCount,
            COALESCE(SUM(cash_delta_minor), 0) AS cashDeltaMinor,
            COALESCE(SUM(open_exposure_delta_minor), 0) AS openExposureMinor,
            COALESCE(SUM(realized_pnl_delta_minor), 0) AS realizedPnlMinor,
            COALESCE(SUM(fee_delta_minor), 0) AS feesMinor,
            COALESCE(SUM(partner_split_delta_minor), 0) AS partnerSplitMinor
       FROM execution_journal_entries
      WHERE provider = $provider AND out_id = $outId`,
  ).get({ $provider: batch.provider, $outId: batch.outId }) as Omit<
    ExecutionJournalProjection,
    "partnerCode" | "outId" | "skin" | "currency"
  >;
  return {
    partnerCode: "*",
    outId: batch.outId,
    skin: "*",
    currency: "*",
    ...row,
  };
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

/** Settle one linked account order using its reservation-snapshotted journal lane. */
export function settleProviderLifecycleAccountOrderWithJournal(
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
): ReturnType<typeof settleProviderLifecycleWithJournal> {
  const order = getProviderOrderLifecycle(db, input.provider, input.outId, input.providerOrderId);
  if (order === null) throw new Error("provider lifecycle order not found");
  if (order.reservationId === null) throw new Error("unlinked provider order cannot enter partner settlement journal");
  const context = reservationJournalContext(db, { outId: input.outId }, order);
  return settleProviderLifecycleWithJournal(db, input, context);
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
