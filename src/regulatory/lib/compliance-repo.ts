/**
 * ComplianceRepository — validates bets against state regulatory limits
 * with per-user checks (self-exclusion, daily limits, cooling-off).
 *
 * All checks are wrapped in SQLite transactions for atomicity.
 */

import { Database } from "bun:sqlite";
import { BetBlockedError } from "./errors";
import {
  PLAY_STATUS,
  DEFAULT_COUNTRY_CODE,
  LICENSE_STATUS,
  SPECIAL_RULE,
  TABLE,
  TX,
  SQL_UNIXEPOCH,
} from "../constants";

export interface BetCheckParams {
  nodeId: string;
  userId: string;
  stateCode: string;
  sportId: string;
  marketId: string;
  wagerAmount: number;
  betType: string; // e.g. "straight", "parlay", "teaser"
}

export interface BetCheckResult {
  allowed: boolean;
  reason?: string;
  ruleId?: number;
}

export type ExecutionPlayStatus =
  | typeof PLAY_STATUS.PROPOSED
  | typeof PLAY_STATUS.CONFIRMED
  | typeof PLAY_STATUS.REJECTED
  | typeof PLAY_STATUS.UNKNOWN;

export class ComplianceRepository {
  constructor(private db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Determine whether a bet is allowed under current regulations.
   * Checks (in order):
   *   1. Self-exclusion
   *   2. Partner license status
   *   3. Regulatory limits (wager bounds, bet types, special rules)
   *   4. Per-user daily limits (if configured in special_rules)
   */
  isBetAllowed(params: BetCheckParams): BetCheckResult {
    // 1. Self-exclusion check
    const exclusion = this.checkSelfExclusion(params.userId, params.nodeId);
    if (exclusion.excluded) {
      return {
        allowed: false,
        reason: `User ${params.userId} is self-excluded: ${exclusion.reason}`,
      };
    }

    // 2. License check
    const license = this.db
      .query<{ status: string }, [string, string]>(
        `SELECT status FROM ${TABLE.PARTNER_STATE_LICENSES}
         WHERE node_id = ? AND state_code = ?`,
      )
      .get(params.nodeId, params.stateCode);

    if (!license) {
      return {
        allowed: false,
        reason: `Partner ${params.nodeId} is not licensed in ${params.stateCode}`,
      };
    }
    if (license.status !== LICENSE_STATUS.ACTIVE) {
      return {
        allowed: false,
        reason: `Partner license in ${params.stateCode} is ${license.status}`,
      };
    }

    // 3. Fetch the most-recent active regulatory limit row
    const limit = this.db
      .query<
        {
          id: number;
          max_wager: number | null;
          min_wager: number;
          allowed_bet_types: string;
          special_rules: string | null;
        },
        [string, string, string]
      >(
        `SELECT id, max_wager, min_wager, allowed_bet_types, special_rules
         FROM ${TABLE.REGULATORY_LIMITS}
         WHERE state_code = ? AND sport_id = ? AND market_id = ?
           AND effective_from <= ${SQL_UNIXEPOCH}
           AND (effective_to IS NULL OR effective_to > ${SQL_UNIXEPOCH})
         ORDER BY effective_from DESC
         LIMIT 1`,
      )
      .get(params.stateCode, params.sportId, params.marketId);

    if (!limit) {
      return { allowed: true };
    }

    // 4. Wager bounds
    if (limit.max_wager !== null && params.wagerAmount > limit.max_wager) {
      return {
        allowed: false,
        reason: `Wager $${params.wagerAmount} exceeds max $${limit.max_wager} in ${params.stateCode}`,
        ruleId: limit.id,
      };
    }
    if (params.wagerAmount < limit.min_wager) {
      return {
        allowed: false,
        reason: `Wager $${params.wagerAmount} below min $${limit.min_wager} in ${params.stateCode}`,
        ruleId: limit.id,
      };
    }

    // 5. Bet-type whitelist
    let allowedTypes: string[] = [];
    try {
      allowedTypes = JSON.parse(limit.allowed_bet_types || "[]");
    } catch {
      return {
        allowed: false,
        reason: `Corrupted allowed_bet_types config for ${params.stateCode}`,
        ruleId: limit.id,
      };
    }

    if (!allowedTypes.includes(params.betType)) {
      return {
        allowed: false,
        reason: `Bet type '${params.betType}' not permitted in ${params.stateCode}; allowed: ${allowedTypes.join(", ")}`,
        ruleId: limit.id,
      };
    }

    // 6. Special rules (daily limits, identity verification, cooling-off)
    if (limit.special_rules) {
      const special = this.evaluateSpecialRules(params, limit.special_rules);
      if (!special.allowed) {
        return {
          allowed: false,
          reason: special.reason!,
          ruleId: limit.id,
        };
      }
    }

    return { allowed: true, ruleId: limit.id };
  }

  /**
   * Atomically validate a bet AND insert it if allowed.
   * Returns the inserted play_id on success, or throws with the block reason.
   *
   * Pre-checks outside the transaction so violation logs survive rollback.
   * Re-verifies inside the locked transaction to prevent races.
   */
  placeBetAtomic(params: BetCheckParams & { playId: string }): { playId: string; status: typeof PLAY_STATUS.ACCEPTED } {
    // Pre-check outside transaction so violation logs survive rollback
    const check = this.isBetAllowed(params);
    if (!check.allowed) {
      this.logViolation(params.playId, params.nodeId, params.userId, params.stateCode, check.reason!);
      throw new BetBlockedError(check.reason!, check.ruleId);
    }

    // Start IMMEDIATE transaction to lock the database for the insert
    this.db.run(TX.BEGIN_IMMEDIATE);
    try {
      // Re-verify inside the locked transaction (limits may have changed)
      const recheck = this.isBetAllowed(params);
      if (!recheck.allowed) {
        this.db.run(TX.ROLLBACK);
        this.logViolation(params.playId, params.nodeId, params.userId, params.stateCode, recheck.reason!);
        throw new BetBlockedError(recheck.reason!, recheck.ruleId);
      }

      this.db.run(
        `INSERT INTO ${TABLE.PLAYS} (play_id, node_id, user_id, country_code, sport_id, market_id, state_code, wager_amount, bet_type, status, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '${PLAY_STATUS.ACCEPTED}', ${SQL_UNIXEPOCH})`,
        [
          params.playId,
          params.nodeId,
          params.userId,
          DEFAULT_COUNTRY_CODE,
          params.sportId,
          params.marketId,
          params.stateCode,
          params.wagerAmount,
          params.betType,
        ],
      );

      this.db.run(TX.COMMIT);
      return { playId: params.playId, status: PLAY_STATUS.ACCEPTED };
    } catch (err) {
      try { this.db.run(TX.ROLLBACK); } catch { /* already rolled back or never began */ }
      throw err;
    }
  }

  /**
   * Validate and record an execution intent without counting it as an accepted
   * wager. The idempotency key is the cross-database binding to the execution
   * reservation that is attached after the gate reserves exposure.
   */
  proposeExecutionBetAtomic(
    params: BetCheckParams & { playId: string; idempotencyKey: string },
  ): { playId: string; status: typeof PLAY_STATUS.PROPOSED } {
    if (!params.idempotencyKey.trim()) throw new Error("Execution idempotency key is required");

    const existing = this.db
      .query<{ play_id: string; status: string }, [string]>(
        `SELECT play_id, status FROM ${TABLE.PLAYS} WHERE execution_idempotency_key = ?`,
      )
      .get(params.idempotencyKey);
    if (existing) {
      if (existing.play_id !== params.playId) {
        throw new Error("Execution idempotency key is already bound to another play");
      }
      return { playId: existing.play_id, status: PLAY_STATUS.PROPOSED };
    }

    const check = this.isBetAllowed(params);
    if (!check.allowed) {
      this.logViolation(params.playId, params.nodeId, params.userId, params.stateCode, check.reason!);
      throw new BetBlockedError(check.reason!, check.ruleId);
    }

    this.db.run(TX.BEGIN_IMMEDIATE);
    try {
      const recheck = this.isBetAllowed(params);
      if (!recheck.allowed) {
        this.db.run(TX.ROLLBACK);
        this.logViolation(params.playId, params.nodeId, params.userId, params.stateCode, recheck.reason!);
        throw new BetBlockedError(recheck.reason!, recheck.ruleId);
      }
      this.db.run(
        `INSERT INTO ${TABLE.PLAYS}
          (play_id, node_id, user_id, country_code, sport_id, market_id, state_code,
           wager_amount, bet_type, status, placed_at, execution_idempotency_key, execution_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH}, ?, ${SQL_UNIXEPOCH})`,
        [params.playId, params.nodeId, params.userId, DEFAULT_COUNTRY_CODE, params.sportId,
          params.marketId, params.stateCode, params.wagerAmount, params.betType,
          PLAY_STATUS.PROPOSED, params.idempotencyKey],
      );
      this.db.run(TX.COMMIT);
      return { playId: params.playId, status: PLAY_STATUS.PROPOSED };
    } catch (err) {
      try { this.db.run(TX.ROLLBACK); } catch { /* already rolled back */ }
      throw err;
    }
  }

  /** Advance a proposed/unknown play using provider evidence. Terminal states
   * are immutable; replaying the same transition is idempotent. */
  transitionExecutionPlay(params: {
    idempotencyKey: string;
    status: Exclude<ExecutionPlayStatus, typeof PLAY_STATUS.PROPOSED>;
    reservationId?: number | null;
    reason?: string | null;
  }): { playId: string; status: string } {
    this.db.run(TX.BEGIN_IMMEDIATE);
    try {
      const row = this.db.query<{ play_id: string; status: string }, [string]>(
        `SELECT play_id, status FROM ${TABLE.PLAYS} WHERE execution_idempotency_key = ?`,
      ).get(params.idempotencyKey);
      if (!row) throw new Error("Execution play not found");
      if (row.status === params.status) {
        this.db.run(TX.COMMIT);
        return { playId: row.play_id, status: row.status };
      }
      if (row.status === PLAY_STATUS.CONFIRMED || row.status === PLAY_STATUS.REJECTED) {
        throw new Error(`Cannot transition terminal execution play from ${row.status}`);
      }
      if (row.status !== PLAY_STATUS.PROPOSED && row.status !== PLAY_STATUS.UNKNOWN) {
        throw new Error(`Invalid execution play state: ${row.status}`);
      }
      this.db.run(
        `UPDATE ${TABLE.PLAYS}
         SET status = ?, execution_reservation_id = COALESCE(?, execution_reservation_id),
             execution_reason = ?, execution_updated_at = ${SQL_UNIXEPOCH}
         WHERE execution_idempotency_key = ?`,
        [params.status, params.reservationId ?? null, params.reason ?? null, params.idempotencyKey],
      );
      this.db.run(TX.COMMIT);
      return { playId: row.play_id, status: params.status };
    } catch (err) {
      try { this.db.run(TX.ROLLBACK); } catch { /* already rolled back */ }
      throw err;
    }
  }

  /**
   * Record a regulatory violation for audit / ops dashboard.
   */
  logViolation(
    playId: string | null,
    nodeId: string,
    userId: string,
    stateCode: string,
    reason: string,
    details?: Record<string, unknown>,
  ): void {
    this.db.run(
      `INSERT INTO ${TABLE.REGULATORY_VIOLATIONS} (node_id, user_id, play_id, state_code, reason, details, blocked_at)
       VALUES (?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH})`,
      [nodeId, userId, playId, stateCode, reason, details ? JSON.stringify(details) : null],
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private checkSelfExclusion(userId: string, nodeId: string): { excluded: boolean; reason?: string } {
    const row = this.db
      .query<{ reason: string; expires_at: number | null }, [string, string]>(
        `SELECT reason, expires_at FROM ${TABLE.SELF_EXCLUSIONS}
         WHERE user_id = ? AND node_id = ?
           AND (expires_at IS NULL OR expires_at > ${SQL_UNIXEPOCH})`,
      )
      .get(userId, nodeId);

    if (row) {
      return { excluded: true, reason: row.reason };
    }
    return { excluded: false };
  }

  private evaluateSpecialRules(
    params: BetCheckParams,
    rulesJson: string,
  ): { allowed: boolean; reason?: string } {
    try {
      const rules = JSON.parse(rulesJson) as Record<string, unknown>;

      // max_daily_total — check user's wager sum today
      const maxDaily = rules[SPECIAL_RULE.MAX_DAILY_TOTAL];
      if (typeof maxDaily === "number") {
        const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
        const spent = this.db
          .query<{ total: number }, [string, string, number]>(
            `SELECT COALESCE(SUM(wager_amount), 0) as total
             FROM ${TABLE.PLAYS}
             WHERE user_id = ? AND node_id = ? AND placed_at >= ?
               AND status IN ('${PLAY_STATUS.ACCEPTED}', '${PLAY_STATUS.CONFIRMED}',
                 '${PLAY_STATUS.PROPOSED}', '${PLAY_STATUS.UNKNOWN}')`,
          )
          .get(params.userId, params.nodeId, todayStart);

        const total = (spent?.total ?? 0) + params.wagerAmount;
        if (total > maxDaily) {
          return {
            allowed: false,
            reason: `Daily wager limit $${maxDaily} would be exceeded (currently $${spent?.total ?? 0} + $${params.wagerAmount})`,
          };
        }
      }

      // require_identity_verification — stub for KYC hook
      if (rules[SPECIAL_RULE.REQUIRE_IDENTITY_VERIFICATION] === true) {
        // In production: check session / KYC status here
        // return { allowed: false, reason: "Identity verification required" };
      }

      // cooling_off_minutes — enforce time since last bet
      const coolingOff = rules[SPECIAL_RULE.COOLING_OFF_MINUTES];
      if (typeof coolingOff === "number") {
        const lastBet = this.db
          .query<{ placed_at: number }, [string, string]>(
            `SELECT placed_at FROM ${TABLE.PLAYS}
             WHERE user_id = ? AND node_id = ?
               AND status IN ('${PLAY_STATUS.ACCEPTED}', '${PLAY_STATUS.CONFIRMED}',
                 '${PLAY_STATUS.PROPOSED}', '${PLAY_STATUS.UNKNOWN}')
             ORDER BY placed_at DESC LIMIT 1`,
          )
          .get(params.userId, params.nodeId);

        if (lastBet) {
          const minutesSince = (Math.floor(Date.now() / 1000) - lastBet.placed_at) / 60;
          if (minutesSince < coolingOff) {
            return {
              allowed: false,
              reason: `Cooling-off period: ${Math.ceil(coolingOff - minutesSince)} minutes remaining`,
            };
          }
        }
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: "Invalid special_rules JSON" };
    }
  }
}
