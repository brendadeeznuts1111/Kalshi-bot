import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asAuthorizationId,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  computePolicyHash,
  getActiveLiveTradeAuthorization,
  migrateAuthorizationSchema,
  type AuthorizationPolicy,
  type AuthorizationId,
} from "../../../src/partner/authorization/index.ts";

const NOW_MS = 1_700_000_000_000;

function policy(): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("TEST"),
    outId: asOutId("out-TEST-1"),
    provider: asProviderId("test-provider"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 50_000,
    maxWin: 100_000,
    maxWinBasis: "profit",
    dailyLimit: 1_000_000,
    exposureLimit: 500_000,
    currency: asCurrencyCode("USD"),
    validFromMs: NOW_MS - 1_000,
    expiresAtMs: NOW_MS + 1_000,
  };
}

function insertGrant(db: Database, approvedPolicy = policy()): AuthorizationId {
  const hash = computePolicyHash(approvedPolicy);
  const request = db
    .query(
      `INSERT INTO account_authorization_requests (
        partner_code, out_id, provider, skin, permission_scope,
        requested_max_stake, requested_max_win, max_win_basis,
        daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
        request_hash, telegram_chat_id, telegram_message_id
      ) VALUES (
        $partner, $out, $provider, $skin, $scope,
        $maxStake, $maxWin, $basis,
        $daily, $exposure, $currency, $validFrom, $expiresAt,
        $hash, '-123', '456'
      ) RETURNING id`,
    )
    .get({
      $partner: approvedPolicy.partnerCode,
      $out: approvedPolicy.outId,
      $provider: approvedPolicy.provider,
      $skin: approvedPolicy.skin,
      $scope: approvedPolicy.scope,
      $maxStake: approvedPolicy.maxStake,
      $maxWin: approvedPolicy.maxWin,
      $basis: approvedPolicy.maxWinBasis,
      $daily: approvedPolicy.dailyLimit,
      $exposure: approvedPolicy.exposureLimit,
      $currency: approvedPolicy.currency,
      $validFrom: approvedPolicy.validFromMs,
      $expiresAt: approvedPolicy.expiresAtMs,
      $hash: hash,
    }) as { id: number };

  const grant = db
    .query(
      `INSERT INTO account_authorizations (
        request_id, partner_code, out_id, provider, skin, permission_scope,
        approved_max_stake, approved_max_win, max_win_basis,
        daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
        approval_hash, telegram_chat_id, telegram_message_id, telegram_approving_user_id
      ) VALUES (
        $requestId, $partner, $out, $provider, $skin, $scope,
        $maxStake, $maxWin, $basis,
        $daily, $exposure, $currency, $validFrom, $expiresAt,
        $hash, '-123', '457', '789'
      ) RETURNING id`,
    )
    .get({
      $requestId: request.id,
      $partner: approvedPolicy.partnerCode,
      $out: approvedPolicy.outId,
      $provider: approvedPolicy.provider,
      $skin: approvedPolicy.skin,
      $scope: approvedPolicy.scope,
      $maxStake: approvedPolicy.maxStake,
      $maxWin: approvedPolicy.maxWin,
      $basis: approvedPolicy.maxWinBasis,
      $daily: approvedPolicy.dailyLimit,
      $exposure: approvedPolicy.exposureLimit,
      $currency: approvedPolicy.currency,
      $validFrom: approvedPolicy.validFromMs,
      $expiresAt: approvedPolicy.expiresAtMs,
      $hash: hash,
    }) as { id: number };
  return asAuthorizationId(grant.id);
}

describe("authorization SQL boundary", () => {
  test("migrates idempotently and records epoch milliseconds", () => {
    const db = new Database(":memory:");
    expect(migrateAuthorizationSchema(db, NOW_MS)).toEqual([
      "001_account_authorization_core",
      "002_account_authorization_receipt_outbox",
      "003_account_authorization_revocations",
    ]);
    expect(migrateAuthorizationSchema(db, NOW_MS + 1)).toEqual([]);

    const migration = db
      .query("SELECT applied_at_ms FROM _partner_authorization_migrations")
      .get() as { applied_at_ms: number };
    expect(migration.applied_at_ms).toBe(NOW_MS);

    const indexSql = db
      .query("SELECT sql FROM sqlite_master WHERE name = 'idx_auth_grants_lookup'")
      .get() as { sql: string };
    expect(indexSql.sql).not.toContain("unixepoch");
    db.close();
  });

  test("loads only grants active at the supplied query time", () => {
    const db = new Database(":memory:");
    migrateAuthorizationSchema(db, NOW_MS);
    const grantId = insertGrant(db);

    const lookup = {
      partnerCode: asPartnerCode("TEST"),
      outId: asOutId("out-TEST-1"),
      skin: asSkinId("main"),
      nowMs: NOW_MS,
    };
    const active = getActiveLiveTradeAuthorization(db, lookup);
    expect(active?.id).toBe(grantId);
    expect(active?.maxStake).toBe(50_000);
    expect(getActiveLiveTradeAuthorization(db, { ...lookup, nowMs: NOW_MS + 1_000 })).toBeNull();

    db.query("UPDATE account_authorizations SET revoked_at_ms = $now WHERE id = $id").run({
      $now: NOW_MS,
      $id: grantId,
    });
    expect(getActiveLiveTradeAuthorization(db, lookup)).toBeNull();
    db.close();
  });

  test("rejects fractional minor units and supports partner-wide approvers", () => {
    const db = new Database(":memory:");
    migrateAuthorizationSchema(db, NOW_MS);
    expect(() =>
      db.query(
        `INSERT INTO account_authorization_requests (
          partner_code, out_id, provider, skin, permission_scope,
          requested_max_stake, requested_max_win, max_win_basis,
          currency, valid_from_ms, request_hash,
          telegram_chat_id, telegram_message_id
        ) VALUES ('TEST', 'out-TEST-1', 'provider', 'main', 'live_trade',
          1.5, 100, 'profit', 'USD', 1, $hash, '-123', '456')`,
      ).run({ $hash: "a".repeat(64) }),
    ).toThrow();

    db.query(
      `INSERT INTO account_authorization_approvers (
        partner_code, out_id, telegram_user_id
      ) VALUES ('TEST', NULL, '789')`,
    ).run();
    expect(() =>
      db.query(
        `INSERT INTO account_authorization_approvers (
          partner_code, out_id, telegram_user_id
        ) VALUES ('TEST', NULL, '789')`,
      ).run(),
    ).toThrow();
    db.close();
  });
});
