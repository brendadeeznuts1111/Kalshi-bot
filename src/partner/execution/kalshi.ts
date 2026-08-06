import type {
  KalshiClient,
  KalshiOrderRequest,
} from "../../bot/kalshi-client.ts";
import { KalshiRequestRejectedError } from "../../bot/kalshi-client.ts";
import { asTicketId, type ProviderPlacementInput } from "./domain.ts";
import type { KalshiExpectedOrder } from "./kalshi-reconciliation.ts";

export type KalshiExecutionOrder = Omit<
  KalshiOrderRequest,
  "dryRun" | "clientOrderId"
>;

export type KalshiExecutionOrderMapper = (
  input: ProviderPlacementInput,
) => KalshiExecutionOrder;

export type KalshiPlacementState =
  | "resting"
  | "partially_filled"
  | "filled"
  | "not_filled";

export interface KalshiOrderResponseSummary {
  environment: KalshiClient["environment"];
  orderId: string;
  clientOrderId: string;
  ticker: string;
  outcome: KalshiExecutionOrder["side"];
  count: number;
  priceCents: number;
  state: KalshiPlacementState;
  fillCount: number;
  remainingCount: number;
  averageFillPriceCents: number | null;
  averageFeePaidCents: number | null;
  processedAtMs: number | null;
}

export class KalshiOrderMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiOrderMappingError";
  }
}

/** The exact immutable provider terms shared by placement and reconciliation. */
export function expectedKalshiOrder(
  environment: KalshiClient["environment"],
  order: KalshiExecutionOrder,
  clientOrderId: string,
): KalshiExpectedOrder {
  return {
    environment,
    ticker: order.ticker,
    clientOrderId,
    outcome: order.side,
    bookSide: order.side === "yes" ? "bid" : "ask",
    count: order.count,
    yesPriceCents: order.side === "yes" ? order.priceCents : 100 - order.priceCents,
  };
}

/** Bind the generic authorized executor to the existing signed Kalshi client. */
export function createKalshiExecutionPlacer(
  client: Pick<KalshiClient, "environment" | "placeOrder">,
  mapOrder: KalshiExecutionOrderMapper,
) {
  return async (input: ProviderPlacementInput) => {
    const clientOrderId = executionIdempotencyKeyToUuid(input.idempotencyKey);
    let order: KalshiExecutionOrder;
    try {
      order = mapOrder(input);
    } catch (error) {
      if (!(error instanceof KalshiOrderMappingError)) throw error;
      return { accepted: false as const, reason: error.message };
    }
    let result;
    try {
      result = await client.placeOrder({ ...order, dryRun: false, clientOrderId });
    } catch (error) {
      if (!(error instanceof KalshiRequestRejectedError)) throw error;
      return {
        accepted: false as const,
        reason: error.message,
        responseSummary: {
          environment: client.environment,
          status: error.status,
          providerCode: error.providerCode,
          clientOrderId,
        },
      };
    }
    if (result.dryRun) throw new Error("Kalshi execution unexpectedly returned a dry-run order");
    if (result.fillCount <= 0 && result.remainingCount <= 0) {
      return {
        accepted: false as const,
        reason: "Kalshi processed the order without a fill or resting quantity",
        responseSummary: summarizeKalshiOrderResult(client.environment, result, order),
      };
    }
    return {
      accepted: true as const,
      ticketId: asTicketId(result.orderId),
      responseSummary: summarizeKalshiOrderResult(client.environment, result, order),
    };
  };
}

/** Map authorized minor-unit risk to an integer Kalshi buy order. */
export function createKalshiBuyOrderMapper(
  side: KalshiExecutionOrder["side"],
  options: { postOnly?: boolean } = {},
): KalshiExecutionOrderMapper {
  return ({ request, effectiveStake }) => projectKalshiBuyOrder({
    ticker: request.marketId,
    selection: request.selection,
    effectiveStake,
    decimalOdds: request.decimalOdds,
    side,
    postOnly: options.postOnly,
  });
}

/** Pure term projection; reconciliation calls the same math as placement. */
export function projectKalshiBuyOrder(input: {
  ticker: string;
  selection: string;
  effectiveStake: number;
  decimalOdds: number;
  side: KalshiExecutionOrder["side"];
  postOnly?: boolean;
}): KalshiExecutionOrder {
  if (input.selection.toLowerCase() !== input.side) {
    throw new KalshiOrderMappingError(
      `Execution selection ${input.selection} does not match Kalshi ${input.side.toUpperCase()} mapper`,
    );
  }
  const priceCents = decimalOddsToKalshiPriceCents(input.decimalOdds);
  const count = Math.floor(input.effectiveStake / priceCents);
  if (count < 1) {
    throw new KalshiOrderMappingError(
      `Effective stake ${input.effectiveStake} is below the ${priceCents}-cent cost of one ${input.side.toUpperCase()} contract`,
    );
  }
  return {
    ticker: input.ticker,
    side: input.side,
    count,
    priceCents,
    postOnly: input.postOnly ?? false,
  };
}

/** Binary-contract total-return decimal odds map to the quoted side's price. */
export function decimalOddsToKalshiPriceCents(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new KalshiOrderMappingError("Decimal odds must be finite and greater than 1");
  }
  const priceCents = Math.round(100 / decimalOdds);
  if (priceCents < 1 || priceCents > 99) {
    throw new KalshiOrderMappingError(
      `Decimal odds ${decimalOdds} do not map to a Kalshi price between 1 and 99 cents`,
    );
  }
  return priceCents;
}

function summarizeKalshiOrderResult(
  environment: KalshiClient["environment"],
  result: Awaited<ReturnType<KalshiClient["placeOrder"]>>,
  order: KalshiExecutionOrder,
): KalshiOrderResponseSummary {
  const expected = expectedKalshiOrder(environment, order, result.clientOrderId);
  const state =
    result.fillCount > 0 && result.remainingCount > 0
      ? "partially_filled"
      : result.fillCount > 0
        ? "filled"
        : result.remainingCount > 0
          ? "resting"
          : "not_filled";
  return {
    environment: expected.environment,
    orderId: result.orderId,
    clientOrderId: result.clientOrderId,
    ticker: expected.ticker,
    outcome: expected.outcome,
    count: expected.count,
    priceCents: order.priceCents,
    state,
    fillCount: result.fillCount,
    remainingCount: result.remainingCount,
    averageFillPriceCents: result.averageFillPriceCents,
    averageFeePaidCents: result.averageFeePaidCents,
    processedAtMs: result.processedAtMs,
  };
}

/** Deterministic RFC-4122 UUIDv5-shaped key derived without exposing the source key. */
export function executionIdempotencyKeyToUuid(key: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(key).digest() as Uint8Array;
  const bytes = Uint8Array.from(digest.slice(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
