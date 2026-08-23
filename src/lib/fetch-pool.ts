/**
 * Canonical fetch defaults for Bun 1.4.0, baking in the probe-verified
 * pooling/DNS findings (docs/AGENT-PITFALLS.md §10-11):
 *
 *   1. DNS warm-up via Bun.dns.prefetch before fan-outs, so all requests
 *      share one lookup instead of racing their own (per-process cache,
 *      30s TTL; failed connections evict and re-resolve).
 *   2. BOUNDED concurrency. On HTTP/1.1 (the default) every concurrent
 *      request opens its OWN TCP connection, so an unbounded Promise.all
 *      fan-out burns N sockets. mapPool-style workers keep the peak
 *      bounded (default 8). With protocol:'http2' over https, requests
 *      MULTIPLEX on one connection instead (verified: 20 parallel -> 1
 *      conn / 20 streams) - see the protocol option.
 *   3. Bodies are ALWAYS consumed. An unread response body blocks
 *      connection reuse (verified: 1MB unread -> next fetch opens a new
 *      connection), so fetchText() reads the body unconditionally.
 *   4. Per-request timeout via AbortSignal.timeout (documented fetch
 *      extension) so a hanging host (no DNS eviction on timeout -
 *      verified) cannot stall the pool.
 *
 * Precedent: src/research/pool.ts (mapPool) and url-health's worker loop;
 * this module is the fetch-specific default for new ingest code.
 */

export type DnsWarmTarget = string | { hostname: string; port?: number };

export type FetchTextResult = {
  url: string;
  ok: boolean;
  status: number;
  bytes: number;
  text: string;
  error?: string;
};

export type FetchPoolOptions = {
  /** Max concurrent fetches (each = one TCP connection on HTTP/1.1; one
   * multiplexed stream per request on h2). Default 8. */
  concurrency?: number;
  /** Per-request timeout via AbortSignal.timeout. Default 15s. */
  timeoutMs?: number;
  /** Warm DNS for the target hosts first (default true). */
  warmDns?: boolean;
  /**
   * Force the HTTP version (experimental, 1.4.0): 'http2' multiplexes
   * concurrent requests on ONE TLS connection (verified: 20 parallel
   * -> 1 conn / 20 streams) but REQUIRES https - plaintext h2c is not
   * supported and a server that declines h2 makes the request fail
   * with HTTP2Unsupported (no fallback). Omit to use the default
   * (h1.1; offer h2 process-wide via BUN_FEATURE_FLAG_EXPERIMENTAL_
   * HTTP2_CLIENT=1 / --experimental-http2-fetch).
   */
  protocol?: 'http2' | 'http1.1';
  /** Extra fetch init forwarded to every request (e.g. tls options). */
  fetchInit?: RequestInit;
  /**
   * Compress request bodies before sending (v1.4 fetch extension, probe-
   * verified in pitfalls §14): true | 'gzip' | 'deflate' | 'br' | 'zstd'
   * | { encoding, level }. Sets Content-Encoding automatically; buffered
   * bodies reflect compressed Content-Length; streaming bodies pass
   * through unchanged. Only worth it for LARGE bodies (>~100KB).
   */
  compress?: true | 'gzip' | 'deflate' | 'br' | 'zstd' | { encoding: 'gzip' | 'deflate' | 'br' | 'zstd'; level?: number };
};

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 15_000;

function hostPort(url: string): { hostname: string; port: number } {
  const u = new URL(url);
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  return { hostname: u.hostname, port };
}

/** Best-effort DNS warm-up (Bun.dns.prefetch, real on 1.4.0). Never throws. */
export function warmDns(targets: DnsWarmTarget[]): void {
  for (const t of targets) {
    const host = typeof t === 'string' ? { hostname: t } : t;
    try {
      Bun.dns.prefetch(host.hostname, host.port ?? 443);
    } catch {
      // best effort - prefetch is an optimization, never fail on it
    }
  }
}

/**
 * Fetch a URL and ALWAYS consume the body (pooling-friendly).
 * Resolves with ok/status/text; throws only on network-level errors.
 */
export type FetchCompress =
  | true
  | 'gzip'
  | 'deflate'
  | 'br'
  | 'zstd'
  | { encoding: 'gzip' | 'deflate' | 'br' | 'zstd'; level?: number };

export async function fetchText(
  url: string,
  init?: RequestInit & { timeoutMs?: number; protocol?: 'http2' | 'http1.1'; compress?: FetchCompress },
): Promise<{ ok: boolean; status: number; bytes: number; text: string }> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
  const { timeoutMs: _t, protocol, compress, ...rest } = init ?? {};
  void _t;
  const res = await fetch(url, { ...rest, signal, ...(protocol ? { protocol } : {}), ...(compress ? { compress } : {}) });
  const text = await res.text(); // body ALWAYS consumed for pooling
  // bytes = UTF-8 byte length, NOT UTF-16 code units (recon finding:
  // 'text.length' reported 17 for a 27-byte multibyte string).
  return { ok: res.ok, status: res.status, bytes: Buffer.byteLength(text, 'utf8'), text };
}

/**
 * Bounded-concurrency fetch fan-out over URLs. Warms DNS for the unique
 * target hosts, runs at most `concurrency` fetches at once (each = one TCP
 * connection), consumes every body, and captures per-URL failures in the
 * result (never throws). Results are aligned with the input order.
 */
export async function fetchPool(
  urls: string[],
  options?: FetchPoolOptions,
): Promise<FetchTextResult[]> {
  if (!urls.length) return [];
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const protocol = options?.protocol;
  const compress = options?.compress;
  if (options?.warmDns ?? true) {
    const seen = new Set<string>();
    const targets: DnsWarmTarget[] = [];
    for (const u of urls) {
      const { hostname, port } = hostPort(u);
      const key = hostname + ':' + port;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ hostname, port });
      }
    }
    warmDns(targets);
  }
  const results: FetchTextResult[] = new Array(urls.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= urls.length) return;
      const url = urls[idx]!;
      try {
        const r = await fetchText(url, { timeoutMs, protocol, compress, ...options?.fetchInit });
        results[idx] = { url, ok: r.ok, status: r.status, bytes: r.bytes, text: r.text };
      } catch (err) {
        results[idx] = { url, ok: false, status: 0, bytes: 0, text: '', error: (err as Error).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}