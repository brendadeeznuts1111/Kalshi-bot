import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { KalshiClient } from "../../../src/bot/kalshi-client.ts";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramUserId,
  type AuthorizationPolicy,
} from "../../../src/partner/authorization/domain.ts";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
} from "../../../src/partner/authorization/service.ts";
import {
  executeKalshiLiveOrder,
  createKalshiAccountClientResolver,
  parseKalshiLiveOrderCommand,
  type KalshiLiveOrderCommand,
} from "../../../src/partner/execution/kalshi-live.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
} from "../../../src/partner/execution/domain.ts";
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
} from "../../../src/partner/registry.ts";

const NOW_MS = 1_700_000_000_000;

describe("Kalshi live execution orchestration", () => {
  test("parses canonical identity and requires explicit idempotency", () => {
    const wire = {
      partnerCode: "sports",
      outId: "out-SPORTS-1",
      skin: "main",
      ticker: "KXTEST",
      outcome: "yes",
      stakeMinorUnits: 125,
      priceCents: 40,
    };
    expect(parseKalshiLiveOrderCommand(wire)).toMatchObject({
      ok: false,
      code: "IDEMPOTENCY_REQUIRED",
    });
    expect(parseKalshiLiveOrderCommand(wire, "request-1")).toMatchObject({
      ok: true,
      command: { partnerCode: "SPORTS", idempotencyKey: "request-1" },
    });
    expect(parseKalshiLiveOrderCommand({ ...wire, outId: "out-OTHER-1" }, "request-2"))
      .toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  test("resolves the active skin, binds the live balance/book, quantizes, and audits outcome", async () => {
    const db = setup();
    const orders: Array<Record<string, unknown>> = [];
    const client = mockClient(orders);
    const result = await executeKalshiLiveOrder(db, command(), {
      client,
      now: () => NOW_MS,
      maxBookAgeMs: 1_000,
      isRiskHealthy: () => true,
    });
    expect(result).toMatchObject({
      ok: true,
      result: { success: true, effectiveStake: 120 },
      order: {
        ticker: "KXTEST",
        outcome: "yes",
        count: 3,
        priceCents: 40,
        state: "partially_filled",
        fillCount: 1,
        remainingCount: 2,
      },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ side: "yes", count: 3, priceCents: 40, dryRun: false });
    expect(
      db.query(
        `SELECT partner_code, out_id, skin, provider, market_id, selection,
                requested_stake, effective_stake, status
         FROM exposure_reservations`,
      ).get(),
    ).toEqual({
      partner_code: "SPORTS",
      out_id: "out-SPORTS-1",
      skin: "main",
      provider: "kalshi",
      market_id: "KXTEST",
      selection: "yes",
      requested_stake: 125,
      effective_stake: 120,
      status: "confirmed",
    });
    db.close();
  });

  test("fails closed for inactive/mismatched account state and non-Kalshi providers", async () => {
    for (const variant of ["inactive", "partner", "provider"] as const) {
      const db = setup(variant);
      const result = await executeKalshiLiveOrder(db, command(), {
        client: mockClient([]),
        now: () => NOW_MS,
        isRiskHealthy: () => true,
      });
      expect(result.ok).toBeFalse();
      if (!result.ok) {
        expect(result.code).toBe(
          variant === "inactive"
            ? "ACCOUNT_INACTIVE"
            : variant === "partner"
              ? "PARTNER_INACTIVE"
              : "PROVIDER_NOT_IMPLEMENTED",
        );
      }
      db.close();
    }
  });

  test("fails closed when risk, balance, or quote binding is unavailable", async () => {
    const cases = [
      { risk: false, balance: 10_000, priceCents: 40 },
      { risk: true, balance: null, priceCents: 40 },
      { risk: true, balance: 10_000, priceCents: 41 },
    ] as const;
    for (const item of cases) {
      const db = setup();
      const result = await executeKalshiLiveOrder(
        db,
        command({ priceCents: item.priceCents }),
        {
          client: mockClient([], item.balance),
          now: () => NOW_MS,
          maxBookAgeMs: 1_000,
          isRiskHealthy: () => item.risk,
        },
      );
      expect(result).toMatchObject({ ok: false, code: "EXECUTION_DENIED" });
      expect(db.query("SELECT count(*) AS count FROM exposure_reservations").get()).toEqual({
        count: 0,
      });
      db.close();
    }
  });

  test("resolves and caches out-scoped credentials without falling through to another out", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const resolve = createKalshiAccountClientResolver({
      KALSHI_SPORTS_1_API_KEY_ID: "out-key",
      KALSHI_SPORTS_1_PRIVATE_KEY: pem,
      KALSHI_ENV: "demo",
    });
    const account = {
      id: "out-SPORTS-1",
      partnerId: "partner-sports",
      provider: "kalshi" as const,
      url: "",
      status: "active" as const,
      envPrefix: "KALSHI_SPORTS_1_",
      maxStake: 5,
      maxWin: 20,
      currency: "USD",
      skin: null,
      metaJson: "{}",
    };
    const first = resolve(account);
    expect(resolve(account)).toBe(first);
    expect(first.environment).toBe("demo");
    expect(() => resolve({ ...account, id: "out-OTHER-1", envPrefix: "KALSHI_OTHER_1_" }))
      .toThrow(/Missing KALSHI_API_KEY_ID/);
  });

  test("rebuilds an out-scoped client after credential rotation", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const env = {
      KALSHI_SPORTS_1_API_KEY_ID: "out-key-v1",
      KALSHI_SPORTS_1_PRIVATE_KEY: pem,
      KALSHI_ENV: "demo",
    };
    const resolve = createKalshiAccountClientResolver(env);
    const account = {
      id: "out-SPORTS-1",
      partnerId: "partner-sports",
      provider: "kalshi" as const,
      url: "",
      status: "active" as const,
      envPrefix: "KALSHI_SPORTS_1_",
      maxStake: 5,
      maxWin: 20,
      currency: "USD",
      skin: null,
      metaJson: "{}",
    };
    const first = resolve(account);
    env.KALSHI_SPORTS_1_API_KEY_ID = "out-key-v2";
    expect(resolve(account)).not.toBe(first);
  });

  test("returns an explicit session failure when scoped credentials cannot resolve", async () => {
    const db = setup();
    const result = await executeKalshiLiveOrder(db, command(), {
      resolveClient: () => {
        throw new Error("Missing KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)");
      },
      isRiskHealthy: () => true,
    });
    expect(result).toEqual({
      ok: false,
      code: "PROVIDER_SESSION_UNAVAILABLE",
      reason: "Missing KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)",
    });
    db.close();
  });
});

function setup(variant?: "inactive" | "partner" | "provider"): Database {
  const db = new Database(":memory:");
  ensurePartnerRegistrySchema(db);
  migrateExecutionSchema(db, NOW_MS);
  db.exec(`
    CREATE TABLE book_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT,
      ts INTEGER NOT NULL,
      recv_ts INTEGER,
      levels_json TEXT NOT NULL,
      source TEXT NOT NULL
    );
  `);
  upsertPartner(db, {
    id: "partner-sports",
    name: "Sports Partner",
    active: variant !== "partner",
    profitSplit: null,
    commissionRate: null,
    notes: null,
  }, NOW_MS);
  upsertBettingAccount(db, {
    id: "out-SPORTS-1",
    partnerId: "partner-sports",
    provider: variant === "provider" ? "fantasy402" : "kalshi",
    url: "",
    status: variant === "inactive" ? "inactive" : "active",
    envPrefix: "KALSHI_SPORTS_1_",
    maxStake: 5,
    maxWin: 20,
    currency: "USD",
    skin: null,
    metaJson: JSON.stringify({
      partnerCode: "SPORTS",
      skins: [{ name: "main", perBetMax: 5, maxWin: 20, active: true }],
    }),
  }, NOW_MS);
  const policy: AuthorizationPolicy = {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("kalshi"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 500,
    maxWin: 2_000,
    maxWinBasis: "profit",
    dailyLimit: 5_000,
    exposureLimit: 2_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + 60_000,
  };
  db.query(
    `INSERT INTO account_authorization_approvers (
       partner_code, out_id, telegram_user_id, created_at_ms
     ) VALUES ('SPORTS', 'out-SPORTS-1', '789', $nowMs)`,
  ).run({ $nowMs: NOW_MS });
  const request = createAuthorizationRequest(db, {
    policy,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: null,
    telegramMessageId: asTelegramMessageId("100"),
    nowMs: NOW_MS,
  });
  if (!request.ok) throw new Error(request.reason);
  const approved = approveAuthorizationRequest(db, {
    requestId: request.request.id,
    currentPolicy: policy,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: null,
    telegramMessageId: asTelegramMessageId("101"),
    approvingUserId: asTelegramUserId("789"),
    nowMs: NOW_MS,
  });
  if (!approved.ok) throw new Error(approved.reason);
  db.query(
    `INSERT INTO book_ticks (ticker, ts, recv_ts, levels_json, source)
     VALUES ('KXTEST', $ts, $ts, $book, 'kalshi-ws')`,
  ).run({
    $ts: NOW_MS - 100,
    $book: JSON.stringify({
      ts: NOW_MS - 100,
      seq: 1,
      bids: [{ priceCents: 35, size: 10 }],
      asks: [{ priceCents: 40, size: 10 }],
    }),
  });
  return db;
}

function command(overrides: Partial<KalshiLiveOrderCommand> = {}): KalshiLiveOrderCommand {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    skin: asSkinId("main"),
    ticker: asMarketId("KXTEST"),
    outcome: "yes",
    requestedStake: 125,
    priceCents: 40,
    idempotencyKey: asExecutionIdempotencyKey("live-order-1"),
    ...overrides,
  };
}

function mockClient(
  calls: Array<Record<string, unknown>>,
  balanceCents: number | null = 10_000,
): Pick<KalshiClient, "environment" | "placeOrder" | "getBalance"> {
  return {
    environment: "demo",
    getBalance: async () => ({ balanceCents }),
    placeOrder: async (order) => {
      calls.push(order as unknown as Record<string, unknown>);
      return {
        orderId: "order-1",
        clientOrderId: order.clientOrderId!,
        fillCount: 1,
        remainingCount: 2,
        averageFillPriceCents: 40,
        averageFeePaidCents: 1,
        processedAtMs: NOW_MS,
        dryRun: false,
      };
    },
  };
}
