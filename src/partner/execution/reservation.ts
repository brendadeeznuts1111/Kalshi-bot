import type { Database } from "bun:sqlite";
import {
  asAuthorizationId,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  type ApprovedAuthorization,
  type OutId,
  type PartnerCode,
  type SkinId,
} from "../authorization/domain.ts";
import {
  asExecutionIdempotencyKey,
  asExposureReservationId,
  asMarketId,
  asMarketSelection,
  asPlacementOwner,
  asReconciliationOwner,
  asTicketId,
  type BetRequest,
  type ExecutionIdempotencyKey,
  type ExposureReservation,
  type ExposureReservationId,
  type ExposureReservationStatus,
  type PlacementOwner,
  type ReconciliationAttemptResult,
  type ReconciliationOwner,
  type TicketId,
} from "./domain.ts";

type ReservationRow = {
  id: number;
  idempotency_key: string;
  partner_code: string;
  out_id: string; // brand-ok — SQLite wire value; parsed by mapReservation
  skin: string;
  provider: string;
  authorization_id: number;
  actor_id: string | null;
  partner_split_bps: number;
  requested_stake: number;
  effective_stake: number;
  market_id: string; // brand-ok — SQLite wire value; parsed by mapReservation
  selection: string; // brand-ok — SQLite wire value; parsed by mapReservation
  decimal_odds: number;
  status: ExposureReservationStatus;
  reservation_expires_at_ms: number;
  placement_owner: string | null;
  ticket_id: string | null; // brand-ok — SQLite wire value; parsed by mapReservation
  provider_response_json: string | null;
  failure_reason: string | null;
  reconciliation_owner: string | null;
  reconciliation_lease_expires_at_ms: number | null;
  reconciliation_attempts: number;
  last_reconciliation_at_ms: number | null;
  next_reconciliation_at_ms: number | null;
  reconciliation_result: ReconciliationAttemptResult | "confirmed" | null;
  reconciliation_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type CreatePendingReservationResult =
  | { ok: true; created: true; reservation: ExposureReservation }
  | { ok: true; created: false; reservation: ExposureReservation }
  | { ok: false; code: "IDEMPOTENCY_CONFLICT" | "INVALID_INPUT"; reason: string };

export interface ReservationLane {
  partnerCode: PartnerCode;
  outId: OutId;
  skin: SkinId;
}

export interface ClaimUnknownReservationsInput {
  provider: string;
  owner: ReconciliationOwner;
  nowMs: number;
  leaseDurationMs: number;
  limit: number;
}

/**
 * A process may die after dispatching an order but before recording its result.
 * Move only old `placing` rows to exposure-bearing `unknown`; never infer a
 * rejection or release capacity from worker age alone.
 */
export function recoverStalePlacingReservations(
  db: Database,
  input: {
    nowMs: number;
    staleAfterMs: number;
    provider?: string;
  },
): number {
  assertTimestamp(input.nowMs, "stale placement recovery time");
  if (!Number.isSafeInteger(input.staleAfterMs) || input.staleAfterMs < 1) {
    throw new TypeError("placing stale threshold must be a positive safe integer");
  }
  const cutoffMs = input.nowMs - input.staleAfterMs;
  if (cutoffMs < 0) return 0;
  const provider = input.provider?.trim().toLowerCase() ?? null;
  if (provider !== null && (!provider || provider.length > 128)) {
    throw new TypeError("stale placement provider is invalid");
  }
  return db.query(
    `UPDATE exposure_reservations
     SET status = 'unknown',
         provider_response_json = $responseJson,
         failure_reason = $failureReason,
         next_reconciliation_at_ms = $nowMs,
         reconciliation_result = NULL,
         reconciliation_error = NULL,
         updated_at_ms = $nowMs
     WHERE status = 'placing'
       AND updated_at_ms <= $cutoffMs
       AND ($provider IS NULL OR lower(provider) = $provider)`,
  ).run({
    $responseJson: JSON.stringify({
      recovery: "stale_placing",
      reason: "placement worker did not record a conclusive provider outcome",
    }),
    $failureReason: "stale placing recovered for provider reconciliation",
    $nowMs: input.nowMs,
    $cutoffMs: cutoffMs,
    $provider: provider,
  }).changes;
}

/** Atomically lease a fair, bounded batch of due unknown reservations. */
export function claimUnknownReservations(
  db: Database,
  input: ClaimUnknownReservationsInput,
): ExposureReservation[] {
  assertTimestamp(input.nowMs, "reconciliation claim time");
  if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
    throw new TypeError("reconciliation lease duration must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new TypeError("reconciliation claim limit must be an integer between 1 and 1000");
  }
  const provider = input.provider.trim().toLowerCase();
  if (!provider || provider.length > 128) throw new TypeError("reconciliation provider is invalid");
  const leaseExpiresAtMs = input.nowMs + input.leaseDurationMs;
  if (!Number.isSafeInteger(leaseExpiresAtMs)) {
    throw new TypeError("reconciliation lease expiry is outside the safe integer range");
  }

  const claim = db.transaction(() => {
    const ids = db.query(
      `SELECT id FROM exposure_reservations
       WHERE status = 'unknown'
         AND lower(provider) = $provider
         AND (next_reconciliation_at_ms IS NULL OR next_reconciliation_at_ms <= $nowMs)
         AND reconciliation_attempts < 9007199254740991
         AND (
           reconciliation_owner IS NULL
           OR reconciliation_lease_expires_at_ms IS NULL
           OR reconciliation_lease_expires_at_ms <= $nowMs
         )
       ORDER BY COALESCE(next_reconciliation_at_ms, 0), id
       LIMIT $limit`,
    ).all({ $provider: provider, $nowMs: input.nowMs, $limit: input.limit }) as Array<{ id: number }>;
    const rows: ReservationRow[] = [];
    const update = db.query(
      `UPDATE exposure_reservations
       SET reconciliation_owner = $owner,
           reconciliation_lease_expires_at_ms = $leaseExpiresAtMs,
           reconciliation_attempts = reconciliation_attempts + 1,
           last_reconciliation_at_ms = $nowMs,
           reconciliation_result = NULL,
           reconciliation_error = NULL
       WHERE id = $id
         AND status = 'unknown'
         AND reconciliation_attempts < 9007199254740991
         AND (
           reconciliation_owner IS NULL
           OR reconciliation_lease_expires_at_ms IS NULL
           OR reconciliation_lease_expires_at_ms <= $nowMs
         )
       RETURNING *`,
    );
    for (const { id } of ids) {
      const row = update.get({
        $id: id,
        $owner: input.owner,
        $leaseExpiresAtMs: leaseExpiresAtMs,
        $nowMs: input.nowMs,
      }) as ReservationRow | null;
      if (row !== null) rows.push(row);
    }
    return rows;
  });
  return claim.immediate().map(mapReservation);
}

/** Record an inconclusive attempt and release its lease for a scheduled retry. */
export function completeReconciliationAttempt(
  db: Database,
  input: {
    id: ExposureReservationId;
    owner: ReconciliationOwner;
    result: ReconciliationAttemptResult;
    error?: string | null;
    nextAttemptAtMs: number;
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "reconciliation completion time");
  assertTimestamp(input.nextAttemptAtMs, "next reconciliation time");
  if (input.nextAttemptAtMs < input.nowMs) {
    throw new TypeError("next reconciliation time must not be in the past");
  }
  const row = db.query(
    `UPDATE exposure_reservations
     SET reconciliation_owner = NULL,
         reconciliation_lease_expires_at_ms = NULL,
         next_reconciliation_at_ms = $nextAttemptAtMs,
         reconciliation_result = $result,
         reconciliation_error = $error
     WHERE id = $id
       AND status = 'unknown'
       AND reconciliation_owner = $owner
       AND reconciliation_lease_expires_at_ms > $nowMs
     RETURNING *`,
  ).get({
    $id: input.id,
    $owner: input.owner,
    $result: input.result,
    $error: input.error == null ? null : normalizeReason(input.error),
    $nextAttemptAtMs: input.nextAttemptAtMs,
    $nowMs: input.nowMs,
  }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

/** Confirm only while holding the live reconciliation lease. */
export function reconcileClaimedUnknownAsConfirmed(
  db: Database,
  input: {
    id: ExposureReservationId;
    owner: ReconciliationOwner;
    ticketId: TicketId;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "reservation reconciliation time");
  const row = db.query(
    `UPDATE exposure_reservations
     SET status = 'confirmed', ticket_id = $ticketId,
         provider_response_json = $responseJson, failure_reason = NULL,
         reconciliation_owner = NULL, reconciliation_lease_expires_at_ms = NULL,
         next_reconciliation_at_ms = NULL, reconciliation_result = 'confirmed',
         reconciliation_error = NULL, updated_at_ms = $nowMs
     WHERE id = $id AND status = 'unknown'
       AND reconciliation_owner = $owner
       AND reconciliation_lease_expires_at_ms > $nowMs
     RETURNING *`,
  ).get({
    $id: input.id,
    $owner: input.owner,
    $ticketId: input.ticketId,
    $responseJson: serializeProviderResponse(input.providerResponse),
    $nowMs: input.nowMs,
  }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

export function createPendingReservation(
  db: Database,
  input: {
    authorization: ApprovedAuthorization;
    request: BetRequest;
    effectiveStake: number;
    partnerSplitBps?: number;
    expiresAtMs: number;
    nowMs: number;
  },
): CreatePendingReservationResult {
  try {
    assertTimestamp(input.nowMs, "reservation creation time");
    assertTimestamp(input.expiresAtMs, "reservation expiry");
    if (input.expiresAtMs <= input.nowMs) throw new TypeError("reservation expiry must be future");
    assertPositiveMinorUnits(input.request.requestedStake, "requested stake");
    assertPositiveMinorUnits(input.effectiveStake, "effective stake");
    if (!Number.isSafeInteger(input.partnerSplitBps ?? 0) ||
        (input.partnerSplitBps ?? 0) < 0 || (input.partnerSplitBps ?? 0) > 10_000) {
      throw new TypeError("partner split basis points must be from 0 to 10000");
    }
    if (!Number.isFinite(input.request.decimalOdds) || input.request.decimalOdds <= 1) {
      throw new TypeError("decimal odds must be finite and greater than one");
    }
  } catch (error) {
    return { ok: false, code: "INVALID_INPUT", reason: errorMessage(error) };
  }

  const inserted = db
    .query(
      `INSERT INTO exposure_reservations (
        idempotency_key, partner_code, out_id, skin, provider, authorization_id,
        actor_id, partner_split_bps, requested_stake, effective_stake, market_id, selection, decimal_odds,
        status, reservation_expires_at_ms, created_at_ms, updated_at_ms
      ) VALUES (
        $idempotencyKey, $partnerCode, $outId, $skin, $provider, $authorizationId,
        $actorId, $partnerSplitBps, $requestedStake, $effectiveStake, $marketId, $selection, $decimalOdds,
        'pending', $expiresAtMs, $nowMs, $nowMs
      )
      ON CONFLICT(idempotency_key) DO NOTHING
      RETURNING *`,
    )
    .get({
      $idempotencyKey: input.request.idempotencyKey,
      $partnerCode: input.authorization.partnerCode,
      $outId: input.authorization.outId,
      $skin: input.authorization.skin,
      $provider: input.authorization.provider,
      $authorizationId: input.authorization.id,
      $actorId: input.request.actorId?.trim() || null,
      $partnerSplitBps: input.partnerSplitBps ?? 0,
      $requestedStake: input.request.requestedStake,
      $effectiveStake: input.effectiveStake,
      $marketId: input.request.marketId,
      $selection: input.request.selection,
      $decimalOdds: input.request.decimalOdds,
      $expiresAtMs: input.expiresAtMs,
      $nowMs: input.nowMs,
    }) as ReservationRow | null;
  if (inserted !== null) return { ok: true, created: true, reservation: mapReservation(inserted) };

  const existing = getReservationByIdempotencyKey(db, input.request.idempotencyKey);
  if (existing === null) throw new Error("execution idempotency lookup failed");
  if (
    existing.partnerCode !== input.request.partnerCode ||
    existing.outId !== input.request.outId ||
    existing.skin !== input.request.skin ||
    existing.authorizationId !== input.authorization.id ||
    (input.request.actorId !== undefined && existing.actorId !== input.request.actorId) ||
    existing.marketId !== input.request.marketId ||
    existing.selection !== input.request.selection ||
    existing.requestedStake !== input.request.requestedStake ||
    existing.decimalOdds !== input.request.decimalOdds
  ) {
    return {
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      reason: "execution idempotency key is already bound to different bet terms",
    };
  }
  return { ok: true, created: false, reservation: existing };
}

export function claimReservationForPlacement(
  db: Database,
  input: {
    id: ExposureReservationId;
    placementOwner: PlacementOwner;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "placement claim time");
  const row = db
    .query(
      `UPDATE exposure_reservations
       SET status = 'placing', placement_owner = $owner,
           provider_response_json = COALESCE($responseJson, provider_response_json), updated_at_ms = $nowMs
       WHERE id = $id
         AND status = 'pending'
         AND reservation_expires_at_ms > $nowMs
       RETURNING *`,
    )
    .get({
      $id: input.id,
      $owner: input.placementOwner,
      $responseJson: input.providerResponse === undefined
        ? null
        : serializeProviderResponse(input.providerResponse),
      $nowMs: input.nowMs,
    }) as
    | ReservationRow
    | null;
  return row === null ? null : mapReservation(row);
}

export function confirmReservation(
  db: Database,
  input: {
    id: ExposureReservationId;
    placementOwner: PlacementOwner;
    ticketId: TicketId;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  return completePlacement(db, {
    ...input,
    status: "confirmed",
    failureReason: null,
  });
}

export function rejectReservation(
  db: Database,
  input: {
    id: ExposureReservationId;
    placementOwner: PlacementOwner;
    reason: string;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  return completePlacement(db, {
    ...input,
    status: "rejected",
    ticketId: null,
    failureReason: input.reason,
  });
}

/** A thrown/ambiguous provider call remains exposure-bearing until reconciled. */
export function markReservationUnknown(
  db: Database,
  input: {
    id: ExposureReservationId;
    placementOwner: PlacementOwner;
    reason: string;
    placementExpectation?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  return completePlacement(db, {
    ...input,
    status: "unknown",
    ticketId: null,
    providerResponse: {
      ...(input.placementExpectation === undefined
        ? {}
        : { placementExpectation: input.placementExpectation }),
      error: normalizeReason(input.reason),
    },
    failureReason: input.reason,
  });
}

export function cancelPendingReservation(
  db: Database,
  id: ExposureReservationId,
  nowMs = Date.now(),
): boolean {
  assertTimestamp(nowMs, "reservation cancellation time");
  return (
    db
      .query(
        `UPDATE exposure_reservations
         SET status = 'cancelled', updated_at_ms = $nowMs
         WHERE id = $id AND status = 'pending'`,
      )
      .run({ $id: id, $nowMs: nowMs }).changes === 1
  );
}

/** Release only never-dispatched reservations. Placing/unknown rows require reconciliation. */
export function releaseExpiredReservations(db: Database, nowMs = Date.now()): number {
  assertTimestamp(nowMs, "reservation release time");
  return db
    .query(
      `UPDATE exposure_reservations
       SET status = 'cancelled', updated_at_ms = $nowMs
       WHERE status = 'pending' AND reservation_expires_at_ms <= $nowMs`,
    )
    .run({ $nowMs: nowMs }).changes;
}

export function computeOutstandingExposure(db: Database, lane: ReservationLane): number {
  const row = db.query(
    `SELECT COALESCE(SUM(
       CASE WHEN r.status = 'confirmed' THEN COALESCE(
         (SELECT SUM((p.remaining_quantity + p.filled_quantity - p.settled_quantity)
           * p.unit_price_minor)
          FROM provider_order_lifecycle p WHERE p.reservation_id = r.id),
         r.effective_stake)
       ELSE r.effective_stake END
     ), 0) AS total
     FROM exposure_reservations r
     WHERE r.partner_code = $partnerCode AND r.out_id = $outId AND r.skin = $skin
       AND r.status IN ('pending', 'placing', 'confirmed', 'unknown')`,
  ).get({
    $partnerCode: lane.partnerCode,
    $outId: lane.outId,
    $skin: lane.skin,
  }) as { total: number };
  return assertAggregate(row.total);
}

export function computeReservedMarketLiquidity(
  db: Database,
  lane: ReservationLane,
  marketId: BetRequest["marketId"],
  decimalOdds: number,
): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN COALESCE(
         (SELECT SUM(p.remaining_quantity * p.unit_price_minor)
          FROM provider_order_lifecycle p WHERE p.reservation_id = r.id),
         r.effective_stake) ELSE r.effective_stake END), 0) AS total
       FROM exposure_reservations r
       WHERE partner_code = $partnerCode
         AND out_id = $outId
         AND skin = $skin
         AND market_id = $marketId
         AND decimal_odds = $decimalOdds
         AND status IN ('pending', 'placing', 'confirmed', 'unknown')`,
    )
    .get({
      $partnerCode: lane.partnerCode,
      $outId: lane.outId,
      $skin: lane.skin,
      $marketId: marketId,
      $decimalOdds: decimalOdds,
    }) as { total: number };
  return assertAggregate(row.total);
}

/** Reserved and placed stakes all consume the daily budget until conclusively rejected/cancelled. */
export function computeDailyUsage(
  db: Database,
  lane: ReservationLane,
  dayStartMs: number,
): number {
  assertTimestamp(dayStartMs, "daily usage start");
  const row = db
    .query(
      `SELECT COALESCE(SUM(effective_stake), 0) AS total
       FROM exposure_reservations
       WHERE partner_code = $partnerCode
         AND out_id = $outId
         AND skin = $skin
         AND created_at_ms >= $dayStartMs
         AND status IN ('pending', 'placing', 'confirmed', 'unknown', 'settled')`,
    )
    .get({
      $partnerCode: lane.partnerCode,
      $outId: lane.outId,
      $skin: lane.skin,
      $dayStartMs: dayStartMs,
    }) as { total: number };
  return assertAggregate(row.total);
}

export function getReservation(
  db: Database,
  id: ExposureReservationId,
): ExposureReservation | null {
  const row = db
    .query("SELECT * FROM exposure_reservations WHERE id = $id")
    .get({ $id: id }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

export function getReservationByIdempotencyKey(
  db: Database,
  key: ExecutionIdempotencyKey,
): ExposureReservation | null {
  const row = db
    .query("SELECT * FROM exposure_reservations WHERE idempotency_key = $key")
    .get({ $key: key }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

/**
 * Manual/provider-positive reconciliation path.
 * @deprecated Automated workers must claim a lease and use
 * `reconcileClaimedUnknownAsConfirmed`.
 */
export function reconcileUnknownAsConfirmed(
  db: Database,
  input: {
    id: ExposureReservationId;
    ticketId: TicketId;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  return reconcileUnknown(db, {
    ...input,
    status: "confirmed",
    failureReason: null,
  });
}

export function reconcileUnknownAsRejected(
  db: Database,
  input: {
    id: ExposureReservationId;
    reason: string;
    providerResponse?: unknown;
    nowMs: number;
  },
): ExposureReservation | null {
  return reconcileUnknown(db, {
    id: input.id,
    status: "rejected",
    ticketId: null,
    providerResponse: input.providerResponse,
    failureReason: input.reason,
    nowMs: input.nowMs,
  });
}

export function settleConfirmedReservation(
  db: Database,
  id: ExposureReservationId,
  nowMs = Date.now(),
): ExposureReservation | null {
  assertTimestamp(nowMs, "reservation settlement time");
  const row = db
    .query(
      `UPDATE exposure_reservations
       SET status = 'settled', updated_at_ms = $nowMs
       WHERE id = $id AND status = 'confirmed'
       RETURNING *`,
    )
    .get({ $id: id, $nowMs: nowMs }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

function completePlacement(
  db: Database,
  input: {
    id: ExposureReservationId;
    placementOwner: PlacementOwner;
    status: "confirmed" | "rejected" | "unknown";
    ticketId: TicketId | null;
    providerResponse?: unknown;
    failureReason: string | null;
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "placement completion time");
  const responseJson = serializeProviderResponse(input.providerResponse);
  const failureReason =
    input.failureReason === null ? null : normalizeReason(input.failureReason);
  const row = db
    .query(
      `UPDATE exposure_reservations
       SET status = $status,
           ticket_id = $ticketId,
           provider_response_json = $responseJson,
           failure_reason = $failureReason,
           updated_at_ms = $nowMs
       WHERE id = $id
         AND status = 'placing'
         AND placement_owner = $owner
       RETURNING *`,
    )
    .get({
      $status: input.status,
      $ticketId: input.ticketId,
      $responseJson: responseJson,
      $failureReason: failureReason,
      $nowMs: input.nowMs,
      $id: input.id,
      $owner: input.placementOwner,
    }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

function reconcileUnknown(
  db: Database,
  input: {
    id: ExposureReservationId;
    status: "confirmed" | "rejected";
    ticketId: TicketId | null;
    providerResponse?: unknown;
    failureReason: string | null;
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "reservation reconciliation time");
  const row = db
    .query(
      `UPDATE exposure_reservations
       SET status = $status,
           ticket_id = $ticketId,
           provider_response_json = $responseJson,
           failure_reason = $failureReason,
           updated_at_ms = $nowMs
       WHERE id = $id AND status = 'unknown'
       RETURNING *`,
    )
    .get({
      $status: input.status,
      $ticketId: input.ticketId,
      $responseJson: serializeProviderResponse(input.providerResponse),
      $failureReason:
        input.failureReason === null ? null : normalizeReason(input.failureReason),
      $nowMs: input.nowMs,
      $id: input.id,
    }) as ReservationRow | null;
  return row === null ? null : mapReservation(row);
}

function sumExposure(db: Database, lane: ReservationLane, statusSql: string): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(effective_stake), 0) AS total
       FROM exposure_reservations
       WHERE partner_code = $partnerCode
         AND out_id = $outId
         AND skin = $skin
         AND ${statusSql}`,
    )
    .get({
      $partnerCode: lane.partnerCode,
      $outId: lane.outId,
      $skin: lane.skin,
    }) as { total: number };
  return assertAggregate(row.total);
}

function mapReservation(row: ReservationRow): ExposureReservation {
  return {
    id: asExposureReservationId(row.id),
    idempotencyKey: asExecutionIdempotencyKey(row.idempotency_key),
    partnerCode: asPartnerCode(row.partner_code),
    outId: asOutId(row.out_id),
    skin: asSkinId(row.skin),
    provider: asProviderId(row.provider),
    authorizationId: asAuthorizationId(row.authorization_id),
    actorId: row.actor_id,
    partnerSplitBps: row.partner_split_bps,
    requestedStake: row.requested_stake,
    effectiveStake: row.effective_stake,
    marketId: asMarketId(row.market_id),
    selection: asMarketSelection(row.selection),
    decimalOdds: row.decimal_odds,
    status: row.status,
    reservationExpiresAtMs: row.reservation_expires_at_ms,
    placementOwner: row.placement_owner === null ? null : asPlacementOwner(row.placement_owner),
    ticketId: row.ticket_id === null ? null : asTicketId(row.ticket_id),
    providerResponse:
      row.provider_response_json === null ? null : JSON.parse(row.provider_response_json),
    failureReason: row.failure_reason,
    reconciliationOwner:
      row.reconciliation_owner === null ? null : asReconciliationOwner(row.reconciliation_owner),
    reconciliationLeaseExpiresAtMs: row.reconciliation_lease_expires_at_ms,
    reconciliationAttempts: row.reconciliation_attempts,
    lastReconciliationAtMs: row.last_reconciliation_at_ms,
    nextReconciliationAtMs: row.next_reconciliation_at_ms,
    reconciliationResult: row.reconciliation_result,
    reconciliationError: row.reconciliation_error,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function serializeProviderResponse(value: unknown): string | null {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("provider response summary is not JSON serializable");
  if (serialized.length > 16_384) {
    throw new TypeError("provider response summary must be at most 16384 characters");
  }
  return serialized;
}

function normalizeReason(reason: string): string {
  return (reason.trim() || "provider outcome unavailable").slice(0, 2_048);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch-millisecond integer`);
  }
}

function assertPositiveMinorUnits(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer in minor units`);
  }
}

function assertAggregate(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("exposure aggregate is outside the safe integer range");
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid exposure reservation input";
}
