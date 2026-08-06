import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
} from "../../src/partner/authorization/domain.ts";
import {
  asAuthorizationReceiptDedupeKey,
  asAuthorizationReceiptLeaseOwner,
  enqueueAuthorizationReceipt,
  getAuthorizationReceiptOutboxItem,
} from "../../src/partner/authorization/outbox.ts";
import { migrateAuthorizationSchema } from "../../src/partner/authorization/sql.ts";
import { deliverAuthorizationReceiptBatch } from "../../src/telegram/authorization-outbox-worker.ts";

const NOW_MS = 1_700_000_000_000;

describe("Telegram authorization outbox worker", () => {
  test("retries transport failures and delivers topic-bound receipts", async () => {
    const db = new Database(":memory:");
    migrateAuthorizationSchema(db, NOW_MS);
    const queued = enqueueAuthorizationReceipt(
      db,
      {
        dedupeKey: asAuthorizationReceiptDedupeKey("command:-123:200"),
        telegramChatId: asTelegramChatId("-123"),
        telegramTopicId: asTelegramTopicId("7"),
        payload: {
          text: "approved",
          parseMode: "HTML",
          replyToMessageId: asTelegramMessageId("200"),
        },
      },
      NOW_MS,
    ).item;
    const worker = asAuthorizationReceiptLeaseOwner("test-worker");
    let attempts = 0;
    const send = async (chatId: number | string, text: string, options?: { messageThreadId?: number; replyToMessageId?: number }) => {
      attempts += 1;
      if (attempts === 1) throw new Error("Telegram offline");
      expect(chatId).toBe("-123");
      expect(text).toBe("approved");
      expect(options).toMatchObject({ messageThreadId: 7, replyToMessageId: 200 });
      return {
        message_id: 201,
        message_thread_id: 7,
        chat: { id: -123, type: "supergroup" as const },
        date: Math.floor(NOW_MS / 1_000),
        text,
      };
    };

    expect(
      await deliverAuthorizationReceiptBatch(db, {
        nowMs: NOW_MS,
        leaseOwner: worker,
        send,
        baseDelayMs: 100,
        clock: () => NOW_MS,
      }),
    ).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(getAuthorizationReceiptOutboxItem(db, queued.id)?.status).toBe("pending");

    expect(
      await deliverAuthorizationReceiptBatch(db, {
        nowMs: NOW_MS + 100,
        leaseOwner: worker,
        send,
        baseDelayMs: 100,
        clock: () => NOW_MS + 100,
      }),
    ).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(getAuthorizationReceiptOutboxItem(db, queued.id)?.status).toBe("sent");
    db.close();
  });
});
