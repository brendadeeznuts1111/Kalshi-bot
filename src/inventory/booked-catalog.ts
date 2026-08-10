/**
 * Public Statscore booked-events catalog (livescorepro) — no Fantasy login.
 * Resilient: fetchWithRetry (403/429/5xx), disk cache TTL + stale fallback.
 * Does **not** carry prices (metadata only).
 */
// @see https://bun.com/docs/api/fetch
import {
  createCircuitBreaker,
  fetchWithRetry,
  type FetchFn,
} from '../institutions/resilient-fetch.ts';
import { parseStatscoreBookedEvents } from '../partner/fantasy-ultra/parse.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import type { PartnerBookedEvent } from '../partner/types.ts';
import {
  defaultBookedCatalogCachePath,
  loadBookedCatalogCache,
  saveBookedCatalogCache,
} from './booked-catalog-cache.ts';
import { enrichLog } from './enrich-log.ts';

export type BookedCatalogEntry = {
  oddsEventId: string;
  name: string;
  sportName: string;
};

export type FetchBookedCatalogOptions = {
  /** Max events to collect (default 800, max 2500). */
  maxEvents?: number;
  /** Max HTTP pages (default 20). */
  maxPages?: number;
  /** Optional sport name filter (case-insensitive includes). */
  sport?: string;
  fetchImpl?: FetchFn;
  /** Cache file path (default research/cache/booked-catalog-cache.json). */
  cachePath?: string;
  /** Fresh cache TTL ms (default 5 min). */
  cacheTtlMs?: number;
  /** Skip live network (tests / force cache). */
  cacheOnly?: boolean;
  /** Do not write cache after live success. */
  skipCacheWrite?: boolean;
  nowMs?: number;
  /** Retry base backoff ms (default 800; tests use 0). */
  retryBackoffMs?: number;
  /** Max retries per page (default 3). */
  retries?: number;
};

export type BookedCatalogResult = {
  entries: BookedCatalogEntry[];
  pages: number;
  totalItemsHint: number | null;
  /** live | cache | cache-stale | injected */
  source: string;
  /** Wall ms for live fetch (0 when cache-only hit). */
  latencyMs: number;
  errors: string[];
};

const catalogBreaker = createCircuitBreaker({
  failureThreshold: 4,
  resetMs: 60_000,
});

function catalogHeaders(): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
    referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
  };
}

function firstPageUrl(): string {
  const q = new URLSearchParams({
    client_id: FANTASY_ULTRA_DEFAULTS.statscoreClientId,
    product: FANTASY_ULTRA_DEFAULTS.statscoreProduct,
    events_details: 'yes',
    lang: 'en',
  });
  return `${FANTASY_ULTRA_DEFAULTS.statscoreBookedEventsUrl}?${q.toString()}`;
}

function nextPageUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const np = (raw as { api?: { method?: { next_page?: unknown } } }).api?.method
    ?.next_page;
  if (typeof np !== 'string' || !np.trim()) return null;
  const s = np.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return null;
}

async function fetchLiveCatalog(
  options: FetchBookedCatalogOptions
): Promise<Omit<BookedCatalogResult, 'source' | 'errors'>> {
  const maxEvents = Math.min(Math.max(options.maxEvents ?? 800, 1), 2500);
  const maxPages = Math.min(Math.max(options.maxPages ?? 20, 1), 50);
  const fetchImpl = options.fetchImpl ?? fetch;
  const want = options.sport?.trim().toLowerCase();
  const byId = new Map<string, BookedCatalogEntry>();
  let url: string | null = firstPageUrl();
  let pages = 0;
  let totalItemsHint: number | null = null;
  const t0 = Date.now();

  while (url && pages < maxPages && byId.size < maxEvents) {
    const res = await fetchWithRetry(
      url,
      { headers: catalogHeaders() },
      {
        retries: options.retries ?? 3,
        backoffMs: options.retryBackoffMs ?? 800,
        maxDelayMs: 12_000,
        timeoutMs: 25_000,
        // 403 often rate/geo — short cooldown retries; 429/5xx standard
        isRetryable: status =>
          status === 403 || status === 429 || status >= 500,
        fetchImpl,
        breaker: catalogBreaker,
        random: () => 0,
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `booked-catalog: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`
      );
    }
    const raw: unknown = await res.json();
    if (totalItemsHint == null && raw && typeof raw === 'object') {
      const t = (raw as { api?: { method?: { total_items?: unknown } } }).api
        ?.method?.total_items;
      if (typeof t === 'number' && Number.isFinite(t)) totalItemsHint = t;
      else if (typeof t === 'string' && t.trim()) totalItemsHint = Number(t) || null;
    }
    const rows = parseStatscoreBookedEvents(raw);
    for (const r of rows) {
      if (want && want !== 'all') {
        const sn = r.sportName.toLowerCase();
        if (sn !== want && !sn.includes(want)) continue;
      }
      byId.set(r.oddsEventId, {
        oddsEventId: r.oddsEventId,
        name: r.name,
        sportName: r.sportName,
      });
      if (byId.size >= maxEvents) break;
    }
    pages++;
    url = nextPageUrl(raw);
  }

  return {
    entries: [...byId.values()],
    pages,
    totalItemsHint,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Paginate public booked-events with retry + cache fallback.
 */
export async function fetchPublicBookedCatalog(
  options: FetchBookedCatalogOptions = {}
): Promise<BookedCatalogResult> {
  const cachePath = options.cachePath ?? defaultBookedCatalogCachePath();
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now();
  const errors: string[] = [];

  if (options.cacheOnly) {
    const cached = await loadBookedCatalogCache(cachePath, {
      nowMs,
      allowStale: true,
    });
    if (!cached) {
      throw new Error('booked-catalog: cacheOnly but no cache file');
    }
    enrichLog('info', 'booked_catalog_cache_only', {
      entries: cached.entries.length,
      ageMs: nowMs - cached.savedAtMs,
    });
    return {
      entries: cached.entries,
      pages: cached.pages,
      totalItemsHint: cached.totalItemsHint,
      source: 'cache',
      latencyMs: 0,
      errors: [],
    };
  }

  // Fresh cache hit
  const fresh = await loadBookedCatalogCache(cachePath, { nowMs, allowStale: false });
  if (fresh) {
    enrichLog('info', 'booked_catalog_cache_hit', {
      entries: fresh.entries.length,
      ageMs: nowMs - fresh.savedAtMs,
    });
    return {
      entries: fresh.entries,
      pages: fresh.pages,
      totalItemsHint: fresh.totalItemsHint,
      source: 'cache',
      latencyMs: 0,
      errors: [],
    };
  }

  try {
    const live = await fetchLiveCatalog(options);
    if (live.entries.length === 0) {
      throw new Error('booked-catalog: live returned 0 entries');
    }
    if (!options.skipCacheWrite) {
      await saveBookedCatalogCache(cachePath, {
        savedAtMs: nowMs,
        expiresAtMs: nowMs + cacheTtlMs,
        source: 'live',
        pages: live.pages,
        totalItemsHint: live.totalItemsHint,
        entries: live.entries,
      });
    }
    enrichLog('info', 'booked_catalog_live_ok', {
      entries: live.entries.length,
      pages: live.pages,
      latencyMs: live.latencyMs,
      totalItemsHint: live.totalItemsHint,
    });
    return {
      ...live,
      source: 'live',
      errors: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    enrichLog('warn', 'booked_catalog_live_fail', { error: msg });

    const stale = await loadBookedCatalogCache(cachePath, {
      nowMs,
      allowStale: true,
    });
    if (stale && stale.entries.length > 0) {
      enrichLog('warn', 'booked_catalog_stale_fallback', {
        entries: stale.entries.length,
        ageMs: nowMs - stale.savedAtMs,
      });
      return {
        entries: stale.entries,
        pages: stale.pages,
        totalItemsHint: stale.totalItemsHint,
        source: 'cache-stale',
        latencyMs: 0,
        errors,
      };
    }
    throw new Error(
      `booked-catalog: live failed and no cache — ${msg}`
    );
  }
}

export function bookedCatalogToMatchList(
  entries: BookedCatalogEntry[]
): Array<{ oddsEventId: string; name: string }> {
  return entries.map(e => ({ oddsEventId: e.oddsEventId, name: e.name }));
}

/** Adapter-shaped rows → catalog entries. */
export function partnerBookedToCatalog(
  rows: PartnerBookedEvent[]
): BookedCatalogEntry[] {
  return rows.map(r => ({
    oddsEventId: r.oddsEventId,
    name: r.name,
    sportName: r.sportName,
  }));
}
