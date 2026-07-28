/**
 * audit.ts — Immutable audit trail for regulatory actions.
 *
 * Every significant action (bet placement, self-exclusion, limit change,
 * line-move detection, agent dispatch) is logged with:
 *   - traceId (correlates across agents)
 *   - actor (role + optional userId)
 *   - action (canonical verb)
 *   - target (what was acted upon)
 *   - outcome (ok / blocked / error)
 *   - latencyMs
 *   - timestamp
 *
 * Table: regulatory_audit_log (created via migration 012_polymarket.sql)
 */

import { Database } from "bun:sqlite";
import { TABLE, SQL_UNIXEPOCH } from "../constants";

export type AuditEntry = {
  traceId: string;
  actor: string;       // e.g. "compliance-agent", "admin-cli", "polymarket-ingest"
  action: string;      // e.g. "BET_PLACED", "SELF_EXCLUSION_ADDED", "LINE_MOVE_DETECTED"
  target?: string;     // e.g. "play-123", "user-1", "will-it-rain"
  outcome: "ok" | "blocked" | "error" | "flagged";
  details?: Record<string, unknown>;
  latencyMs?: number;
};

export class AuditTrail {
  constructor(private db: Database) {}

  /** Append a single audit entry. */
  log(entry: AuditEntry): void {
    this.db.run(
      `INSERT INTO ${TABLE.REGULATORY_AUDIT_LOG}
       (trace_id, actor, action, target, outcome, details, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH})`,
      [
        entry.traceId,
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.outcome,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.latencyMs ?? null,
      ],
    );
  }

  /** Convenience: log a bet placement outcome. */
  logBet(traceId: string, playId: string, userId: string, outcome: "ok" | "blocked", details?: Record<string, unknown>, latencyMs?: number): void {
    this.log({
      traceId,
      actor: "compliance-agent",
      action: "BET_PLACED",
      target: playId,
      outcome,
      details: { userId, ...details },
      latencyMs,
    });
  }

  /** Convenience: log a line move detection. */
  logLineMove(traceId: string, slug: string, deltaBp: number, volumeAtMove: number, latencyMs?: number): void {
    this.log({
      traceId,
      actor: "market-data-agent",
      action: "LINE_MOVE_DETECTED",
      target: slug,
      outcome: "flagged",
      details: { deltaBp, volumeAtMove },
      latencyMs,
    });
  }

  /** Convenience: log an agent dispatch. */
  logDispatch(traceId: string, role: string, taskType: string, outcome: "ok" | "error", latencyMs?: number): void {
    this.log({
      traceId,
      actor: "orchestrator",
      action: "AGENT_DISPATCH",
      target: `${role}:${taskType}`,
      outcome,
      latencyMs,
    });
  }

  /** Query audit entries by traceId (ordered newest first). */
  byTrace(traceId: string, limit = 50): Array<{
    id: number;
    traceId: string;
    actor: string;
    action: string;
    target: string | null;
    outcome: string;
    details: Record<string, unknown> | null;
    latencyMs: number | null;
    createdAt: number;
  }> {
    const rows = this.db
      .query<
        {
          id: number;
          trace_id: string;
          actor: string;
          action: string;
          target: string | null;
          outcome: string;
          details: string | null;
          latency_ms: number | null;
          created_at: number;
        },
        [string, number]
      >(
        `SELECT id, trace_id, actor, action, target, outcome, details, latency_ms, created_at
         FROM ${TABLE.REGULATORY_AUDIT_LOG}
         WHERE trace_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(traceId, limit);

    return rows.map((r) => ({
      id: r.id,
      traceId: r.trace_id,
      actor: r.actor,
      action: r.action,
      target: r.target,
      outcome: r.outcome,
      details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
      latencyMs: r.latency_ms,
      createdAt: r.created_at,
    }));
  }

  /** Summary of actions in a time window. */
  summary(since: number): {
    total: number;
    byActor: Record<string, number>;
    byOutcome: Record<string, number>;
    avgLatencyMs: number | null;
  } {
    const total = this.db
      .query<{ c: number }, [number]>(
        `SELECT COUNT(*) as c FROM ${TABLE.REGULATORY_AUDIT_LOG} WHERE created_at >= ?`,
      )
      .get(since)!.c;

    const byActorRows = this.db
      .query<{ actor: string; c: number }, [number]>(
        `SELECT actor, COUNT(*) as c FROM ${TABLE.REGULATORY_AUDIT_LOG} WHERE created_at >= ? GROUP BY actor`,
      )
      .all(since);

    const byOutcomeRows = this.db
      .query<{ outcome: string; c: number }, [number]>(
        `SELECT outcome, COUNT(*) as c FROM ${TABLE.REGULATORY_AUDIT_LOG} WHERE created_at >= ? GROUP BY outcome`,
      )
      .all(since);

    const avgRow = this.db
      .query<{ avg: number | null }, [number]>(
        `SELECT AVG(latency_ms) as avg FROM ${TABLE.REGULATORY_AUDIT_LOG} WHERE created_at >= ? AND latency_ms IS NOT NULL`,
      )
      .get(since);

    return {
      total,
      byActor: Object.fromEntries(byActorRows.map((r) => [r.actor, r.c])),
      byOutcome: Object.fromEntries(byOutcomeRows.map((r) => [r.outcome, r.c])),
      avgLatencyMs: avgRow?.avg ?? null,
    };
  }
}
