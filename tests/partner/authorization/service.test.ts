import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy } from "../../../src/partner/authorization/domain.ts";
import {
  asAuthorizationRequestId,
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
  asTelegramUserId,
} from "../../../src/partner/authorization/domain.ts";
import { computePolicyHash } from "../../../src/partner/authorization/hash.ts";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
  revokeAuthorizations,
  revokeOutFromTelegram,
} from "../../../src/partner/authorization/service.ts";
import { migrateAuthorizationSchema } from "../../../src/partner/authorization/sql.ts";

const NOW_MS = 1_700_000_000_000;
const CHAT_ID = asTelegramChatId("-123456");
const TOPIC_ID = asTelegramTopicId("42");
const REQUEST_MESSAGE_ID = asTelegramMessageId("100");
const APPROVAL_MESSAGE_ID = asTelegramMessageId("101");
const APPROVER_ID = asTelegramUserId("789");

function policy(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("TEST"),
    outId: asOutId("out-TEST-1"),
    provider: asProviderId("test-provider"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 50_000,
    maxWin: 100_000,
    maxWinBasis: "profit",
    dailyLimit: 1_000_000,
    exposureLimit: 500_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + 60_000,
    ...overrides,
  };
}

function database(): Database {
  const db = new Database(":memory:");
  migrateAuthorizationSchema(db, NOW_MS);
  return db;
}

function allowApprover(
  db: Database,
  approvedPolicy: AuthorizationPolicy,
  userId = APPROVER_ID,
  partnerWide = false,
): void {
  db.query(
    `INSERT INTO account_authorization_approvers (
      partner_code, out_id, telegram_user_id, created_at_ms
    ) VALUES ($partnerCode, $outId, $telegramUserId, $nowMs)`,
  ).run({
    $partnerCode: approvedPolicy.partnerCode,
    $outId: partnerWide ? null : approvedPolicy.outId,
    $telegramUserId: userId,
    $nowMs: NOW_MS,
  });
}

function createRequest(db: Database, requestedPolicy = policy()) {
  const result = createAuthorizationRequest(db, {
    policy: requestedPolicy,
    telegramChatId: CHAT_ID,
    telegramTopicId: TOPIC_ID,
    telegramMessageId: REQUEST_MESSAGE_ID,
    nowMs: NOW_MS,
  });
  expect(result.ok).toBeTrue();
  if (!result.ok) throw new Error(result.reason);
  return result.request;
}

function approveRequest(
  db: Database,
  requestedPolicy: AuthorizationPolicy,
  requestId: ReturnType<typeof asAuthorizationRequestId>,
) {
  return approveAuthorizationRequest(db, {
    requestId,
    currentPolicy: requestedPolicy,
    telegramChatId: CHAT_ID,
    telegramTopicId: TOPIC_ID,
    telegramMessageId: APPROVAL_MESSAGE_ID,
    approvingUserId: APPROVER_ID,
    nowMs: NOW_MS,
  });
}

describe("authorization application service", () => {
  test("persists a request with an immutable policy hash and integer timestamps", () => {
    const db = database();
    try {
      const requestedPolicy = policy();
      const result = createAuthorizationRequest(db, {
        policy: requestedPolicy,
        telegramChatId: CHAT_ID,
        telegramTopicId: TOPIC_ID,
        telegramMessageId: REQUEST_MESSAGE_ID,
        nowMs: NOW_MS,
      });

      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(result.code).toBe("REQUEST_CREATED");
      expect(result.request.requestHash).toBe(computePolicyHash(requestedPolicy));
      expect(result.request.createdAtMs).toBe(NOW_MS);
      expect(result.request.updatedAtMs).toBe(NOW_MS);

      const row = db
        .query(
          `SELECT status, request_hash, created_at_ms, updated_at_ms
           FROM account_authorization_requests WHERE id = $id`,
        )
        .get({ $id: result.request.id }) as {
        status: string;
        request_hash: string;
        created_at_ms: number;
        updated_at_ms: number;
      };
      expect(row).toEqual({
        status: "pending",
        request_hash: computePolicyHash(requestedPolicy),
        created_at_ms: NOW_MS,
        updated_at_ms: NOW_MS,
      });
    } finally {
      db.close();
    }
  });

  test("rejects invalid creation time and already-expired policy without a write", () => {
    const db = database();
    try {
      const badTime = createAuthorizationRequest(db, {
        policy: policy(),
        telegramChatId: CHAT_ID,
        telegramTopicId: null,
        telegramMessageId: REQUEST_MESSAGE_ID,
        nowMs: 1.5,
      });
      expect(badTime).toMatchObject({ ok: false, code: "INVALID_INPUT" });

      const expired = createAuthorizationRequest(db, {
        policy: policy({ expiresAtMs: NOW_MS }),
        telegramChatId: CHAT_ID,
        telegramTopicId: null,
        telegramMessageId: REQUEST_MESSAGE_ID,
        nowMs: NOW_MS,
      });
      expect(expired).toMatchObject({ ok: false, code: "POLICY_ALREADY_EXPIRED" });
      expect(
        (
          db.query("SELECT count(*) AS count FROM account_authorization_requests").get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  test("approves an allowlisted exact-chat and exact-topic request atomically", () => {
    const db = database();
    try {
      const requestedPolicy = policy();
      allowApprover(db, requestedPolicy);
      const request = createRequest(db, requestedPolicy);
      const result = approveRequest(db, requestedPolicy, request.id);

      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(result.code).toBe("AUTHORIZATION_APPROVED");
      expect(result.authorization.approvalHash).toBe(request.requestHash);
      expect(result.authorization.telegramMessageId).toBe(APPROVAL_MESSAGE_ID);
      expect(result.authorization.approvingUserId).toBe(APPROVER_ID);

      const persisted = db
        .query(
          `SELECT r.status, count(a.id) AS grants
           FROM account_authorization_requests r
           LEFT JOIN account_authorizations a ON a.request_id = r.id
           WHERE r.id = $requestId
           GROUP BY r.id`,
        )
        .get({ $requestId: request.id }) as { status: string; grants: number };
      expect(persisted).toEqual({ status: "approved", grants: 1 });
    } finally {
      db.close();
    }
  });

  test("honors explicit partner-wide approvers but rejects other partners and outs", () => {
    const db = database();
    try {
      const requestedPolicy = policy();
      allowApprover(db, requestedPolicy, APPROVER_ID, true);
      const allowedRequest = createRequest(db, requestedPolicy);
      expect(approveRequest(db, requestedPolicy, allowedRequest.id).ok).toBeTrue();

      const otherPartnerPolicy = policy({ partnerCode: asPartnerCode("OTHER") });
      const otherPartnerRequest = createRequest(db, otherPartnerPolicy);
      expect(approveRequest(db, otherPartnerPolicy, otherPartnerRequest.id)).toMatchObject({
        ok: false,
        code: "APPROVER_NOT_ALLOWED",
      });

      const exactDb = database();
      try {
        allowApprover(exactDb, requestedPolicy);
        const otherOutPolicy = policy({ outId: asOutId("out-TEST-2") });
        const otherOutRequest = createRequest(exactDb, otherOutPolicy);
        expect(approveRequest(exactDb, otherOutPolicy, otherOutRequest.id)).toMatchObject({
          ok: false,
          code: "APPROVER_NOT_ALLOWED",
        });
      } finally {
        exactDb.close();
      }
    } finally {
      db.close();
    }
  });

  test("fails closed for chat, topic, approver, and policy mismatches", () => {
    const cases = [
      {
        code: "CHAT_MISMATCH",
        override: { telegramChatId: asTelegramChatId("-999") },
      },
      {
        code: "TOPIC_MISMATCH",
        override: { telegramTopicId: asTelegramTopicId("99") },
      },
      {
        code: "APPROVER_NOT_ALLOWED",
        override: { approvingUserId: asTelegramUserId("999") },
      },
      {
        code: "POLICY_HASH_MISMATCH",
        override: { currentPolicy: policy({ maxStake: 50_001 }) },
      },
    ] as const;

    for (const testCase of cases) {
      const db = database();
      try {
        const requestedPolicy = policy();
        allowApprover(db, requestedPolicy);
        const request = createRequest(db, requestedPolicy);
        const result = approveAuthorizationRequest(db, {
          requestId: request.id,
          currentPolicy: requestedPolicy,
          telegramChatId: CHAT_ID,
          telegramTopicId: TOPIC_ID,
          telegramMessageId: APPROVAL_MESSAGE_ID,
          approvingUserId: APPROVER_ID,
          nowMs: NOW_MS,
          ...testCase.override,
        });
        expect(result).toMatchObject({ ok: false, code: testCase.code });
        expect(
          (db.query("SELECT count(*) AS count FROM account_authorizations").get() as { count: number })
            .count,
        ).toBe(0);
      } finally {
        db.close();
      }
    }
  });

  test("rejects a tampered persisted policy even when current policy is unchanged", () => {
    const db = database();
    try {
      const requestedPolicy = policy();
      allowApprover(db, requestedPolicy);
      const request = createRequest(db, requestedPolicy);
      db.query(
        `UPDATE account_authorization_requests
         SET requested_max_stake = requested_max_stake + 1
         WHERE id = $requestId`,
      ).run({ $requestId: request.id });

      expect(approveRequest(db, requestedPolicy, request.id)).toMatchObject({
        ok: false,
        code: "POLICY_HASH_MISMATCH",
      });
      expect(
        (db.query("SELECT count(*) AS count FROM account_authorizations").get() as { count: number })
          .count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  test("makes repeated approval idempotent with exactly one grant", () => {
    const db = database();
    try {
      const requestedPolicy = policy();
      allowApprover(db, requestedPolicy);
      const request = createRequest(db, requestedPolicy);
      const first = approveRequest(db, requestedPolicy, request.id);
      db.query("DELETE FROM account_authorization_approvers").run();
      const second = approveRequest(db, requestedPolicy, request.id);

      expect(first).toMatchObject({ ok: true, code: "AUTHORIZATION_APPROVED" });
      expect(second).toMatchObject({ ok: true, code: "ALREADY_APPROVED" });
      if (first.ok && second.ok) expect(second.authorization.id).toBe(first.authorization.id);
      expect(
        (db.query("SELECT count(*) AS count FROM account_authorizations").get() as { count: number })
          .count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  test("expires a pending request instead of creating a grant", () => {
    const db = database();
    try {
      const requestedPolicy = policy({ expiresAtMs: NOW_MS + 1 });
      allowApprover(db, requestedPolicy);
      const request = createRequest(db, requestedPolicy);
      const result = approveAuthorizationRequest(db, {
        requestId: request.id,
        currentPolicy: requestedPolicy,
        telegramChatId: CHAT_ID,
        telegramTopicId: TOPIC_ID,
        telegramMessageId: APPROVAL_MESSAGE_ID,
        approvingUserId: APPROVER_ID,
        nowMs: NOW_MS + 1,
      });

      expect(result).toMatchObject({ ok: false, code: "REQUEST_EXPIRED" });
      expect(
        (
          db.query("SELECT status FROM account_authorization_requests WHERE id = $id").get({
            $id: request.id,
          }) as { status: string }
        ).status,
      ).toBe("expired");
      expect(
        (db.query("SELECT count(*) AS count FROM account_authorizations").get() as { count: number })
          .count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  test("revokes all unrevoked grants for only the exact partner, out, and skin", () => {
    const db = database();
    try {
      const mainPolicy = policy();
      const otherSkinPolicy = policy({ skin: asSkinId("alternate") });
      allowApprover(db, mainPolicy);

      for (const requestedPolicy of [mainPolicy, mainPolicy, otherSkinPolicy]) {
        const request = createRequest(db, requestedPolicy);
        expect(approveRequest(db, requestedPolicy, request.id).ok).toBeTrue();
      }

      const result = revokeAuthorizations(db, {
        partnerCode: mainPolicy.partnerCode,
        outId: mainPolicy.outId,
        skin: mainPolicy.skin,
        nowMs: NOW_MS + 10,
      });
      expect(result).toEqual({
        ok: true,
        code: "AUTHORIZATIONS_REVOKED",
        revokedCount: 2,
      });
      expect(
        (
          db
            .query(
              `SELECT count(*) AS count FROM account_authorizations
               WHERE revoked_at_ms IS NULL`,
            )
            .get() as { count: number }
        ).count,
      ).toBe(1);

      expect(
        revokeAuthorizations(db, {
          partnerCode: mainPolicy.partnerCode,
          outId: mainPolicy.outId,
          skin: mainPolicy.skin,
          nowMs: NOW_MS + 11,
        }),
      ).toMatchObject({ ok: false, code: "NO_ACTIVE_AUTHORIZATIONS" });
    } finally {
      db.close();
    }
  });

  test("Telegram revoke binds channel and approver, records evidence, and is replay-safe", () => {
    const db = database();
    try {
      const mainPolicy = policy();
      const alternatePolicy = policy({ skin: asSkinId("alternate") });
      allowApprover(db, mainPolicy);
      for (const requestedPolicy of [mainPolicy, alternatePolicy]) {
        const request = createRequest(db, requestedPolicy);
        expect(approveRequest(db, requestedPolicy, request.id).ok).toBeTrue();
      }

      const input = {
        outId: mainPolicy.outId,
        telegramChatId: CHAT_ID,
        telegramTopicId: TOPIC_ID,
        telegramMessageId: asTelegramMessageId("222"),
        revokingUserId: APPROVER_ID,
        nowMs: NOW_MS + 20,
      };
      expect(revokeOutFromTelegram(db, input)).toMatchObject({
        ok: true,
        code: "OUT_AUTHORIZATIONS_REVOKED",
        revokedCount: 2,
      });
      expect(revokeOutFromTelegram(db, input)).toMatchObject({
        ok: true,
        code: "OUT_AUTHORIZATIONS_REVOKED",
        revokedCount: 2,
      });
      expect(
        db.query("SELECT count(*) AS count FROM account_authorization_revocations").get(),
      ).toEqual({ count: 2 });
      expect(
        db
          .query(
            `SELECT telegram_chat_id, telegram_topic_id, telegram_message_id,
                    telegram_revoking_user_id
             FROM account_authorization_revocations LIMIT 1`,
          )
          .get(),
      ).toEqual({
        telegram_chat_id: CHAT_ID,
        telegram_topic_id: TOPIC_ID,
        telegram_message_id: "222",
        telegram_revoking_user_id: APPROVER_ID,
      });
    } finally {
      db.close();
    }
  });

  test("Telegram revoke rejects the wrong channel and a removed approver", () => {
    for (const denied of ["channel", "approver"] as const) {
      const db = database();
      try {
        const requestedPolicy = policy();
        allowApprover(db, requestedPolicy);
        const request = createRequest(db, requestedPolicy);
        expect(approveRequest(db, requestedPolicy, request.id).ok).toBeTrue();
        if (denied === "approver") {
          db.query("DELETE FROM account_authorization_approvers").run();
        }

        const result = revokeOutFromTelegram(db, {
          outId: requestedPolicy.outId,
          telegramChatId:
            denied === "channel" ? asTelegramChatId("-999") : CHAT_ID,
          telegramTopicId: TOPIC_ID,
          telegramMessageId: asTelegramMessageId("223"),
          revokingUserId: APPROVER_ID,
          nowMs: NOW_MS + 20,
        });
        expect(result).toMatchObject({
          ok: false,
          code: denied === "channel" ? "CHANNEL_MISMATCH" : "APPROVER_NOT_ALLOWED",
        });
        expect(
          db.query("SELECT count(*) AS count FROM account_authorization_revocations").get(),
        ).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    }
  });
});
