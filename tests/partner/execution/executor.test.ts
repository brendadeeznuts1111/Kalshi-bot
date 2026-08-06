import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
  asTelegramUserId,
  type ApprovedAuthorization,
  type AuthorizationPolicy,
} from "../../../src/partner/authorization/domain.ts";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
} from "../../../src/partner/authorization/service.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
  asTicketId,
  type BetRequest,
  type ExecutionDependencies,
} from "../../../src/partner/execution/domain.ts";
import { executeAuthorizedBet } from "../../../src/partner/execution/executor.ts";
import {
  computeOutstandingExposure,
  getReservation,
} from "../../../src/partner/execution/reservation.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const NOW_MS = 1_700_000_000_000;

function policy(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("provider-x"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 5_000,
    maxWin: 20_000,
    maxWinBasis: "profit",
    dailyLimit: 10_000,
    exposureLimit: 1_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + 60_000,
    ...overrides,
  };
}

function setup(p = policy()): { db: Database; authorization: ApprovedAuthorization } {
  const db = new Database(":memory:");
  migrateExecutionSchema(db, NOW_MS);
  db.query(
    `INSERT INTO account_authorization_approvers (
      partner_code, out_id, telegram_user_id, created_at_ms
    ) VALUES ($partner, $out, '789', $nowMs)`,
  ).run({ $partner: p.partnerCode, $out: p.outId, $nowMs: NOW_MS });
  const request = createAuthorizationRequest(db, {
    policy: p,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: asTelegramTopicId("7"),
    telegramMessageId: asTelegramMessageId("100"),
    nowMs: NOW_MS,
  });
  if (!request.ok) throw new Error(request.reason);
  const approved = approveAuthorizationRequest(db, {
    requestId: request.request.id,
    currentPolicy: p,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: asTelegramTopicId("7"),
    telegramMessageId: asTelegramMessageId("101"),
    approvingUserId: asTelegramUserId("789"),
    nowMs: NOW_MS,
  });
  if (!approved.ok) throw new Error(approved.reason);
  return { db, authorization: approved.authorization };
}

function request(key: string, requestedStake = 700): BetRequest {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    skin: asSkinId("main"),
    marketId: asMarketId("market-1"),
    idempotencyKey: asExecutionIdempotencyKey(key),
    requestedStake,
    decimalOdds: 2,
  };
}

function dependencies(
  currentPolicy: AuthorizationPolicy,
  placeBet: ExecutionDependencies["placeBet"],
): ExecutionDependencies {
  return {
    now: () => NOW_MS + 1,
    loadSnapshot: () => ({
      currentPolicy,
      oddsFresh: true,
      providerSessionValid: true,
      riskHealthy: true,
      sitePerBetMax: 5_000,
      availableBalance: 10_000,
      marketLiquidity: 10_000,
    }),
    placeBet,
  };
}

describe("authorized bet execution", () => {
  test("reserves, places, confirms, queues a receipt, and replays without a second call", async () => {
    const p = policy();
    const { db } = setup(p);
    let calls = 0;
    const deps = dependencies(p, async ({ effectiveStake, idempotencyKey }) => {
      calls += 1;
      expect(effectiveStake).toBe(700);
      expect(String(idempotencyKey)).toBe("bet-success");
      return { accepted: true, ticketId: asTicketId("ticket-1"), responseSummary: { ok: true } };
    });

    const first = await executeAuthorizedBet(db, request("bet-success"), deps);
    const replay = await executeAuthorizedBet(db, request("bet-success"), {
      ...deps,
      loadSnapshot: () => {
        throw new Error("replay must not reload state");
      },
    });
    expect(first).toMatchObject({ success: true, code: "BET_CONFIRMED", effectiveStake: 700 });
    expect(replay).toMatchObject({ success: true, code: "ALREADY_CONFIRMED" });
    expect(calls).toBe(1);
    if (first.success) expect(getReservation(db, first.reservationId)?.status).toBe("confirmed");
    expect(
      db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  test("serializes reservations so concurrent exposure cannot exceed the policy", async () => {
    const p = policy({ exposureLimit: 1_000 });
    const { db, authorization } = setup(p);
    const stakes: number[] = [];
    const deps = dependencies(p, async ({ effectiveStake }) => {
      stakes.push(effectiveStake);
      return { accepted: true, ticketId: asTicketId(`ticket-${stakes.length}`) };
    });
    expect((await executeAuthorizedBet(db, request("bet-a", 700), deps)).success).toBeTrue();
    const second = await executeAuthorizedBet(db, request("bet-b", 700), deps);
    expect(second).toMatchObject({ success: true, effectiveStake: 300 });
    expect(stakes).toEqual([700, 300]);
    expect(
      computeOutstandingExposure(db, {
        partnerCode: authorization.partnerCode,
        outId: authorization.outId,
        skin: authorization.skin,
      }),
    ).toBe(1_000);
    db.close();
  });

  test("does not reuse a stale market-liquidity snapshot", async () => {
    const p = policy({ exposureLimit: null });
    const { db } = setup(p);
    const stakes: number[] = [];
    const deps = dependencies(p, async ({ effectiveStake }) => {
      stakes.push(effectiveStake);
      return { accepted: true, ticketId: asTicketId(`ticket-${stakes.length}`) };
    });
    deps.loadSnapshot = () => ({
      currentPolicy: p,
      oddsFresh: true,
      providerSessionValid: true,
      riskHealthy: true,
      sitePerBetMax: 5_000,
      availableBalance: 10_000,
      marketLiquidity: 1_000,
    });
    await executeAuthorizedBet(db, request("liquidity-a", 700), deps);
    await executeAuthorizedBet(db, request("liquidity-b", 700), deps);
    expect(stakes).toEqual([700, 300]);
    db.close();
  });

  test("quantizes reservations to the provider's exact minor-unit order increment", async () => {
    const p = policy({ exposureLimit: null });
    const { db } = setup(p);
    let placedStake = 0;
    const deps = dependencies(p, async ({ effectiveStake }) => {
      placedStake = effectiveStake;
      return { accepted: true, ticketId: asTicketId("ticket-quantized") };
    });
    deps.loadSnapshot = () => ({
      currentPolicy: p,
      oddsFresh: true,
      providerSessionValid: true,
      riskHealthy: true,
      sitePerBetMax: 5_000,
      availableBalance: 10_000,
      marketLiquidity: 10_000,
      stakeQuantum: 40,
    });
    const result = await executeAuthorizedBet(db, request("quantized", 125), deps);
    expect(result).toMatchObject({ success: true, effectiveStake: 120 });
    expect(placedStake).toBe(120);
    db.close();
  });

  test("fails closed for stale policy and authorization revoked during snapshot loading", async () => {
    const p = policy();
    for (const mode of ["stale", "revoked"] as const) {
      const { db, authorization } = setup(p);
      let calls = 0;
      const deps = dependencies(p, async () => {
        calls += 1;
        return { accepted: true, ticketId: asTicketId("must-not-place") };
      });
      deps.loadSnapshot = () => {
        if (mode === "revoked") {
          db.query(
            `UPDATE account_authorizations
             SET revoked_at_ms = $nowMs WHERE id = $id`,
          ).run({ $nowMs: NOW_MS + 1, $id: authorization.id });
        }
        return {
          currentPolicy: mode === "stale" ? policy({ maxStake: 4_999 }) : p,
          oddsFresh: true,
          providerSessionValid: true,
          riskHealthy: true,
          sitePerBetMax: 5_000,
          availableBalance: 10_000,
          marketLiquidity: 10_000,
        };
      };
      const result = await executeAuthorizedBet(db, request(`bet-${mode}`), deps);
      expect(result.success).toBeFalse();
      expect(result.code).toBe(mode === "stale" ? "GATE_DENIED" : "NO_ACTIVE_AUTHORIZATION");
      expect(calls).toBe(0);
      expect(db.query("SELECT count(*) AS count FROM exposure_reservations").get()).toEqual({
        count: 0,
      });
      db.close();
    }
  });

  test("distinguishes known rejection from ambiguous provider failure", async () => {
    const p = policy();
    for (const mode of ["rejected", "unknown"] as const) {
      const { db, authorization } = setup(p);
      const result = await executeAuthorizedBet(
        db,
        request(`bet-${mode}`),
        dependencies(p, async () => {
          if (mode === "unknown") throw new Error("socket reset after write");
          return { accepted: false, reason: "market suspended", responseSummary: { code: 409 } };
        }),
      );
      expect(result).toMatchObject({
        success: false,
        code: mode === "unknown" ? "PROVIDER_OUTCOME_UNKNOWN" : "PROVIDER_REJECTED",
      });
      const row = db.query("SELECT status FROM exposure_reservations").get() as { status: string };
      expect(row.status).toBe(mode);
      const exposure = computeOutstandingExposure(db, {
        partnerCode: authorization.partnerCode,
        outId: authorization.outId,
        skin: authorization.skin,
      });
      expect(exposure).toBe(mode === "unknown" ? 700 : 0);
      expect(
        db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
      ).toEqual({ count: 1 });
      db.close();
    }
  });

  test("rejects reuse of an idempotency key for different terms", async () => {
    const p = policy();
    const { db } = setup(p);
    const deps = dependencies(p, async () => ({
      accepted: true,
      ticketId: asTicketId("ticket-1"),
    }));
    expect((await executeAuthorizedBet(db, request("same-key", 100), deps)).success).toBeTrue();
    const conflict = await executeAuthorizedBet(db, request("same-key", 101), deps);
    expect(conflict).toMatchObject({ success: false, code: "RESERVATION_CONFLICT" });
    db.close();
  });
});
