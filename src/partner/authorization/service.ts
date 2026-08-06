import type { Database } from "bun:sqlite";
import type {
  ApprovedAuthorization,
  AuthorizationPolicy,
  AuthorizationRequest,
  AuthorizationRequestId,
  OutId,
  PartnerCode,
  PolicyHash,
  SkinId,
  TelegramChatId,
  TelegramMessageId,
  TelegramTopicId,
  TelegramUserId,
} from "./domain.ts";
import {
  asAuthorizationId,
  asAuthorizationRequestId,
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asPolicyHash,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
  asTelegramUserId,
} from "./domain.ts";
import { computePolicyHash, verifyPolicyMatch } from "./hash.ts";

export interface CreateAuthorizationRequestInput {
  policy: AuthorizationPolicy;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  telegramMessageId: TelegramMessageId;
  nowMs: number;
}

export type CreateAuthorizationRequestResult =
  | { ok: true; code: "REQUEST_CREATED"; request: AuthorizationRequest }
  | {
      ok: false;
      code: "INVALID_INPUT" | "POLICY_ALREADY_EXPIRED" | "DATABASE_ERROR";
      reason: string;
    };

export interface ApproveAuthorizationRequestInput {
  requestId: AuthorizationRequestId;
  currentPolicy: AuthorizationPolicy;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  telegramMessageId: TelegramMessageId;
  approvingUserId: TelegramUserId;
  nowMs: number;
}

export type ApproveAuthorizationRequestResult =
  | {
      ok: true;
      code: "AUTHORIZATION_APPROVED" | "ALREADY_APPROVED";
      authorization: ApprovedAuthorization;
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "REQUEST_NOT_FOUND"
        | "REQUEST_NOT_PENDING"
        | "REQUEST_EXPIRED"
        | "CHAT_MISMATCH"
        | "TOPIC_MISMATCH"
        | "APPROVER_NOT_ALLOWED"
        | "POLICY_HASH_MISMATCH"
        | "DATABASE_ERROR";
      reason: string;
    };

export interface RevokeAuthorizationsInput {
  partnerCode: PartnerCode;
  outId: OutId;
  skin: SkinId;
  nowMs: number;
}

export type RevokeAuthorizationsResult =
  | { ok: true; code: "AUTHORIZATIONS_REVOKED"; revokedCount: number }
  | {
      ok: false;
      code: "INVALID_INPUT" | "NO_ACTIVE_AUTHORIZATIONS" | "DATABASE_ERROR";
      reason: string;
    };

export interface RevokeOutFromTelegramInput {
  outId: OutId;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  telegramMessageId: TelegramMessageId;
  revokingUserId: TelegramUserId;
  nowMs: number;
}

export type RevokeOutFromTelegramResult =
  | {
      ok: true;
      code: "OUT_AUTHORIZATIONS_REVOKED";
      partnerCode: PartnerCode;
      outId: OutId;
      revokedCount: number;
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "NO_ACTIVE_AUTHORIZATIONS"
        | "CHANNEL_MISMATCH"
        | "AMBIGUOUS_OUT"
        | "APPROVER_NOT_ALLOWED"
        | "DATABASE_ERROR";
      reason: string;
    };

type RequestRow = {
  id: number;
  partner_code: string;
  out_id: string; // brand-ok — SQLite wire value; parsed by requestPolicy
  provider: string;
  skin: string;
  permission_scope: AuthorizationRequest["scope"];
  requested_max_stake: number;
  requested_max_win: number;
  max_win_basis: AuthorizationRequest["maxWinBasis"];
  daily_limit: number | null;
  exposure_limit: number | null;
  currency: string;
  valid_from_ms: number;
  expires_at_ms: number | null;
  request_hash: string;
  telegram_chat_id: string; // brand-ok — SQLite wire value; parsed by mapRequest
  telegram_topic_id: string | null; // brand-ok — SQLite wire value; parsed by mapRequest
  telegram_message_id: string; // brand-ok — SQLite wire value; parsed by mapRequest
  status: AuthorizationRequest["status"];
  created_at_ms: number;
  updated_at_ms: number;
};

type AuthorizationRow = {
  id: number;
  request_id: number;
  partner_code: string;
  out_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorization
  provider: string;
  skin: string;
  permission_scope: ApprovedAuthorization["scope"];
  approved_max_stake: number;
  approved_max_win: number;
  max_win_basis: ApprovedAuthorization["maxWinBasis"];
  daily_limit: number | null;
  exposure_limit: number | null;
  currency: string;
  valid_from_ms: number;
  expires_at_ms: number | null;
  approval_hash: string;
  telegram_chat_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorization
  telegram_topic_id: string | null; // brand-ok — SQLite wire value; parsed by mapAuthorization
  telegram_message_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorization
  telegram_approving_user_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorization
  revoked_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function validateNowMs(nowMs: number): string | null {
  return Number.isSafeInteger(nowMs) && nowMs >= 0
    ? null
    : "nowMs must be a non-negative epoch-millisecond integer";
}

function requestPolicy(row: RequestRow): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode(row.partner_code),
    outId: asOutId(row.out_id),
    provider: asProviderId(row.provider),
    skin: asSkinId(row.skin),
    scope: row.permission_scope,
    maxStake: row.requested_max_stake,
    maxWin: row.requested_max_win,
    maxWinBasis: row.max_win_basis,
    dailyLimit: row.daily_limit,
    exposureLimit: row.exposure_limit,
    currency: asCurrencyCode(row.currency),
    validFromMs: row.valid_from_ms,
    expiresAtMs: row.expires_at_ms,
  };
}

function mapRequest(row: RequestRow): AuthorizationRequest {
  return {
    id: asAuthorizationRequestId(row.id),
    ...requestPolicy(row),
    status: row.status,
    requestHash: asPolicyHash(row.request_hash),
    telegramChatId: asTelegramChatId(row.telegram_chat_id),
    telegramTopicId:
      row.telegram_topic_id === null ? null : asTelegramTopicId(row.telegram_topic_id),
    telegramMessageId: asTelegramMessageId(row.telegram_message_id),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function mapAuthorization(row: AuthorizationRow): ApprovedAuthorization {
  return {
    id: asAuthorizationId(row.id),
    requestId: asAuthorizationRequestId(row.request_id),
    partnerCode: asPartnerCode(row.partner_code),
    outId: asOutId(row.out_id),
    provider: asProviderId(row.provider),
    skin: asSkinId(row.skin),
    scope: row.permission_scope,
    maxStake: row.approved_max_stake,
    maxWin: row.approved_max_win,
    maxWinBasis: row.max_win_basis,
    dailyLimit: row.daily_limit,
    exposureLimit: row.exposure_limit,
    currency: asCurrencyCode(row.currency),
    validFromMs: row.valid_from_ms,
    expiresAtMs: row.expires_at_ms,
    approvalHash: asPolicyHash(row.approval_hash),
    telegramChatId: asTelegramChatId(row.telegram_chat_id),
    telegramTopicId:
      row.telegram_topic_id === null ? null : asTelegramTopicId(row.telegram_topic_id),
    telegramMessageId: asTelegramMessageId(row.telegram_message_id),
    approvingUserId: asTelegramUserId(row.telegram_approving_user_id),
    revokedAtMs: row.revoked_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function databaseFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : "authorization database operation failed";
}

/** Persist an immutable policy request after its Telegram request message exists. */
export function createAuthorizationRequest(
  db: Database,
  input: CreateAuthorizationRequestInput,
): CreateAuthorizationRequestResult {
  const invalidTime = validateNowMs(input.nowMs);
  if (invalidTime !== null) return { ok: false, code: "INVALID_INPUT", reason: invalidTime };
  if (input.policy.expiresAtMs !== null && input.policy.expiresAtMs <= input.nowMs) {
    return {
      ok: false,
      code: "POLICY_ALREADY_EXPIRED",
      reason: "authorization policy is already expired",
    };
  }

  let requestHash: PolicyHash;
  try {
    requestHash = computePolicyHash(input.policy);
    asTelegramChatId(input.telegramChatId);
    if (input.telegramTopicId !== null) asTelegramTopicId(input.telegramTopicId);
    asTelegramMessageId(input.telegramMessageId);
  } catch (error) {
    return { ok: false, code: "INVALID_INPUT", reason: databaseFailure(error) };
  }

  try {
    const row = db
      .query(
        `INSERT INTO account_authorization_requests (
          partner_code, out_id, provider, skin, permission_scope,
          requested_max_stake, requested_max_win, max_win_basis,
          daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
          request_hash, telegram_chat_id, telegram_topic_id, telegram_message_id,
          status, created_at_ms, updated_at_ms
        ) VALUES (
          $partnerCode, $outId, $provider, $skin, $scope,
          $maxStake, $maxWin, $maxWinBasis,
          $dailyLimit, $exposureLimit, $currency, $validFromMs, $expiresAtMs,
          $requestHash, $telegramChatId, $telegramTopicId, $telegramMessageId,
          'pending', $nowMs, $nowMs
        ) RETURNING *`,
      )
      .get({
        $partnerCode: input.policy.partnerCode,
        $outId: input.policy.outId,
        $provider: input.policy.provider,
        $skin: input.policy.skin,
        $scope: input.policy.scope,
        $maxStake: input.policy.maxStake,
        $maxWin: input.policy.maxWin,
        $maxWinBasis: input.policy.maxWinBasis,
        $dailyLimit: input.policy.dailyLimit,
        $exposureLimit: input.policy.exposureLimit,
        $currency: input.policy.currency,
        $validFromMs: input.policy.validFromMs,
        $expiresAtMs: input.policy.expiresAtMs,
        $requestHash: requestHash,
        $telegramChatId: input.telegramChatId,
        $telegramTopicId: input.telegramTopicId,
        $telegramMessageId: input.telegramMessageId,
        $nowMs: input.nowMs,
      }) as RequestRow;
    return { ok: true, code: "REQUEST_CREATED", request: mapRequest(row) };
  } catch (error) {
    return { ok: false, code: "DATABASE_ERROR", reason: databaseFailure(error) };
  }
}

function getAuthorizationByRequestId(
  db: Database,
  requestId: AuthorizationRequestId,
): ApprovedAuthorization | null {
  const row = db
    .query("SELECT * FROM account_authorizations WHERE request_id = $requestId")
    .get({ $requestId: requestId }) as AuthorizationRow | null;
  return row === null ? null : mapAuthorization(row);
}

export function getAuthorizationRequest(
  db: Database,
  requestId: AuthorizationRequestId,
): AuthorizationRequest | null {
  const row = db
    .query("SELECT * FROM account_authorization_requests WHERE id = $requestId")
    .get({ $requestId: requestId }) as RequestRow | null;
  return row === null ? null : mapRequest(row);
}

/** Resolve the newest approval policy snapshot for the same partner/out/provider/skin lane. */
export function getCurrentAuthorizationPolicy(
  db: Database,
  request: AuthorizationRequest,
): AuthorizationPolicy | null {
  const row = db
    .query(
      `SELECT *
       FROM account_authorization_requests
       WHERE partner_code = $partnerCode
         AND out_id = $outId
         AND provider = $provider
         AND skin = $skin
         AND status IN ('pending', 'approved')
       ORDER BY created_at_ms DESC, id DESC
       LIMIT 1`,
    )
    .get({
      $partnerCode: request.partnerCode,
      $outId: request.outId,
      $provider: request.provider,
      $skin: request.skin,
    }) as RequestRow | null;
  return row === null ? null : requestPolicy(row);
}

/**
 * Approve one pending request in a single immediate transaction.
 * An explicit partner-wide approver (out_id IS NULL) may approve any out for that partner.
 */
export function approveAuthorizationRequest(
  db: Database,
  input: ApproveAuthorizationRequestInput,
): ApproveAuthorizationRequestResult {
  const invalidTime = validateNowMs(input.nowMs);
  if (invalidTime !== null) return { ok: false, code: "INVALID_INPUT", reason: invalidTime };
  try {
    asAuthorizationRequestId(input.requestId);
    asTelegramChatId(input.telegramChatId);
    if (input.telegramTopicId !== null) asTelegramTopicId(input.telegramTopicId);
    asTelegramMessageId(input.telegramMessageId);
    asTelegramUserId(input.approvingUserId);
    computePolicyHash(input.currentPolicy);
  } catch (error) {
    return { ok: false, code: "INVALID_INPUT", reason: databaseFailure(error) };
  }

  try {
    const transaction = db.transaction((): ApproveAuthorizationRequestResult => {
      const row = db
        .query("SELECT * FROM account_authorization_requests WHERE id = $requestId")
        .get({ $requestId: input.requestId }) as RequestRow | null;
      if (row === null) {
        return { ok: false, code: "REQUEST_NOT_FOUND", reason: "authorization request not found" };
      }

      if (row.telegram_chat_id !== input.telegramChatId) {
        return { ok: false, code: "CHAT_MISMATCH", reason: "approval chat does not match request" };
      }
      if (row.telegram_topic_id !== input.telegramTopicId) {
        return { ok: false, code: "TOPIC_MISMATCH", reason: "approval topic does not match request" };
      }

      if (row.status === "approved") {
        const replayedAuthorization = getAuthorizationByRequestId(
          db,
          asAuthorizationRequestId(row.id),
        );
        if (
          replayedAuthorization !== null &&
          replayedAuthorization.telegramChatId === input.telegramChatId &&
          replayedAuthorization.telegramTopicId === input.telegramTopicId &&
          replayedAuthorization.telegramMessageId === input.telegramMessageId &&
          replayedAuthorization.approvingUserId === input.approvingUserId
        ) {
          return {
            ok: true,
            code: "ALREADY_APPROVED",
            authorization: replayedAuthorization,
          };
        }
      }

      const approver = db
        .query(
          `SELECT 1 AS allowed
           FROM account_authorization_approvers
           WHERE partner_code = $partnerCode
             AND telegram_user_id = $telegramUserId
             AND (out_id = $outId OR out_id IS NULL)
           LIMIT 1`,
        )
        .get({
          $partnerCode: row.partner_code,
          $outId: row.out_id,
          $telegramUserId: input.approvingUserId,
        }) as { allowed: number } | null;
      if (approver === null) {
        return {
          ok: false,
          code: "APPROVER_NOT_ALLOWED",
          reason: "Telegram user is not allowlisted for this partner and out",
        };
      }

      const persistedPolicy = requestPolicy(row);
      if (
        !verifyPolicyMatch(persistedPolicy, row.request_hash) ||
        !verifyPolicyMatch(input.currentPolicy, row.request_hash)
      ) {
        return {
          ok: false,
          code: "POLICY_HASH_MISMATCH",
          reason: "persisted or current policy does not match the requested policy hash",
        };
      }

      if (row.status === "approved") {
        const authorization = getAuthorizationByRequestId(db, asAuthorizationRequestId(row.id));
        if (authorization !== null) {
          return { ok: true, code: "ALREADY_APPROVED", authorization };
        }
        return {
          ok: false,
          code: "DATABASE_ERROR",
          reason: "approved request has no authorization grant",
        };
      }
      if (row.status !== "pending") {
        return {
          ok: false,
          code: "REQUEST_NOT_PENDING",
          reason: `authorization request status is ${row.status}`,
        };
      }
      if (row.expires_at_ms !== null && row.expires_at_ms <= input.nowMs) {
        db.query(
          `UPDATE account_authorization_requests
           SET status = 'expired', updated_at_ms = $nowMs
           WHERE id = $requestId AND status = 'pending'`,
        ).run({ $nowMs: input.nowMs, $requestId: row.id });
        return { ok: false, code: "REQUEST_EXPIRED", reason: "authorization request has expired" };
      }

      const grantRow = db
        .query(
          `INSERT INTO account_authorizations (
            request_id, partner_code, out_id, provider, skin, permission_scope,
            approved_max_stake, approved_max_win, max_win_basis,
            daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
            approval_hash, telegram_chat_id, telegram_topic_id, telegram_message_id,
            telegram_approving_user_id, revoked_at_ms, created_at_ms, updated_at_ms
          ) VALUES (
            $requestId, $partnerCode, $outId, $provider, $skin, $scope,
            $maxStake, $maxWin, $maxWinBasis,
            $dailyLimit, $exposureLimit, $currency, $validFromMs, $expiresAtMs,
            $approvalHash, $telegramChatId, $telegramTopicId, $telegramMessageId,
            $approvingUserId, NULL, $nowMs, $nowMs
          ) RETURNING *`,
        )
        .get({
          $requestId: row.id,
          $partnerCode: persistedPolicy.partnerCode,
          $outId: persistedPolicy.outId,
          $provider: persistedPolicy.provider,
          $skin: persistedPolicy.skin,
          $scope: persistedPolicy.scope,
          $maxStake: persistedPolicy.maxStake,
          $maxWin: persistedPolicy.maxWin,
          $maxWinBasis: persistedPolicy.maxWinBasis,
          $dailyLimit: persistedPolicy.dailyLimit,
          $exposureLimit: persistedPolicy.exposureLimit,
          $currency: persistedPolicy.currency,
          $validFromMs: persistedPolicy.validFromMs,
          $expiresAtMs: persistedPolicy.expiresAtMs,
          $approvalHash: asPolicyHash(row.request_hash),
          $telegramChatId: input.telegramChatId,
          $telegramTopicId: input.telegramTopicId,
          $telegramMessageId: input.telegramMessageId,
          $approvingUserId: input.approvingUserId,
          $nowMs: input.nowMs,
        }) as AuthorizationRow;

      const changed = db
        .query(
          `UPDATE account_authorization_requests
           SET status = 'approved', updated_at_ms = $nowMs
           WHERE id = $requestId AND status = 'pending'`,
        )
        .run({ $nowMs: input.nowMs, $requestId: row.id });
      if (changed.changes !== 1) throw new Error("authorization request changed during approval");

      return {
        ok: true,
        code: "AUTHORIZATION_APPROVED",
        authorization: mapAuthorization(grantRow),
      };
    });
    return transaction.immediate();
  } catch (error) {
    return { ok: false, code: "DATABASE_ERROR", reason: databaseFailure(error) };
  }
}

/** Revoke every unrevoked grant for one exact partner, out, and skin. */
export function revokeAuthorizations(
  db: Database,
  input: RevokeAuthorizationsInput,
): RevokeAuthorizationsResult {
  const invalidTime = validateNowMs(input.nowMs);
  if (invalidTime !== null) return { ok: false, code: "INVALID_INPUT", reason: invalidTime };
  try {
    asPartnerCode(input.partnerCode);
    asOutId(input.outId);
    asSkinId(input.skin);
  } catch (error) {
    return { ok: false, code: "INVALID_INPUT", reason: databaseFailure(error) };
  }

  try {
    const result = db
      .query(
        `UPDATE account_authorizations
         SET revoked_at_ms = $nowMs, updated_at_ms = $nowMs
         WHERE partner_code = $partnerCode
           AND out_id = $outId
           AND skin = $skin
           AND revoked_at_ms IS NULL`,
      )
      .run({
        $nowMs: input.nowMs,
        $partnerCode: input.partnerCode,
        $outId: input.outId,
        $skin: input.skin,
      });
    if (result.changes === 0) {
      return {
        ok: false,
        code: "NO_ACTIVE_AUTHORIZATIONS",
        reason: "no unrevoked authorizations found for the exact partner, out, and skin",
      };
    }
    return { ok: true, code: "AUTHORIZATIONS_REVOKED", revokedCount: result.changes };
  } catch (error) {
    return { ok: false, code: "DATABASE_ERROR", reason: databaseFailure(error) };
  }
}

/** Revoke every skin for one out from its exact Telegram channel after an allowlist check. */
export function revokeOutFromTelegram(
  db: Database,
  input: RevokeOutFromTelegramInput,
): RevokeOutFromTelegramResult {
  const invalidTime = validateNowMs(input.nowMs);
  if (invalidTime !== null) return { ok: false, code: "INVALID_INPUT", reason: invalidTime };
  try {
    asOutId(input.outId);
    asTelegramChatId(input.telegramChatId);
    if (input.telegramTopicId !== null) asTelegramTopicId(input.telegramTopicId);
    asTelegramMessageId(input.telegramMessageId);
    asTelegramUserId(input.revokingUserId);
  } catch (error) {
    return { ok: false, code: "INVALID_INPUT", reason: databaseFailure(error) };
  }

  try {
    const transaction = db.transaction((): RevokeOutFromTelegramResult => {
      const replay = db
        .query(
          `SELECT partner_code, out_id, count(*) AS revoked_count
           FROM account_authorization_revocations
           WHERE out_id = $outId
             AND telegram_chat_id = $chatId
             AND telegram_topic_id IS $topicId
             AND telegram_message_id = $messageId
             AND telegram_revoking_user_id = $userId
           GROUP BY partner_code, out_id`,
        )
        .get({
          $outId: input.outId,
          $chatId: input.telegramChatId,
          $topicId: input.telegramTopicId,
          $messageId: input.telegramMessageId,
          $userId: input.revokingUserId,
        }) as
        | { partner_code: string; out_id: string; revoked_count: number } // brand-ok — SQLite replay row
        | null;
      if (replay !== null) {
        return {
          ok: true,
          code: "OUT_AUTHORIZATIONS_REVOKED",
          partnerCode: asPartnerCode(replay.partner_code),
          outId: asOutId(replay.out_id),
          revokedCount: replay.revoked_count,
        };
      }

      const allRows = db
        .query(
          `SELECT id, partner_code, out_id, skin
           FROM account_authorizations
           WHERE out_id = $outId AND revoked_at_ms IS NULL
           ORDER BY id`,
        )
        .all({ $outId: input.outId }) as Array<{
        id: number;
        partner_code: string;
        out_id: string; // brand-ok — SQLite wire value, constrained by input out brand
        skin: string;
      }>;
      if (allRows.length === 0) {
        return {
          ok: false,
          code: "NO_ACTIVE_AUTHORIZATIONS",
          reason: "no unrevoked authorizations found for this out",
        };
      }

      const channelRows = db
        .query(
          `SELECT id, partner_code, out_id, skin
           FROM account_authorizations
           WHERE out_id = $outId
             AND revoked_at_ms IS NULL
             AND telegram_chat_id = $chatId
             AND telegram_topic_id IS $topicId
           ORDER BY id`,
        )
        .all({
          $outId: input.outId,
          $chatId: input.telegramChatId,
          $topicId: input.telegramTopicId,
        }) as typeof allRows;
      if (channelRows.length === 0 || channelRows.length !== allRows.length) {
        return {
          ok: false,
          code: "CHANNEL_MISMATCH",
          reason: "active grants for this out are not bound exclusively to this chat and topic",
        };
      }

      const partnerCodes = new Set(channelRows.map((row) => row.partner_code));
      if (partnerCodes.size !== 1) {
        return {
          ok: false,
          code: "AMBIGUOUS_OUT",
          reason: "out ID resolves to more than one partner",
        };
      }
      const partnerCode = asPartnerCode(channelRows[0]!.partner_code);

      const approver = db
        .query(
          `SELECT 1 AS allowed
           FROM account_authorization_approvers
           WHERE partner_code = $partnerCode
             AND telegram_user_id = $telegramUserId
             AND (out_id = $outId OR out_id IS NULL)
           LIMIT 1`,
        )
        .get({
          $partnerCode: partnerCode,
          $outId: input.outId,
          $telegramUserId: input.revokingUserId,
        }) as { allowed: number } | null;
      if (approver === null) {
        return {
          ok: false,
          code: "APPROVER_NOT_ALLOWED",
          reason: "Telegram user is not allowlisted to revoke this partner and out",
        };
      }

      const insertEvidence = db.query(
        `INSERT INTO account_authorization_revocations (
          authorization_id, partner_code, out_id, skin,
          telegram_chat_id, telegram_topic_id, telegram_message_id,
          telegram_revoking_user_id, revoked_at_ms
        ) VALUES (
          $authorizationId, $partnerCode, $outId, $skin,
          $chatId, $topicId, $messageId, $userId, $nowMs
        )`,
      );
      for (const row of channelRows) {
        insertEvidence.run({
          $authorizationId: row.id,
          $partnerCode: partnerCode,
          $outId: input.outId,
          $skin: row.skin,
          $chatId: input.telegramChatId,
          $topicId: input.telegramTopicId,
          $messageId: input.telegramMessageId,
          $userId: input.revokingUserId,
          $nowMs: input.nowMs,
        });
      }

      const updated = db
        .query(
          `UPDATE account_authorizations
           SET revoked_at_ms = $nowMs, updated_at_ms = $nowMs
           WHERE out_id = $outId
             AND partner_code = $partnerCode
             AND revoked_at_ms IS NULL
             AND telegram_chat_id = $chatId
             AND telegram_topic_id IS $topicId`,
        )
        .run({
          $nowMs: input.nowMs,
          $outId: input.outId,
          $partnerCode: partnerCode,
          $chatId: input.telegramChatId,
          $topicId: input.telegramTopicId,
        });
      if (updated.changes !== channelRows.length) {
        throw new Error("authorization set changed during out revocation");
      }

      return {
        ok: true,
        code: "OUT_AUTHORIZATIONS_REVOKED",
        partnerCode,
        outId: input.outId,
        revokedCount: updated.changes,
      };
    });
    return transaction.immediate();
  } catch (error) {
    return { ok: false, code: "DATABASE_ERROR", reason: databaseFailure(error) };
  }
}
