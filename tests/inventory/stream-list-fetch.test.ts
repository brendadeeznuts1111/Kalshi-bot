// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchPublicStreamListWire } from '../../src/inventory/stream-list-fetch.ts';
import type { FetchFn } from '../../src/institutions/resilient-fetch.ts';

describe('stream-list-fetch', () => {
  test('falls back to stale cache on 403 after retries', async () => {
    const dir = join(tmpdir(), `stream-cache-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'stream.json');
    const now = Date.now();
    const wire = {
      sports: {
        tennis: {
          events: {
            '1': {
              sport: 'Tennis',
              league: 'Test',
              competitiors: { home: 'A', away: 'B' },
              stream_id: 1,
            },
          },
        },
      },
    };
    await Bun.write(
      path,
      JSON.stringify({
        savedAtMs: now - 10 * 60_000,
        expiresAtMs: now - 5 * 60_000,
        url: 'https://example.invalid/stream',
        wire,
      })
    );

    let calls = 0;
    const fetchImpl: FetchFn = async () => {
      calls++;
      return new Response('no', { status: 403, statusText: 'Forbidden' });
    };

    const result = await fetchPublicStreamListWire({
      cachePath: path,
      fetchImpl,
      nowMs: now,
      retries: 1,
      retryBackoffMs: 0,
      url: 'https://example.invalid/stream',
    });
    expect(result.source).toBe('cache-stale');
    expect(calls).toBeGreaterThan(0);
    expect((result.wire as { sports?: unknown }).sports).toBeTruthy();
  });

  test('cacheOnly requires existing file', async () => {
    await expect(
      fetchPublicStreamListWire({
        cacheOnly: true,
        cachePath: join(tmpdir(), `missing-${Date.now()}.json`),
      })
    ).rejects.toThrow(/cacheOnly/);
  });
});
