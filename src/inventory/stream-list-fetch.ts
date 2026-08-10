/**
 * Resilient public stream-list-v2 fetch: retry 403/429/5xx + disk cache fallback.
 * Shared by inventory events + domain:sports inventory snapshot.
 */
// @see https://bun.com/docs/api/fetch
import { join } from 'node:path';
import {
  createCircuitBreaker,
  fetchWithRetry,
  type FetchFn,
} from '../institutions/resilient-fetch.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import { CACHE_DIR } from '../research/paths.ts';
import { enrichLog } from './enrich-log.ts';

export type StreamListFetchResult = {
  wire: unknown;
  url: string;
  source: 'live' | 'cache' | 'cache-stale';
  latencyMs: number;
  errors: string[];
};

export type StreamListFetchOptions = {
  url?: string;
  fetchImpl?: FetchFn;
  cachePath?: string;
  cacheTtlMs?: number;
  cacheOnly?: boolean;
  skipCacheWrite?: boolean;
  nowMs?: number;
  retries?: number;
  retryBackoffMs?: number;
};

type StreamListCachePayload = {
  savedAtMs: number;
  expiresAtMs: number;
  url: string;
  wire: unknown;
};

const streamBreaker = createCircuitBreaker({
  failureThreshold: 4,
  resetMs: 60_000,
});

export function defaultStreamListCachePath(): string {
  const override = Bun.env.INVENTORY_STREAM_LIST_CACHE?.trim();
  if (override) return override;
  return join(CACHE_DIR, 'stream-list-cache.json');
}

function streamHeaders(): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
    referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
  };
}

async function loadStreamCache(
  path: string,
  options: { nowMs?: number; allowStale?: boolean } = {}
): Promise<StreamListCachePayload | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const raw = (await file.json()) as Partial<StreamListCachePayload>;
    if (raw.wire == null) return null;
    const nowMs = options.nowMs ?? Date.now();
    const expiresAtMs = Number(raw.expiresAtMs) || 0;
    if (!options.allowStale && expiresAtMs > 0 && expiresAtMs < nowMs) return null;
    return {
      savedAtMs: Number(raw.savedAtMs) || 0,
      expiresAtMs,
      url: String(raw.url ?? ''),
      wire: raw.wire,
    };
  } catch {
    return null;
  }
}

async function saveStreamCache(
  path: string,
  payload: StreamListCachePayload
): Promise<void> {
  await Bun.write(path, JSON.stringify(payload) + '\n');
}

/**
 * GET stream-list-v2 with retries; on failure use fresh then stale disk cache.
 */
export async function fetchPublicStreamListWire(
  options: StreamListFetchOptions = {}
): Promise<StreamListFetchResult> {
  const url = options.url ?? FANTASY_ULTRA_DEFAULTS.streamListUrl;
  const cachePath = options.cachePath ?? defaultStreamListCachePath();
  const cacheTtlMs = options.cacheTtlMs ?? 2 * 60 * 1000; // 2 min (board rotates)
  const nowMs = options.nowMs ?? Date.now();
  const errors: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;

  if (options.cacheOnly) {
    const cached = await loadStreamCache(cachePath, { nowMs, allowStale: true });
    if (!cached) throw new Error('stream-list: cacheOnly but no cache');
    return {
      wire: cached.wire,
      url: cached.url || url,
      source: 'cache',
      latencyMs: 0,
      errors: [],
    };
  }

  const fresh = await loadStreamCache(cachePath, { nowMs, allowStale: false });
  if (fresh) {
    enrichLog('info', 'stream_list_cache_hit', {
      ageMs: nowMs - fresh.savedAtMs,
    });
    return {
      wire: fresh.wire,
      url: fresh.url || url,
      source: 'cache',
      latencyMs: 0,
      errors: [],
    };
  }

  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      url,
      { headers: streamHeaders() },
      {
        retries: options.retries ?? 3,
        backoffMs: options.retryBackoffMs ?? 800,
        maxDelayMs: 12_000,
        timeoutMs: 25_000,
        isRetryable: status =>
          status === 403 || status === 429 || status >= 500,
        fetchImpl,
        breaker: streamBreaker,
        random: () => 0,
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `stream-list HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`
      );
    }
    const wire: unknown = await res.json();
    if (!options.skipCacheWrite) {
      await saveStreamCache(cachePath, {
        savedAtMs: nowMs,
        expiresAtMs: nowMs + cacheTtlMs,
        url,
        wire,
      });
    }
    const latencyMs = Date.now() - t0;
    enrichLog('info', 'stream_list_live_ok', { latencyMs });
    return { wire, url, source: 'live', latencyMs, errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    enrichLog('warn', 'stream_list_live_fail', { error: msg });

    const stale = await loadStreamCache(cachePath, { nowMs, allowStale: true });
    if (stale) {
      enrichLog('warn', 'stream_list_stale_fallback', {
        ageMs: nowMs - stale.savedAtMs,
      });
      return {
        wire: stale.wire,
        url: stale.url || url,
        source: 'cache-stale',
        latencyMs: 0,
        errors,
      };
    }
    throw new Error(`stream-list: live failed and no cache — ${msg}`);
  }
}
