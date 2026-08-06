import type { Database } from "bun:sqlite";
import type {
  AuthorizationPolicy,
  AuthorizationRequest,
  TelegramChatId,
  TelegramTopicId,
} from "../partner/authorization/domain.ts";
import {
  asTelegramChatId,
  asTelegramMessageId,
} from "../partner/authorization/domain.ts";
import { computePolicyHash } from "../partner/authorization/hash.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from "../partner/authorization/outbox.ts";
import { createAuthorizationRequest } from "../partner/authorization/service.ts";
import type { SendMessageOptions, TelegramMessage } from "./api.ts";

export type AuthorizationMessageSender = (
  chatId: number | string,
  text: string,
  options?: SendMessageOptions,
) => Promise<TelegramMessage>;

export interface PostAuthorizationRequestInput {
  policy: AuthorizationPolicy;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  nowMs: number;
}

export type PostAuthorizationRequestResult =
  | { ok: true; code: "REQUEST_POSTED"; request: AuthorizationRequest }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "TELEGRAM_SEND_FAILED"
        | "TELEGRAM_RESPONSE_MISMATCH"
        | "REQUEST_PERSIST_FAILED";
      reason: string;
    };

export function formatAuthorizationRequest(policy: AuthorizationPolicy): string {
  const hash = computePolicyHash(policy);
  const validFrom = new Date(policy.validFromMs).toISOString();
  const expiry =
    policy.expiresAtMs === null ? "No expiration" : new Date(policy.expiresAtMs).toISOString();
  return (
    `📋 <b>Authorization Request</b>\n` +
    `Partner: <code>${Bun.escapeHTML(policy.partnerCode)}</code>\n` +
    `Out: <code>${Bun.escapeHTML(policy.outId)}</code>\n` +
    `Provider: <code>${Bun.escapeHTML(policy.provider)}</code>\n` +
    `Skin: <code>${Bun.escapeHTML(policy.skin)}</code>\n` +
    `Scope: <code>${policy.scope}</code>\n` +
    `Max stake: <code>${policy.maxStake} ${policy.currency} minor units</code>\n` +
    `Max win: <code>${policy.maxWin} ${policy.currency} minor units (${policy.maxWinBasis})</code>\n` +
    `Daily limit: <code>${policy.dailyLimit ?? "none"}</code>\n` +
    `Exposure limit: <code>${policy.exposureLimit ?? "none"}</code>\n` +
    `Valid from: <code>${validFrom}</code>\n` +
    `Expires: <code>${expiry}</code>\n` +
    `Hash: <code>${hash}</code>\n\n` +
    `The bot will reply with the numeric request ID required for approval.`
  );
}

/** Post the immutable snapshot, persist its returned message identity, then queue instructions. */
export async function postAuthorizationRequest(
  db: Database,
  input: PostAuthorizationRequestInput,
  send: AuthorizationMessageSender,
): Promise<PostAuthorizationRequestResult> {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return { ok: false, code: "INVALID_INPUT", reason: "nowMs must be an epoch-millisecond integer" };
  }
  let topicNumber: number | null;
  let formattedRequest: string;
  try {
    asTelegramChatId(input.telegramChatId);
    topicNumber = telegramNumericId(input.telegramTopicId);
    formattedRequest = formatAuthorizationRequest(input.policy);
    if (input.policy.expiresAtMs !== null && input.policy.expiresAtMs <= input.nowMs) {
      throw new TypeError("authorization policy is already expired");
    }
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: error instanceof Error ? error.message : "Invalid authorization request",
    };
  }
  let posted: TelegramMessage;
  try {
    posted = await send(input.telegramChatId, formattedRequest, {
      parseMode: "HTML",
      ...(topicNumber === null ? {} : { messageThreadId: topicNumber }),
    });
  } catch (error) {
    return {
      ok: false,
      code: "TELEGRAM_SEND_FAILED",
      reason: error instanceof Error ? error.message : "Telegram request send failed",
    };
  }

  if (
    String(posted.chat.id) !== input.telegramChatId ||
    (input.telegramTopicId === null
      ? posted.message_thread_id !== undefined
      : String(posted.message_thread_id) !== input.telegramTopicId)
  ) {
    return {
      ok: false,
      code: "TELEGRAM_RESPONSE_MISMATCH",
      reason: "Telegram returned a different chat or topic for the request message",
    };
  }

  let requestMessageId;
  try {
    requestMessageId = asTelegramMessageId(String(posted.message_id));
  } catch (error) {
    return {
      ok: false,
      code: "TELEGRAM_RESPONSE_MISMATCH",
      reason: error instanceof Error ? error.message : "Telegram returned an invalid message ID",
    };
  }

  try {
    const transaction = db.transaction((): PostAuthorizationRequestResult => {
      const created = createAuthorizationRequest(db, {
        policy: input.policy,
        telegramChatId: input.telegramChatId,
        telegramTopicId: input.telegramTopicId,
        telegramMessageId: requestMessageId,
        nowMs: input.nowMs,
      });
      if (!created.ok) {
        return { ok: false, code: "REQUEST_PERSIST_FAILED", reason: created.reason };
      }

      enqueueAuthorizationReceipt(
        db,
        {
          dedupeKey: asAuthorizationReceiptDedupeKey(
            `authorization-request:${created.request.id}:approval-instructions`,
          ),
          telegramChatId: input.telegramChatId,
          telegramTopicId: input.telegramTopicId,
          payload: {
            text:
              `Authorization request <code>${created.request.id}</code> is pending.\n` +
              `Approve with <code>/approve ${created.request.id}</code>.`,
            parseMode: "HTML",
            replyToMessageId: requestMessageId,
          },
        },
        input.nowMs,
      );
      return { ok: true, code: "REQUEST_POSTED", request: created.request };
    });
    return transaction.immediate();
  } catch (error) {
    return {
      ok: false,
      code: "REQUEST_PERSIST_FAILED",
      reason: error instanceof Error ? error.message : "Authorization request persistence failed",
    };
  }
}

function telegramNumericId(value: TelegramTopicId | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new TypeError("Telegram topic ID exceeds the safe integer range");
  }
  return numeric;
}
