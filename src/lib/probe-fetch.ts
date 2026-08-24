/**
 * probe-fetch.ts — bounded network fetch for the repo's probe tooling.
 *
 * The probes historically used BARE fetch() — no timeout (hangs on a
 * non-routable host), no retry, no User-Agent, no error handling. The
 * repo's fetchWithRetry (resilient-fetch) already has timeout/retry/
 * backoff/breaker defaults — this wrapper adds the probe-specific
 * defaults: shorter timeout (network probes shouldn't wait 30s), a
 * User-Agent, redirect follow, and null-on-failure so probes don't
 * crash (AGENT-PITFALLS §57).
 */
import { fetchWithRetry } from "../institutions/resilient-fetch.ts";

export type ProbeFetchOptions = {
  timeoutMs?: number;
  retries?: number;
  /** User-Agent sent on every probe request (default: kalshi-bot-research). */
  userAgent?: string;
  headers?: Record<string, string>;
};

/**
 * Fetch with probe-safe defaults. Returns the Response or null on any
 * failure (timeout, network error, retry exhaustion) — probes then
 * report "unreachable" instead of throwing.
 */
export async function probeFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: ProbeFetchOptions = {},
): Promise<Response | null> {
  const ua = options.userAgent ?? "kalshi-bot-research/0.2.0 (probe)";
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", ua);
  try {
    return await fetchWithRetry(input, { ...init, headers, redirect: "follow" }, {
      timeoutMs: options.timeoutMs ?? 8_000,
      retries: options.retries ?? 2,
    });
  } catch {
    return null;
  }
}