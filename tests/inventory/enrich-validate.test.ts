// @see https://bun.com/docs/test/index#run-tests
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { validateEnrichmentResult } from '../../src/inventory/enrich-validate.ts';

describe('enrich-validate', () => {
  test('passes when no candidates', () => {
    const r = validateEnrichmentResult(null, 'buckeye', {
      candidates: 0,
      matched: 0,
    });
    expect(r.passed).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.oddsLink).toBeNull();
  });

  test('fails when candidates>0 and matched=0 with requireAnyMatch', () => {
    const r = validateEnrichmentResult(null, 'buckeye', {
      candidates: 3,
      matched: 0,
      requireAnyMatchWhenCandidates: true,
    });
    expect(r.passed).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('reads odds link coverage from skin_events', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE skin_events (
        inventory_id TEXT PRIMARY KEY,
        book_id TEXT,
        odds_event_id TEXT,
        home TEXT,
        away TEXT,
        last_updated TEXT
      );
      INSERT INTO skin_events VALUES
        ('1', 'buckeye', '100', 'A', 'B', '2026-01-01'),
        ('2', 'buckeye', NULL, 'C', 'D', '2026-01-02'),
        ('3', 'buckeye', '', 'E', 'F', '2026-01-03'),
        ('4', 'other', '200', 'G', 'H', '2026-01-04');
    `);
    const r = validateEnrichmentResult(db, 'buckeye', {
      candidates: 2,
      matched: 1,
    });
    expect(r.oddsLink).toEqual({
      bookId: 'buckeye',
      total: 3,
      linked: 1,
      unlinked: 2,
      linkedPct: 33,
    });
    expect(r.unlinkedRemaining).toBe(2);
    expect(r.unlinkedSample.length).toBeGreaterThan(0);
    db.close();
  });
});
