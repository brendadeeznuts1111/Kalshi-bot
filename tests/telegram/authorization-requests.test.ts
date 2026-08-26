import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramTopicId,
  type AuthorizationPolicy,
} from "../../src/partner/authorization/domain.ts";
import { migrateAuthorizationSchema } from "../../src/partner/authorization/sql.ts";
import {
  formatAuthorizationRequest,
  postAuthorizationRequest,
} from "../../src/telegram/authorization-requests.ts";

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
    dailyLimit: 1_000_000,
    exposureLimit: 500_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS,
    expiresAtMs: NOW_MS + 60_000,
  };
}

function database() {
  const db = new Database(":memory:");
  migrateAuthorizationSchema(db, NOW_MS);
  return db;
}

describe("Telegram authorization request posting", () => {
  test("posts the immutable snapshot, persists provenance, and queues approval instructions", async () => {
    const db = database();
    const sent: Array<{ chatId: number | string; text: string; topic?: number }> = [];
    const result = await postAuthorizationRequest(
      db,
      {
        policy: policy(),
        telegramChatId: asTelegramChatId("-123"),
        telegramTopicId: asTelegramTopicId("7"),
        nowMs: NOW_MS,
      },
      async (chatId, text, options) => {
        sent.push({ chatId, text, ...(options?.messageThreadId !== undefined ? { topic: options.messageThreadId } : {}) });
        return {
          message_id: 100,
          message_thread_id: 7,
          chat: { id: -123, type: "supergroup" },
          date: Math.floor(NOW_MS / 1_000),
          text,
        };
      },
    );

    expect(result).toMatchObject({ ok: true, code: "REQUEST_POSTED" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.topic).toBe(7);
    expect(sent[0]?.text).toContain("Hash:");
    expect(sent[0]?.text).not.toContain("Balance:");
    expect(
      db.query("SELECT telegram_message_id, status FROM account_authorization_requests").get(),
    ).toEqual({ telegram_message_id: "100", status: "pending" });
    expect(
      db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  test("fails without persistence when Telegram send fails or returns another topic", async () => {
    for (const mismatch of [false, true]) {
      const db = database();
      const result = await postAuthorizationRequest(
        db,
        {
          policy: policy(),
          telegramChatId: asTelegramChatId("-123"),
          telegramTopicId: asTelegramTopicId("7"),
          nowMs: NOW_MS,
        },
        async (_chatId, text) => {
          if (!mismatch) throw new Error("offline");
          return {
            message_id: 100,
            message_thread_id: 8,
            chat: { id: -123, type: "supergroup" },
            date: Math.floor(NOW_MS / 1_000),
            text,
          };
        },
      );
      expect(result.ok).toBeFalse();
      expect(
        db.query("SELECT count(*) AS count FROM account_authorization_requests").get(),
      ).toEqual({ count: 0 });
      db.close();
    }
  });

  test("rejects an expired policy before contacting Telegram", async () => {
    const db = database();
    let sends = 0;
    const result = await postAuthorizationRequest(
      db,
      {
        policy: { ...policy(), expiresAtMs: NOW_MS },
        telegramChatId: asTelegramChatId("-123"),
        telegramTopicId: asTelegramTopicId("7"),
        nowMs: NOW_MS,
      },
      async () => {
        sends += 1;
        throw new Error("must not be called");
      },
    );

    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(sends).toBe(0);
    expect(db.query("SELECT count(*) AS count FROM account_authorization_requests").get()).toEqual({
      count: 0,
    });
    db.close();
  });

  test("formatter exposes only immutable authorization terms", () => {
    const text = formatAuthorizationRequest(policy());
    expect(text).toContain("out-SPORTS-1");
    expect(text).toContain("50000 USD minor units");
    expect(text).not.toContain("balance");
  });
});
