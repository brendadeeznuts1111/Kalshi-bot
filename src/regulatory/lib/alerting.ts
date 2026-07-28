/**
 * alerting.ts — Sliding-window violation spike detection + ops-ready summaries.
 *
 * Usage:
 *   const alerts = new ViolationAlerts(db);
 *   const spike = alerts.checkSpike({ windowSeconds: 300, threshold: 10 });
 *   if (spike.triggered) { pageOnCall(spike); }
 */

import { Database } from "bun:sqlite";
import { ALERT, TABLE, SQL_UNIXEPOCH } from "../constants";

export interface SpikeCheckOptions {
  windowSeconds: number; // sliding window size
  threshold: number;     // violations before trigger
}

export interface SpikeResult {
  triggered: boolean;
  count: number;
  windowSeconds: number;
  threshold: number;
  topReasons: { reason: string; count: number }[];
  topStates: { stateCode: string; count: number }[];
}

export interface ViolationSummary {
  total: number;
  byState: Record<string, number>;
  byNode: Record<string, number>;
  byReason: Record<string, number>;
  recent: Array<{
    blockedAt: number;
    stateCode: string;
    nodeId: string;
    reason: string;
  }>;
}

export class ViolationAlerts {
  constructor(private db: Database) {}

  /**
   * Check whether violation count in the last `windowSeconds` exceeds `threshold`.
   * Returns full breakdown for ops dashboards even when not triggered.
   */
  checkSpike(options: SpikeCheckOptions): SpikeResult {
    const since = Math.floor(Date.now() / 1000) - options.windowSeconds;

    const count = this.db
      .query<{ c: number }, [number]>(
        `SELECT COUNT(*) as c FROM ${TABLE.REGULATORY_VIOLATIONS} WHERE blocked_at >= ?`,
      )
      .get(since)!.c;

    const topReasons = this.db
      .query<{ reason: string; count: number }, [number]>(
        `SELECT reason, COUNT(*) as count
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         GROUP BY reason
         ORDER BY count DESC
         LIMIT ${ALERT.TOP_REASONS_LIMIT}`,
      )
      .all(since);

    const topStates = this.db
      .query<{ stateCode: string; count: number }, [number]>(
        `SELECT state_code as stateCode, COUNT(*) as count
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         GROUP BY state_code
         ORDER BY count DESC
         LIMIT ${ALERT.TOP_STATES_LIMIT}`,
      )
      .all(since);

    return {
      triggered: count >= options.threshold,
      count,
      windowSeconds: options.windowSeconds,
      threshold: options.threshold,
      topReasons,
      topStates,
    };
  }

  /**
   * Produce a full summary of violations over the last N minutes.
   * Suitable for ops dashboard ingestion.
   */
  summary(lastMinutes: number = ALERT.DEFAULT_SUMMARY_MINUTES): ViolationSummary {
    const since = Math.floor(Date.now() / 1000) - lastMinutes * 60;

    const total = this.db
      .query<{ c: number }, [number]>(
        `SELECT COUNT(*) as c FROM ${TABLE.REGULATORY_VIOLATIONS} WHERE blocked_at >= ?`,
      )
      .get(since)!.c;

    const byStateRows = this.db
      .query<{ state_code: string; count: number }, [number]>(
        `SELECT state_code, COUNT(*) as count
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         GROUP BY state_code`,
      )
      .all(since);

    const byNodeRows = this.db
      .query<{ node_id: string; count: number }, [number]>(
        `SELECT node_id, COUNT(*) as count
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         GROUP BY node_id`,
      )
      .all(since);

    const byReasonRows = this.db
      .query<{ reason: string; count: number }, [number]>(
        `SELECT reason, COUNT(*) as count
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         GROUP BY reason`,
      )
      .all(since);

    const recent = this.db
      .query<
        { blocked_at: number; state_code: string; node_id: string; reason: string },
        [number]
      >(
        `SELECT blocked_at, state_code, node_id, reason
         FROM ${TABLE.REGULATORY_VIOLATIONS}
         WHERE blocked_at >= ?
         ORDER BY blocked_at DESC
         LIMIT ${ALERT.RECENT_LIMIT}`,
      )
      .all(since);

    return {
      total,
      byState: Object.fromEntries(byStateRows.map((r) => [r.state_code, r.count])),
      byNode: Object.fromEntries(byNodeRows.map((r) => [r.node_id, r.count])),
      byReason: Object.fromEntries(byReasonRows.map((r) => [r.reason, r.count])),
      recent: recent.map((r) => ({
        blockedAt: r.blocked_at,
        stateCode: r.state_code,
        nodeId: r.node_id,
        reason: r.reason,
      })),
    };
  }
}
