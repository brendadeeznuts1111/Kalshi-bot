import type { Database } from 'bun:sqlite';
import { KalshiRequestRejectedError, type KalshiClient } from '../../bot/kalshi-client.ts';
import { getActiveLiveTradeAuthorization } from '../authorization/sql.ts';
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from '../authorization/outbox.ts';
import { getBettingAccountById, type BettingAccountRow } from '../registry.ts';
import { asExposureReservationId, type ExposureReservation } from './domain.ts';
import { getReservation } from './reservation.ts';
import { migrateAuthorizedCancellationSchema } from './cancel-sql.ts';
import type { ExecutionRiskHealthDecision } from './risk-health.ts';

export interface CancellationPrincipal {
  actorId: string;
  role: 'trade_operator' | 'admin';
  partnerScopes: ReadonlySet<string>;
  outScopes: ReadonlySet<string>;
}

export interface AuthorizedCancelInput {
  ticketId: string;
  idempotencyKey: string;
  principal: CancellationPrincipal;
}

export interface AuthorizedCancelDependencies {
  resolveClient: (account: BettingAccountRow) => Pick<KalshiClient, 'environment' | 'cancelOrder'>;
  isRiskHealthy: (reservation: ExposureReservation) =>
    boolean | ExecutionRiskHealthDecision | Promise<boolean | ExecutionRiskHealthDecision>;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export type AuthorizedCancelResult =
  | { ok: true; code: 'CANCEL_CONFIRMED' | 'ALREADY_CANCELLED'; reservationId: number }
  | {
      ok: false;
      code:
        | 'INVALID_REQUEST'
        | 'RESERVATION_NOT_FOUND'
        | 'SCOPE_DENIED'
        | 'AUTHORIZATION_REQUIRED'
        | 'EXECUTION_DISABLED'
        | 'RISK_UNHEALTHY'
        | 'ACCOUNT_UNAVAILABLE'
        | 'CANCEL_REJECTED'
        | 'CANCEL_OUTCOME_UNKNOWN';
      reason: string;
      reservationId?: number;
    };

type CancellationRow = { status: 'intent' | 'confirmed' | 'rejected' | 'unknown' };

function scopeAllows(scopes: ReadonlySet<string>, value: string): boolean {
  return scopes.has('*') || scopes.has(value);
}

function clean(value: string, name: string, max: number): string {
  const result = value.trim();
  if (!result || result.length > max) throw new TypeError(`${name} is invalid`);
  return result;
}

function reservationByTicket(db: Database, ticketId: string): ExposureReservation | null {
  const row = db
    .query(
      `SELECT id FROM exposure_reservations
     WHERE ticket_id = $ticketId
     ORDER BY id DESC LIMIT 1`
    )
    .get({ $ticketId: ticketId }) as { id: number } | null;
  return row === null ? null : getReservation(db, asExposureReservationId(row.id));
}

function serialize(value: unknown): string {
  return JSON.stringify(value) ?? '{}';
}

function receipt(
  db: Database,
  reservation: ExposureReservation,
  auth: NonNullable<ReturnType<typeof getActiveLiveTradeAuthorization>>,
  outcome: 'confirmed' | 'rejected' | 'unknown',
  actorId: string,
  reason: string | null,
  nowMs: number
): void {
  enqueueAuthorizationReceipt(
    db,
    {
      dedupeKey: asAuthorizationReceiptDedupeKey(`cancel:${reservation.id}:${outcome}`),
      telegramChatId: auth.telegramChatId,
      telegramTopicId: auth.telegramTopicId,
      payload: {
        parseMode: 'HTML',
        text:
          `${outcome === 'confirmed' ? '✅' : outcome === 'rejected' ? '⛔' : '⚠️'} <b>Cancellation ${outcome}</b>\n` +
          `Ticket: <code>${Bun.escapeHTML(reservation.ticketId ?? 'missing')}</code>\n` +
          `Out: <code>${Bun.escapeHTML(reservation.outId)}</code>\n` +
          `Actor: <code>${Bun.escapeHTML(actorId)}</code>` +
          (reason ? `\nReason: ${Bun.escapeHTML(reason)}` : ''),
      },
    },
    nowMs
  );
}

export async function executeAuthorizedCancel(
  db: Database,
  input: AuthorizedCancelInput,
  dependencies: AuthorizedCancelDependencies
): Promise<AuthorizedCancelResult> {
  let ticketId: string;
  let idempotencyKey: string;
  let actorId: string;
  try {
    ticketId = clean(input.ticketId, 'ticket ID', 256);
    idempotencyKey = clean(input.idempotencyKey, 'cancellation idempotency key', 256);
    actorId = clean(input.principal.actorId, 'operator actor ID', 128);
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      reason: error instanceof Error ? error.message : 'invalid cancellation',
    };
  }
  migrateAuthorizedCancellationSchema(db);
  const nowMs = (dependencies.now ?? Date.now)();
  const reservation = reservationByTicket(db, ticketId);
  if (
    !reservation ||
    (reservation.status !== 'confirmed' && reservation.status !== 'cancelled')
  ) {
    return {
      ok: false,
      code: 'RESERVATION_NOT_FOUND',
      reason: 'ticket is not bound to a cancellable reservation',
    };
  }
  if (
    !scopeAllows(input.principal.partnerScopes, reservation.partnerCode) ||
    !scopeAllows(input.principal.outScopes, reservation.outId)
  ) {
    return {
      ok: false,
      code: 'SCOPE_DENIED',
      reason: 'operator is not scoped to the reservation',
      reservationId: reservation.id,
    };
  }
  const auth = getActiveLiveTradeAuthorization(db, {
    partnerCode: reservation.partnerCode,
    outId: reservation.outId,
    skin: reservation.skin,
    nowMs,
  });
  if (!auth || auth.id !== reservation.authorizationId || auth.provider !== reservation.provider) {
    return {
      ok: false,
      code: 'AUTHORIZATION_REQUIRED',
      reason: 'the reservation authorization is no longer active',
      reservationId: reservation.id,
    };
  }
  if (reservation.status === 'cancelled') {
    return { ok: true, code: 'ALREADY_CANCELLED', reservationId: reservation.id };
  }
  const env = dependencies.env ?? Bun.env;
  if (env.KALSHI_AUTHORIZED_EXECUTION_ENABLED !== '1') {
    return {
      ok: false,
      code: 'EXECUTION_DISABLED',
      reason: 'authorized execution breaker is disabled',
      reservationId: reservation.id,
    };
  }
  const riskDecision = await dependencies.isRiskHealthy(reservation);
  if (!(typeof riskDecision === 'boolean' ? riskDecision : riskDecision.healthy)) {
    return {
      ok: false,
      code: 'RISK_UNHEALTHY',
      reason: typeof riskDecision === 'boolean'
        ? 'execution risk health is not healthy'
        : `execution risk health denied: ${riskDecision.codes.join(',')}`,
      reservationId: reservation.id,
    };
  }
  const account = getBettingAccountById(db, reservation.outId);
  if (!account || account.status !== 'active' || account.provider.toLowerCase() !== 'kalshi') {
    return {
      ok: false,
      code: 'ACCOUNT_UNAVAILABLE',
      reason: 'the reservation out is not an active Kalshi account',
      reservationId: reservation.id,
    };
  }
  let client: Pick<KalshiClient, 'environment' | 'cancelOrder'>;
  try {
    client = dependencies.resolveClient(account);
  } catch (error) {
    return {
      ok: false,
      code: 'ACCOUNT_UNAVAILABLE',
      reason: error instanceof Error ? error.message : 'out-scoped client unavailable',
      reservationId: reservation.id,
    };
  }
  if (client.environment === 'prod' && env.KALSHI_PROD_ARMED !== '1') {
    return {
      ok: false,
      code: 'EXECUTION_DISABLED',
      reason: 'production cancellation is not armed',
      reservationId: reservation.id,
    };
  }

  const inserted = db
    .query(
      `INSERT INTO authorized_cancellations (
       idempotency_key, reservation_id, ticket_id, partner_code, out_id, skin,
       authorization_id, actor_id, status, created_at_ms, updated_at_ms
     ) VALUES ($key, $reservationId, $ticketId, $partnerCode, $outId, $skin,
       $authorizationId, $actorId, 'intent', $nowMs, $nowMs)
     ON CONFLICT DO NOTHING RETURNING status`
    )
    .get({
      $key: idempotencyKey,
      $reservationId: reservation.id,
      $ticketId: ticketId,
      $partnerCode: reservation.partnerCode,
      $outId: reservation.outId,
      $skin: reservation.skin,
      $authorizationId: reservation.authorizationId,
      $actorId: actorId,
      $nowMs: nowMs,
    }) as CancellationRow | null;
  if (inserted === null) {
    const existing = db
      .query(
        `SELECT status FROM authorized_cancellations
       WHERE reservation_id = $reservationId AND idempotency_key = $key`
      )
      .get({ $reservationId: reservation.id, $key: idempotencyKey }) as CancellationRow | null;
    if (existing?.status === 'confirmed') {
      return { ok: true, code: 'ALREADY_CANCELLED', reservationId: reservation.id };
    }
    return {
      ok: false,
      code: existing?.status === 'rejected' ? 'CANCEL_REJECTED' : 'CANCEL_OUTCOME_UNKNOWN',
      reason: existing
        ? `cancellation is ${existing.status}`
        : 'cancellation idempotency key conflicts with another request',
      reservationId: reservation.id,
    };
  }

  try {
    await client.cancelOrder(ticketId);
    db.transaction(() => {
      db.query(
        `UPDATE authorized_cancellations SET status = 'confirmed',
         provider_response_json = $response, updated_at_ms = $nowMs
         WHERE reservation_id = $reservationId AND status = 'intent'`
      ).run({
        $response: serialize({ cancelled: true }),
        $nowMs: nowMs,
        $reservationId: reservation.id,
      });
      // Cancellation acknowledgement alone does not prove fill quantities.
      // Keep reservation exposure until cursor-complete order/fill ingestion
      // observes the provider's cancelled/filled split.
      receipt(db, reservation, auth, 'confirmed', actorId, null, nowMs);
    }).immediate();
    return { ok: true, code: 'CANCEL_CONFIRMED', reservationId: reservation.id };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message.slice(0, 2048)
        : 'provider cancellation outcome is unknown';
    const rejected = error instanceof KalshiRequestRejectedError;
    db.transaction(() => {
      db.query(
        `UPDATE authorized_cancellations SET status = $status, failure_reason = $reason,
         provider_response_json = $response, updated_at_ms = $nowMs
         WHERE reservation_id = $reservationId AND status = 'intent'`
      ).run({
        $status: rejected ? 'rejected' : 'unknown',
        $reason: reason,
        $response: serialize({ error: reason }),
        $nowMs: nowMs,
        $reservationId: reservation.id,
      });
      receipt(db, reservation, auth, rejected ? 'rejected' : 'unknown', actorId, reason, nowMs);
    }).immediate();
    return {
      ok: false,
      code: rejected ? 'CANCEL_REJECTED' : 'CANCEL_OUTCOME_UNKNOWN',
      reason,
      reservationId: reservation.id,
    };
  }
}
