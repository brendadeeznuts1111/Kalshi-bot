import type {
  ApprovedAuthorization,
  AuthorizationPolicy,
  OutId,
  PartnerCode,
  ProviderId,
  SkinId,
} from "../authorization/domain.ts";

declare const marketIdBrand: unique symbol;
declare const marketSelectionBrand: unique symbol;
declare const ticketIdBrand: unique symbol;
declare const reservationIdBrand: unique symbol;
declare const executionKeyBrand: unique symbol;
declare const placementOwnerBrand: unique symbol;
declare const reconciliationOwnerBrand: unique symbol;

export type MarketId = string & { readonly [marketIdBrand]: true };
export type MarketSelection = string & { readonly [marketSelectionBrand]: true };
export type TicketId = string & { readonly [ticketIdBrand]: true };
export type ExposureReservationId = number & { readonly [reservationIdBrand]: true };
export type ExecutionIdempotencyKey = string & { readonly [executionKeyBrand]: true };
export type PlacementOwner = string & { readonly [placementOwnerBrand]: true };
export type ReconciliationOwner = string & { readonly [reconciliationOwnerBrand]: true };

export const RECONCILIATION_ATTEMPT_RESULTS = [
  "not_found",
  "conflict",
  "error",
] as const;
export type ReconciliationAttemptResult = (typeof RECONCILIATION_ATTEMPT_RESULTS)[number];

export const EXPOSURE_RESERVATION_STATUSES = [
  "pending",
  "placing",
  "confirmed",
  "rejected",
  "unknown",
  "cancelled",
  "settled",
] as const;
export type ExposureReservationStatus = (typeof EXPOSURE_RESERVATION_STATUSES)[number];

export interface BetRequest {
  /** Authenticated operator provenance; absent only for non-HTTP/internal callers. */
  actorId?: string;
  partnerCode: PartnerCode;
  outId: OutId;
  skin: SkinId;
  marketId: MarketId;
  selection: MarketSelection;
  idempotencyKey: ExecutionIdempotencyKey;
  requestedStake: number;
  decimalOdds: number;
}

/** Fresh runtime inputs gathered immediately before the reservation transaction. */
export interface ExecutionSnapshot {
  currentPolicy: AuthorizationPolicy;
  oddsFresh: boolean;
  providerSessionValid: boolean;
  riskHealthy: boolean;
  sitePerBetMax: number;
  availableBalance: number;
  marketLiquidity: number;
  /** Optional provider order increment in minor units; effective stake rounds down to it. */
  stakeQuantum?: number;
}

export interface ProviderPlacementInput {
  authorization: ApprovedAuthorization;
  request: BetRequest;
  effectiveStake: number;
  /** Must be forwarded to providers that support idempotent order creation. */
  idempotencyKey: ExecutionIdempotencyKey;
}

export type ProviderPlacementResult =
  | {
      accepted: true;
      ticketId: TicketId;
      /** Sanitized, secret-free summary only. */
      responseSummary?: unknown;
    }
  | {
      accepted: false;
      reason: string;
      /** Sanitized, secret-free summary only. */
      responseSummary?: unknown;
    };

export interface ExecutionDependencies {
  loadSnapshot: (
    authorization: ApprovedAuthorization,
    request: BetRequest,
  ) => Promise<ExecutionSnapshot> | ExecutionSnapshot;
  placeBet: (input: ProviderPlacementInput) => Promise<ProviderPlacementResult>;
  /** Secret-free immutable provider terms persisted before any provider I/O. */
  capturePlacementExpectation?: (input: ProviderPlacementInput) => unknown;
  now?: () => number;
  reservationTtlMs?: number;
  /** Immutable partner economics captured on the reservation before dispatch. */
  partnerSplitBps?: number;
}

export interface ExposureReservation {
  id: ExposureReservationId;
  idempotencyKey: ExecutionIdempotencyKey;
  partnerCode: PartnerCode;
  outId: OutId;
  skin: SkinId;
  provider: ProviderId;
  authorizationId: ApprovedAuthorization["id"];
  actorId: string | null;
  partnerSplitBps: number;
  requestedStake: number;
  effectiveStake: number;
  marketId: MarketId;
  selection: MarketSelection;
  decimalOdds: number;
  status: ExposureReservationStatus;
  reservationExpiresAtMs: number;
  placementOwner: PlacementOwner | null;
  ticketId: TicketId | null;
  providerResponse: unknown | null;
  failureReason: string | null;
  reconciliationOwner: ReconciliationOwner | null;
  reconciliationLeaseExpiresAtMs: number | null;
  reconciliationAttempts: number;
  lastReconciliationAtMs: number | null;
  nextReconciliationAtMs: number | null;
  reconciliationResult: ReconciliationAttemptResult | "confirmed" | null;
  reconciliationError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type ExecutionDenialCode =
  | "INVALID_REQUEST"
  | "NO_ACTIVE_AUTHORIZATION"
  | "SNAPSHOT_UNAVAILABLE"
  | "GATE_DENIED"
  | "RESERVATION_CONFLICT"
  | "RESERVATION_FAILED"
  | "PLACEMENT_IN_PROGRESS"
  | "PROVIDER_REJECTED"
  | "PROVIDER_OUTCOME_UNKNOWN"
  | "PERSISTENCE_UNCERTAIN";

export type AuthorizedBetResult =
  | {
      success: true;
      code: "BET_CONFIRMED" | "ALREADY_CONFIRMED";
      ticketId: TicketId;
      effectiveStake: number;
      reservationId: ExposureReservationId;
      /** Sanitized provider placement summary, including immediate fill state when available. */
      providerResponse?: unknown;
    }
  | {
      success: false;
      code: ExecutionDenialCode;
      reason: string;
      reservationId?: ExposureReservationId;
      effectiveStake?: number;
    };

export function asMarketId(value: string): MarketId {
  return brandBoundedString<MarketId>(value, "market ID", 256);
}

export function asMarketSelection(value: string): MarketSelection {
  return brandBoundedString<MarketSelection>(value, "market selection", 128);
}

export function asTicketId(value: string): TicketId {
  return brandBoundedString<TicketId>(value, "ticket ID", 256);
}

export function asExecutionIdempotencyKey(value: string): ExecutionIdempotencyKey {
  return brandBoundedString<ExecutionIdempotencyKey>(value, "execution idempotency key", 256);
}

export function asPlacementOwner(value: string): PlacementOwner {
  return brandBoundedString<PlacementOwner>(value, "placement owner", 128);
}

export function asReconciliationOwner(value: string): ReconciliationOwner {
  return brandBoundedString<ReconciliationOwner>(value, "reconciliation owner", 128);
}

export function asExposureReservationId(value: number): ExposureReservationId {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("exposure reservation ID must be a positive safe integer");
  }
  return value as ExposureReservationId;
}

function brandBoundedString<T extends string>(value: string, label: string, max: number): T {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > max) throw new TypeError(`${label} must be at most ${max} characters`);
  if (/\p{Cc}/u.test(normalized)) throw new TypeError(`${label} must not contain control characters`);
  return normalized as T;
}
