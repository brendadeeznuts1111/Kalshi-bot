import {
  KalshiLifecyclePageMalformedError,
  KalshiRequestOutcomeUnknownError,
  type KalshiClient,
  type KalshiLifecycleFeed,
  type KalshiOrderLookupSource,
} from "../../bot/kalshi-client.ts";
import type { ExposureReservationId } from "./domain.ts";
import type {
  ProviderFillSnapshot,
  ProviderLifecycleBatch,
  ProviderOrderSnapshot,
} from "./provider-lifecycle.ts";

export type KalshiLifecycleLoadResult =
  | { ok: true; batch: ProviderLifecycleBatch; pagesScanned: number }
  | {
      ok: false;
      kind: "incomplete" | "malformed" | "provider_error";
      feed: KalshiLifecycleFeed;
      source: KalshiOrderLookupSource;
      pagesScanned: number;
      reason: string;
    };

export interface KalshiLifecycleLoaderOptions {
  outId: string;
  observedAtMs?: number;
  maxPagesPerFeed?: number;
  pageSize?: number;
  reservationForClientOrderId?: (clientOrderId: string) => ExposureReservationId | null;
}

/** Load all current and archived account orders/fills before returning a batch. */
export async function loadKalshiLifecycleBatch(
  client: Pick<KalshiClient, "environment" | "getLifecyclePage">,
  options: KalshiLifecycleLoaderOptions,
): Promise<KalshiLifecycleLoadResult> {
  const maxPages = options.maxPagesPerFeed ?? 10;
  const pageSize = options.pageSize ?? 1_000;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new TypeError("Kalshi lifecycle max pages must be from 1 to 100");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new TypeError("Kalshi lifecycle page size must be from 1 to 1000");
  }
  const observedAtMs = options.observedAtMs ?? Date.now();
  timestamp(observedAtMs, "lifecycle observation time");
  const orderWire: Record<string, unknown>[] = [];
  const fillWire: Record<string, unknown>[] = [];
  let pagesScanned = 0;
  for (const feed of ["orders", "fills"] as const) {
    for (const source of ["active", "historical"] as const) {
      let cursor = "";
      for (let page = 0; page < maxPages; page++) {
        let result;
        try {
          result = await client.getLifecyclePage(feed, source, cursor, pageSize);
        } catch (error) {
          return {
            ok: false,
            kind: error instanceof KalshiLifecycleNormalizationError ||
              error instanceof KalshiLifecyclePageMalformedError
              ? "malformed"
              : "provider_error",
            feed,
            source,
            pagesScanned,
            reason: boundedReason(error),
          };
        }
        pagesScanned++;
        (feed === "orders" ? orderWire : fillWire).push(...result.items);
        cursor = result.cursor;
        if (!cursor) break;
        if (page === maxPages - 1) {
          return {
            ok: false,
            kind: "incomplete",
            feed,
            source,
            pagesScanned,
            reason: "cursor remained after the bounded page limit",
          };
        }
      }
    }
  }
  try {
    const orders = dedupeOrders(orderWire.map((wire) => normalizeKalshiLifecycleOrder(
      wire,
      options.reservationForClientOrderId,
    )));
    const fills = dedupeFills(fillWire.map(normalizeKalshiLifecycleFill));
    return {
      ok: true,
      pagesScanned,
      batch: {
        provider: "kalshi",
        outId: options.outId,
        environment: client.environment,
        observedAtMs,
        ordersCursorComplete: true,
        fillsCursorComplete: true,
        orders,
        fills,
      },
    };
  } catch (error) {
    return {
      ok: false,
      kind: "malformed",
      feed: "orders",
      source: "active",
      pagesScanned,
      reason: boundedReason(error),
    };
  }
}

export function normalizeKalshiLifecycleOrder(
  wire: Record<string, unknown>,
  reservationForClientOrderId?: (clientOrderId: string) => ExposureReservationId | null,
): ProviderOrderSnapshot {
  const providerOrderId = requiredString(wire.order_id, "order ID");
  const clientOrderId = optionalString(wire.client_order_id);
  const ticker = requiredString(wire.ticker, "ticker");
  const side = yesNo(wire.outcome_side ?? wire.side, "order side");
  const action = buySell(wire.action, "order action");
  const orderedQuantity = integerCount(wire.initial_count_fp ?? wire.initial_count, "ordered quantity");
  const filledQuantity = integerCount(wire.fill_count_fp ?? wire.fill_count, "filled quantity");
  const remainingQuantity = integerCount(
    wire.remaining_count_fp ?? wire.remaining_count,
    "remaining quantity",
  );
  const yesPrice = priceMinor(wire.yes_price_dollars, wire.yes_price, "order YES price");
  return {
    providerOrderId,
    clientOrderId,
    reservationId: clientOrderId && reservationForClientOrderId
      ? reservationForClientOrderId(clientOrderId)
      : null,
    ticker,
    side,
    action,
    unitPriceMinor: exposureUnitPrice(side, action, yesPrice),
    orderedQuantity,
    filledQuantity,
    remainingQuantity,
    status: lifecycleStatus(wire.status),
    providerUpdatedAtMs: optionalTime(wire.last_update_time),
  };
}

export function normalizeKalshiLifecycleFill(
  wire: Record<string, unknown>,
): ProviderFillSnapshot {
  const fillId = optionalString(wire.fill_id);
  const tradeId = optionalString(wire.trade_id);
  if (!fillId && !tradeId) throw new KalshiLifecycleNormalizationError("fill has no stable ID");
  const side = yesNo(wire.side, "fill side");
  const action = buySell(wire.action, "fill action");
  const yesPrice = priceMinor(wire.yes_price_dollars, wire.yes_price, "fill YES price");
  return {
    sourceKey: fillId ? `fill:${fillId}` : `trade:${tradeId}`,
    providerOrderId: requiredString(wire.order_id, "fill order ID"),
    ticker: requiredString(wire.ticker ?? wire.market_ticker, "fill ticker"),
    side,
    action,
    quantity: integerCount(wire.count_fp ?? wire.count, "fill quantity"),
    unitPriceMinor: exposureUnitPrice(side, action, yesPrice),
    feeMinor: optionalFeeMinor(wire.fee_cost),
    providerCreatedAtMs: optionalTime(wire.created_time) ?? optionalUnixSeconds(wire.ts),
  };
}

class KalshiLifecycleNormalizationError extends Error {}

function dedupeOrders(orders: ProviderOrderSnapshot[]): ProviderOrderSnapshot[] {
  const byId = new Map<string, ProviderOrderSnapshot>();
  for (const order of orders) {
    const prior = byId.get(order.providerOrderId);
    if (!prior) {
      byId.set(order.providerOrderId, order);
      continue;
    }
    assertImmutableOrder(prior, order);
    const priorTime = prior.providerUpdatedAtMs ?? -1;
    const nextTime = order.providerUpdatedAtMs ?? -1;
    if (nextTime >= priorTime) byId.set(order.providerOrderId, order);
  }
  return [...byId.values()];
}

function dedupeFills(fills: ProviderFillSnapshot[]): ProviderFillSnapshot[] {
  const byKey = new Map<string, ProviderFillSnapshot>();
  for (const fill of fills) {
    const prior = byKey.get(fill.sourceKey);
    if (prior && JSON.stringify(prior) !== JSON.stringify(fill)) {
      throw new KalshiLifecycleNormalizationError("fill source key has conflicting terms");
    }
    byKey.set(fill.sourceKey, fill);
  }
  return [...byKey.values()];
}

function assertImmutableOrder(left: ProviderOrderSnapshot, right: ProviderOrderSnapshot): void {
  if (
    left.clientOrderId !== right.clientOrderId || left.ticker !== right.ticker ||
    left.side !== right.side || left.action !== right.action ||
    left.unitPriceMinor !== right.unitPriceMinor ||
    left.orderedQuantity !== right.orderedQuantity ||
    left.reservationId !== right.reservationId
  ) throw new KalshiLifecycleNormalizationError("order ID has conflicting immutable terms");
}

function lifecycleStatus(value: unknown): ProviderOrderSnapshot["status"] {
  if (value === "resting" || value === "pending") return "working";
  if (value === "executed") return "executed";
  if (value === "canceled" || value === "cancelled") return "cancelled";
  throw new KalshiLifecycleNormalizationError("unsupported provider order status");
}

function exposureUnitPrice(
  side: "yes" | "no",
  action: "buy" | "sell",
  yesPrice: number,
): number {
  const selectionPrice = side === "yes" ? yesPrice : 100 - yesPrice;
  return action === "buy" ? selectionPrice : 100 - selectionPrice;
}

function priceMinor(dollars: unknown, legacy: unknown, label: string): number {
  if (typeof legacy === "number" && Number.isSafeInteger(legacy) && legacy >= 0 && legacy <= 100) {
    return legacy;
  }
  if (typeof dollars !== "string" && typeof dollars !== "number") {
    throw new KalshiLifecycleNormalizationError(`${label} is missing`);
  }
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(dollars));
  if (!match) throw new KalshiLifecycleNormalizationError(`${label} is malformed`);
  const tenThousandths = Number(match[1]) * 10_000 +
    Number((match[2] ?? "").padEnd(4, "0"));
  const value = tenThousandths / 100;
  if (!Number.isSafeInteger(tenThousandths) || !Number.isSafeInteger(value) || value > 100) {
    throw new KalshiLifecycleNormalizationError(`${label} must be whole minor units`);
  }
  return value;
}

function integerCount(value: unknown, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new KalshiLifecycleNormalizationError(`${label} is missing`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new KalshiLifecycleNormalizationError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function optionalFeeMinor(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new KalshiLifecycleNormalizationError("fill fee is malformed");
  }
  const parsed = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new KalshiLifecycleNormalizationError("fill fee is malformed");
  }
  return parsed;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new KalshiLifecycleNormalizationError(`${label} is missing`);
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function yesNo(value: unknown, label: string): "yes" | "no" {
  if (value !== "yes" && value !== "no") throw new KalshiLifecycleNormalizationError(`${label} is invalid`);
  return value;
}

function buySell(value: unknown, label: string): "buy" | "sell" {
  if (value !== "buy" && value !== "sell") throw new KalshiLifecycleNormalizationError(`${label} is invalid`);
  return value;
}

function optionalTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function optionalUnixSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const milliseconds = value * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function timestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`);
}

function boundedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider lifecycle load failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 512);
}
