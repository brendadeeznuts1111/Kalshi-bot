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
  asPlacementOwner,
  asTicketId,
} from "../../../src/partner/execution/domain.ts";
import {
  claimReservationForPlacement,
  computeDailyUsage,
  computeOutstandingExposure,
  confirmReservation,
  createPendingReservation,
  getReservation,
  markReservationUnknown,
  reconcileUnknownAsConfirmed,
  rejectReservation,
  releaseExpiredReservations,
  settleConfirmedReservation,
} from "../../../src/partner/execution/reservation.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const NOW_MS = 1_700_000_000_000;

function policy(): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("provider-x"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 50_000,
    maxWin: 100_000,
    maxWinBasis: "profit",
    dailyLimit: 100_000,
    exposureLimit: 50_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + 60_000,
  };
}

function setup(): { db: Database; authorization: ApprovedAuthorization } {
  const db = new Database(":memory:");
  expect(migrateExecutionSchema(db, NOW_MS)).toEqual(["001_exposure_reservations"]);
  expect(migrateExecutionSchema(db, NOW_MS + 1)).toEqual([]);
  const p = policy();
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

function request(key = "bet-1", stake = 1_000) {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    skin: asSkinId("main"),
    marketId: asMarketId("market-1"),
    idempotencyKey: asExecutionIdempotencyKey(key),
    requestedStake: stake,
    decimalOdds: 2,
  };
}

function pending(db: Database, authorization: ApprovedAuthorization, key = "bet-1") {
  const result = createPendingReservation(db, {
    authorization,
    request: request(key),
    effectiveStake: 800,
    expiresAtMs: NOW_MS + 30_000,
    nowMs: NOW_MS,
  });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("execution exposure reservations", () => {
  test("migrates prerequisites and creates an idempotent pending reservation", () => {
    const { db, authorization } = setup();
    const first = pending(db, authorization);
    const replay = pending(db, authorization);
    expect(first.created).toBeTrue();
    expect(replay.created).toBeFalse();
    expect(replay.reservation.id).toBe(first.reservation.id);

    const conflict = createPendingReservation(db, {
      authorization,
      request: request("bet-1", 1_001),
      effectiveStake: 800,
      expiresAtMs: NOW_MS + 30_000,
      nowMs: NOW_MS,
    });
    expect(conflict).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    db.close();
  });

  test("claims and confirms only with the placement owner", () => {
    const { db, authorization } = setup();
    const created = pending(db, authorization).reservation;
    const owner = asPlacementOwner("worker-a");
    const claimed = claimReservationForPlacement(db, {
      id: created.id,
      placementOwner: owner,
      nowMs: NOW_MS + 1,
    });
    expect(claimed?.status).toBe("placing");
    expect(
      confirmReservation(db, {
        id: created.id,
        placementOwner: asPlacementOwner("worker-b"),
        ticketId: asTicketId("ticket-1"),
        nowMs: NOW_MS + 2,
      }),
    ).toBeNull();
    const confirmed = confirmReservation(db, {
      id: created.id,
      placementOwner: owner,
      ticketId: asTicketId("ticket-1"),
      providerResponse: { accepted: true },
      nowMs: NOW_MS + 2,
    });
    expect(confirmed).toMatchObject({ status: "confirmed", ticketId: "ticket-1" });
    db.close();
  });

  test("counts reserved and ambiguous exposure but releases only undispatched expiry", () => {
    const { db, authorization } = setup();
    const lane = {
      partnerCode: authorization.partnerCode,
      outId: authorization.outId,
      skin: authorization.skin,
    };
    const expiring = pending(db, authorization, "expire").reservation;
    const unknown = pending(db, authorization, "unknown").reservation;
    const owner = asPlacementOwner("worker-a");
    claimReservationForPlacement(db, { id: unknown.id, placementOwner: owner, nowMs: NOW_MS + 1 });
    markReservationUnknown(db, {
      id: unknown.id,
      placementOwner: owner,
      reason: "timeout",
      nowMs: NOW_MS + 2,
    });
    expect(computeOutstandingExposure(db, lane)).toBe(1_600);
    expect(computeDailyUsage(db, lane, NOW_MS - 1)).toBe(1_600);

    expect(releaseExpiredReservations(db, NOW_MS + 30_000)).toBe(1);
    expect(getReservation(db, expiring.id)?.status).toBe("cancelled");
    expect(getReservation(db, unknown.id)?.status).toBe("unknown");
    expect(computeOutstandingExposure(db, lane)).toBe(800);
    db.close();
  });

  test("known provider rejection releases exposure and daily budget", () => {
    const { db, authorization } = setup();
    const created = pending(db, authorization).reservation;
    const owner = asPlacementOwner("worker-a");
    claimReservationForPlacement(db, { id: created.id, placementOwner: owner, nowMs: NOW_MS + 1 });
    rejectReservation(db, {
      id: created.id,
      placementOwner: owner,
      reason: "limit moved",
      providerResponse: { code: "LIMIT" },
      nowMs: NOW_MS + 2,
    });
    const lane = {
      partnerCode: authorization.partnerCode,
      outId: authorization.outId,
      skin: authorization.skin,
    };
    expect(computeOutstandingExposure(db, lane)).toBe(0);
    expect(computeDailyUsage(db, lane, NOW_MS - 1)).toBe(0);
    db.close();
  });

  test("reconciles an ambiguous placement before settlement releases exposure", () => {
    const { db, authorization } = setup();
    const created = pending(db, authorization).reservation;
    const owner = asPlacementOwner("worker-a");
    claimReservationForPlacement(db, { id: created.id, placementOwner: owner, nowMs: NOW_MS + 1 });
    markReservationUnknown(db, {
      id: created.id,
      placementOwner: owner,
      reason: "timeout",
      nowMs: NOW_MS + 2,
    });
    const reconciled = reconcileUnknownAsConfirmed(db, {
      id: created.id,
      ticketId: asTicketId("ticket-late"),
      providerResponse: { foundByIdempotencyKey: true },
      nowMs: NOW_MS + 3,
    });
    expect(reconciled).toMatchObject({ status: "confirmed", ticketId: "ticket-late" });
    expect(settleConfirmedReservation(db, created.id, NOW_MS + 4)?.status).toBe("settled");
    expect(
      computeOutstandingExposure(db, {
        partnerCode: authorization.partnerCode,
        outId: authorization.outId,
        skin: authorization.skin,
      }),
    ).toBe(0);
    db.close();
  });
});
