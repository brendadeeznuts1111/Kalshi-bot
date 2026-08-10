/**
 * Enrich quality loop: match-rate + miss-reason histogram + ops gates.
 */
import {
  diagnoseBookedMatch,
  type BookedMatchEntry,
  type BookedMatchReason,
} from './booked-match.ts';

export type EnrichQualityMiss = {
  inventoryId: string;
  home: string | null;
  away: string | null;
  sport: string | null;
  league: string | null;
  reason: BookedMatchReason;
  score: number | null;
  secondScore: number | null;
};

export type EnrichQualityReport = {
  candidates: number;
  matched: number;
  matchRate: number; // 0–1
  /** Counts by BookedMatchReason (includes matched). */
  byReason: Record<string, number>;
  /** Sample misses (not matched), max 12. */
  missSample: EnrichQualityMiss[];
  catalogSize: number;
  /** Optional book fill after enrich (null if not measured). */
  linkedPct: number | null;
  passed: boolean;
  errors: string[];
};

export type EnrichQualityGates = {
  /**
   * Fail when matched/candidates < this (0–1).
   * Default null = no match-rate gate (only requireAnyMatch-style via validate).
   */
  minMatchRate?: number | null;
  /** Fail when book linkedPct < this (0–100). */
  minLinkedPct?: number | null;
  /** Fail when candidates>0 and matched=0 (default true when catalog non-empty). */
  requireAnyMatchWhenCandidates?: boolean;
};

export function emptyEnrichQuality(
  catalogSize = 0
): EnrichQualityReport {
  return {
    candidates: 0,
    matched: 0,
    matchRate: 0,
    byReason: {},
    missSample: [],
    catalogSize,
    linkedPct: null,
    passed: true,
    errors: [],
  };
}

/**
 * Score every candidate; does not write. Used after applyBookedOddsEnrich
 * (or instead of) for quality reporting.
 */
export function buildEnrichQualityReport(
  candidates: Array<{
    inventoryId: string;
    home: string | null;
    away: string | null;
    sport?: string | null;
    league?: string | null;
  }>,
  catalog: BookedMatchEntry[],
  options: {
    gates?: EnrichQualityGates;
    linkedPct?: number | null;
  } = {}
): EnrichQualityReport {
  const byReason: Record<string, number> = {};
  const missSample: EnrichQualityMiss[] = [];
  let matched = 0;

  for (const row of candidates) {
    const d = diagnoseBookedMatch(row.home, row.away, catalog, {
      sport: row.sport,
      league: row.league,
    });
    byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
    if (d.reason === 'matched') {
      matched++;
    } else if (missSample.length < 12) {
      missSample.push({
        inventoryId: row.inventoryId,
        home: row.home,
        away: row.away,
        sport: row.sport ?? null,
        league: row.league ?? null,
        reason: d.reason,
        score: d.score,
        secondScore: d.secondScore,
      });
    }
  }

  const candidatesN = candidates.length;
  const matchRate = candidatesN === 0 ? 0 : matched / candidatesN;
  const linkedPct =
    options.linkedPct != null && Number.isFinite(options.linkedPct)
      ? options.linkedPct
      : null;
  const gates = options.gates ?? {};
  const errors: string[] = [];

  const requireAny =
    gates.requireAnyMatchWhenCandidates !== false &&
    candidatesN > 0 &&
    matched === 0 &&
    catalog.length > 0;
  if (requireAny) {
    errors.push(
      `enrich quality: matched 0/${candidatesN} with catalog=${catalog.length}`
    );
  }
  if (catalog.length === 0 && candidatesN > 0) {
    errors.push('enrich quality: catalog empty with candidates>0');
  }
  if (
    gates.minMatchRate != null &&
    candidatesN > 0 &&
    matchRate < gates.minMatchRate
  ) {
    errors.push(
      `enrich quality: matchRate=${(matchRate * 100).toFixed(1)}% < minMatchRate=${(gates.minMatchRate * 100).toFixed(1)}%`
    );
  }
  if (
    gates.minLinkedPct != null &&
    linkedPct != null &&
    linkedPct < gates.minLinkedPct
  ) {
    errors.push(
      `enrich quality: linkedPct=${linkedPct}% < minLinkedPct=${gates.minLinkedPct}%`
    );
  }

  return {
    candidates: candidatesN,
    matched,
    matchRate,
    byReason,
    missSample,
    catalogSize: catalog.length,
    linkedPct,
    passed: errors.length === 0,
    errors,
  };
}

export function formatEnrichQuality(q: EnrichQualityReport): string {
  const rate = `${(q.matchRate * 100).toFixed(1)}%`;
  const reasons = Object.entries(q.byReason)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const link =
    q.linkedPct != null ? ` linkedPct=${q.linkedPct}%` : '';
  const head = `enrich-quality ${q.passed ? 'ok' : 'FAIL'} matched=${q.matched}/${q.candidates} (${rate}) catalog=${q.catalogSize}${link}`;
  const lines = [head];
  if (reasons) lines.push(`  reasons: ${reasons}`);
  for (const m of q.missSample.slice(0, 5)) {
    lines.push(
      `  miss ${m.reason} inv=${m.inventoryId} score=${m.score ?? '—'} · ${m.home ?? '?'} vs ${m.away ?? '?'}`
    );
  }
  for (const e of q.errors) {
    lines.push(`  ! ${e}`);
  }
  return lines.join('\n');
}
