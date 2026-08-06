import type { Database } from "bun:sqlite";
import type {
  AuthorizationPolicy,
  AuthorizationRequest,
  AuthorizationRequestId,
  TelegramUserId,
} from "../partner/authorization/domain.ts";
import {
  asAuthorizationRequestId,
  asOutId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
  asTelegramUserId,
} from "../partner/authorization/domain.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
  type AuthorizationReceiptOutboxId,
} from "../partner/authorization/outbox.ts";
import {
  approveAuthorizationRequest,
  getCurrentAuthorizationPolicy,
  getAuthorizationRequest,
  revokeOutFromTelegram,
} from "../partner/authorization/service.ts";
import { parseTelegramCommand } from "./commands.ts";
import type { TelegramMessage } from "./api.ts";

export type CurrentAuthorizationPolicyResolver = (
  request: AuthorizationRequest,
) => AuthorizationPolicy | null;

export interface AuthorizationCommandDependencies {
  db: Database;
  botUsername?: string;
  resolveCurrentPolicy?: CurrentAuthorizationPolicyResolver;
}

export type AuthorizationCommandResult =
  | { handled: false }
  | {
      handled: true;
      ok: boolean;
      code: string;
      receiptOutboxId: AuthorizationReceiptOutboxId | null;
    };

type CommandReceipt = {
  ok: boolean;
  code: string;
  text: string;
};

function parseRequestId(value: string | undefined): AuthorizationRequestId | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const numeric = Number(value);
  try {
    return asAuthorizationRequestId(numeric);
  } catch {
    return null;
  }
}

function resultReceipt(code: string, reason: string, context: string): CommandReceipt {
  return {
    ok: false,
    code,
    text:
      `⛔ <b>Authorization command denied</b>\n` +
      `${Bun.escapeHTML(context)}\n` +
      `Code: <code>${Bun.escapeHTML(code)}</code>\n` +
      `Reason: ${Bun.escapeHTML(reason)}`,
  };
}

/** Route only authorization commands. All responses are durably queued, never sent inline. */
export function handleAuthorizationCommand(
  dependencies: AuthorizationCommandDependencies,
  message: TelegramMessage,
  nowMs = Date.now(),
): AuthorizationCommandResult {
  const parsed = message.text === undefined ? null : parseTelegramCommand(message.text);
  if (parsed === null || (parsed.name !== "approve" && parsed.name !== "revoke_out")) {
    return { handled: false };
  }
  if (
    parsed.botUsername !== null &&
    (dependencies.botUsername === undefined ||
      parsed.botUsername !== dependencies.botUsername.toLowerCase())
  ) {
    return { handled: false };
  }

  let chatId;
  let topicId;
  let commandMessageId;
  try {
    chatId = asTelegramChatId(String(message.chat.id));
    topicId =
      message.message_thread_id === undefined
        ? null
        : asTelegramTopicId(String(message.message_thread_id));
    commandMessageId = asTelegramMessageId(String(message.message_id));
  } catch {
    return {
      handled: true,
      ok: false,
      code: "INVALID_TELEGRAM_MESSAGE",
      receiptOutboxId: null,
    };
  }

  const dedupeKey = asAuthorizationReceiptDedupeKey(
    `authorization-command:${chatId}:${commandMessageId}`,
  );

  try {
    const transaction = dependencies.db.transaction((): AuthorizationCommandResult => {
      let receipt: CommandReceipt;

      const senderId = telegramUserId(message);
      if (senderId === null) {
        receipt = resultReceipt(
          "SENDER_ID_REQUIRED",
          "Authorization commands require a numeric Telegram user identity",
          `Command: /${parsed.name}`,
        );
      } else if (parsed.name === "approve") {
        receipt = approveReceipt(dependencies, parsed.args, {
          chatId,
          topicId,
          commandMessageId,
          userId: senderId,
          nowMs,
        });
      } else {
        receipt = revokeReceipt(dependencies, parsed.args, {
          chatId,
          topicId,
          commandMessageId,
          userId: senderId,
          nowMs,
        });
      }

      const queued = enqueueAuthorizationReceipt(
        dependencies.db,
        {
          dedupeKey,
          telegramChatId: chatId,
          telegramTopicId: topicId,
          payload: {
            text: receipt.text,
            parseMode: "HTML",
            replyToMessageId: commandMessageId,
          },
        },
        nowMs,
      );
      return {
        handled: true,
        ok: receipt.ok,
        code: receipt.code,
        receiptOutboxId: queued.item.id,
      };
    });
    return transaction.immediate();
  } catch {
    return {
      handled: true,
      ok: false,
      code: "COMMAND_DATABASE_ERROR",
      receiptOutboxId: null,
    };
  }
}

type TelegramCommandProvenance = {
  chatId: ReturnType<typeof asTelegramChatId>;
  topicId: ReturnType<typeof asTelegramTopicId> | null;
  commandMessageId: ReturnType<typeof asTelegramMessageId>;
  userId: TelegramUserId;
  nowMs: number;
};

function approveReceipt(
  dependencies: AuthorizationCommandDependencies,
  args: readonly string[],
  provenance: TelegramCommandProvenance,
): CommandReceipt {
  const requestId = args.length === 1 ? parseRequestId(args[0]) : null;
  if (requestId === null) {
    return resultReceipt(
      "INVALID_APPROVE_COMMAND",
      "Usage: /approve <positive-request-id>",
      "Command: /approve",
    );
  }

  const request = getAuthorizationRequest(dependencies.db, requestId);
  if (request === null) {
    return resultReceipt(
      "REQUEST_NOT_FOUND",
      "Authorization request not found",
      `Request: ${requestId}`,
    );
  }
  const currentPolicy =
    dependencies.resolveCurrentPolicy?.(request) ??
    (dependencies.resolveCurrentPolicy === undefined
      ? getCurrentAuthorizationPolicy(dependencies.db, request)
      : null);
  if (currentPolicy === null) {
    return resultReceipt(
      "CURRENT_POLICY_UNAVAILABLE",
      "Current authorization policy could not be resolved",
      `Request: ${requestId}`,
    );
  }

  const result = approveAuthorizationRequest(dependencies.db, {
    requestId,
    currentPolicy,
    telegramChatId: provenance.chatId,
    telegramTopicId: provenance.topicId,
    telegramMessageId: provenance.commandMessageId,
    approvingUserId: provenance.userId,
    nowMs: provenance.nowMs,
  });
  if (!result.ok) return resultReceipt(result.code, result.reason, `Request: ${requestId}`);

  return {
    ok: true,
    code: result.code,
    text:
      `✅ <b>Authorization active</b>\n` +
      `Request: <code>${requestId}</code>\n` +
      `Partner: <code>${Bun.escapeHTML(result.authorization.partnerCode)}</code>\n` +
      `Out: <code>${Bun.escapeHTML(result.authorization.outId)}</code>\n` +
      `Skin: <code>${Bun.escapeHTML(result.authorization.skin)}</code>\n` +
      `Scope: <code>${result.authorization.scope}</code>`,
  };
}

function revokeReceipt(
  dependencies: AuthorizationCommandDependencies,
  args: readonly string[],
  provenance: TelegramCommandProvenance,
): CommandReceipt {
  if (args.length !== 1) {
    return resultReceipt(
      "INVALID_REVOKE_COMMAND",
      "Usage: /revoke_out <out-id>",
      "Command: /revoke_out",
    );
  }

  let outId;
  try {
    outId = asOutId(args[0]!);
  } catch (error) {
    return resultReceipt(
      "INVALID_REVOKE_COMMAND",
      error instanceof Error ? error.message : "Invalid revoke command",
      "Command: /revoke_out",
    );
  }

  const result = revokeOutFromTelegram(dependencies.db, {
    outId,
    telegramChatId: provenance.chatId,
    telegramTopicId: provenance.topicId,
    telegramMessageId: provenance.commandMessageId,
    revokingUserId: provenance.userId,
    nowMs: provenance.nowMs,
  });
  if (!result.ok) return resultReceipt(result.code, result.reason, `Out: ${outId}`);

  return {
    ok: true,
    code: result.code,
    text:
      `🛑 <b>Out authorization revoked</b>\n` +
      `Partner: <code>${Bun.escapeHTML(result.partnerCode)}</code>\n` +
      `Out: <code>${Bun.escapeHTML(result.outId)}</code>\n` +
      `Grants revoked: <code>${result.revokedCount}</code>`,
  };
}

function telegramUserId(message: TelegramMessage): TelegramUserId | null {
  if (message.from === undefined) return null;
  try {
    return asTelegramUserId(String(message.from.id));
  } catch {
    return null;
  }
}
