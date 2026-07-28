/**
 * DNS + connection warming for known hosts before a burst of `fetch`.
 *
 * **DNS prefetch** (always safe on current Bun):
 * ```ts
 * import { dns } from "bun";
 * dns.prefetch("bun.com");        // fetch#dns-prefetching
 * dns.prefetch("bun.com", 443);   // dns#dns-prefetch (host + port)
 * ```
 * In-memory DNS cache: up to 256 entries, ≤30s TTL; shared by fetch, install, connect, …
 * Inspect with `dns.getCacheStats()`.
 *
 * **Preconnect** (TCP + TLS — stricter):
 * - `fetch.preconnect("http://host:port")` — OK when port present
 * - `fetch.preconnect("https://…")` — **throws Invalid port** (oven-sh/bun#21633);
 *   use CLI `bun --fetch-preconnect https://host:443 ./app.ts`
 * - Only helps when there is a **gap** between knowing the host and the first request
 *
 * @see https://bun.com/docs/runtime/networking/fetch#dns-prefetching — DNS prefetching (fetch)
 * @see https://bun.com/docs/runtime/networking/dns#dns-prefetch — dns.prefetch
 * @see https://bun.com/docs/runtime/networking/dns#dns-getcachestats — dns.getCacheStats
 * @see https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host — fetch.preconnect
 * @see https://bun.com/docs/runtime/networking/fetch#preconnect-at-startup — --fetch-preconnect
 */

import { dns } from 'bun';

/** Fetch-page locus (performance / DNS prefetching section). */
export const BUN_DNS_PREFETCHING_DOCS =
  'https://bun.com/docs/runtime/networking/fetch#dns-prefetching';

/** DNS module locus for `dns.prefetch(hostname, port?)`. */
export const BUN_DNS_PREFETCH_DOCS =
  'https://bun.com/docs/runtime/networking/dns#dns-prefetch';

export const BUN_DNS_CACHE_STATS_DOCS =
  'https://bun.com/docs/runtime/networking/dns#dns-getcachestats';

export const BUN_FETCH_PRECONNECT_DOCS =
  'https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host';

export const BUN_FETCH_PRECONNECT_STARTUP_DOCS =
  'https://bun.com/docs/runtime/networking/fetch#preconnect-at-startup';

export type DnsPrefetchResult = {
  host: string;
  /** Port passed to dns.prefetch (omit when not supplied). */
  port?: number;
  ok: boolean;
  note?: string;
};

export type PreconnectResult = {
  origin: string;
  host: string;
  port?: number;
  /** dns.prefetch ran without throw */
  dnsPrefetch: boolean;
  /** fetch.preconnect ran without throw (HTTP+port only on current Bun) */
  fetchPreconnect: boolean;
  /** Why fetch.preconnect was skipped or failed */
  note?: string;
};

/**
 * Resolve default port for a URL protocol when the URL omits it.
 * Used so `dns.prefetch(host, port)` matches the connection you will open.
 */
export function defaultPortForUrl(url: URL): number {
  if (url.port !== '') return Number(url.port);
  if (url.protocol === 'https:') return 443;
  if (url.protocol === 'http:') return 80;
  return 443;
}

/**
 * Fire-and-forget DNS warm — docs shape from both anchors.
 * Never throws.
 *
 * @see https://bun.com/docs/runtime/networking/fetch#dns-prefetching
 * @see https://bun.com/docs/runtime/networking/dns#dns-prefetch
 */
export function dnsPrefetchHost(hostname: string, port?: number): DnsPrefetchResult {
  const host = hostname.trim();
  if (!host) {
    return { host, port, ok: false, note: 'empty hostname' };
  }
  try {
    if (port !== undefined && Number.isFinite(port) && port > 0) {
      dns.prefetch(host, port);
      return { host, port, ok: true };
    }
    dns.prefetch(host);
    return { host, ok: true };
  } catch (err) {
    return {
      host,
      port,
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Prefetch DNS for a URL/origin — extracts hostname + connection port.
 *
 * @example
 * ```ts
 * dnsPrefetchOrigin("https://bun.com/docs"); // → dns.prefetch("bun.com", 443)
 * dnsPrefetchOrigin("http://127.0.0.1:3000"); // → dns.prefetch("127.0.0.1", 3000)
 * ```
 */
export function dnsPrefetchOrigin(originOrUrl: string): DnsPrefetchResult {
  try {
    const u = new URL(originOrUrl.includes('://') ? originOrUrl : `https://${originOrUrl}`);
    return dnsPrefetchHost(u.hostname, defaultPortForUrl(u));
  } catch {
    return { host: originOrUrl, ok: false, note: 'invalid URL' };
  }
}

/** Snapshot Bun's in-process DNS cache (≤256 entries, ~30s TTL). */
export function dnsCacheStats(): ReturnType<typeof dns.getCacheStats> {
  return dns.getCacheStats();
}

/**
 * Build a CLI-safe preconnect URL (HTTPS needs explicit :443 on current Bun).
 *
 * @example
 * ```sh
 * bun --fetch-preconnect https://bun.com:443 ./my-script.ts
 * ```
 */
export function preconnectCliUrl(originOrUrl: string): string {
  const u = new URL(originOrUrl.includes('://') ? originOrUrl : `https://${originOrUrl}`);
  if (u.protocol === 'https:' && (u.port === '' || u.port === '443')) {
    return `https://${u.hostname}:443`;
  }
  if (u.protocol === 'http:' && (u.port === '' || u.port === '80')) {
    return `http://${u.hostname}:80`;
  }
  return u.origin;
}

/**
 * Best-effort warm: DNS-prefetch (host+port) then fetch.preconnect when the runtime accepts it.
 * Never throws — callers may fire-and-forget at process start.
 */
export function preconnectOrigin(originOrUrl: string): PreconnectResult {
  let host = originOrUrl;
  let origin = originOrUrl;
  let port: number | undefined;
  try {
    const u = new URL(originOrUrl.includes('://') ? originOrUrl : `http://${originOrUrl}`);
    host = u.hostname;
    origin = u.origin;
    port = defaultPortForUrl(u);
  } catch {
    return {
      origin: originOrUrl,
      host: originOrUrl,
      dnsPrefetch: false,
      fetchPreconnect: false,
      note: 'invalid URL',
    };
  }

  const dnsResult = dnsPrefetchHost(host, port);
  const dnsPrefetch = dnsResult.ok;

  let fetchPreconnect = false;
  let note: string | undefined = dnsResult.note;
  const u = new URL(origin);

  // HTTPS API preconnect is broken on current Bun (Invalid port even with :443).
  if (u.protocol === 'https:') {
    note = `fetch.preconnect HTTPS throws Invalid port — use CLI: bun --fetch-preconnect ${preconnectCliUrl(origin)} ./app.ts (dns.prefetch host+port still applied)`;
    return { origin, host, port, dnsPrefetch, fetchPreconnect, note };
  }

  // HTTP requires an explicit port for preconnect on this runtime.
  const target = u.port !== '' ? origin : `http://${u.hostname}:80`;

  try {
    fetch.preconnect(target);
    fetchPreconnect = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    note = note ? `${note}; ${msg}` : msg;
  }

  return { origin, host, port, dnsPrefetch, fetchPreconnect, note };
}

/** Warm several bases (unique origins only). */
export function preconnectOrigins(urls: readonly string[]): PreconnectResult[] {
  const seen = new Set<string>();
  const out: PreconnectResult[] = [];
  for (const raw of urls) {
    try {
      const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
      if (seen.has(u.origin)) continue;
      seen.add(u.origin);
      out.push(preconnectOrigin(u.origin));
    } catch {
      out.push({
        origin: raw,
        host: raw,
        dnsPrefetch: false,
        fetchPreconnect: false,
        note: 'invalid URL',
      });
    }
  }
  return out;
}
