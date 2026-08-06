import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { KalshiClient } from "../../src/bot/kalshi-client.ts";
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
} from "../../src/partner/authorization/domain.ts";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
} from "../../src/partner/authorization/service.ts";
import { migrateExecutionSchema } from "../../src/partner/execution/sql.ts";
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
} from "../../src/partner/registry.ts";
import { handleTradingOrder } from "../../src/research/serve.ts";

describe("HQ trading-order authorization boundary", () => {
  test("preserves legacy dry-run behavior without authorization context", async () => {
    const response = await handleTradingOrder(request({
      ticker: "KXTEST",
      side: "yes",
      count: 2,
      priceCents: 40,
      dryRun: true,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      dryRun: true,
      ticker: "KXTEST",
      side: "yes",
      count: 2,
      priceCents: 40,
    });
  });

  test("live execution requires proof that compliance middleware ran", async () => {
    const response = await handleTradingOrder(request(liveBody()));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "E_AUTH_CONTEXT_REQUIRED",
    });
  });

  test("Fantasy402 is explicitly 501 and never reaches provider placement", async () => {
    const db = fantasyDatabase();
    let providerCalls = 0;
    const req = request(liveBody(), { "Idempotency-Key": "live-http-1" });
    (req as Request & { compliance?: unknown }).compliance = {
      stateCode: "MA",
      userId: "operator-1",
      playId: "play-1",
      parsedBody: {},
    };
    const response = await handleTradingOrder(req, {
      db,
      client: {
        environment: "demo",
        getBalance: async () => {
          providerCalls++;
          return { balanceCents: 1_000 };
        },
        placeOrder: async () => {
          providerCalls++;
          throw new Error("must not place");
        },
      } satisfies Pick<KalshiClient, "environment" | "placeOrder" | "getBalance">,
      isRiskHealthy: () => true,
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "E_PROVIDER_NOT_IMPLEMENTED",
    });
    expect(providerCalls).toBe(0);
    db.close();
  });

  test("live route binds authorization, balance, book, reservation, and response", async () => {
    const nowMs = Date.now();
    const db = authorizedDatabase(nowMs);
    let providerCalls = 0;
    const req = request(liveBody(), { "Idempotency-Key": "live-http-1" });
    attachCompliance(req);
    const response = await handleTradingOrder(req, {
      db,
      client: {
        environment: "demo",
        getBalance: async () => ({ balanceCents: 10_000 }),
        placeOrder: async (order) => {
          providerCalls++;
          return {
            orderId: "order-http-1",
            clientOrderId: order.clientOrderId!,
            fillCount: 2,
            remainingCount: 0,
            averageFillPriceCents: 40,
            averageFeePaidCents: 1,
            processedAtMs: nowMs,
            dryRun: false,
          };
        },
      },
      isRiskHealthy: () => true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      dryRun: false,
      orderId: "order-http-1",
      effectiveStakeMinorUnits: 80,
      status: "filled",
      fillCount: 2,
      remainingCount: 0,
      partnerCode: "SPORTS",
      outId: "out-SPORTS-1",
      skin: "main",
    });
    expect(providerCalls).toBe(1);
    expect(
      db.query(
        "SELECT market_id, selection, effective_stake, status FROM exposure_reservations",
      ).get(),
    ).toEqual({
      market_id: "KXTEST",
      selection: "yes",
      effective_stake: 80,
      status: "confirmed",
    });
    db.close();
  });
});

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/trading/order", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function liveBody(): Record<string, unknown> {
  return {
    partnerCode: "SPORTS",
    outId: "out-SPORTS-1",
    skin: "main",
    ticker: "KXTEST",
    outcome: "yes",
    stakeMinorUnits: 80,
    priceCents: 40,
    idempotencyKey: "live-http-1",
    dryRun: false,
  };
}

function attachCompliance(req: Request): void {
  (req as Request & { compliance?: unknown }).compliance = {
    stateCode: "MA",
    userId: "operator-1",
    playId: "play-1",
    parsedBody: {},
  };
}

function authorizedDatabase(nowMs: number): Database {
  const db = new Database(":memory:");
  ensurePartnerRegistrySchema(db);
  migrateExecutionSchema(db, nowMs);
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
    active: true,
    profitSplit: null,
    commissionRate: null,
    notes: null,
  }, nowMs);
  upsertBettingAccount(db, {
    id: "out-SPORTS-1",
    partnerId: "partner-sports",
    provider: "kalshi",
    url: "",
    status: "active",
    envPrefix: "KALSHI_SPORTS_1_",
    maxStake: 5,
    maxWin: 20,
    currency: "USD",
    skin: null,
    metaJson: JSON.stringify({
      partnerCode: "SPORTS",
      skins: [{ name: "main", perBetMax: 5, maxWin: 20, active: true }],
    }),
  }, nowMs);
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
    validFromMs: nowMs - 1_000,
    expiresAtMs: nowMs + 60_000,
  };
  db.query(
    `INSERT INTO account_authorization_approvers (
       partner_code, out_id, telegram_user_id, created_at_ms
     ) VALUES ('SPORTS', 'out-SPORTS-1', '789', $nowMs)`,
  ).run({ $nowMs: nowMs });
  const authRequest = createAuthorizationRequest(db, {
    policy,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: null,
    telegramMessageId: asTelegramMessageId("100"),
    nowMs,
  });
  if (!authRequest.ok) throw new Error(authRequest.reason);
  const approved = approveAuthorizationRequest(db, {
    requestId: authRequest.request.id,
    currentPolicy: policy,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: null,
    telegramMessageId: asTelegramMessageId("101"),
    approvingUserId: asTelegramUserId("789"),
    nowMs,
  });
  if (!approved.ok) throw new Error(approved.reason);
  db.query(
    `INSERT INTO book_ticks (ticker, ts, recv_ts, levels_json, source)
     VALUES ('KXTEST', $ts, $ts, $book, 'kalshi-ws')`,
  ).run({
    $ts: nowMs - 100,
    $book: JSON.stringify({
      ts: nowMs - 100,
      seq: 1,
      bids: [{ priceCents: 35, size: 10 }],
      asks: [{ priceCents: 40, size: 10 }],
    }),
  });
  return db;
}

function fantasyDatabase(): Database {
  const db = new Database(":memory:");
  ensurePartnerRegistrySchema(db);
  upsertPartner(db, {
    id: "partner-sports",
    name: "Sports Partner",
    active: true,
    profitSplit: null,
    commissionRate: null,
    notes: null,
  });
  upsertBettingAccount(db, {
    id: "out-SPORTS-1",
    partnerId: "partner-sports",
    provider: "fantasy402",
    url: "",
    status: "active",
    envPrefix: "FANTASY402_SPORTS_1_",
    maxStake: 5,
    maxWin: 20,
    currency: "USD",
    skin: null,
    metaJson: JSON.stringify({
      partnerCode: "SPORTS",
      skins: [{ name: "main", perBetMax: 5, maxWin: 20, active: true }],
    }),
  });
  return db;
}
