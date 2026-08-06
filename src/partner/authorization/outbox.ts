import type { Database } from "bun:sqlite";
import {
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramTopicId,
  type TelegramChatId,
  type TelegramMessageId,
  type TelegramTopicId,
} from "./domain.ts";

declare const receiptOutboxIdBrand: unique symbol;
declare const receiptDedupeKeyBrand: unique symbol;
declare const receiptLeaseOwnerBrand: unique symbol;

export type AuthorizationReceiptOutboxId = number & { readonly [receiptOutboxIdBrand]: true };
export type AuthorizationReceiptDedupeKey = string & {
  readonly [receiptDedupeKeyBrand]: true;
};
export type AuthorizationReceiptLeaseOwner = string & {
  readonly [receiptLeaseOwnerBrand]: true;
};

export const AUTHORIZATION_RECEIPT_STATUSES = ["pending", "sent", "dead"] as const;
export type AuthorizationReceiptStatus = (typeof AUTHORIZATION_RECEIPT_STATUSES)[number];

export interface AuthorizationReceiptPayload {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  disableNotification?: boolean;
  replyToMessageId?: TelegramMessageId;
}

export interface AuthorizationReceiptOutboxItem {
  id: AuthorizationReceiptOutboxId;
  dedupeKey: AuthorizationReceiptDedupeKey;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  payload: AuthorizationReceiptPayload;
  status: AuthorizationReceiptStatus;
  attempts: number;
  availableAtMs: number;
  leaseOwner: AuthorizationReceiptLeaseOwner | null;
  leaseExpiresAtMs: number | null;
  lastError: string | null;
  sentAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface EnqueueAuthorizationReceiptInput {
  dedupeKey: AuthorizationReceiptDedupeKey;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  payload: AuthorizationReceiptPayload;
  availableAtMs?: number;
}

export interface EnqueueAuthorizationReceiptResult {
  created: boolean;
  item: AuthorizationReceiptOutboxItem;
}

export interface ClaimAuthorizationReceiptsInput {
  nowMs: number;
  leaseOwner: AuthorizationReceiptLeaseOwner;
  leaseDurationMs: number;
  limit?: number;
}

export interface MarkAuthorizationReceiptSentInput {
  id: AuthorizationReceiptOutboxId;
  leaseOwner: AuthorizationReceiptLeaseOwner;
  nowMs: number;
}

export interface MarkAuthorizationReceiptFailedInput {
  id: AuthorizationReceiptOutboxId;
  leaseOwner: AuthorizationReceiptLeaseOwner;
  nowMs: number;
  error: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class AuthorizationReceiptDedupeConflictError extends Error {
  constructor(dedupeKey: AuthorizationReceiptDedupeKey) {
    super(`authorization receipt dedupe key already exists with different content: ${dedupeKey}`);
    this.name = "AuthorizationReceiptDedupeConflictError";
  }
}

type OutboxRow = {
  id: number;
  dedupe_key: string;
  telegram_chat_id: string; // brand-ok — SQLite wire value; parsed by mapOutboxRow
  telegram_topic_id: string | null; // brand-ok — SQLite wire value; parsed by mapOutboxRow
  payload_json: string;
  status: AuthorizationReceiptStatus;
  attempts: number;
  available_at_ms: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  last_error: string | null;
  sent_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export function asAuthorizationReceiptOutboxId(value: number): AuthorizationReceiptOutboxId {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("authorization receipt outbox ID must be a positive safe integer");
  }
  return value as AuthorizationReceiptOutboxId;
}

export function asAuthorizationReceiptDedupeKey(value: string): AuthorizationReceiptDedupeKey {
  return brandBoundedString<AuthorizationReceiptDedupeKey>(
    value,
    "authorization receipt dedupe key",
    256,
  );
}

export function asAuthorizationReceiptLeaseOwner(value: string): AuthorizationReceiptLeaseOwner {
  return brandBoundedString<AuthorizationReceiptLeaseOwner>(
    value,
    "authorization receipt lease owner",
    128,
  );
}

/** Insert once by dedupe key. A reused key must describe the exact same immutable receipt. */
export function enqueueAuthorizationReceipt(
  db: Database,
  input: EnqueueAuthorizationReceiptInput,
  nowMs = Date.now(),
): EnqueueAuthorizationReceiptResult {
  assertTimestamp(nowMs, "enqueue time");
  const availableAtMs = input.availableAtMs ?? nowMs;
  assertTimestamp(availableAtMs, "receipt available time");
  const payloadJson = serializePayload(input.payload);

  const inserted = db
    .query(
      `INSERT INTO account_authorization_receipt_outbox (
        dedupe_key, telegram_chat_id, telegram_topic_id, payload_json,
        available_at_ms, created_at_ms, updated_at_ms
      ) VALUES (
        $dedupeKey, $chatId, $topicId, $payloadJson,
        $availableAtMs, $nowMs, $nowMs
      )
      ON CONFLICT(dedupe_key) DO NOTHING
      RETURNING *`,
    )
    .get({
      $dedupeKey: input.dedupeKey,
      $chatId: input.telegramChatId,
      $topicId: input.telegramTopicId,
      $payloadJson: payloadJson,
      $availableAtMs: availableAtMs,
      $nowMs: nowMs,
    }) as OutboxRow | null;

  if (inserted !== null) return { created: true, item: mapOutboxRow(inserted) };

  const existing = db
    .query(
      `SELECT * FROM account_authorization_receipt_outbox
       WHERE dedupe_key = $dedupeKey`,
    )
    .get({ $dedupeKey: input.dedupeKey }) as OutboxRow | null;
  if (existing === null) throw new Error("authorization receipt dedupe lookup failed");

  if (
    existing.telegram_chat_id !== input.telegramChatId ||
    existing.telegram_topic_id !== input.telegramTopicId ||
    existing.payload_json !== payloadJson
  ) {
    throw new AuthorizationReceiptDedupeConflictError(input.dedupeKey);
  }
  return { created: false, item: mapOutboxRow(existing) };
}

/** Claim due pending receipts under one transaction and increment their delivery attempts. */
export function claimDueAuthorizationReceipts(
  db: Database,
  input: ClaimAuthorizationReceiptsInput,
): AuthorizationReceiptOutboxItem[] {
  assertTimestamp(input.nowMs, "claim time");
  assertPositiveInteger(input.leaseDurationMs, "lease duration");
  const limit = input.limit ?? 25;
  assertPositiveInteger(limit, "claim limit");
  if (limit > 1_000) throw new TypeError("claim limit must not exceed 1000");
  const leaseExpiresAtMs = safeAdd(input.nowMs, input.leaseDurationMs, "lease expiry");

  db.run("BEGIN IMMEDIATE");
  try {
    const candidates = db
      .query(
        `SELECT id
         FROM account_authorization_receipt_outbox
         WHERE status = 'pending'
           AND available_at_ms <= $nowMs
           AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= $nowMs)
         ORDER BY available_at_ms ASC, id ASC
         LIMIT $limit`,
      )
      .all({ $nowMs: input.nowMs, $limit: limit }) as Array<{ id: number }>;

    const claimed: AuthorizationReceiptOutboxItem[] = [];
    const claim = db.query(
      `UPDATE account_authorization_receipt_outbox
       SET lease_owner = $leaseOwner,
           lease_expires_at_ms = $leaseExpiresAtMs,
           attempts = attempts + 1,
           updated_at_ms = $nowMs
       WHERE id = $id
         AND status = 'pending'
         AND available_at_ms <= $nowMs
         AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= $nowMs)
       RETURNING *`,
    );
    for (const candidate of candidates) {
      const row = claim.get({
        $leaseOwner: input.leaseOwner,
        $leaseExpiresAtMs: leaseExpiresAtMs,
        $nowMs: input.nowMs,
        $id: candidate.id,
      }) as OutboxRow | null;
      if (row !== null) claimed.push(mapOutboxRow(row));
    }
    db.run("COMMIT");
    return claimed;
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

/** Mark a receipt sent only while the caller still owns its unexpired lease. */
export function markAuthorizationReceiptSent(
  db: Database,
  input: MarkAuthorizationReceiptSentInput,
): AuthorizationReceiptOutboxItem | null {
  assertTimestamp(input.nowMs, "sent time");
  const row = db
    .query(
      `UPDATE account_authorization_receipt_outbox
       SET status = 'sent',
           sent_at_ms = $nowMs,
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           last_error = NULL,
           updated_at_ms = $nowMs
       WHERE id = $id
         AND status = 'pending'
         AND lease_owner = $leaseOwner
         AND lease_expires_at_ms > $nowMs
       RETURNING *`,
    )
    .get({ $id: input.id, $leaseOwner: input.leaseOwner, $nowMs: input.nowMs }) as OutboxRow | null;
  return row === null ? null : mapOutboxRow(row);
}

/** Release a claimed receipt for retry, or dead-letter it when the attempt budget is exhausted. */
export function markAuthorizationReceiptFailed(
  db: Database,
  input: MarkAuthorizationReceiptFailedInput,
): AuthorizationReceiptOutboxItem | null {
  assertTimestamp(input.nowMs, "failure time");
  const maxAttempts = input.maxAttempts ?? 5;
  const baseDelayMs = input.baseDelayMs ?? 1_000;
  const maxDelayMs = input.maxDelayMs ?? 60_000;
  assertPositiveInteger(maxAttempts, "maximum attempts");
  assertPositiveInteger(baseDelayMs, "base retry delay");
  assertPositiveInteger(maxDelayMs, "maximum retry delay");
  if (maxDelayMs < baseDelayMs) {
    throw new TypeError("maximum retry delay must be at least the base retry delay");
  }
  const lastError = normalizeError(input.error);

  db.run("BEGIN IMMEDIATE");
  try {
    const claimed = db
      .query(
        `SELECT attempts
         FROM account_authorization_receipt_outbox
         WHERE id = $id
           AND status = 'pending'
           AND lease_owner = $leaseOwner
           AND lease_expires_at_ms > $nowMs`,
      )
      .get({ $id: input.id, $leaseOwner: input.leaseOwner, $nowMs: input.nowMs }) as
      | { attempts: number }
      | null;

    if (claimed === null) {
      db.run("COMMIT");
      return null;
    }

    const dead = claimed.attempts >= maxAttempts;
    const availableAtMs = dead
      ? input.nowMs
      : safeAdd(
          input.nowMs,
          boundedBackoff(claimed.attempts, baseDelayMs, maxDelayMs),
          "retry availability",
        );
    const row = db
      .query(
        `UPDATE account_authorization_receipt_outbox
         SET status = $status,
             available_at_ms = $availableAtMs,
             lease_owner = NULL,
             lease_expires_at_ms = NULL,
             last_error = $lastError,
             updated_at_ms = $nowMs
         WHERE id = $id
           AND status = 'pending'
           AND lease_owner = $leaseOwner
           AND lease_expires_at_ms > $nowMs
         RETURNING *`,
      )
      .get({
        $status: dead ? "dead" : "pending",
        $availableAtMs: availableAtMs,
        $lastError: lastError,
        $nowMs: input.nowMs,
        $id: input.id,
        $leaseOwner: input.leaseOwner,
      }) as OutboxRow | null;
    db.run("COMMIT");
    return row === null ? null : mapOutboxRow(row);
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

export function getAuthorizationReceiptOutboxItem(
  db: Database,
  id: AuthorizationReceiptOutboxId,
): AuthorizationReceiptOutboxItem | null {
  const row = db
    .query("SELECT * FROM account_authorization_receipt_outbox WHERE id = $id")
    .get({ $id: id }) as OutboxRow | null;
  return row === null ? null : mapOutboxRow(row);
}

function mapOutboxRow(row: OutboxRow): AuthorizationReceiptOutboxItem {
  return {
    id: asAuthorizationReceiptOutboxId(row.id),
    dedupeKey: asAuthorizationReceiptDedupeKey(row.dedupe_key),
    telegramChatId: asTelegramChatId(row.telegram_chat_id),
    telegramTopicId:
      row.telegram_topic_id === null ? null : asTelegramTopicId(row.telegram_topic_id),
    payload: parsePayload(row.payload_json),
    status: row.status,
    attempts: row.attempts,
    availableAtMs: row.available_at_ms,
    leaseOwner:
      row.lease_owner === null ? null : asAuthorizationReceiptLeaseOwner(row.lease_owner),
    leaseExpiresAtMs: row.lease_expires_at_ms,
    lastError: row.last_error,
    sentAtMs: row.sent_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function serializePayload(payload: AuthorizationReceiptPayload): string {
  const normalized = validatePayload(payload);
  // Explicit field order is the durable wire contract.
  return JSON.stringify({
    text: normalized.text,
    ...(normalized.parseMode === undefined ? {} : { parseMode: normalized.parseMode }),
    ...(normalized.disableNotification === undefined
      ? {}
      : { disableNotification: normalized.disableNotification }),
    ...(normalized.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: normalized.replyToMessageId }),
  });
}

function parsePayload(payloadJson: string): AuthorizationReceiptPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw new TypeError("stored authorization receipt payload is not valid JSON");
  }
  return validatePayload(parsed);
}

function validatePayload(payload: unknown): AuthorizationReceiptPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new TypeError("authorization receipt payload must be an object");
  }
  const candidate = payload as Record<string, unknown>;
  const allowed = new Set(["text", "parseMode", "disableNotification", "replyToMessageId"]);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) throw new TypeError(`unknown authorization receipt payload field: ${key}`);
  }
  if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
    throw new TypeError("authorization receipt text must not be empty");
  }
  if (candidate.text.length > 4_096) {
    throw new TypeError("authorization receipt text must be at most 4096 characters");
  }
  if (
    candidate.parseMode !== undefined &&
    candidate.parseMode !== "HTML" &&
    candidate.parseMode !== "MarkdownV2"
  ) {
    throw new TypeError("authorization receipt parse mode must be HTML or MarkdownV2");
  }
  if (
    candidate.disableNotification !== undefined &&
    typeof candidate.disableNotification !== "boolean"
  ) {
    throw new TypeError("authorization receipt disableNotification must be boolean");
  }

  const result: AuthorizationReceiptPayload = { text: candidate.text };
  if (candidate.parseMode !== undefined) result.parseMode = candidate.parseMode;
  if (candidate.disableNotification !== undefined) {
    result.disableNotification = candidate.disableNotification;
  }
  if (candidate.replyToMessageId !== undefined) {
    if (typeof candidate.replyToMessageId !== "string") {
      throw new TypeError("authorization receipt replyToMessageId must be a string");
    }
    result.replyToMessageId = asTelegramMessageId(candidate.replyToMessageId);
  }
  return result;
}

function boundedBackoff(attempts: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 52);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

function normalizeError(error: string): string {
  const normalized = error.trim() || "delivery failed";
  return normalized.slice(0, 2_048);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch-millisecond integer`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new TypeError(`${label} exceeds safe integer range`);
  return result;
}

function brandBoundedString<T extends string>(value: string, label: string, max: number): T {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > max) throw new TypeError(`${label} must be at most ${max} characters`);
  if (/\p{Cc}/u.test(normalized)) throw new TypeError(`${label} must not contain control characters`);
  return normalized as T;
}
