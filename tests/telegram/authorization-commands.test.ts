import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { AuthorizationPolicy } from "../../src/partner/authorization/domain.ts";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
} from "../../src/partner/authorization/domain.ts";
import { getAuthorizationReceiptOutboxItem } from "../../src/partner/authorization/outbox.ts";
import { createAuthorizationRequest } from "../../src/partner/authorization/service.ts";
import { migrateAuthorizationSchema } from "../../src/partner/authorization/sql.ts";
import { handleAuthorizationCommand } from "../../src/telegram/authorization-commands.ts";
import type { TelegramMessage, TelegramUser } from "../../src/telegram/api.ts";

const NOW_MS = 1_700_000_000_000;

function policy(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("SPORTS"),
    outId: asOutId("out-SPORTS-1"),
    provider: asProviderId("provider-x"),
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

function database() {
  const db = new Database(":memory:");
  migrateAuthorizationSchema(db, NOW_MS);
  return db;
}

function seedRequest(db: Database, requestedPolicy = policy()) {
  db.query(
    `INSERT INTO account_authorization_approvers (
      partner_code, out_id, telegram_user_id, created_at_ms
    ) VALUES ($partner, $out, '789', $nowMs)`,
  ).run({
    $partner: requestedPolicy.partnerCode,
    $out: requestedPolicy.outId,
    $nowMs: NOW_MS,
  });
  const request = createAuthorizationRequest(db, {
    policy: requestedPolicy,
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: asTelegramTopicId("7"),
    telegramMessageId: asTelegramMessageId("100"),
    nowMs: NOW_MS,
  });
  if (!request.ok) throw new Error(request.reason);
  return request.request;
}

function message(
  text: string,
  overrides: Partial<Omit<TelegramMessage, "from">> & { from?: TelegramUser | undefined } = {},
): TelegramMessage {
  const { from: fromOverride, ...rest } = overrides;
  return {
    message_id: 200,
    message_thread_id: 7,
    chat: { id: -123, type: "supergroup" },
    text,
    date: Math.floor(NOW_MS / 1_000),
    ...(fromOverride !== undefined
      ? { from: fromOverride }
      : "from" in overrides
        ? {}
        : { from: { id: 789, first_name: "Partner" } }),
    ...rest,
  };
}

describe("Telegram authorization commands", () => {
  test("approves once, queues one deterministic receipt, and replays idempotently", () => {
    const db = database();
    const request = seedRequest(db);
    const update = message(`/approve@FactoryWagerBot ${request.id}`);
    const dependencies = { db, botUsername: "FactoryWagerBot" };

    const first = handleAuthorizationCommand(dependencies, update, NOW_MS + 1);
    const replay = handleAuthorizationCommand(dependencies, update, NOW_MS + 2);
    expect(first).toMatchObject({ handled: true, ok: true, code: "AUTHORIZATION_APPROVED" });
    expect(replay).toMatchObject({ handled: true, ok: true, code: "ALREADY_APPROVED" });
    expect(
      db.query("SELECT count(*) AS count FROM account_authorizations").get(),
    ).toEqual({ count: 1 });
    expect(
      db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
    ).toEqual({ count: 1 });
    if (first.handled && first.receiptOutboxId !== null) {
      expect(getAuthorizationReceiptOutboxItem(db, first.receiptOutboxId)?.payload.text).toContain(
        "Authorization active",
      );
    }
    db.close();
  });

  test("fails closed for stale policy, wrong topic, and absent sender", () => {
    const cases = [
      {
        expected: "POLICY_HASH_MISMATCH",
        dependencies: (db: Database) => ({
          db,
          resolveCurrentPolicy: () => policy({ maxStake: 50_001 }),
        }),
        update: (requestId: number) => message(`/approve ${requestId}`),
      },
      {
        expected: "TOPIC_MISMATCH",
        dependencies: (db: Database) => ({ db }),
        update: (requestId: number) =>
          message(`/approve ${requestId}`, { message_thread_id: 8 }),
      },
      {
        expected: "SENDER_ID_REQUIRED",
        dependencies: (db: Database) => ({ db }),
        update: (requestId: number) => message(`/approve ${requestId}`, { from: undefined }),
      },
    ];

    for (const testCase of cases) {
      const db = database();
      const request = seedRequest(db);
      const result = handleAuthorizationCommand(
        testCase.dependencies(db),
        testCase.update(request.id),
        NOW_MS + 1,
      );
      expect(result).toMatchObject({ handled: true, ok: false, code: testCase.expected });
      expect(
        db.query("SELECT count(*) AS count FROM account_authorizations").get(),
      ).toEqual({ count: 0 });
      expect(
        db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
      ).toEqual({ count: 1 });
      db.close();
    }
  });

  test("rejects an older request after a newer policy snapshot supersedes it", () => {
    const db = database();
    const original = seedRequest(db);
    const superseding = createAuthorizationRequest(db, {
      policy: policy({ maxStake: 40_000 }),
      telegramChatId: asTelegramChatId("-123"),
      telegramTopicId: asTelegramTopicId("7"),
      telegramMessageId: asTelegramMessageId("101"),
      nowMs: NOW_MS + 1,
    });
    expect(superseding.ok).toBeTrue();

    const result = handleAuthorizationCommand(
      { db },
      message(`/approve ${original.id}`),
      NOW_MS + 2,
    );

    expect(result).toMatchObject({
      handled: true,
      ok: false,
      code: "POLICY_HASH_MISMATCH",
    });
    expect(db.query("SELECT count(*) AS count FROM account_authorizations").get()).toEqual({
      count: 0,
    });
    db.close();
  });

  test("preserves out ID case and records replay-safe revocation provenance", () => {
    const db = database();
    const request = seedRequest(db);
    expect(
      handleAuthorizationCommand({ db }, message(`/approve ${request.id}`), NOW_MS + 1),
    ).toMatchObject({ handled: true, ok: true });

    const revokeMessage = message("/revoke_out out-SPORTS-1", { message_id: 201 });
    const first = handleAuthorizationCommand({ db }, revokeMessage, NOW_MS + 2);
    const replay = handleAuthorizationCommand({ db }, revokeMessage, NOW_MS + 3);
    expect(first).toMatchObject({ handled: true, ok: true, code: "OUT_AUTHORIZATIONS_REVOKED" });
    expect(replay).toMatchObject({ handled: true, ok: true, code: "OUT_AUTHORIZATIONS_REVOKED" });
    expect(
      db.query("SELECT out_id, telegram_message_id FROM account_authorization_revocations").get(),
    ).toEqual({ out_id: "out-SPORTS-1", telegram_message_id: "201" });
    expect(
      db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
    ).toEqual({ count: 2 });
    db.close();
  });

  test("ignores commands addressed to another bot", () => {
    const db = database();
    expect(
      handleAuthorizationCommand(
        { db, botUsername: "FactoryWagerBot" },
        message("/approve@OtherBot 1"),
        NOW_MS,
      ),
    ).toEqual({ handled: false });
    db.close();
  });
});
