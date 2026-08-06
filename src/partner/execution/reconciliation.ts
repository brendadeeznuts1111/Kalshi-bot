import type { Database } from "bun:sqlite";
import type { KalshiClient } from "../../bot/kalshi-client.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from "../authorization/outbox.ts";
import { asTelegramChatId, asTelegramTopicId } from "../authorization/domain.ts";
import {
  asTicketId,
  type ExposureReservation,
  type ReconciliationOwner,
} from "./domain.ts";
import {
  executionIdempotencyKeyToUuid,
  expectedKalshiOrder,
  projectKalshiBuyOrder,
} from "./kalshi.ts";
import { verifyKalshiOrderEvidence } from "./kalshi-reconciliation.ts";
import type { KalshiExpectedOrder } from "./kalshi-reconciliation.ts";
import {
  claimUnknownReservations,
  completeReconciliationAttempt,
  reconcileClaimedUnknownAsConfirmed,
} from "./reservation.ts";

export interface UnknownReconciliationResult {
  scanned: number;
  confirmed: number;
  unresolved: number;
  conflicts: number;
  errors: number;
  leaseLost: number;
}

export interface KalshiUnknownReconciliationDependencies {
  resolveClient: (
    reservation: ExposureReservation,
  ) =>
    | Pick<KalshiClient, "environment" | "lookupOrderByClientOrderId">
    | Promise<Pick<KalshiClient, "environment" | "lookupOrderByClientOrderId">>;
  now?: () => number;
  limit?: number;
  owner: ReconciliationOwner;
  leaseDurationMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

/**
 * Resolve only provider-positive evidence. Missing, malformed, or conflicting
 * records remain `unknown` and exposure-bearing for a later/manual review.
 */
export async function reconcileKalshiUnknownReservations(
  db: Database,
  dependencies: KalshiUnknownReconciliationDependencies,
): Promise<UnknownReconciliationResult> {
  const limit = dependencies.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new TypeError("reconciliation limit must be an integer between 1 and 1000");
  }
  const clock = dependencies.now ?? Date.now;
  const leaseDurationMs = positiveDuration(
    dependencies.leaseDurationMs ?? 30_000,
    "reconciliation lease duration",
  );
  const retryBaseMs = positiveDuration(
    dependencies.retryBaseMs ?? 1_000,
    "reconciliation retry base",
  );
  const retryMaxMs = positiveDuration(
    dependencies.retryMaxMs ?? 300_000,
    "reconciliation retry maximum",
  );
  if (retryMaxMs < retryBaseMs) {
    throw new TypeError("reconciliation retry maximum must be at least the retry base");
  }
  const reservations = claimUnknownReservations(db, {
    provider: "kalshi",
    owner: dependencies.owner,
    nowMs: clock(),
    leaseDurationMs,
    limit,
  });
  const result: UnknownReconciliationResult = {
    scanned: reservations.length,
    confirmed: 0,
    unresolved: 0,
    conflicts: 0,
    errors: 0,
    leaseLost: 0,
  };

  for (const reservation of reservations) {
    try {
      const client = await dependencies.resolveClient(reservation);
      const clientOrderId = executionIdempotencyKeyToUuid(reservation.idempotencyKey);
      const side = reservation.selection.toLowerCase();
      if (side !== "yes" && side !== "no") throw new Error("invalid Kalshi reservation selection");
      const projected = projectKalshiBuyOrder({
        ticker: reservation.marketId,
        selection: reservation.selection,
        effectiveStake: reservation.effectiveStake,
        decimalOdds: reservation.decimalOdds,
        side,
      });
      const persistedExpected = placementExpectation(reservation.providerResponse);
      const evidence = verifyKalshiOrderEvidence(
        persistedExpected ?? expectedKalshiOrder(client.environment, projected, clientOrderId),
        client.environment,
        await client.lookupOrderByClientOrderId(reservation.marketId, clientOrderId),
      );
      if (evidence.kind !== "confirmed") {
        const resultKind = evidence.kind === "conflict"
          ? "conflict"
          : evidence.kind === "not_found" || evidence.kind === "incomplete"
            ? "not_found"
            : "error";
        const detail = evidence.kind === "conflict"
          ? `Kalshi evidence mismatch: ${evidence.mismatches.join(",")}`
          : evidence.kind === "malformed" || evidence.kind === "provider_error"
            ? `Kalshi reconciliation evidence: ${evidence.kind}: ${evidence.reason}`
          : `Kalshi reconciliation evidence: ${evidence.kind}`;
        if (!deferAttempt(
          db,
          reservation,
          dependencies.owner,
          resultKind,
          detail,
          clock(),
          retryBaseMs,
          retryMaxMs,
        )) {
          result.leaseLost++;
          continue;
        }
        if (resultKind === "conflict") result.conflicts++;
        else if (resultKind === "error") result.errors++;
        else result.unresolved++;
        continue;
      }
      const order = evidence.order;
      const orderId = order.orderId;
      const nowMs = clock();
      const transaction = db.transaction(() => {
        const confirmed = reconcileClaimedUnknownAsConfirmed(db, {
          id: reservation.id,
          owner: dependencies.owner,
          ticketId: asTicketId(order.orderId),
          providerResponse: {
            environment: client.environment,
            orderId,
            clientOrderId,
            ticker: order.ticker,
            outcome: order.outcome,
            bookSide: order.bookSide,
            initialCount: order.initialCount,
            yesPriceCents: order.yesPriceCents,
            fillCount: order.fillCount,
            remainingCount: order.remainingCount,
            source: evidence.source,
            reconciled: true,
          },
          nowMs,
        });
        if (confirmed !== null) enqueueReconciliationReceipt(db, confirmed, nowMs);
        return confirmed;
      });
      const confirmed = transaction.immediate();
      if (confirmed === null) result.leaseLost++;
      else {
        result.confirmed++;
      }
    } catch (error) {
      if (!deferAttempt(
        db,
        reservation,
        dependencies.owner,
        "error",
        errorMessage(error),
        clock(),
        retryBaseMs,
        retryMaxMs,
      )) {
        result.leaseLost++;
        continue;
      }
      result.errors++;
    }
  }
  return result;
}

function placementExpectation(value: unknown): KalshiExpectedOrder | null {
  if (!value || typeof value !== "object" || !("placementExpectation" in value)) return null;
  const expected = value.placementExpectation;
  if (!expected || typeof expected !== "object") return null;
  const row = expected as Record<string, unknown>;
  if (
    (row.environment !== "demo" && row.environment !== "prod") ||
    typeof row.ticker !== "string" || typeof row.clientOrderId !== "string" ||
    (row.outcome !== "yes" && row.outcome !== "no") ||
    (row.bookSide !== "bid" && row.bookSide !== "ask") ||
    !Number.isSafeInteger(row.count) || !Number.isSafeInteger(row.yesPriceCents)
  ) return null;
  return row as unknown as KalshiExpectedOrder;
}

function deferAttempt(
  db: Database,
  reservation: ExposureReservation,
  owner: ReconciliationOwner,
  result: "not_found" | "conflict" | "error",
  error: string | null,
  nowMs: number,
  retryBaseMs: number,
  retryMaxMs: number,
): boolean {
  const exponent = Math.min(Math.max(reservation.reconciliationAttempts - 1, 0), 30);
  const delayMs = Math.min(retryMaxMs, retryBaseMs * 2 ** exponent);
  const nextAttemptAtMs = nowMs + delayMs;
  if (!Number.isSafeInteger(nextAttemptAtMs)) {
    throw new TypeError("next reconciliation time is outside the safe integer range");
  }
  return completeReconciliationAttempt(db, {
    id: reservation.id,
    owner,
    result,
    error,
    nextAttemptAtMs,
    nowMs,
  }) !== null;
}

function enqueueReconciliationReceipt(
  db: Database,
  reservation: ExposureReservation,
  nowMs: number,
): void {
  const destination = db
    .query(
      `SELECT telegram_chat_id AS telegramChatId, telegram_topic_id AS telegramTopicId
       FROM account_authorizations WHERE id = $id`,
    )
    .get({ $id: reservation.authorizationId }) as {
      telegramChatId: string;
      telegramTopicId: string | null;
    } | null;
  if (destination === null) return;
  enqueueAuthorizationReceipt(db, {
    dedupeKey: asAuthorizationReceiptDedupeKey(
      `execution:${reservation.id}:confirmed`,
    ),
    telegramChatId: asTelegramChatId(destination.telegramChatId),
    telegramTopicId:
      destination.telegramTopicId === null
        ? null
        : asTelegramTopicId(destination.telegramTopicId),
    payload: {
      parseMode: "HTML",
      text:
        "✅ <b>Bet confirmed by reconciliation</b>\n" +
        `Out: <code>${Bun.escapeHTML(reservation.outId)}</code>\n` +
        `Market: <code>${Bun.escapeHTML(reservation.marketId)}</code>\n` +
        `Ticket: <code>${Bun.escapeHTML(reservation.ticketId ?? "missing")}</code>\n` +
        `Stake: <code>${reservation.effectiveStake}</code> minor units`,
    },
  }, nowMs);
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Kalshi reconciliation lookup failed";
}
