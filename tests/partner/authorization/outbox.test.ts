import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  AuthorizationReceiptDedupeConflictError,
  asAuthorizationReceiptDedupeKey,
  asAuthorizationReceiptLeaseOwner,
  claimDueAuthorizationReceipts,
  enqueueAuthorizationReceipt,
  getAuthorizationReceiptOutboxItem,
  markAuthorizationReceiptFailed,
  markAuthorizationReceiptSent,
} from "../../../src/partner/authorization/outbox.ts";
import {
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
} from "../../../src/partner/authorization/domain.ts";
import { migrateAuthorizationSchema } from "../../../src/partner/authorization/sql.ts";

const NOW_MS = 1_700_000_000_000;
const WORKER_A = asAuthorizationReceiptLeaseOwner("receipt-worker-a");
const WORKER_B = asAuthorizationReceiptLeaseOwner("receipt-worker-b");

function openDb(): Database {
  const db = new Database(":memory:");
  migrateAuthorizationSchema(db, NOW_MS);
  return db;
}

function enqueue(db: Database, suffix = "approved", availableAtMs?: number) {
  return enqueueAuthorizationReceipt(
    db,
    {
      dedupeKey: asAuthorizationReceiptDedupeKey(`authorization:request-1:${suffix}`),
      telegramChatId: asTelegramChatId("-100123"),
      telegramTopicId: asTelegramTopicId("42"),
      payload: {
        text: `Authorization request 1 ${suffix}`,
        parseMode: "HTML",
        disableNotification: false,
        replyToMessageId: asTelegramMessageId("99"),
      },
      availableAtMs,
    },
    NOW_MS,
  );
}

describe("authorization receipt outbox", () => {
  test("enqueues idempotently and rejects a conflicting dedupe key", () => {
    const db = openDb();
    const first = enqueue(db);
    const replay = enqueueAuthorizationReceipt(
      db,
      {
        dedupeKey: first.item.dedupeKey,
        telegramChatId: first.item.telegramChatId,
        telegramTopicId: first.item.telegramTopicId,
        payload: first.item.payload,
      },
      NOW_MS + 5_000,
    );

    expect(first.created).toBeTrue();
    expect(replay.created).toBeFalse();
    expect(replay.item.id).toBe(first.item.id);
    expect(replay.item.availableAtMs).toBe(NOW_MS);
    expect(
      db.query("SELECT count(*) AS count FROM account_authorization_receipt_outbox").get(),
    ).toEqual({ count: 1 });

    expect(() =>
      enqueueAuthorizationReceipt(
        db,
        {
          dedupeKey: first.item.dedupeKey,
          telegramChatId: first.item.telegramChatId,
          telegramTopicId: first.item.telegramTopicId,
          payload: { text: "different receipt" },
        },
        NOW_MS + 10_000,
      ),
    ).toThrow(AuthorizationReceiptDedupeConflictError);
    db.close();
  });

  test("claims only due rows and protects them with an expiring lease", () => {
    const db = openDb();
    const due = enqueue(db, "due").item;
    enqueue(db, "future", NOW_MS + 10_000);

    const firstClaim = claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS,
      leaseOwner: WORKER_A,
      leaseDurationMs: 5_000,
      limit: 10,
    });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({
      id: due.id,
      attempts: 1,
      leaseOwner: WORKER_A,
      leaseExpiresAtMs: NOW_MS + 5_000,
    });

    expect(
      claimDueAuthorizationReceipts(db, {
        nowMs: NOW_MS + 4_999,
        leaseOwner: WORKER_B,
        leaseDurationMs: 5_000,
      }),
    ).toEqual([]);

    const reclaimed = claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS + 5_000,
      leaseOwner: WORKER_B,
      leaseDurationMs: 5_000,
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ attempts: 2, leaseOwner: WORKER_B });
    db.close();
  });

  test("marks sent only for the owner of an unexpired lease", () => {
    const db = openDb();
    const queued = enqueue(db).item;
    claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS,
      leaseOwner: WORKER_A,
      leaseDurationMs: 1_000,
    });

    expect(
      markAuthorizationReceiptSent(db, {
        id: queued.id,
        leaseOwner: WORKER_B,
        nowMs: NOW_MS + 1,
      }),
    ).toBeNull();

    const sent = markAuthorizationReceiptSent(db, {
      id: queued.id,
      leaseOwner: WORKER_A,
      nowMs: NOW_MS + 1,
    });
    expect(sent).toMatchObject({
      status: "sent",
      attempts: 1,
      sentAtMs: NOW_MS + 1,
      leaseOwner: null,
      leaseExpiresAtMs: null,
      lastError: null,
    });
    expect(
      claimDueAuthorizationReceipts(db, {
        nowMs: NOW_MS + 2_000,
        leaseOwner: WORKER_B,
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);
    db.close();
  });

  test("retries with bounded exponential backoff and dead-letters at the threshold", () => {
    const db = openDb();
    const queued = enqueue(db).item;

    const [firstClaim] = claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS,
      leaseOwner: WORKER_A,
      leaseDurationMs: 1_000,
    });
    const firstFailure = markAuthorizationReceiptFailed(db, {
      id: firstClaim.id,
      leaseOwner: WORKER_A,
      nowMs: NOW_MS + 1,
      error: "temporary failure",
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 150,
    });
    expect(firstFailure).toMatchObject({
      status: "pending",
      attempts: 1,
      availableAtMs: NOW_MS + 101,
      lastError: "temporary failure",
    });

    expect(
      claimDueAuthorizationReceipts(db, {
        nowMs: NOW_MS + 100,
        leaseOwner: WORKER_B,
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);

    const [secondClaim] = claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS + 101,
      leaseOwner: WORKER_B,
      leaseDurationMs: 1_000,
    });
    expect(secondClaim.attempts).toBe(2);
    const secondFailure = markAuthorizationReceiptFailed(db, {
      id: queued.id,
      leaseOwner: WORKER_B,
      nowMs: NOW_MS + 102,
      error: "still unavailable",
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 150,
    });
    expect(secondFailure).toMatchObject({
      status: "pending",
      attempts: 2,
      availableAtMs: NOW_MS + 252,
    });

    const [thirdClaim] = claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS + 252,
      leaseOwner: WORKER_A,
      leaseDurationMs: 1_000,
    });
    expect(thirdClaim.attempts).toBe(3);
    const dead = markAuthorizationReceiptFailed(db, {
      id: queued.id,
      leaseOwner: WORKER_A,
      nowMs: NOW_MS + 253,
      error: "permanent failure",
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 150,
    });
    expect(dead).toMatchObject({
      status: "dead",
      attempts: 3,
      lastError: "permanent failure",
      leaseOwner: null,
      leaseExpiresAtMs: null,
    });
    expect(
      claimDueAuthorizationReceipts(db, {
        nowMs: NOW_MS + 10_000,
        leaseOwner: WORKER_B,
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);
    expect(getAuthorizationReceiptOutboxItem(db, queued.id)?.status).toBe("dead");
    db.close();
  });

  test("rejects stale completion and invalid millisecond boundaries", () => {
    const db = openDb();
    const queued = enqueue(db).item;
    claimDueAuthorizationReceipts(db, {
      nowMs: NOW_MS,
      leaseOwner: WORKER_A,
      leaseDurationMs: 1,
    });

    expect(
      markAuthorizationReceiptFailed(db, {
        id: queued.id,
        leaseOwner: WORKER_A,
        nowMs: NOW_MS + 1,
        error: "too late",
      }),
    ).toBeNull();
    expect(() =>
      claimDueAuthorizationReceipts(db, {
        nowMs: NOW_MS + 0.5,
        leaseOwner: WORKER_A,
        leaseDurationMs: 100,
      }),
    ).toThrow("epoch-millisecond integer");
    db.close();
  });
});
