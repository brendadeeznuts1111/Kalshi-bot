import type {
  KalshiClient,
  KalshiOrderRequest,
} from "../../bot/kalshi-client.ts";
import { asTicketId, type ProviderPlacementInput } from "./domain.ts";

export type KalshiExecutionOrder = Omit<
  KalshiOrderRequest,
  "dryRun" | "clientOrderId"
>;

export type KalshiExecutionOrderMapper = (
  input: ProviderPlacementInput,
) => KalshiExecutionOrder;

/** Bind the generic authorized executor to the existing signed Kalshi client. */
export function createKalshiExecutionPlacer(
  client: Pick<KalshiClient, "environment" | "placeOrder">,
  mapOrder: KalshiExecutionOrderMapper,
) {
  return async (input: ProviderPlacementInput) => {
    const clientOrderId = executionIdempotencyKeyToUuid(input.idempotencyKey);
    const result = await client.placeOrder({
      ...mapOrder(input),
      dryRun: false,
      clientOrderId,
    });
    if (result.dryRun) throw new Error("Kalshi execution unexpectedly returned a dry-run order");
    return {
      accepted: true as const,
      ticketId: asTicketId(result.orderId),
      responseSummary: {
        environment: client.environment,
        orderId: result.orderId,
        clientOrderId,
      },
    };
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
