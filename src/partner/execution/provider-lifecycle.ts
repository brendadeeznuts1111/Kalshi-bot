import type { Database } from "bun:sqlite";
import type { ExposureReservationId } from "./domain.ts";

export type ProviderLifecycleStatus = "working" | "executed" | "cancelled";
export type ProviderLifecycleSide = "yes" | "no";
export type ProviderLifecycleAction = "buy" | "sell";

export interface ProviderOrderSnapshot {
  providerOrderId: string;
  clientOrderId: string | null;
  reservationId: ExposureReservationId | null;
  ticker: string;
  side: ProviderLifecycleSide;
  action: ProviderLifecycleAction;
  /** Per-contract exposure cost in the account currency's minor units. */
  unitPriceMinor: number;
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  status: ProviderLifecycleStatus;
  providerUpdatedAtMs: number | null;
}

export interface ProviderFillSnapshot {
  /** Stable provider fill/trade identifier, namespaced by the adapter. */
  sourceKey: string;
  providerOrderId: string;
  ticker: string;
  side: ProviderLifecycleSide;
  action: ProviderLifecycleAction;
  quantity: number;
  unitPriceMinor: number;
  feeMinor: number | null;
  providerCreatedAtMs: number | null;
}

export interface ProviderLifecycleBatch {
  provider: string;
  outId: string;
  environment: string;
  observedAtMs: number;
  /** True only after every cursor page required for this account snapshot was read. */
  ordersCursorComplete: boolean;
  fillsCursorComplete: boolean;
  orders: ProviderOrderSnapshot[];
  fills: ProviderFillSnapshot[];
}

export interface ProviderLifecycleIngestResult {
  ordersInserted: number;
  ordersUpdated: number;
  ordersUnchanged: number;
  fillsInserted: number;
  fillsDuplicate: number;
}

export interface ProviderOrderLifecycle {
  id: number;
  provider: string;
  outId: string;
  environment: string;
  providerOrderId: string;
  clientOrderId: string | null;
  reservationId: ExposureReservationId | null;
  ticker: string;
  side: ProviderLifecycleSide;
  action: ProviderLifecycleAction;
  unitPriceMinor: number;
  orderedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  cancelledQuantity: number;
  settledQuantity: number;
  providerStatus: ProviderLifecycleStatus;
  providerUpdatedAtMs: number | null;
  firstObservedAtMs: number;
  lastObservedAtMs: number;
}

export interface ProviderOrderExposure {
  workingQuantity: number;
  filledUnsettledQuantity: number;
  cancelledQuantity: number;
  settledQuantity: number;
  workingExposureMinor: number;
  filledExposureMinor: number;
  totalExposureMinor: number;
}

type LifecycleRow = {
  id: number;
  provider: string;
  out_id: string;
  environment: string;
  provider_order_id: string;
  client_order_id: string | null;
  reservation_id: number | null;
  ticker: string;
  side: ProviderLifecycleSide;
  action: ProviderLifecycleAction;
  unit_price_minor: number;
  ordered_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  cancelled_quantity: number;
  settled_quantity: number;
  provider_status: ProviderLifecycleStatus;
  provider_updated_at_ms: number | null;
  first_observed_at_ms: number;
  last_observed_at_ms: number;
};

/**
 * Persist a complete account snapshot. Incomplete cursor chains never mutate
 * lifecycle state because absence from an incomplete feed is not evidence.
 */
export function ingestProviderLifecycleBatch(
  db: Database,
  batch: ProviderLifecycleBatch,
): ProviderLifecycleIngestResult {
  const transaction = db.transaction(() => applyProviderLifecycleBatchInTransaction(db, batch));
  return transaction.immediate();
}

/** Internal composition boundary; caller must own the surrounding write transaction. */
export function applyProviderLifecycleBatchInTransaction(
  db: Database,
  batch: ProviderLifecycleBatch,
): ProviderLifecycleIngestResult {
  validateBatch(batch);
  const result: ProviderLifecycleIngestResult = {
    ordersInserted: 0,
    ordersUpdated: 0,
    ordersUnchanged: 0,
    fillsInserted: 0,
    fillsDuplicate: 0,
  };
  for (const order of batch.orders) upsertOrder(db, batch, order, result);
  for (const fill of batch.fills) upsertFill(db, batch, fill, result);
  reconcileFillTotals(db, batch.provider, batch.outId, batch.observedAtMs);
  return result;
}

/** Record only explicit provider-positive settlement evidence. */
export function recordProviderOrderSettlement(
  db: Database,
  input: {
    provider: string;
    outId: string;
    providerOrderId: string;
    evidenceKey: string;
    settledQuantity: number;
    observedAtMs: number;
  },
): ProviderOrderLifecycle {
  const transaction = db.transaction(() => applyProviderOrderSettlementInTransaction(db, input));
  return transaction.immediate();
}

/** Internal composition boundary; caller must own the surrounding write transaction. */
export function applyProviderOrderSettlementInTransaction(
  db: Database,
  input: {
    provider: string;
    outId: string;
    providerOrderId: string;
    evidenceKey: string;
    settledQuantity: number;
    observedAtMs: number;
  },
): ProviderOrderLifecycle {
  const provider = bounded(input.provider, "provider", 128);
  const outId = bounded(input.outId, "out ID", 256);
  const providerOrderId = bounded(input.providerOrderId, "provider order ID", 512);
  const evidenceKey = bounded(input.evidenceKey, "settlement evidence key", 512);
  positiveInteger(input.settledQuantity, "settled quantity");
  timestamp(input.observedAtMs, "settlement observation time");
  const order = requireOrder(db, provider, outId, providerOrderId);
    if (input.settledQuantity > order.filledQuantity) {
      throw new Error("settled quantity cannot exceed provider-confirmed filled quantity");
    }
    if (input.settledQuantity < order.settledQuantity) {
      throw new Error("settled quantity cannot decrease");
    }
    const existing = db.query(
      `SELECT settled_quantity AS settledQuantity
       FROM provider_order_settlements
       WHERE order_lifecycle_id = $orderId AND evidence_key = $evidenceKey`,
    ).get({ $orderId: order.id, $evidenceKey: evidenceKey }) as {
      settledQuantity: number;
    } | null;
    if (existing !== null && existing.settledQuantity !== input.settledQuantity) {
      throw new Error("settlement evidence key is already bound to a different quantity");
    }
    if (existing === null) {
      db.query(
        `INSERT INTO provider_order_settlements (
           order_lifecycle_id, provider, out_id, evidence_key,
           settled_quantity, observed_at_ms
         ) VALUES ($orderId, $provider, $outId, $evidenceKey, $quantity, $observedAtMs)`,
      ).run({
        $orderId: order.id,
        $provider: provider,
        $outId: outId,
        $evidenceKey: evidenceKey,
        $quantity: input.settledQuantity,
        $observedAtMs: input.observedAtMs,
      });
    }
    db.query(
      `UPDATE provider_order_lifecycle
       SET settled_quantity = $quantity,
           last_observed_at_ms = MAX(last_observed_at_ms, $observedAtMs)
       WHERE id = $id`,
    ).run({
      $quantity: input.settledQuantity,
      $observedAtMs: input.observedAtMs,
      $id: order.id,
    });
  return requireOrder(db, provider, outId, providerOrderId);
}

export function getProviderOrderFillTotals(
  db: Database,
  provider: string,
  outId: string,
  providerOrderId: string,
): { quantity: number; costMinor: number; feesMinor: number } {
  const order = requireOrder(db, provider, outId, providerOrderId);
  const rows = db.query(
    `SELECT quantity, unit_price_minor AS unitPriceMinor, COALESCE(fee_minor, 0) AS feeMinor
     FROM provider_order_fills WHERE order_lifecycle_id = $id`,
  ).all({ $id: order.id }) as Array<{ quantity: number; unitPriceMinor: number; feeMinor: number }>;
  let quantity = 0;
  let costMinor = 0;
  let feesMinor = 0;
  for (const row of rows) {
    quantity = safeSum(quantity, row.quantity);
    costMinor = safeSum(costMinor, safeProduct(row.quantity, row.unitPriceMinor));
    feesMinor = safeSum(feesMinor, row.feeMinor);
  }
  return { quantity, costMinor, feesMinor };
}

export function getProviderOrderLifecycle(
  db: Database,
  provider: string,
  outId: string,
  providerOrderId: string,
): ProviderOrderLifecycle | null {
  const row = db.query(
    `SELECT * FROM provider_order_lifecycle
     WHERE provider = $provider AND out_id = $outId AND provider_order_id = $orderId`,
  ).get({ $provider: provider, $outId: outId, $orderId: providerOrderId }) as LifecycleRow | null;
  return row === null ? null : mapLifecycle(row);
}

export function computeProviderOrderExposure(
  order: ProviderOrderLifecycle,
): ProviderOrderExposure {
  const workingQuantity = order.remainingQuantity;
  const filledUnsettledQuantity = order.filledQuantity - order.settledQuantity;
  const workingExposureMinor = safeProduct(workingQuantity, order.unitPriceMinor);
  const filledExposureMinor = safeProduct(filledUnsettledQuantity, order.unitPriceMinor);
  return {
    workingQuantity,
    filledUnsettledQuantity,
    cancelledQuantity: order.cancelledQuantity,
    settledQuantity: order.settledQuantity,
    workingExposureMinor,
    filledExposureMinor,
    totalExposureMinor: safeSum(workingExposureMinor, filledExposureMinor),
  };
}

function upsertOrder(
  db: Database,
  batch: ProviderLifecycleBatch,
  snapshot: ProviderOrderSnapshot,
  result: ProviderLifecycleIngestResult,
): void {
  const existing = getProviderOrderLifecycle(
    db,
    batch.provider,
    batch.outId,
    snapshot.providerOrderId,
  );
  const quantities = normalizedQuantities(snapshot);
  if (existing === null) {
    db.query(
      `INSERT INTO provider_order_lifecycle (
         provider, out_id, environment, provider_order_id, client_order_id,
         reservation_id, ticker, side, action, unit_price_minor,
         ordered_quantity, filled_quantity, remaining_quantity, cancelled_quantity,
         provider_status, provider_updated_at_ms, first_observed_at_ms, last_observed_at_ms
       ) VALUES (
         $provider, $outId, $environment, $providerOrderId, $clientOrderId,
         $reservationId, $ticker, $side, $action, $unitPrice,
         $ordered, $filled, $remaining, $cancelled,
         $status, $providerUpdatedAtMs, $observedAtMs, $observedAtMs
       )`,
    ).run(orderParams(batch, snapshot, quantities));
    result.ordersInserted++;
    return;
  }
  assertSameOrder(existing, batch, snapshot);
  const isOlder =
    snapshot.providerUpdatedAtMs !== null &&
    existing.providerUpdatedAtMs !== null &&
    snapshot.providerUpdatedAtMs < existing.providerUpdatedAtMs;
  if (isOlder) {
    touchOrder(db, existing.id, batch.observedAtMs);
    result.ordersUnchanged++;
    return;
  }
  const providerUpdatedAtMs = snapshot.providerUpdatedAtMs ?? existing.providerUpdatedAtMs;
  const merged = mergeOrder(existing, snapshot);
  const changed =
    existing.filledQuantity !== merged.filled ||
    existing.remainingQuantity !== merged.remaining ||
    existing.cancelledQuantity !== merged.cancelled ||
    existing.providerStatus !== merged.status ||
    existing.providerUpdatedAtMs !== providerUpdatedAtMs;
  db.query(
    `UPDATE provider_order_lifecycle
     SET filled_quantity = $filled,
         remaining_quantity = $remaining,
         cancelled_quantity = $cancelled,
         provider_status = $status,
         provider_updated_at_ms = $providerUpdatedAtMs,
         last_observed_at_ms = MAX(last_observed_at_ms, $observedAtMs)
     WHERE id = $id`,
  ).run({
    $filled: merged.filled,
    $remaining: merged.remaining,
    $cancelled: merged.cancelled,
    $status: merged.status,
    $providerUpdatedAtMs: providerUpdatedAtMs,
    $observedAtMs: batch.observedAtMs,
    $id: existing.id,
  });
  if (changed) result.ordersUpdated++;
  else result.ordersUnchanged++;
}

function upsertFill(
  db: Database,
  batch: ProviderLifecycleBatch,
  fill: ProviderFillSnapshot,
  result: ProviderLifecycleIngestResult,
): void {
  const order = requireOrder(db, batch.provider, batch.outId, fill.providerOrderId);
  if (order.ticker !== fill.ticker || order.side !== fill.side || order.action !== fill.action) {
    throw new Error("provider fill identity does not match its order");
  }
  const existing = db.query(
    `SELECT provider_order_id AS providerOrderId, ticker, side, action,
            quantity, unit_price_minor AS unitPriceMinor, fee_minor AS feeMinor,
            provider_created_at_ms AS providerCreatedAtMs
     FROM provider_order_fills
     WHERE provider = $provider AND out_id = $outId AND source_key = $sourceKey`,
  ).get({
    $provider: batch.provider,
    $outId: batch.outId,
    $sourceKey: fill.sourceKey,
  }) as Omit<ProviderFillSnapshot, "sourceKey"> | null;
  if (existing !== null) {
    if (JSON.stringify(existing) !== JSON.stringify({
      providerOrderId: fill.providerOrderId,
      ticker: fill.ticker,
      side: fill.side,
      action: fill.action,
      quantity: fill.quantity,
      unitPriceMinor: fill.unitPriceMinor,
      feeMinor: fill.feeMinor,
      providerCreatedAtMs: fill.providerCreatedAtMs,
    })) {
      throw new Error("provider fill source key is already bound to different terms");
    }
    result.fillsDuplicate++;
    return;
  }
  db.query(
    `INSERT INTO provider_order_fills (
       order_lifecycle_id, provider, out_id, source_key, provider_order_id,
       ticker, side, action, quantity, unit_price_minor, fee_minor,
       provider_created_at_ms, observed_at_ms
     ) VALUES (
       $orderId, $provider, $outId, $sourceKey, $providerOrderId,
       $ticker, $side, $action, $quantity, $unitPrice, $fee,
       $providerCreatedAtMs, $observedAtMs
     )`,
  ).run({
    $orderId: order.id,
    $provider: batch.provider,
    $outId: batch.outId,
    $sourceKey: fill.sourceKey,
    $providerOrderId: fill.providerOrderId,
    $ticker: fill.ticker,
    $side: fill.side,
    $action: fill.action,
    $quantity: fill.quantity,
    $unitPrice: fill.unitPriceMinor,
    $fee: fill.feeMinor,
    $providerCreatedAtMs: fill.providerCreatedAtMs,
    $observedAtMs: batch.observedAtMs,
  });
  result.fillsInserted++;
}

function reconcileFillTotals(db: Database, provider: string, outId: string, nowMs: number): void {
  const orders = db.query(
    `SELECT * FROM provider_order_lifecycle WHERE provider = $provider AND out_id = $outId`,
  ).all({ $provider: provider, $outId: outId }) as LifecycleRow[];
  for (const row of orders) {
    const total = db.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total
       FROM provider_order_fills WHERE order_lifecycle_id = $id`,
    ).get({ $id: row.id }) as { total: number };
    const filled = Math.max(row.filled_quantity, safeInteger(total.total, "fill total"));
    if (filled > row.ordered_quantity) throw new Error("provider fills exceed ordered quantity");
    if (filled < row.settled_quantity) throw new Error("provider fills are below settled quantity");
    const remaining = row.provider_status === "working" ? row.ordered_quantity - filled : 0;
    const cancelled = row.provider_status === "cancelled" ? row.ordered_quantity - filled : 0;
    if (row.provider_status === "executed" && filled !== row.ordered_quantity) {
      throw new Error("executed provider order is not fully filled");
    }
    db.query(
      `UPDATE provider_order_lifecycle
       SET filled_quantity = $filled, remaining_quantity = $remaining,
           cancelled_quantity = $cancelled,
           last_observed_at_ms = MAX(last_observed_at_ms, $nowMs)
       WHERE id = $id`,
    ).run({ $filled: filled, $remaining: remaining, $cancelled: cancelled, $nowMs: nowMs, $id: row.id });
  }
}

function normalizedQuantities(snapshot: ProviderOrderSnapshot): {
  filled: number;
  remaining: number;
  cancelled: number;
} {
  if (snapshot.status === "working") {
    if (snapshot.filledQuantity + snapshot.remainingQuantity !== snapshot.orderedQuantity) {
      throw new TypeError("working order filled and remaining quantities must equal ordered quantity");
    }
    return { filled: snapshot.filledQuantity, remaining: snapshot.remainingQuantity, cancelled: 0 };
  }
  if (snapshot.remainingQuantity !== 0) {
    throw new TypeError("terminal provider orders cannot have remaining quantity");
  }
  if (snapshot.status === "executed" && snapshot.filledQuantity !== snapshot.orderedQuantity) {
    throw new TypeError("executed provider order must be fully filled");
  }
  return {
    filled: snapshot.filledQuantity,
    remaining: 0,
    cancelled: snapshot.status === "cancelled"
      ? snapshot.orderedQuantity - snapshot.filledQuantity
      : 0,
  };
}

function mergeOrder(existing: ProviderOrderLifecycle, snapshot: ProviderOrderSnapshot) {
  if (
    existing.providerStatus !== "working" &&
    snapshot.status !== existing.providerStatus
  ) {
    throw new Error("terminal provider order status cannot change");
  }
  const status = existing.providerStatus === "working" ? snapshot.status : existing.providerStatus;
  const filled = Math.max(existing.filledQuantity, snapshot.filledQuantity);
  if (filled > existing.orderedQuantity) throw new Error("filled quantity exceeds ordered quantity");
  if (status === "executed" && filled !== existing.orderedQuantity) {
    throw new Error("executed provider order is not fully filled");
  }
  return {
    status,
    filled,
    remaining: status === "working" ? existing.orderedQuantity - filled : 0,
    cancelled: status === "cancelled" ? existing.orderedQuantity - filled : 0,
  };
}

function assertSameOrder(
  existing: ProviderOrderLifecycle,
  batch: ProviderLifecycleBatch,
  snapshot: ProviderOrderSnapshot,
): void {
  if (
    existing.environment !== batch.environment ||
    existing.clientOrderId !== snapshot.clientOrderId ||
    existing.reservationId !== snapshot.reservationId ||
    existing.ticker !== snapshot.ticker ||
    existing.side !== snapshot.side ||
    existing.action !== snapshot.action ||
    existing.unitPriceMinor !== snapshot.unitPriceMinor ||
    existing.orderedQuantity !== snapshot.orderedQuantity
  ) {
    throw new Error("provider order identity or immutable terms changed");
  }
}

function orderParams(
  batch: ProviderLifecycleBatch,
  snapshot: ProviderOrderSnapshot,
  quantities: { filled: number; remaining: number; cancelled: number },
) {
  return {
    $provider: batch.provider,
    $outId: batch.outId,
    $environment: batch.environment,
    $providerOrderId: snapshot.providerOrderId,
    $clientOrderId: snapshot.clientOrderId,
    $reservationId: snapshot.reservationId,
    $ticker: snapshot.ticker,
    $side: snapshot.side,
    $action: snapshot.action,
    $unitPrice: snapshot.unitPriceMinor,
    $ordered: snapshot.orderedQuantity,
    $filled: quantities.filled,
    $remaining: quantities.remaining,
    $cancelled: quantities.cancelled,
    $status: snapshot.status,
    $providerUpdatedAtMs: snapshot.providerUpdatedAtMs,
    $observedAtMs: batch.observedAtMs,
  };
}

function validateBatch(batch: ProviderLifecycleBatch): void {
  bounded(batch.provider, "provider", 128);
  bounded(batch.outId, "out ID", 256);
  bounded(batch.environment, "provider environment", 64);
  timestamp(batch.observedAtMs, "lifecycle observation time");
  if (!batch.ordersCursorComplete || !batch.fillsCursorComplete) {
    throw new Error("provider lifecycle ingestion requires cursor-complete order and fill feeds");
  }
  for (const order of batch.orders) {
    bounded(order.providerOrderId, "provider order ID", 512);
    if (order.clientOrderId !== null) bounded(order.clientOrderId, "client order ID", 512);
    if (order.reservationId !== null) positiveInteger(order.reservationId, "reservation ID");
    bounded(order.ticker, "ticker", 256);
    if (order.side !== "yes" && order.side !== "no") throw new TypeError("invalid order side");
    if (order.action !== "buy" && order.action !== "sell") throw new TypeError("invalid order action");
    if (!(["working", "executed", "cancelled"] as const).includes(order.status)) {
      throw new TypeError("invalid provider lifecycle status");
    }
    nonNegativeInteger(order.unitPriceMinor, "order unit price");
    positiveInteger(order.orderedQuantity, "ordered quantity");
    nonNegativeInteger(order.filledQuantity, "filled quantity");
    nonNegativeInteger(order.remainingQuantity, "remaining quantity");
    if (order.filledQuantity > order.orderedQuantity) {
      throw new TypeError("filled quantity cannot exceed ordered quantity");
    }
    nullableTimestamp(order.providerUpdatedAtMs, "provider order update time");
    normalizedQuantities(order);
  }
  for (const fill of batch.fills) {
    bounded(fill.sourceKey, "fill source key", 512);
    bounded(fill.providerOrderId, "fill provider order ID", 512);
    bounded(fill.ticker, "fill ticker", 256);
    if (fill.side !== "yes" && fill.side !== "no") throw new TypeError("invalid fill side");
    if (fill.action !== "buy" && fill.action !== "sell") throw new TypeError("invalid fill action");
    positiveInteger(fill.quantity, "fill quantity");
    nonNegativeInteger(fill.unitPriceMinor, "fill unit price");
    if (fill.feeMinor !== null) nonNegativeInteger(fill.feeMinor, "fill fee");
    nullableTimestamp(fill.providerCreatedAtMs, "provider fill creation time");
  }
}

function requireOrder(db: Database, provider: string, outId: string, orderId: string) {
  const order = getProviderOrderLifecycle(db, provider, outId, orderId);
  if (order === null) throw new Error("provider lifecycle order not found");
  return order;
}

function touchOrder(db: Database, id: number, observedAtMs: number): void {
  db.query(
    `UPDATE provider_order_lifecycle
     SET last_observed_at_ms = MAX(last_observed_at_ms, $observedAtMs) WHERE id = $id`,
  ).run({ $observedAtMs: observedAtMs, $id: id });
}

function mapLifecycle(row: LifecycleRow): ProviderOrderLifecycle {
  return {
    id: row.id,
    provider: row.provider,
    outId: row.out_id,
    environment: row.environment,
    providerOrderId: row.provider_order_id,
    clientOrderId: row.client_order_id,
    reservationId: row.reservation_id as ExposureReservationId | null,
    ticker: row.ticker,
    side: row.side,
    action: row.action,
    unitPriceMinor: row.unit_price_minor,
    orderedQuantity: row.ordered_quantity,
    filledQuantity: row.filled_quantity,
    remainingQuantity: row.remaining_quantity,
    cancelledQuantity: row.cancelled_quantity,
    settledQuantity: row.settled_quantity,
    providerStatus: row.provider_status,
    providerUpdatedAtMs: row.provider_updated_at_ms,
    firstObservedAtMs: row.first_observed_at_ms,
    lastObservedAtMs: row.last_observed_at_ms,
  };
}

function bounded(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new TypeError(`${label} must be a bounded non-control string`);
  }
  return normalized;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
}

function safeInteger(value: number, label: string): number {
  nonNegativeInteger(value, label);
  return value;
}

function timestamp(value: number, label: string): void {
  nonNegativeInteger(value, label);
}

function nullableTimestamp(value: number | null, label: string): void {
  if (value !== null) timestamp(value, label);
}

function safeProduct(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("provider exposure exceeds safe integer range");
  return value;
}

function safeSum(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("provider exposure exceeds safe integer range");
  return value;
}
