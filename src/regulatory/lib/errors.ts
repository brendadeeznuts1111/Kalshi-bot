/**
 * errors.ts — Domain-typed error hierarchy for the regulatory system.
 *
 * Every error carries:
 *   - A canonical code (for programmatic handling)
 *   - A human-readable message
 *   - Optional context (ruleId, userId, nodeId, etc.)
 *
 * Usage:
 *   throw new BetBlockedError("Max wager exceeded", { ruleId: 7, userId: "u1" });
 *   if (err instanceof RegulatoryError && err.code === "BET_BLOCKED") { … }
 */

export type ErrorContext = Record<string, unknown>;

/** Base class for all regulatory domain errors. */
export class RegulatoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: ErrorContext,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace for V8/Bun
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context ?? null,
    };
  }
}

// ── Bet lifecycle ──

/** Bet rejected by compliance gate. */
export class BetBlockedError extends RegulatoryError {
  constructor(
    message: string,
    public readonly ruleId?: number,
    context?: ErrorContext,
  ) {
    super(message, "BET_BLOCKED", { ...context, ruleId });
  }
}

/** Bet type not permitted in jurisdiction. */
export class BetTypeNotAllowedError extends RegulatoryError {
  constructor(
    message: string,
    public readonly allowedTypes: string[],
    context?: ErrorContext,
  ) {
    super(message, "BET_TYPE_NOT_ALLOWED", { ...context, allowedTypes });
  }
}

/** Wager outside permitted bounds. */
export class WagerOutOfBoundsError extends RegulatoryError {
  constructor(
    message: string,
    public readonly minWager: number,
    public readonly maxWager: number | null,
    public readonly actualWager: number,
    context?: ErrorContext,
  ) {
    super(message, "WAGER_OUT_OF_BOUNDS", { ...context, minWager, maxWager, actualWager });
  }
}

// ── User / identity ──

/** User is self-excluded. */
export class SelfExcludedError extends RegulatoryError {
  constructor(
    message: string,
    public readonly userId: string,
    public readonly nodeId: string,
    public readonly reason: string,
    context?: ErrorContext,
  ) {
    super(message, "SELF_EXCLUDED", { ...context, userId, nodeId, reason });
  }
}

/** Identity verification required but not satisfied. */
export class IdentityVerificationError extends RegulatoryError {
  constructor(
    message: string,
    public readonly userId: string,
    context?: ErrorContext,
  ) {
    super(message, "IDENTITY_VERIFICATION_REQUIRED", { ...context, userId });
  }
}

// ── License / jurisdiction ──

/** Partner not licensed in target state. */
export class LicenseError extends RegulatoryError {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly stateCode: string,
    public readonly licenseStatus?: string,
    context?: ErrorContext,
  ) {
    super(message, "LICENSE_INVALID", { ...context, nodeId, stateCode, licenseStatus });
  }
}

// ── Rate limiting ──

/** Request throttled by rate limiter. */
export class RateLimitError extends RegulatoryError {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
    public readonly limit: number,
    public readonly windowMs: number,
    context?: ErrorContext,
  ) {
    super(message, "RATE_LIMITED", { ...context, retryAfterMs, limit, windowMs });
  }
}

// ── Market data / Polymarket ──

/** Polymarket Gamma API request failed. */
export class PolymarketApiError extends RegulatoryError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    context?: ErrorContext,
  ) {
    super(message, "POLYMARKET_API_ERROR", { ...context, statusCode, endpoint });
  }
}

/** Detected steam bet — bet placed before a significant line move. */
export class SteamAlertError extends RegulatoryError {
  constructor(
    message: string,
    public readonly slug: string,
    public readonly deltaBp: number,
    public readonly playId: string,
    public readonly userId: string,
    context?: ErrorContext,
  ) {
    super(message, "STEAM_ALERT", { ...context, slug, deltaBp, playId, userId });
  }
}

/** Market data stale or missing. */
export class MarketDataStaleError extends RegulatoryError {
  constructor(
    message: string,
    public readonly slug: string,
    public readonly lastTickAt?: number,
    context?: ErrorContext,
  ) {
    super(message, "MARKET_DATA_STALE", { ...context, slug, lastTickAt });
  }
}

// ── Agent / orchestration ──

/** No agent registered for requested role. */
export class AgentNotFoundError extends RegulatoryError {
  constructor(
    message: string,
    public readonly role: string,
    context?: ErrorContext,
  ) {
    super(message, "AGENT_NOT_FOUND", { ...context, role });
  }
}

/** Agent task execution failed. */
export class AgentTaskError extends RegulatoryError {
  constructor(
    message: string,
    public readonly role: string,
    public readonly taskType: string,
    public readonly innerError?: string,
    context?: ErrorContext,
  ) {
    super(message, "AGENT_TASK_FAILED", { ...context, role, taskType, innerError });
  }
}

// ── Database / migration ──

/** Migration failed to apply. */
export class MigrationError extends RegulatoryError {
  constructor(
    message: string,
    public readonly filename: string,
    public readonly checksum?: string,
    context?: ErrorContext,
  ) {
    super(message, "MIGRATION_FAILED", { ...context, filename, checksum });
  }
}

/** Database constraint or integrity violation. */
export class DatabaseIntegrityError extends RegulatoryError {
  constructor(
    message: string,
    public readonly table: string,
    public readonly constraint?: string,
    context?: ErrorContext,
  ) {
    super(message, "DB_INTEGRITY", { ...context, table, constraint });
  }
}
