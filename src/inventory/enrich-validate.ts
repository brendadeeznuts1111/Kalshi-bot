/**
 * Post-enrich validation: did odds_event_id assignments land?
 * (Does not import sync.ts — avoids circular deps.)
 */
import type { Database } from 'bun:sqlite';

export type EnrichValidationOddsLink = {
  bookId: string;
  total: number;
  linked: number;
  unlinked: number;
  linkedPct: number;
};

export type EnrichValidation = {
  passed: boolean;
  /** Candidates considered this tick. */
  candidates: number;
  /** Successful name→odds_event_id matches this tick. */
  matched: number;
  /** Still unlinked on book after enrich. */
  unlinkedRemaining: number;
  /** Linked fill-rate on book after enrich. */
  oddsLink: EnrichValidationOddsLink | null;
  errors: string[];
  /** Sample unlinked inventory ids (for ops alerts). */
  unlinkedSample: Array<{
    inventoryId: string;
    home: string | null;
    away: string | null;
  }>;
};

function coverage(db: Database, bookId: string): EnrichValidationOddsLink {
  const row = db
    .query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN odds_event_id IS NOT NULL AND TRIM(odds_event_id) != '' THEN 1 ELSE 0 END) AS linked
       FROM skin_events WHERE book_id = $book`
    )
    .get({ $book: bookId }) as { total: number; linked: number | null };
  const total = Number(row?.total) || 0;
  const linked = Number(row?.linked) || 0;
  const unlinked = Math.max(0, total - linked);
  const linkedPct = total === 0 ? 0 : Math.round((linked / total) * 100);
  return { bookId, total, linked, unlinked, linkedPct };
}

export type ValidateEnrichmentInput = {
  candidates: number;
  matched: number;
  /** Fail validation when matched=0 but candidates>0 (catalog/match dead). */
  requireAnyMatchWhenCandidates?: boolean;
  /**
   * Soft gate: fail when unlinkedRemaining / total > this (0–1).
   * Default: no ratio gate (only dead-match + optional maxUnlinked).
   */
  maxUnlinkedRatio?: number;
  /** Absolute unlinked ceiling; omit to skip. */
  maxUnlinked?: number;
};

/**
 * Validate enrich tick + optional book fill-rate gates.
 */
export function validateEnrichmentResult(
  db: Database | null,
  bookId: string,
  input: ValidateEnrichmentInput
): EnrichValidation {
  const errors: string[] = [];
  const candidates = Math.max(0, input.candidates);
  const matched = Math.max(0, input.matched);
  let oddsLink: EnrichValidationOddsLink | null = null;
  let unlinkedSample: EnrichValidation['unlinkedSample'] = [];

  if (db) {
    oddsLink = coverage(db, bookId);
    unlinkedSample = db
      .query(
        `SELECT inventory_id AS inventoryId, home, away
         FROM skin_events
         WHERE book_id = $book
           AND (odds_event_id IS NULL OR odds_event_id = '')
         ORDER BY last_updated DESC
         LIMIT 5`
      )
      .all({ $book: bookId }) as EnrichValidation['unlinkedSample'];
  }

  const unlinkedRemaining = oddsLink?.unlinked ?? 0;
  const total = oddsLink?.total ?? 0;

  if (
    input.requireAnyMatchWhenCandidates !== false &&
    candidates > 0 &&
    matched === 0
  ) {
    errors.push(
      `enrich matched 0/${candidates} candidates (catalog empty, blocked, or no name hits)`
    );
  }

  if (
    input.maxUnlinked != null &&
    unlinkedRemaining > input.maxUnlinked
  ) {
    errors.push(
      `unlinked remaining ${unlinkedRemaining} exceeds maxUnlinked=${input.maxUnlinked}`
    );
  }

  if (
    input.maxUnlinkedRatio != null &&
    total > 0 &&
    unlinkedRemaining / total > input.maxUnlinkedRatio
  ) {
    errors.push(
      `unlinked ratio ${(unlinkedRemaining / total).toFixed(2)} exceeds maxUnlinkedRatio=${input.maxUnlinkedRatio}`
    );
  }

  const passed = errors.length === 0;
  // Sample unlinked only as context when validation already failed (not a gate)
  if (!passed) {
    for (const row of unlinkedSample.slice(0, 3)) {
      errors.push(
        `  unlinked inv=${row.inventoryId} · ${row.home ?? '?'} vs ${row.away ?? '?'}`
      );
    }
  }

  return {
    passed,
    candidates,
    matched,
    unlinkedRemaining,
    oddsLink,
    errors,
    unlinkedSample,
  };
}

export function formatEnrichValidation(v: EnrichValidation): string {
  const link = v.oddsLink
    ? ` linked=${v.oddsLink.linked}/${v.oddsLink.total} (${v.oddsLink.linkedPct}%)`
    : '';
  return (
    `enrich-validate ${v.passed ? 'ok' : 'FAIL'} matched=${v.matched}/${v.candidates}` +
    ` unlinked=${v.unlinkedRemaining}${link}`
  );
}
