import type {
  KalshiClient,
  KalshiOrderRequest,
} from "../../bot/kalshi-client.ts";
import { KalshiRequestRejectedError } from "../../bot/kalshi-client.ts";
import { asTicketId, type ProviderPlacementInput } from "./domain.ts";

export type KalshiExecutionOrder = Omit<
  KalshiOrderRequest,
  "dryRun" | "clientOrderId"
>;

export type KalshiExecutionOrderMapper = (
  input: ProviderPlacementInput,
) => KalshiExecutionOrder;

export class KalshiOrderMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiOrderMappingError";
  }
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
        responseSummary: summarizeKalshiOrderResult(client.environment, result),
      };
    }
    return {
      accepted: true as const,
      ticketId: asTicketId(result.orderId),
      responseSummary: summarizeKalshiOrderResult(client.environment, result),
    };
  };
}

/** Map authorized minor-unit risk to an integer Kalshi buy order. */
export function createKalshiBuyOrderMapper(
  side: KalshiExecutionOrder["side"],
  options: { postOnly?: boolean } = {},
): KalshiExecutionOrderMapper {
  return ({ request, effectiveStake }) => {
    const priceCents = decimalOddsToKalshiPriceCents(request.decimalOdds);
    const count = Math.floor(effectiveStake / priceCents);
    if (count < 1) {
      throw new KalshiOrderMappingError(
        `Effective stake ${effectiveStake} is below the ${priceCents}-cent cost of one ${side.toUpperCase()} contract`,
      );
    }
    return {
      ticker: request.marketId,
      side,
      count,
      priceCents,
      // This helper consumes executable top-of-book liquidity. Callers that
      // intentionally load a maker quote can opt back into post-only behavior.
      postOnly: options.postOnly ?? false,
    };
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
) {
  const state =
    result.fillCount > 0 && result.remainingCount > 0
      ? "partially_filled"
      : result.fillCount > 0
        ? "filled"
        : result.remainingCount > 0
          ? "resting"
          : "not_filled";
  return {
    environment,
    orderId: result.orderId,
    clientOrderId: result.clientOrderId,
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
