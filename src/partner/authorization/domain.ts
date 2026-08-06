/** Immutable authorization policy and execution-gate domain contracts. */

declare const partnerCodeBrand: unique symbol;
declare const outIdBrand: unique symbol;
declare const providerIdBrand: unique symbol;
declare const skinIdBrand: unique symbol;
declare const currencyCodeBrand: unique symbol;
declare const policyHashBrand: unique symbol;
declare const telegramChatIdBrand: unique symbol;
declare const telegramTopicIdBrand: unique symbol;
declare const telegramMessageIdBrand: unique symbol;
declare const telegramUserIdBrand: unique symbol;
declare const authorizationRequestIdBrand: unique symbol;
declare const authorizationIdBrand: unique symbol;

export type PartnerCode = string & { readonly [partnerCodeBrand]: true };
export type OutId = string & { readonly [outIdBrand]: true };
export type ProviderId = string & { readonly [providerIdBrand]: true };
export type SkinId = string & { readonly [skinIdBrand]: true };
export type CurrencyCode = string & { readonly [currencyCodeBrand]: true };
export type PolicyHash = string & { readonly [policyHashBrand]: true };
export type TelegramChatId = string & { readonly [telegramChatIdBrand]: true };
export type TelegramTopicId = string & { readonly [telegramTopicIdBrand]: true };
export type TelegramMessageId = string & { readonly [telegramMessageIdBrand]: true };
export type TelegramUserId = string & { readonly [telegramUserIdBrand]: true };
export type AuthorizationRequestId = number & { readonly [authorizationRequestIdBrand]: true };
export type AuthorizationId = number & { readonly [authorizationIdBrand]: true };

export const PERMISSION_SCOPES = ["observe_odds", "paper_trade", "live_trade"] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const MAX_WIN_BASES = ["profit", "total_return"] as const;
export type MaxWinBasis = (typeof MAX_WIN_BASES)[number];

export const AUTHORIZATION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;
export type AuthorizationRequestStatus = (typeof AUTHORIZATION_REQUEST_STATUSES)[number];

export const POLICY_HASH_DOMAIN = "partner-account-authorization-policy-v1";

function brandNonEmpty<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > 128) throw new TypeError(`${label} must be at most 128 characters`);
  if (/\p{Cc}/u.test(normalized)) throw new TypeError(`${label} must not contain control characters`);
  return normalized as T;
}

function brandTelegramNumericId<T extends string>(value: string, label: string): T {
  const normalized = brandNonEmpty<string>(value, label);
  if (!/^-?\d+$/.test(normalized)) throw new TypeError(`${label} must be a numeric Telegram ID`);
  return normalized as T;
}

export function asPartnerCode(value: string): PartnerCode {
  return brandNonEmpty(value, "partner code");
}

export function asOutId(value: string): OutId {
  return brandNonEmpty(value, "out ID");
}

export function asProviderId(value: string): ProviderId {
  return brandNonEmpty(value, "provider ID");
}

export function asSkinId(value: string): SkinId {
  return brandNonEmpty(value, "skin ID");
}

export function asCurrencyCode(value: string): CurrencyCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new TypeError("currency code must contain exactly three ASCII letters");
  }
  return normalized as CurrencyCode;
}

export function asPolicyHash(value: string): PolicyHash {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("policy hash must be a 64-character SHA-256 hex digest");
  }
  return normalized as PolicyHash;
}

export function asTelegramChatId(value: string): TelegramChatId {
  return brandTelegramNumericId(value, "Telegram chat ID");
}

export function asTelegramTopicId(value: string): TelegramTopicId {
  return brandTelegramNumericId(value, "Telegram topic ID");
}

export function asTelegramMessageId(value: string): TelegramMessageId {
  return brandTelegramNumericId(value, "Telegram message ID");
}

export function asTelegramUserId(value: string): TelegramUserId {
  return brandTelegramNumericId(value, "Telegram user ID");
}

function brandPositiveInteger<T extends number>(value: number, label: string): T {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value as T;
}

export function asAuthorizationRequestId(value: number): AuthorizationRequestId {
  return brandPositiveInteger(value, "authorization request ID");
}

export function asAuthorizationId(value: number): AuthorizationId {
  return brandPositiveInteger(value, "authorization ID");
}

/** Every money value is an integer number of currency minor units. */
export interface AuthorizationPolicy {
  partnerCode: PartnerCode;
  outId: OutId;
  provider: ProviderId;
  skin: SkinId;
  scope: PermissionScope;
  maxStake: number;
  maxWin: number;
  maxWinBasis: MaxWinBasis;
  dailyLimit: number | null;
  exposureLimit: number | null;
  currency: CurrencyCode;
  validFromMs: number;
  expiresAtMs: number | null;
}

export interface AuthorizationRequest extends AuthorizationPolicy {
  id: AuthorizationRequestId;
  status: AuthorizationRequestStatus;
  requestHash: PolicyHash;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  telegramMessageId: TelegramMessageId;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ApprovedAuthorization extends AuthorizationPolicy {
  id: AuthorizationId;
  requestId: AuthorizationRequestId;
  approvalHash: PolicyHash;
  telegramChatId: TelegramChatId;
  telegramTopicId: TelegramTopicId | null;
  telegramMessageId: TelegramMessageId;
  approvingUserId: TelegramUserId;
  revokedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface StakeComputationInput {
  requestedStake: number;
  sitePerBetMax: number;
  partnerApprovedMaxStake: number;
  maxWin: number;
  maxWinBasis: MaxWinBasis;
  decimalOdds: number;
  availableBalance: number;
  dailyUsed: number;
  dailyLimit: number | null;
  outstandingExposure: number;
  exposureLimit: number | null;
  /** Confirmed executable amount at the quoted odds; pass zero when unknown. */
  marketLiquidity: number;
}

/** Runtime values only. Authorization-controlled caps are supplied by the verified policy. */
export type GateStakeInput = Omit<
  StakeComputationInput,
  "partnerApprovedMaxStake" | "maxWin" | "maxWinBasis" | "dailyLimit" | "exposureLimit"
>;

export interface GateChecks {
  hasActiveAuthorization: boolean;
  isScopeLiveTrade: boolean;
  hashMatch: boolean;
  oddsFresh: boolean;
  effectiveStakePositive: boolean;
  providerSessionValid: boolean;
  riskHealthy: boolean;
}

export type GateDenialCode =
  | "NO_AUTHORIZATION"
  | "INVALID_EVALUATION_TIME"
  | "AUTHORIZATION_REVOKED"
  | "AUTHORIZATION_NOT_YET_VALID"
  | "AUTHORIZATION_EXPIRED"
  | "SCOPE_NOT_LIVE_TRADE"
  | "POLICY_HASH_MISMATCH"
  | "STALE_ODDS"
  | "EFFECTIVE_STAKE_NOT_POSITIVE"
  | "PROVIDER_SESSION_INVALID"
  | "RISK_UNHEALTHY";

export type GateDecision =
  | {
      allowed: true;
      effectiveStake: number;
      checks: GateChecks;
    }
  | {
      allowed: false;
      code: GateDenialCode;
      reason: string;
      checks: GateChecks;
    };

export function policyFromAuthorization(auth: ApprovedAuthorization): AuthorizationPolicy {
  return {
    partnerCode: auth.partnerCode,
    outId: auth.outId,
    provider: auth.provider,
    skin: auth.skin,
    scope: auth.scope,
    maxStake: auth.maxStake,
    maxWin: auth.maxWin,
    maxWinBasis: auth.maxWinBasis,
    dailyLimit: auth.dailyLimit,
    exposureLimit: auth.exposureLimit,
    currency: auth.currency,
    validFromMs: auth.validFromMs,
    expiresAtMs: auth.expiresAtMs,
  };
}
