import type { Database } from "bun:sqlite";
import type { KalshiClient } from "../../bot/kalshi-client.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from "../authorization/outbox.ts";
import { asTelegramChatId, asTelegramTopicId } from "../authorization/domain.ts";
import { asTicketId, type ExposureReservation } from "./domain.ts";
import { executionIdempotencyKeyToUuid } from "./kalshi.ts";
import {
  getReservation,
  reconcileUnknownAsConfirmed,
} from "./reservation.ts";

export interface UnknownReconciliationResult {
  scanned: number;
  confirmed: number;
  unresolved: number;
  conflicts: number;
  errors: number;
}

export interface KalshiUnknownReconciliationDependencies {
  resolveClient: (
    reservation: ExposureReservation,
  ) =>
    | Pick<KalshiClient, "environment" | "findOrderByClientOrderId">
    | Promise<Pick<KalshiClient, "environment" | "findOrderByClientOrderId">>;
  now?: () => number;
  limit?: number;
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
  const ids = db
    .query(
      `SELECT id FROM exposure_reservations
       WHERE status = 'unknown' AND lower(provider) = 'kalshi'
       ORDER BY updated_at_ms, id
       LIMIT $limit`,
    )
    .all({ $limit: limit }) as Array<{ id: number }>;
  const result: UnknownReconciliationResult = {
    scanned: ids.length,
    confirmed: 0,
    unresolved: 0,
    conflicts: 0,
    errors: 0,
  };

  for (const { id } of ids) {
    const reservation = getReservation(db, id as ExposureReservation["id"]);
    if (reservation === null || reservation.status !== "unknown") continue;
    try {
      const client = await dependencies.resolveClient(reservation);
      const clientOrderId = executionIdempotencyKeyToUuid(reservation.idempotencyKey);
      const order = await client.findOrderByClientOrderId(reservation.marketId, clientOrderId);
      if (order === null) {
        result.unresolved++;
        continue;
      }
      const orderId = requiredString(order.order_id);
      const ticker = requiredString(order.ticker);
      const providerClientOrderId = requiredString(order.client_order_id);
      if (!orderId || ticker !== reservation.marketId || providerClientOrderId !== clientOrderId) {
        result.conflicts++;
        continue;
      }
      const confirmed = reconcileUnknownAsConfirmed(db, {
        id: reservation.id,
        ticketId: asTicketId(orderId),
        providerResponse: {
          environment: client.environment,
          orderId,
          clientOrderId,
          ticker,
          status: optionalString(order.status),
          fillCount: fixedCount(order.fill_count_fp ?? order.fill_count),
          remainingCount: fixedCount(order.remaining_count_fp ?? order.remaining_count),
          reconciled: true,
        },
        nowMs: dependencies.now?.() ?? Date.now(),
      });
      if (confirmed === null) result.conflicts++;
      else {
        enqueueReconciliationReceipt(db, confirmed, dependencies.now?.() ?? Date.now());
        result.confirmed++;
      }
    } catch {
      result.errors++;
    }
  }
  return result;
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

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fixedCount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
