/**
 * AdminAgent — self-exclusion, limit management, and user status queries.
 *
 * Wraps the regulatory admin CLI functions into the agent framework.
 */

import { Database } from "bun:sqlite";
import { AGENT_ROLE, TABLE, PLAY_STATUS, SQL_UNIXEPOCH } from "../constants";
import type { Agent, AgentContext, AgentResult, AgentTask } from "./orchestrator.ts";

export class AdminAgent implements Agent {
  readonly role = AGENT_ROLE.ADMIN;

  constructor(private db: Database) {}

  async run(task: AgentTask, _ctx: AgentContext): Promise<AgentResult> {
    const start = performance.now();

    switch (task.type) {
      case "ADMIN_ACTION": {
        const p = task.payload;
        const result = this.handleAdmin(p.action, p.nodeId, p.userId, p.payload);
        return {
          role: this.role,
          ok: result.ok,
          ...(result.data !== undefined ? { data: result.data } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
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

  private handleAdmin(
    action: string,
    nodeId: string,
    userId: string,
    payload?: Record<string, unknown>,
  ): { ok: boolean; data?: Record<string, unknown>; error?: string } {
    switch (action) {
      case "self_exclude": {
        const reason = payload?.reason ? String(payload.reason) : "self-requested";
        const expiresAt = payload?.expiresAt ? Number(payload.expiresAt) : null;
        this.db.run(
          `INSERT INTO ${TABLE.SELF_EXCLUSIONS} (user_id, node_id, reason, excluded_at, expires_at)
           VALUES (?, ?, ?, ${SQL_UNIXEPOCH}, ?)
           ON CONFLICT(user_id, node_id) DO UPDATE SET
             reason = excluded.reason,
             excluded_at = excluded.excluded_at,
             expires_at = excluded.expires_at`,
          [userId, nodeId, reason, expiresAt],
        );
        return { ok: true, data: { userId, nodeId, reason, expiresAt } };
      }

      case "remove_exclusion": {
        this.db.run(
          `DELETE FROM ${TABLE.SELF_EXCLUSIONS} WHERE user_id = ? AND node_id = ?`,
          [userId, nodeId],
        );
        return { ok: true, data: { userId, nodeId, removed: true } };
      }

      case "set_limit": {
        const stateCode = payload?.stateCode ? String(payload.stateCode) : "US";
        const sportId = payload?.sportId ? String(payload.sportId) : "all";
        const marketId = payload?.marketId ? String(payload.marketId) : "all";
        const maxWager = payload?.maxWager !== undefined ? Number(payload.maxWager) : null;
        const minWager = payload?.minWager !== undefined ? Number(payload.minWager) : 0;
        const allowedTypes = payload?.allowedTypes
          ? JSON.stringify(payload.allowedTypes)
          : "[]";
        const specialRules = payload?.specialRules ? JSON.stringify(payload.specialRules) : null;

        this.db.run(
          `INSERT INTO ${TABLE.REGULATORY_LIMITS}
           (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules, effective_from)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH})`,
          [stateCode, sportId, marketId, maxWager, minWager, allowedTypes, specialRules],
        );
        return { ok: true, data: { stateCode, sportId, marketId, maxWager, minWager } };
      }

      case "get_status": {
        // Self-exclusion status
        const exclusion = this.db
          .query<{ reason: string; expires_at: number | null }, [string, string]>(
            `SELECT reason, expires_at FROM ${TABLE.SELF_EXCLUSIONS}
             WHERE user_id = ? AND node_id = ?
               AND (expires_at IS NULL OR expires_at > ${SQL_UNIXEPOCH})`,
          )
          .get(userId, nodeId);

        // Daily spend
        const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
        const spent = this.db
          .query<{ total: number }, [string, string, number]>(
            `SELECT COALESCE(SUM(wager_amount), 0) as total
             FROM ${TABLE.PLAYS}
             WHERE user_id = ? AND node_id = ? AND placed_at >= ? AND status = '${PLAY_STATUS.ACCEPTED}'`,
          )
          .get(userId, nodeId, todayStart);

        // Last bet
        const lastBet = this.db
          .query<{ placed_at: number }, [string, string]>(
            `SELECT placed_at FROM ${TABLE.PLAYS}
             WHERE user_id = ? AND node_id = ? ORDER BY placed_at DESC LIMIT 1`,
          )
          .get(userId, nodeId);

        return {
          ok: true,
          data: {
            userId,
            nodeId,
            selfExcluded: !!exclusion,
            exclusionReason: exclusion?.reason ?? null,
            exclusionExpiresAt: exclusion?.expires_at ?? null,
            dailyWagerTotal: spent?.total ?? 0,
            lastBetAt: lastBet?.placed_at ?? null,
          },
        };
      }

      default:
        return { ok: false, error: `Unknown admin action: ${action}` };
    }
  }
}
