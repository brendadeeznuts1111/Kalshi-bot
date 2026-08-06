import type { Database } from "bun:sqlite";
import { evaluateExecutionGate } from "../authorization/gate.ts";
import {
  asOutId,
  asPartnerCode,
  asSkinId,
  type ApprovedAuthorization,
} from "../authorization/domain.ts";
import {
  asAuthorizationReceiptDedupeKey,
  enqueueAuthorizationReceipt,
} from "../authorization/outbox.ts";
import { getActiveLiveTradeAuthorization } from "../authorization/sql.ts";
import {
  asExecutionIdempotencyKey,
  asMarketId,
  asMarketSelection,
  asPlacementOwner,
  type AuthorizedBetResult,
  type BetRequest,
  type ExecutionDependencies,
  type ExposureReservation,
} from "./domain.ts";
import {
  claimReservationForPlacement,
  computeDailyUsage,
  computeOutstandingExposure,
  computeReservedMarketLiquidity,
  confirmReservation,
  createPendingReservation,
  getReservationByIdempotencyKey,
  markReservationUnknown,
  rejectReservation,
  releaseExpiredReservations,
} from "./reservation.ts";
import { ensureExecutionSchema } from "./sql.ts";

const DEFAULT_RESERVATION_TTL_MS = 30_000;

/**
 * Reserve under BEGIN IMMEDIATE, dispatch outside SQLite, then durably finalize.
 * Provider throws are ambiguous and remain exposure-bearing (`unknown`).
 */
export async function executeAuthorizedBet(
  db: Database,
  request: BetRequest,
  dependencies: ExecutionDependencies,
): Promise<AuthorizedBetResult> {
  const requestError = validateRequest(request);
  if (requestError !== null) {
    return { success: false, code: "INVALID_REQUEST", reason: requestError };
  }
  const initialNow = dependencies.now?.() ?? Date.now();
  try {
    ensureExecutionSchema(db, initialNow);
  } catch (error) {
    return { success: false, code: "RESERVATION_FAILED", reason: errorMessage(error) };
  }

  const existing = getReservationByIdempotencyKey(db, request.idempotencyKey);
  if (existing !== null) {
    return reservationMatchesRequest(existing, request)
      ? replayResult(existing)
      : {
          success: false,
          code: "RESERVATION_CONFLICT",
          reason: "Execution idempotency key is already bound to different bet terms",
          reservationId: existing.id,
        };
  }

  const initialAuthorization = getActiveLiveTradeAuthorization(db, {
    partnerCode: request.partnerCode,
    outId: request.outId,
    skin: request.skin,
    nowMs: initialNow,
  });
  if (initialAuthorization === null) {
    return {
      success: false,
      code: "NO_ACTIVE_AUTHORIZATION",
      reason: "No active live-trade authorization exists for this partner, out, and skin",
    };
  }

  let snapshot;
  try {
    snapshot = await dependencies.loadSnapshot(initialAuthorization, request);
  } catch (error) {
    return { success: false, code: "SNAPSHOT_UNAVAILABLE", reason: errorMessage(error) };
  }
  if (
    snapshot.stakeQuantum !== undefined &&
    (!Number.isSafeInteger(snapshot.stakeQuantum) || snapshot.stakeQuantum <= 0)
  ) {
    return {
      success: false,
      code: "SNAPSHOT_UNAVAILABLE",
      reason: "Provider stake quantum must be a positive safe integer in minor units",
    };
  }

  const placementOwner = asPlacementOwner(crypto.randomUUID());
  const ttlMs = dependencies.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    return {
      success: false,
      code: "INVALID_REQUEST",
      reason: "reservation TTL must be a positive safe integer",
    };
  }

  let prepared:
    | { kind: "place"; authorization: ApprovedAuthorization; reservation: ExposureReservation }
    | { kind: "result"; result: AuthorizedBetResult };
  try {
    const transaction = db.transaction(() => {
      const nowMs = dependencies.now?.() ?? initialNow;
      releaseExpiredReservations(db, nowMs);

      const replay = getReservationByIdempotencyKey(db, request.idempotencyKey);
      if (replay !== null) {
        return {
          kind: "result" as const,
          result: reservationMatchesRequest(replay, request)
            ? replayResult(replay)
            : {
                success: false as const,
                code: "RESERVATION_CONFLICT" as const,
                reason: "Execution idempotency key is already bound to different bet terms",
                reservationId: replay.id,
              },
        };
      }

      const authorization = getActiveLiveTradeAuthorization(db, {
        partnerCode: request.partnerCode,
        outId: request.outId,
        skin: request.skin,
        nowMs,
      });
      if (authorization === null || authorization.id !== initialAuthorization.id) {
        return {
          kind: "result" as const,
          result: {
            success: false as const,
            code: "NO_ACTIVE_AUTHORIZATION" as const,
            reason: "Authorization changed or became inactive before reservation",
          },
        };
      }

      const lane = {
        partnerCode: request.partnerCode,
        outId: request.outId,
        skin: request.skin,
      };
      const outstandingExposure = computeOutstandingExposure(db, lane);
      const reservedMarketLiquidity = computeReservedMarketLiquidity(
        db,
        lane,
        request.marketId,
        request.decimalOdds,
      );
      const gate = evaluateExecutionGate({
        authorization,
        currentPolicy: snapshot.currentPolicy,
        nowMs,
        oddsFresh: snapshot.oddsFresh,
        providerSessionValid: snapshot.providerSessionValid,
        riskHealthy: snapshot.riskHealthy,
        stakeInput: {
          requestedStake: request.requestedStake,
          sitePerBetMax: snapshot.sitePerBetMax,
          decimalOdds: request.decimalOdds,
          availableBalance: Math.max(snapshot.availableBalance - outstandingExposure, 0),
          dailyUsed: computeDailyUsage(db, lane, utcDayStartMs(nowMs)),
          outstandingExposure,
          marketLiquidity: Math.max(
            snapshot.marketLiquidity - reservedMarketLiquidity,
            0,
          ),
        },
      });
      if (!gate.allowed) {
        return {
          kind: "result" as const,
          result: {
            success: false as const,
            code: "GATE_DENIED" as const,
            reason: `${gate.code}: ${gate.reason}`,
          },
        };
      }

      const effectiveStake = quantizeStake(gate.effectiveStake, snapshot.stakeQuantum);
      if (effectiveStake <= 0) {
        return {
          kind: "result" as const,
          result: {
            success: false as const,
            code: "GATE_DENIED" as const,
            reason: "EFFECTIVE_STAKE_ZERO: Effective stake is below the provider order minimum",
          },
        };
      }

      const expiresAtMs = safeAdd(nowMs, ttlMs, "reservation expiry");
      const created = createPendingReservation(db, {
        authorization,
        request,
        effectiveStake,
        expiresAtMs,
        nowMs,
      });
      if (!created.ok) {
        return {
          kind: "result" as const,
          result: {
            success: false as const,
            code:
              created.code === "IDEMPOTENCY_CONFLICT"
                ? ("RESERVATION_CONFLICT" as const)
                : ("RESERVATION_FAILED" as const),
            reason: created.reason,
          },
        };
      }
      if (!created.created) {
        return { kind: "result" as const, result: replayResult(created.reservation) };
      }
      const claimed = claimReservationForPlacement(db, {
        id: created.reservation.id,
        placementOwner,
        ...(dependencies.capturePlacementExpectation
          ? {
              providerResponse: {
                placementExpectation: dependencies.capturePlacementExpectation({
                  authorization,
                  request,
                  effectiveStake,
                  idempotencyKey: request.idempotencyKey,
                }),
              },
            }
          : {}),
        nowMs,
      });
      if (claimed === null) throw new Error("new reservation could not be claimed for placement");
      return { kind: "place" as const, authorization, reservation: claimed };
    });
    prepared = transaction.immediate();
  } catch (error) {
    return { success: false, code: "RESERVATION_FAILED", reason: errorMessage(error) };
  }

  if (prepared.kind === "result") return prepared.result;
  const { authorization, reservation } = prepared;

  let providerResult;
  try {
    providerResult = await dependencies.placeBet({
      authorization,
      request,
      effectiveStake: reservation.effectiveStake,
      idempotencyKey: request.idempotencyKey,
    });
  } catch (error) {
    const reason = errorMessage(error);
    try {
      const transaction = db.transaction(() => {
        const nowMs = dependencies.now?.() ?? Date.now();
        const unknown = markReservationUnknown(db, {
          id: reservation.id,
          placementOwner,
          reason,
          ...(reservation.providerResponse && typeof reservation.providerResponse === "object"
            && "placementExpectation" in reservation.providerResponse
            ? { placementExpectation: reservation.providerResponse.placementExpectation }
            : {}),
          nowMs,
        });
        if (unknown === null) throw new Error("reservation ownership changed before unknown result");
        enqueueExecutionReceipt(db, authorization, unknown, "unknown", reason, nowMs);
      });
      transaction.immediate();
    } catch (persistenceError) {
      return {
        success: false,
        code: "PERSISTENCE_UNCERTAIN",
        reason: `Provider outcome and reservation persistence are uncertain: ${errorMessage(persistenceError)}`,
        reservationId: reservation.id,
        effectiveStake: reservation.effectiveStake,
      };
    }
    return {
      success: false,
      code: "PROVIDER_OUTCOME_UNKNOWN",
      reason,
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }

  if (!providerResult.accepted) {
    try {
      const transaction = db.transaction(() => {
        const nowMs = dependencies.now?.() ?? Date.now();
        const rejected = rejectReservation(db, {
          id: reservation.id,
          placementOwner,
          reason: providerResult.reason,
          providerResponse: providerResult.responseSummary,
          nowMs,
        });
        if (rejected === null) throw new Error("reservation ownership changed before rejection");
        enqueueExecutionReceipt(
          db,
          authorization,
          rejected,
          "rejected",
          providerResult.reason,
          nowMs,
        );
      });
      transaction.immediate();
    } catch (error) {
      return {
        success: false,
        code: "PERSISTENCE_UNCERTAIN",
        reason: `Provider rejected the bet but persistence failed: ${errorMessage(error)}`,
        reservationId: reservation.id,
        effectiveStake: reservation.effectiveStake,
      };
    }
    return {
      success: false,
      code: "PROVIDER_REJECTED",
      reason: providerResult.reason,
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }

  try {
    const transaction = db.transaction(() => {
      const nowMs = dependencies.now?.() ?? Date.now();
      const confirmed = confirmReservation(db, {
        id: reservation.id,
        placementOwner,
        ticketId: providerResult.ticketId,
        providerResponse: providerResult.responseSummary,
        nowMs,
      });
      if (confirmed === null) throw new Error("reservation ownership changed before confirmation");
      enqueueExecutionReceipt(db, authorization, confirmed, "confirmed", null, nowMs);
    });
    transaction.immediate();
  } catch (error) {
    return {
      success: false,
      code: "PERSISTENCE_UNCERTAIN",
      reason: `Provider accepted the bet but confirmation persistence failed: ${errorMessage(error)}`,
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }
  return {
    success: true,
    code: "BET_CONFIRMED",
    ticketId: providerResult.ticketId,
    effectiveStake: reservation.effectiveStake,
    reservationId: reservation.id,
    ...(providerResult.responseSummary === undefined
      ? {}
      : { providerResponse: providerResult.responseSummary }),
  };
}

function quantizeStake(effectiveStake: number, quantum: number | undefined): number {
  if (quantum === undefined) return effectiveStake;
  return Math.floor(effectiveStake / quantum) * quantum;
}

function replayResult(reservation: ExposureReservation): AuthorizedBetResult {
  if (reservation.status === "confirmed" && reservation.ticketId !== null) {
    return {
      success: true,
      code: "ALREADY_CONFIRMED",
      ticketId: reservation.ticketId,
      effectiveStake: reservation.effectiveStake,
      reservationId: reservation.id,
      ...(reservation.providerResponse === null
        ? {}
        : { providerResponse: reservation.providerResponse }),
    };
  }
  if (reservation.status === "unknown") {
    return {
      success: false,
      code: "PROVIDER_OUTCOME_UNKNOWN",
      reason: reservation.failureReason ?? "Provider outcome requires reconciliation",
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }
  if (reservation.status === "placing" || reservation.status === "pending") {
    return {
      success: false,
      code: "PLACEMENT_IN_PROGRESS",
      reason: `Execution reservation is ${reservation.status}`,
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }
  if (reservation.status === "rejected") {
    return {
      success: false,
      code: "PROVIDER_REJECTED",
      reason: reservation.failureReason ?? "Provider rejected the bet",
      reservationId: reservation.id,
      effectiveStake: reservation.effectiveStake,
    };
  }
  return {
    success: false,
    code: "RESERVATION_CONFLICT",
    reason: `Execution idempotency key is bound to a ${reservation.status} reservation`,
    reservationId: reservation.id,
    effectiveStake: reservation.effectiveStake,
  };
}

function reservationMatchesRequest(
  reservation: ExposureReservation,
  request: BetRequest,
): boolean {
  return (
    reservation.partnerCode === request.partnerCode &&
    reservation.outId === request.outId &&
    reservation.skin === request.skin &&
    reservation.marketId === request.marketId &&
    reservation.selection === request.selection &&
    reservation.requestedStake === request.requestedStake &&
    reservation.decimalOdds === request.decimalOdds
  );
}

function enqueueExecutionReceipt(
  db: Database,
  authorization: ApprovedAuthorization,
  reservation: ExposureReservation,
  outcome: "confirmed" | "rejected" | "unknown",
  reason: string | null,
  nowMs: number,
): void {
  const headline =
    outcome === "confirmed"
      ? "✅ <b>Bet confirmed</b>"
      : outcome === "rejected"
        ? "⛔ <b>Bet rejected</b>"
        : "⚠️ <b>Bet outcome unknown — reconciliation required</b>";
  const detail =
    outcome === "confirmed"
      ? `Ticket: <code>${Bun.escapeHTML(reservation.ticketId ?? "missing")}</code>`
      : `Reason: ${Bun.escapeHTML(reason ?? "not provided")}`;
  enqueueAuthorizationReceipt(
    db,
    {
      dedupeKey: asAuthorizationReceiptDedupeKey(
        `execution:${reservation.id}:${outcome}`,
      ),
      telegramChatId: authorization.telegramChatId,
      telegramTopicId: authorization.telegramTopicId,
      payload: {
        text:
          `${headline}\n` +
          `Out: <code>${Bun.escapeHTML(reservation.outId)}</code>\n` +
          `Market: <code>${Bun.escapeHTML(reservation.marketId)}</code>\n` +
          `Selection: <code>${Bun.escapeHTML(reservation.selection)}</code>\n` +
          `Stake: <code>${reservation.effectiveStake}</code> minor units\n` +
          `Odds: <code>${reservation.decimalOdds}</code>\n` +
          detail,
        parseMode: "HTML",
      },
    },
    nowMs,
  );
}

function validateRequest(request: BetRequest): string | null {
  try {
    asPartnerCode(request.partnerCode);
    asOutId(request.outId);
    asSkinId(request.skin);
    asMarketId(request.marketId);
    asMarketSelection(request.selection);
    asExecutionIdempotencyKey(request.idempotencyKey);
    if (!Number.isSafeInteger(request.requestedStake) || request.requestedStake <= 0) {
      throw new TypeError("requested stake must be a positive safe integer in minor units");
    }
    if (!Number.isFinite(request.decimalOdds) || request.decimalOdds <= 1) {
      throw new TypeError("decimal odds must be finite and greater than one");
    }
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function utcDayStartMs(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000) * 86_400_000;
}

function safeAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} exceeds safe integer range`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "execution operation failed";
}
