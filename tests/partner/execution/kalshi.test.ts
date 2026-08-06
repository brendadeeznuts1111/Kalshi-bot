import { describe, expect, test } from "bun:test";
import type { KalshiClient } from "../../../src/bot/kalshi-client.ts";
import {
  asAuthorizationId,
  asAuthorizationRequestId,
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asPolicyHash,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramUserId,
} from "../../../src/partner/authorization/domain.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
} from "../../../src/partner/execution/domain.ts";
import {
  createKalshiExecutionPlacer,
  executionIdempotencyKeyToUuid,
} from "../../../src/partner/execution/kalshi.ts";

describe("Kalshi authorized execution adapter", () => {
  test("maps a stable execution key to a deterministic UUID", () => {
    const first = executionIdempotencyKeyToUuid("partner:out:bet-1");
    expect(first).toBe(executionIdempotencyKeyToUuid("partner:out:bet-1"));
    expect(first).not.toBe(executionIdempotencyKeyToUuid("partner:out:bet-2"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("forces live placement and forwards deterministic provider idempotency", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      environment: "demo" as const,
      placeOrder: async (order) => {
        calls.push(order as unknown as Record<string, unknown>);
        return { orderId: "order-1", dryRun: false };
      },
    } satisfies Pick<KalshiClient, "environment" | "placeOrder">;
    const place = createKalshiExecutionPlacer(client, ({ request, effectiveStake }) => ({
      ticker: request.marketId,
      side: "yes",
      count: effectiveStake,
      priceCents: 42,
    }));
    const currentPolicy = {
      partnerCode: asPartnerCode("SPORTS"),
      outId: asOutId("out-SPORTS-1"),
      provider: asProviderId("kalshi"),
      skin: asSkinId("demo"),
      scope: "live_trade" as const,
      maxStake: 100,
      maxWin: 100,
      maxWinBasis: "profit" as const,
      dailyLimit: null,
      exposureLimit: null,
      currency: asCurrencyCode("USD"),
      validFromMs: 1,
      expiresAtMs: null,
    };
    const result = await place({
      authorization: {
        ...currentPolicy,
        id: asAuthorizationId(1),
        requestId: asAuthorizationRequestId(1),
        approvalHash: asPolicyHash("a".repeat(64)),
        telegramChatId: asTelegramChatId("-123"),
        telegramTopicId: null,
        telegramMessageId: asTelegramMessageId("1"),
        approvingUserId: asTelegramUserId("2"),
        revokedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      request: {
        partnerCode: currentPolicy.partnerCode,
        outId: currentPolicy.outId,
        skin: currentPolicy.skin,
        marketId: asMarketId("KXTEST"),
        idempotencyKey: asExecutionIdempotencyKey("bet-1"),
        requestedStake: 2,
        decimalOdds: 2,
      },
      effectiveStake: 2,
      idempotencyKey: asExecutionIdempotencyKey("bet-1"),
    });
    expect(result).toMatchObject({ accepted: true, ticketId: "order-1" });
    expect(calls[0]).toMatchObject({ dryRun: false, count: 2 });
    expect(calls[0]?.clientOrderId).toBe(executionIdempotencyKeyToUuid("bet-1"));
  });
});
