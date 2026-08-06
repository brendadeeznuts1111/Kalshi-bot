import { describe, expect, test } from "bun:test";
import type { KalshiClient } from "../../../src/bot/kalshi-client.ts";
import { KalshiRequestRejectedError } from "../../../src/bot/kalshi-client.ts";
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
  asMarketSelection,
} from "../../../src/partner/execution/domain.ts";
import {
  createKalshiExecutionPlacer,
  createKalshiBuyOrderMapper,
  decimalOddsToKalshiPriceCents,
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
        return {
          orderId: "order-1",
          clientOrderId: order.clientOrderId!,
          fillCount: 1,
          remainingCount: 1,
          averageFillPriceCents: 42,
          averageFeePaidCents: 1,
          processedAtMs: 1_700_000_000_000,
          dryRun: false,
        };
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
        selection: asMarketSelection("yes"),
        idempotencyKey: asExecutionIdempotencyKey("bet-1"),
        requestedStake: 2,
        decimalOdds: 2,
      },
      effectiveStake: 2,
      idempotencyKey: asExecutionIdempotencyKey("bet-1"),
    });
    expect(result).toMatchObject({ accepted: true, ticketId: "order-1" });
    expect(result.responseSummary).toMatchObject({
      state: "partially_filled",
      fillCount: 1,
      remainingCount: 1,
    });
    expect(calls[0]).toMatchObject({ dryRun: false, count: 2 });
    expect(calls[0]?.clientOrderId).toBe(executionIdempotencyKeyToUuid("bet-1"));
  });

  test("maps minor-unit risk to contract count and the request's quoted price", () => {
    expect(decimalOddsToKalshiPriceCents(2.5)).toBe(40);
    const mapper = createKalshiBuyOrderMapper("no");
    const input = executionInput({ effectiveStake: 125, decimalOdds: 2.5, selection: "no" });
    expect(mapper(input)).toEqual({
      ticker: "KXTEST",
      side: "no",
      count: 3,
      priceCents: 40,
      postOnly: false,
    });
    expect(() => mapper(executionInput({ effectiveStake: 39, decimalOdds: 2.5, selection: "no" }))).toThrow(
      /below the 40-cent cost/,
    );
  });

  test("maps definite provider rejections but leaves ambiguous failures to the executor", async () => {
    const rejectedClient = {
      environment: "demo" as const,
      placeOrder: async () => {
        throw new KalshiRequestRejectedError("Kalshi rejected order", 400, "invalid_order");
      },
    } satisfies Pick<KalshiClient, "environment" | "placeOrder">;
    const result = await createKalshiExecutionPlacer(
      rejectedClient,
      createKalshiBuyOrderMapper("yes"),
    )(executionInput({ effectiveStake: 100, decimalOdds: 2 }));
    expect(result).toMatchObject({
      accepted: false,
      reason: "Kalshi rejected order",
      responseSummary: { status: 400, providerCode: "invalid_order" },
    });
  });

  test("treats a processed order with no fill and no resting quantity as rejected", async () => {
    const client = {
      environment: "demo" as const,
      placeOrder: async (order) => ({
        orderId: "order-empty",
        clientOrderId: order.clientOrderId!,
        fillCount: 0,
        remainingCount: 0,
        averageFillPriceCents: null,
        averageFeePaidCents: null,
        processedAtMs: 1_700_000_000_000,
        dryRun: false,
      }),
    } satisfies Pick<KalshiClient, "environment" | "placeOrder">;
    const result = await createKalshiExecutionPlacer(
      client,
      createKalshiBuyOrderMapper("yes"),
    )(executionInput({ effectiveStake: 100, decimalOdds: 2 }));
    expect(result).toMatchObject({ accepted: false, responseSummary: { state: "not_filled" } });
  });
});

function executionInput(
  overrides: { effectiveStake?: number; decimalOdds?: number; selection?: "yes" | "no" } = {},
) {
  const currentPolicy = {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("kalshi"),
    skin: asSkinId("demo"),
    scope: "live_trade" as const,
    maxStake: 10_000,
    maxWin: 10_000,
    maxWinBasis: "profit" as const,
    dailyLimit: null,
    exposureLimit: null,
    currency: asCurrencyCode("USD"),
    validFromMs: 1,
    expiresAtMs: null,
  };
  return {
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
      selection: asMarketSelection(overrides.selection ?? "yes"),
      idempotencyKey: asExecutionIdempotencyKey("bet-helper"),
      requestedStake: overrides.effectiveStake ?? 100,
      decimalOdds: overrides.decimalOdds ?? 2,
    },
    effectiveStake: overrides.effectiveStake ?? 100,
    idempotencyKey: asExecutionIdempotencyKey("bet-helper"),
  };
}
