import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  KalshiRequestOutcomeUnknownError,
  KalshiRequestRejectedError,
} from '../../../src/bot/kalshi-client.ts';
import {
  executeAuthorizedCancel,
  type CancellationPrincipal,
} from '../../../src/partner/execution/cancel.ts';
import { migrateExecutionSchema } from '../../../src/partner/execution/sql.ts';
import { ingestProviderLifecycleBatch } from '../../../src/partner/execution/provider-lifecycle.ts';
import { computeOutstandingExposure } from '../../../src/partner/execution/reservation.ts';
import { asOutId, asPartnerCode, asSkinId } from '../../../src/partner/authorization/domain.ts';
import { asExposureReservationId } from '../../../src/partner/execution/domain.ts';
import {
  ensurePartnerRegistrySchema,
  upsertBettingAccount,
  upsertPartner,
} from '../../../src/partner/registry.ts';

const NOW = 10_000;
const principal: CancellationPrincipal = {
  actorId: 'operator-1',
  role: 'trade_operator',
  partnerScopes: new Set(['SPORTS']),
  outScopes: new Set(['out-SPORTS-1']),
};

function database(): Database {
  const db = new Database(':memory:');
  ensurePartnerRegistrySchema(db);
  migrateExecutionSchema(db, NOW);
  upsertPartner(
    db,
    {
      id: 'partner-sports',
      name: 'Sports',
      active: true,
      profitSplit: null,
      commissionRate: null,
      notes: null,
    },
    NOW
  );
  upsertBettingAccount(
    db,
    {
      id: 'out-SPORTS-1',
      partnerId: 'partner-sports',
      provider: 'kalshi',
      url: '',
      status: 'active',
      envPrefix: 'KALSHI_SPORTS_1_',
      maxStake: 500,
      maxWin: 2_000,
      currency: 'USD',
      skin: null,
      metaJson: JSON.stringify({
        partnerCode: 'SPORTS',
        skins: [{ name: 'main', active: true, perBetMax: 5, maxWin: 20 }],
      }),
    },
    NOW
  );
  db.exec(`
    INSERT INTO account_authorization_requests (
      partner_code, out_id, provider, skin, permission_scope,
      requested_max_stake, requested_max_win, max_win_basis,
      daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
      request_hash, telegram_chat_id, telegram_message_id, status,
      created_at_ms, updated_at_ms
    ) VALUES (
      'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade',
      500, 2000, 'profit', 5000, 2000, 'USD', 1, NULL,
      '${'0'.repeat(64)}', '-123', '101', 'approved', ${NOW}, ${NOW}
    );
    INSERT INTO account_authorizations (
      request_id, partner_code, out_id, provider, skin, permission_scope,
      approved_max_stake, approved_max_win, max_win_basis,
      daily_limit, exposure_limit, currency, valid_from_ms, expires_at_ms,
      approval_hash, telegram_chat_id, telegram_message_id,
      telegram_approving_user_id, created_at_ms, updated_at_ms
    ) VALUES (
      1, 'SPORTS', 'out-SPORTS-1', 'kalshi', 'main', 'live_trade',
      500, 2000, 'profit', 5000, 2000, 'USD', 1, NULL,
      '${'0'.repeat(64)}', '-123', '102', '789', ${NOW}, ${NOW}
    );
    INSERT INTO exposure_reservations (
      idempotency_key, partner_code, out_id, skin, provider, authorization_id,
      requested_stake, effective_stake, market_id, selection, decimal_odds,
      status, reservation_expires_at_ms, placement_owner, ticket_id,
      created_at_ms, updated_at_ms
    ) VALUES (
      'bet-1', 'SPORTS', 'out-SPORTS-1', 'main', 'kalshi', 1,
      80, 80, 'KXTEST', 'yes', 2.5, 'confirmed', 20000,
      'placement-1', 'ticket-1', ${NOW}, ${NOW}
    );
  `);
  return db;
}

function dependencies(cancelOrder: () => Promise<void>, overrides: Record<string, unknown> = {}) {
  return {
    resolveClient: () => ({ environment: 'demo' as const, cancelOrder }),
    isRiskHealthy: () => true,
    env: { KALSHI_AUTHORIZED_EXECUTION_ENABLED: '1' },
    now: () => NOW,
    ...overrides,
  };
}

describe('authorized cancellation', () => {
  test('resolves the local ticket, cancels with the out client, records actor and receipt', async () => {
    const db = database();
    let calls = 0;
    const result = await executeAuthorizedCancel(
      db,
      {
        ticketId: 'ticket-1',
        idempotencyKey: 'cancel-1',
        principal,
      },
      dependencies(async () => {
        calls++;
      })
    );
    expect(result).toMatchObject({ ok: true, code: 'CANCEL_CONFIRMED' });
    expect(calls).toBe(1);
    expect(
      db.query("SELECT status FROM exposure_reservations WHERE ticket_id='ticket-1'").get()
    ).toEqual({ status: 'confirmed' });
    expect(db.query('SELECT status, actor_id FROM authorized_cancellations').get()).toEqual({
      status: 'confirmed',
      actor_id: 'operator-1',
    });
    expect(
      (
        db.query('SELECT count(*) AS n FROM account_authorization_receipt_outbox').get() as {
          n: number;
        }
      ).n
    ).toBe(1);
    db.close();
  });

  test('is idempotent and never calls the provider twice', async () => {
    const db = database();
    let calls = 0;
    const input = { ticketId: 'ticket-1', idempotencyKey: 'cancel-1', principal };
    const deps = dependencies(async () => {
      calls++;
    });
    expect((await executeAuthorizedCancel(db, input, deps)).ok).toBe(true);
    expect(await executeAuthorizedCancel(db, input, deps)).toMatchObject({
      ok: true,
      code: 'ALREADY_CANCELLED',
    });
    expect(calls).toBe(1);
    db.close();
  });

  test('denies unowned tickets and scopes before provider I/O', async () => {
    for (const input of [
      { ticketId: 'missing', idempotencyKey: 'cancel-x', principal },
      {
        ticketId: 'ticket-1',
        idempotencyKey: 'cancel-x',
        principal: { ...principal, outScopes: new Set(['other']) },
      },
    ]) {
      const db = database();
      let calls = 0;
      const result = await executeAuthorizedCancel(
        db,
        input,
        dependencies(async () => {
          calls++;
        })
      );
      expect(result.ok).toBe(false);
      expect(calls).toBe(0);
      db.close();
    }
  });

  test('revalidates authorization, breaker, risk, and production arming', async () => {
    const cases = [
      {
        mutate: (db: Database) => db.run('UPDATE account_authorizations SET revoked_at_ms=9999'),
        overrides: {},
        code: 'AUTHORIZATION_REQUIRED',
      },
      { mutate: (_db: Database) => {}, overrides: { env: {} }, code: 'EXECUTION_DISABLED' },
      {
        mutate: (_db: Database) => {},
        overrides: { isRiskHealthy: () => false },
        code: 'RISK_UNHEALTHY',
      },
      {
        mutate: (_db: Database) => {},
        overrides: {
          resolveClient: () => ({ environment: 'prod' as const, cancelOrder: async () => {} }),
        },
        code: 'EXECUTION_DISABLED',
      },
    ];
    for (const item of cases) {
      const db = database();
      item.mutate(db);
      let calls = 0;
      const result = await executeAuthorizedCancel(
        db,
        {
          ticketId: 'ticket-1',
          idempotencyKey: `cancel-${item.code}`,
          principal,
        },
        dependencies(async () => {
          calls++;
        }, item.overrides)
      );
      expect(result).toMatchObject({ ok: false, code: item.code });
      expect(calls).toBe(0);
      db.close();
    }
  });

  test('keeps exposure confirmed when provider outcome is unknown', async () => {
    const db = database();
    const result = await executeAuthorizedCancel(
      db,
      {
        ticketId: 'ticket-1',
        idempotencyKey: 'cancel-unknown',
        principal,
      },
      dependencies(async () => {
        throw new KalshiRequestOutcomeUnknownError('timeout');
      })
    );
    expect(result).toMatchObject({ ok: false, code: 'CANCEL_OUTCOME_UNKNOWN' });
    expect(db.query('SELECT status FROM exposure_reservations').get()).toEqual({
      status: 'confirmed',
    });
    expect(db.query('SELECT status FROM authorized_cancellations').get()).toEqual({
      status: 'unknown',
    });
    db.close();
  });

  test('records conclusive provider rejection without releasing exposure', async () => {
    const db = database();
    const result = await executeAuthorizedCancel(
      db,
      {
        ticketId: 'ticket-1',
        idempotencyKey: 'cancel-rejected',
        principal,
      },
      dependencies(async () => {
        throw new KalshiRequestRejectedError('not cancellable', 409);
      })
    );
    expect(result).toMatchObject({ ok: false, code: 'CANCEL_REJECTED' });
    expect(db.query('SELECT status FROM exposure_reservations').get()).toEqual({
      status: 'confirmed',
    });
    expect(db.query('SELECT status FROM authorized_cancellations').get()).toEqual({
      status: 'rejected',
    });
    db.close();
  });

  test('provider lifecycle releases only cancelled working quantity after partial fill', async () => {
    const db = database();
    await executeAuthorizedCancel(db, {
      ticketId: 'ticket-1', idempotencyKey: 'cancel-partial', principal,
    }, dependencies(async () => {}));
    ingestProviderLifecycleBatch(db, {
      provider: 'kalshi', outId: 'out-SPORTS-1', environment: 'demo', observedAtMs: NOW,
      ordersCursorComplete: true, fillsCursorComplete: true,
      orders: [{
        providerOrderId: 'ticket-1', clientOrderId: null,
        reservationId: asExposureReservationId(1), ticker: 'KXTEST', side: 'yes', action: 'buy',
        unitPriceMinor: 40, orderedQuantity: 2, filledQuantity: 1, remainingQuantity: 0,
        status: 'cancelled', providerUpdatedAtMs: NOW,
      }],
      fills: [{
        sourceKey: 'fill-1', providerOrderId: 'ticket-1', ticker: 'KXTEST', side: 'yes',
        action: 'buy', quantity: 1, unitPriceMinor: 40, feeMinor: 1,
        providerCreatedAtMs: NOW,
      }],
    });
    expect(computeOutstandingExposure(db, {
      partnerCode: asPartnerCode('SPORTS'), outId: asOutId('out-SPORTS-1'), skin: asSkinId('main'),
    })).toBe(40);
    db.close();
  });
});
