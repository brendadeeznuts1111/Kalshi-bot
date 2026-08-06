import type { Database } from "bun:sqlite";
import type { ApprovedAuthorization, OutId, PartnerCode, SkinId } from "./domain.ts";
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

export const AUTHORIZATION_MIGRATIONS = [
  {
    id: "001_account_authorization_core",
    sql: `
      CREATE TABLE IF NOT EXISTS account_authorization_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_code TEXT NOT NULL,
        out_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        skin TEXT NOT NULL,
        permission_scope TEXT NOT NULL CHECK (
          permission_scope IN ('observe_odds', 'paper_trade', 'live_trade')
        ),
        requested_max_stake INTEGER NOT NULL CHECK (
          typeof(requested_max_stake) = 'integer' AND requested_max_stake >= 0
        ),
        requested_max_win INTEGER NOT NULL CHECK (
          typeof(requested_max_win) = 'integer' AND requested_max_win >= 0
        ),
        max_win_basis TEXT NOT NULL CHECK (max_win_basis IN ('profit', 'total_return')),
        daily_limit INTEGER CHECK (
          daily_limit IS NULL OR (typeof(daily_limit) = 'integer' AND daily_limit >= 0)
        ),
        exposure_limit INTEGER CHECK (
          exposure_limit IS NULL OR (typeof(exposure_limit) = 'integer' AND exposure_limit >= 0)
        ),
        currency TEXT NOT NULL DEFAULT 'USD' CHECK (
          length(currency) = 3 AND currency = upper(currency)
          AND currency GLOB '[A-Z][A-Z][A-Z]'
        ),
        valid_from_ms INTEGER NOT NULL CHECK (typeof(valid_from_ms) = 'integer' AND valid_from_ms >= 0),
        expires_at_ms INTEGER CHECK (
          expires_at_ms IS NULL OR (
            typeof(expires_at_ms) = 'integer' AND expires_at_ms > valid_from_ms
          )
        ),
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        telegram_chat_id TEXT NOT NULL,
        telegram_topic_id TEXT,
        telegram_message_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')
        ),
        created_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
        updated_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
      );

      CREATE TABLE IF NOT EXISTS account_authorizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL UNIQUE REFERENCES account_authorization_requests(id),
        partner_code TEXT NOT NULL,
        out_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        skin TEXT NOT NULL,
        permission_scope TEXT NOT NULL CHECK (
          permission_scope IN ('observe_odds', 'paper_trade', 'live_trade')
        ),
        approved_max_stake INTEGER NOT NULL CHECK (
          typeof(approved_max_stake) = 'integer' AND approved_max_stake >= 0
        ),
        approved_max_win INTEGER NOT NULL CHECK (
          typeof(approved_max_win) = 'integer' AND approved_max_win >= 0
        ),
        max_win_basis TEXT NOT NULL CHECK (max_win_basis IN ('profit', 'total_return')),
        daily_limit INTEGER CHECK (
          daily_limit IS NULL OR (typeof(daily_limit) = 'integer' AND daily_limit >= 0)
        ),
        exposure_limit INTEGER CHECK (
          exposure_limit IS NULL OR (typeof(exposure_limit) = 'integer' AND exposure_limit >= 0)
        ),
        currency TEXT NOT NULL DEFAULT 'USD' CHECK (
          length(currency) = 3 AND currency = upper(currency)
          AND currency GLOB '[A-Z][A-Z][A-Z]'
        ),
        valid_from_ms INTEGER NOT NULL CHECK (typeof(valid_from_ms) = 'integer' AND valid_from_ms >= 0),
        expires_at_ms INTEGER CHECK (
          expires_at_ms IS NULL OR (
            typeof(expires_at_ms) = 'integer' AND expires_at_ms > valid_from_ms
          )
        ),
        approval_hash TEXT NOT NULL CHECK (length(approval_hash) = 64),
        telegram_chat_id TEXT NOT NULL,
        telegram_topic_id TEXT,
        telegram_message_id TEXT NOT NULL,
        telegram_approving_user_id TEXT NOT NULL,
        revoked_at_ms INTEGER CHECK (
          revoked_at_ms IS NULL OR (typeof(revoked_at_ms) = 'integer' AND revoked_at_ms >= 0)
        ),
        created_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
        updated_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
      );

      CREATE TABLE IF NOT EXISTS account_authorization_approvers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner_code TEXT NOT NULL,
        out_id TEXT,
        telegram_user_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
      );

      CREATE INDEX IF NOT EXISTS idx_auth_requests_pending
        ON account_authorization_requests (partner_code, out_id, status)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_auth_grants_lookup
        ON account_authorizations (
          partner_code, out_id, skin, permission_scope, revoked_at_ms, valid_from_ms, expires_at_ms
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_approvers_partner_wide
        ON account_authorization_approvers (partner_code, telegram_user_id)
        WHERE out_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_approvers_out
        ON account_authorization_approvers (partner_code, out_id, telegram_user_id)
        WHERE out_id IS NOT NULL;
    `,
  },
] as const;

type MigrationRow = {
  migrationId: string; // brand-ok — internal migration wire value, not a business identifier
};

/** Apply all authorization migrations to an existing Bun SQLite connection. */
export function migrateAuthorizationSchema(db: Database, nowMs = Date.now()): string[] {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("migration time must be a non-negative epoch-millisecond integer");
  }

  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS _partner_authorization_migrations (
    id TEXT PRIMARY KEY,
    applied_at_ms INTEGER NOT NULL
  )`);

  const applied = new Set(
    (
      db
        .query("SELECT id AS migrationId FROM _partner_authorization_migrations")
        .all() as MigrationRow[]
    ).map((row) => row.migrationId),
  );
  const newlyApplied: string[] = [];

  for (const migration of AUTHORIZATION_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.run("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.query(
        `INSERT INTO _partner_authorization_migrations (id, applied_at_ms)
         VALUES ($id, $appliedAtMs)`,
      ).run({ $id: migration.id, $appliedAtMs: nowMs });
      db.run("COMMIT");
      newlyApplied.push(migration.id);
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
  return newlyApplied;
}

export const ensureAuthorizationSchema = migrateAuthorizationSchema;

type AuthorizationRow = {
  id: number;
  request_id: number;
  partner_code: string;
  out_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorizationRow
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
  telegram_chat_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorizationRow
  telegram_topic_id: string | null; // brand-ok — SQLite wire value; parsed by mapAuthorizationRow
  telegram_message_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorizationRow
  telegram_approving_user_id: string; // brand-ok — SQLite wire value; parsed by mapAuthorizationRow
  revoked_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export interface ActiveAuthorizationLookup {
  partnerCode: PartnerCode;
  outId: OutId;
  skin: SkinId;
  nowMs: number;
}

/** Return the newest currently valid live-trade grant for one exact out and skin. */
export function getActiveLiveTradeAuthorization(
  db: Database,
  lookup: ActiveAuthorizationLookup,
): ApprovedAuthorization | null {
  if (!Number.isSafeInteger(lookup.nowMs) || lookup.nowMs < 0) {
    throw new TypeError("authorization lookup time must be a non-negative epoch-millisecond integer");
  }

  const row = db
    .query(
      `SELECT *
       FROM account_authorizations
       WHERE partner_code = $partnerCode
         AND out_id = $outId
         AND skin = $skin
         AND permission_scope = 'live_trade'
         AND revoked_at_ms IS NULL
         AND valid_from_ms <= $nowMs
         AND (expires_at_ms IS NULL OR expires_at_ms > $nowMs)
       ORDER BY created_at_ms DESC, id DESC
       LIMIT 1`,
    )
    .get({
      $partnerCode: lookup.partnerCode,
      $outId: lookup.outId,
      $skin: lookup.skin,
      $nowMs: lookup.nowMs,
    }) as AuthorizationRow | null;

  return row === null ? null : mapAuthorizationRow(row);
}

function mapAuthorizationRow(row: AuthorizationRow): ApprovedAuthorization {
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
