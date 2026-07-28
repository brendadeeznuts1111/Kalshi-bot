/**
 * ComplianceAgent — bet validation + market-integrity (steam) rules.
 *
 * Wraps ComplianceRepository and adds Polymarket line-move evaluation.
 */

import { Database } from "bun:sqlite";
import { AGENT_ROLE, TABLE, POLYMARKET, PLAY_STATUS, SQL_UNIXEPOCH } from "../constants";
import type { Agent, AgentContext, AgentResult, AgentTask } from "./orchestrator.ts";
import { ComplianceRepository } from "../lib/compliance-repo.ts";
import { BetBlockedError } from "../lib/errors.ts";

export class ComplianceAgent implements Agent {
  readonly role = AGENT_ROLE.COMPLIANCE;

  constructor(private repo: ComplianceRepository) {}

  async run(task: AgentTask, _ctx: AgentContext): Promise<AgentResult> {
    const start = performance.now();

    switch (task.type) {
      case "COMPLIANCE_CHECK": {
        const p = task.payload;
        try {
          const result = this.repo.placeBetAtomic({
            nodeId: p.nodeId,
            userId: p.userId,
            stateCode: p.stateCode,
            sportId: p.sportId,
            marketId: p.marketId,
            wagerAmount: p.wagerAmount,
            betType: p.betType,
            playId: p.playId,
          });
          return {
            role: this.role,
            ok: true,
            data: { playId: result.playId, status: result.status },
            latencyMs: Math.round(performance.now() - start),
          };
        } catch (err) {
          if (err instanceof BetBlockedError) {
            return {
              role: this.role,
              ok: false,
              error: err.message,
              data: { ruleId: err.ruleId },
              latencyMs: Math.round(performance.now() - start),
            };
          }
          throw err;
        }
      }

      case "LINE_MOVE_EVAL": {
        const p = task.payload;
        const violations = this.evaluateMarketIntegrityRules(
          p.slug,
          p.oldPrice,
          p.newPrice,
          p.deltaBp,
          p.detectedAt,
          _ctx.db,
        );
        return {
          role: this.role,
          ok: true,
          data: { slug: p.slug, violationsFound: violations.length, violations },
          latencyMs: Math.round(performance.now() - start),
        };
      }

      default:
        return {
          role: this.role,
          ok: false,
          error: `Unsupported task type: ${task.type}`,
          latencyMs: Math.round(performance.now() - start),
        };
    }
  }

  /**
   * Steam detection: if a market moves > threshold within the lookback window,
   * flag any bets placed just before the move as suspicious.
   *
   * Returns the list of flagged plays for audit / ops dashboard.
   */
  evaluateMarketIntegrityRules(
    slug: string,
    _oldPrice: number,
    _newPrice: number,
    deltaBp: number,
    detectedAt: number,
    db: Database,
  ): Array<{ playId: string; userId: string; placedAt: number; reason: string }> {
    const lookback = detectedAt - POLYMARKET.STEAM_LOOKBACK_SECONDS;

    // Find plays placed in the steam lookback window whose market_id maps to this slug
    // (In production this would join a market_slug mapping table.)
    const rows = db
      .query<
        { play_id: string; user_id: string; placed_at: number },
        [number, number, string]
      >(
        `SELECT play_id, user_id, placed_at
         FROM ${TABLE.PLAYS}
         WHERE placed_at >= ? AND placed_at <= ?
           AND market_id = ?
           AND status = '${PLAY_STATUS.ACCEPTED}'`,
      )
      .all(lookback, detectedAt, slug);

    if (rows.length === 0) return [];

    const reason = `Steam alert: ${slug} moved ${deltaBp} bp within ${POLYMARKET.STEAM_LOOKBACK_SECONDS}s of bet`;

    const violations: Array<{ playId: string; userId: string; placedAt: number; reason: string }> = [];
    for (const row of rows) {
      db.run(
        `INSERT INTO ${TABLE.REGULATORY_VIOLATIONS}
         (node_id, user_id, play_id, state_code, reason, details, blocked_at)
         VALUES (?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH})`,
        [
          "polymarket",
          row.user_id,
          row.play_id,
          "US",
          reason,
          JSON.stringify({ slug, deltaBp, detectedAt, placedAt: row.placed_at }),
        ],
      );
      violations.push({
        playId: row.play_id,
        userId: row.user_id,
        placedAt: row.placed_at,
        reason,
      });
    }

    return violations;
  }
}
