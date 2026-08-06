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
  asPlacementOwner,
  asTicketId,
  type BetRequest,
  type ExecutionIdempotencyKey,
  type ExposureReservation,
  type ExposureReservationId,
  type ExposureReservationStatus,
  type PlacementOwner,
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
  requested_stake: number;
  effective_stake: number;
  market_id: string; // brand-ok — SQLite wire value; parsed by mapReservation
  decimal_odds: number;
  status: ExposureReservationStatus;
  reservation_expires_at_ms: number;
  placement_owner: string | null;
  ticket_id: string | null; // brand-ok — SQLite wire value; parsed by mapReservation
  provider_response_json: string | null;
  failure_reason: string | null;
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

export function createPendingReservation(
  db: Database,
  input: {
    authorization: ApprovedAuthorization;
    request: BetRequest;
    effectiveStake: number;
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
        requested_stake, effective_stake, market_id, decimal_odds,
        status, reservation_expires_at_ms, created_at_ms, updated_at_ms
      ) VALUES (
        $idempotencyKey, $partnerCode, $outId, $skin, $provider, $authorizationId,
        $requestedStake, $effectiveStake, $marketId, $decimalOdds,
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
      $requestedStake: input.request.requestedStake,
      $effectiveStake: input.effectiveStake,
      $marketId: input.request.marketId,
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
    existing.marketId !== input.request.marketId ||
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
    nowMs: number;
  },
): ExposureReservation | null {
  assertTimestamp(input.nowMs, "placement claim time");
  const row = db
    .query(
      `UPDATE exposure_reservations
       SET status = 'placing', placement_owner = $owner, updated_at_ms = $nowMs
       WHERE id = $id
         AND status = 'pending'
         AND reservation_expires_at_ms > $nowMs
       RETURNING *`,
    )
    .get({ $id: input.id, $owner: input.placementOwner, $nowMs: input.nowMs }) as
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
    nowMs: number;
  },
): ExposureReservation | null {
  return completePlacement(db, {
    ...input,
    status: "unknown",
    ticketId: null,
    providerResponse: { error: normalizeReason(input.reason) },
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
  return sumExposure(
    db,
    lane,
    "status IN ('pending', 'placing', 'confirmed', 'unknown')",
  );
}

export function computeReservedMarketLiquidity(
  db: Database,
  lane: ReservationLane,
  marketId: BetRequest["marketId"],
  decimalOdds: number,
): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(effective_stake), 0) AS total
       FROM exposure_reservations
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

/** Reconcile an ambiguous placement after querying the provider by idempotency key. */
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
    requestedStake: row.requested_stake,
    effectiveStake: row.effective_stake,
    marketId: asMarketId(row.market_id),
    decimalOdds: row.decimal_odds,
    status: row.status,
    reservationExpiresAtMs: row.reservation_expires_at_ms,
    placementOwner: row.placement_owner === null ? null : asPlacementOwner(row.placement_owner),
    ticketId: row.ticket_id === null ? null : asTicketId(row.ticket_id),
    providerResponse:
      row.provider_response_json === null ? null : JSON.parse(row.provider_response_json),
    failureReason: row.failure_reason,
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
