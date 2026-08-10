// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fetchPublicBookedCatalog,
  type BookedCatalogEntry,
} from '../../src/inventory/booked-catalog.ts';
import {
  loadBookedCatalogCache,
  saveBookedCatalogCache,
} from '../../src/inventory/booked-catalog-cache.ts';
import {
  formatEnrichValidation,
  validateEnrichmentResult,
} from '../../src/inventory/enrich-validate.ts';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import { upsertSkinLiveEvents } from '../../src/inventory/skin-events-store.ts';
import type { InventoryEvent } from '../../src/partner/types.ts';
import type { FetchFn } from '../../src/institutions/resilient-fetch.ts';

function live(id: string, home: string, away: string): InventoryEvent {
  return {
    partner: 'fantasy402',
    sport: 'table_tennis',
    league: 'Test',
    inventoryId: id,
    home,
    away,
    feedId: 0,
    donbestId: null,
  };
}

describe('booked catalog cache + resilience', () => {
  test('load/save cache round-trip and TTL', async () => {
    const dir = join(tmpdir(), `kalshi-cat-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'cache.json');
    const entries: BookedCatalogEntry[] = [
      { oddsEventId: '1', name: 'A - B', sportName: 'Tennis' },
    ];
    const now = 1_000_000;
    await saveBookedCatalogCache(path, {
      savedAtMs: now,
      expiresAtMs: now + 60_000,
      source: 'live',
      pages: 1,
      totalItemsHint: 1,
      entries,
    });
    const fresh = await loadBookedCatalogCache(path, { nowMs: now + 10_000 });
    expect(fresh?.entries.length).toBe(1);
    const expired = await loadBookedCatalogCache(path, {
      nowMs: now + 120_000,
      allowStale: false,
    });
    expect(expired).toBeNull();
    const stale = await loadBookedCatalogCache(path, {
      nowMs: now + 120_000,
      allowStale: true,
    });
    expect(stale?.entries[0]?.oddsEventId).toBe('1');
  });

  test('fetchPublicBookedCatalog falls back to stale cache on 403', async () => {
    const dir = join(tmpdir(), `kalshi-cat-fb-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'cache.json');
    const now = Date.now();
    await saveBookedCatalogCache(path, {
      savedAtMs: now - 10 * 60_000,
      expiresAtMs: now - 5 * 60_000, // expired
      source: 'live',
      pages: 2,
      totalItemsHint: 10,
      entries: [
        { oddsEventId: '99', name: 'Cached Home - Cached Away', sportName: 'Tennis' },
      ],
    });

    let calls = 0;
    const fetchImpl: FetchFn = async () => {
      calls++;
      return new Response('forbidden', { status: 403, statusText: 'Forbidden' });
    };

    const result = await fetchPublicBookedCatalog({
      cachePath: path,
      fetchImpl,
      maxPages: 1,
      maxEvents: 50,
      cacheTtlMs: 60_000,
      nowMs: now,
      retries: 1,
      retryBackoffMs: 0,
    });
    expect(result.source).toBe('cache-stale');
    expect(result.entries[0]?.oddsEventId).toBe('99');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0); // retries attempted
  });
});

describe('enrich validation', () => {
  test('fails when candidates>0 and matched=0', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    upsertSkinLiveEvents(db, [live('1', 'A', 'B')], { nowMs: 1 });
    const v = validateEnrichmentResult(db, 'fantasy402', {
      candidates: 10,
      matched: 0,
    });
    expect(v.passed).toBe(false);
    expect(v.errors.some(e => e.includes('matched 0/10'))).toBe(true);
    expect(formatEnrichValidation(v)).toContain('FAIL');
  });

  test('passes when matched and no gates trip', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const v = validateEnrichmentResult(db, 'fantasy402', {
      candidates: 5,
      matched: 2,
    });
    expect(v.passed).toBe(true);
    expect(formatEnrichValidation(v)).toContain('ok');
  });
});
