/**
 * Operator-facing promote dry-report from durable inventory_leagues.
 * Never applies COMPETITIONS — report only (cron / CLI).
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from 'bun:sqlite';
import {
  planCompetitionPromote,
  type CompetitionPromotePlan,
} from '../domain/competition-promote.ts';
import { listInventoryLeagues } from './leagues.ts';

export type PromoteReportOptions = {
  minPeak?: number;
  sportId?: string;
  /** Max candidate ids to include in text (default 12). */
  candidateLimit?: number;
};

export type PromoteReport = {
  plan: CompetitionPromotePlan;
  minPeak: number;
  unmappedInput: number;
  /** One-line summary for cron. */
  summaryLine: string;
  /** Multi-line detail (candidates + reject histogram). */
  detailLines: string[];
};

export function buildPromoteReport(
  db: Database,
  options: PromoteReportOptions = {}
): PromoteReport {
  const minPeak = options.minPeak ?? 1;
  const candidateLimit = Math.min(Math.max(options.candidateLimit ?? 12, 1), 100);
  const rows = listInventoryLeagues(db, {
    unmappedOnly: true,
    sportId: options.sportId,
    limit: 5000,
    orderBy: 'peak',
  });
  const plan = planCompetitionPromote(
    rows.map(r => ({
      sportId: r.sportId,
      leagueKey: r.leagueKey,
      inventoryBucket: r.inventoryBucket,
      peakEventCount: r.peakEventCount,
      eventCountLive: r.eventCountLive,
    })),
    { minPeak }
  );

  const byReason = new Map<string, number>();
  for (const r of plan.rejected) {
    byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  }
  const rejectPart =
    byReason.size > 0
      ? ` rejected=${[...byReason.entries()].map(([k, v]) => `${k}:${v}`).join(',')}`
      : '';

  const summaryLine =
    `promote-report minPeak=${minPeak} unmapped=${rows.length} ` +
    `candidates=${plan.candidates.length}${rejectPart}` +
    (plan.candidates.length > 0
      ? ' · apply: bun run inventory:leagues -- --promote --apply'
      : '');

  const detailLines: string[] = [];
  for (const c of plan.candidates.slice(0, candidateLimit)) {
    const peak = c.source.peakEventCount ?? '?';
    detailLines.push(
      `  +C ${c.record.id} · peak=${peak} · ${c.record.providerMappings.plive?.inventoryBucket ?? c.record.sportId}`
    );
  }
  if (plan.candidates.length > candidateLimit) {
    detailLines.push(`  +C … ${plan.candidates.length - candidateLimit} more`);
  }

  return {
    plan,
    minPeak,
    unmappedInput: rows.length,
    summaryLine,
    detailLines,
  };
}
