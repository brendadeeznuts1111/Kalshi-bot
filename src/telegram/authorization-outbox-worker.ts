import type { Database } from "bun:sqlite";
import {
  claimDueAuthorizationReceipts,
  markAuthorizationReceiptFailed,
  markAuthorizationReceiptSent,
  type AuthorizationReceiptLeaseOwner,
} from "../partner/authorization/outbox.ts";
import type { AuthorizationMessageSender } from "./authorization-requests.ts";

export interface DeliverAuthorizationReceiptsInput {
  nowMs: number;
  leaseOwner: AuthorizationReceiptLeaseOwner;
  send: AuthorizationMessageSender;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  clock?: () => number;
}

export interface DeliverAuthorizationReceiptsResult {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
}

/** Deliver one bounded outbox batch. Telegram failures remain durable for retry. */
export async function deliverAuthorizationReceiptBatch(
  db: Database,
  input: DeliverAuthorizationReceiptsInput,
): Promise<DeliverAuthorizationReceiptsResult> {
  const claimed = claimDueAuthorizationReceipts(db, {
    nowMs: input.nowMs,
    leaseOwner: input.leaseOwner,
    leaseDurationMs: input.leaseDurationMs ?? 30_000,
    limit: input.limit,
  });
  const result: DeliverAuthorizationReceiptsResult = {
    claimed: claimed.length,
    sent: 0,
    failed: 0,
    dead: 0,
  };

  for (const item of claimed) {
    try {
      const topic = numericTelegramId(item.telegramTopicId);
      const reply = numericTelegramId(item.payload.replyToMessageId ?? null);
      await input.send(item.telegramChatId, item.payload.text, {
        parseMode: item.payload.parseMode,
        ...(topic === null ? {} : { messageThreadId: topic }),
        ...(reply === null ? {} : { replyToMessageId: reply }),
        disableNotification: item.payload.disableNotification,
      });
      const completedAtMs = input.clock?.() ?? Date.now();
      const sent = markAuthorizationReceiptSent(db, {
        id: item.id,
        leaseOwner: input.leaseOwner,
        nowMs: completedAtMs,
      });
      if (sent === null) throw new Error("authorization receipt delivery lease expired");
      result.sent += 1;
    } catch (error) {
      const failedAtMs = input.clock?.() ?? Date.now();
      const failed = markAuthorizationReceiptFailed(db, {
        id: item.id,
        leaseOwner: input.leaseOwner,
        nowMs: failedAtMs,
        error: error instanceof Error ? error.message : "Telegram receipt delivery failed",
        maxAttempts: input.maxAttempts,
        baseDelayMs: input.baseDelayMs,
        maxDelayMs: input.maxDelayMs,
      });
      result.failed += 1;
      if (failed?.status === "dead") result.dead += 1;
    }
  }

  return result;
}

function numericTelegramId(value: string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new TypeError("Telegram message or topic ID exceeds the safe integer range");
  }
  return numeric;
}
