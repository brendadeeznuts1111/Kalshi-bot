/**
 * resilient-fetch.ts — Retry/backoff/circuit-breaker fetch wrapper.
 *
 * Inspired by CloddsBot src/utils/http.ts patterns:
 *   - Exponential backoff with jitter
 *   - Circuit breaker (open → half-open → closed)
 *   - Injectable fetch for testability
 *
 * Usage:
 *   const breaker = createCircuitBreaker({ failureThreshold: 5, resetMs: 30_000 });
 *   const res = await fetchWithRetry(url, { method: "POST" }, { retries: 3, breaker });
 */

export type CircuitBreakerState = "closed" | "open" | "half-open";

export type CircuitBreakerOptions = {
  /** Consecutive failures before opening (default 5). */
  failureThreshold?: number;
  /** Milliseconds before attempting half-open (default 30_000). */
  resetMs?: number;
  /** Successes in half-open required to close (default 1). */
  halfOpenSuccesses?: number;
};

export type CircuitBreaker = {
  readonly state: CircuitBreakerState;
  readonly failures: number;
  readonly lastFailureAt: number | null;
  recordSuccess(): void;
  recordFailure(): void;
  /** Throws if open. */
  guard(): void;
};

export type RetryOptions = {
  /** Max retry attempts (default 3). */
  retries?: number;
  /** Base backoff in ms (default 500). */
  backoffMs?: number;
  /** Max delay in ms (default 10_000). */
  maxDelayMs?: number;
  /** Jitter fraction 0–1 (default 0.25). */
  jitter?: number;
  /** Custom random source (tests). */
  random?: () => number;
  /** Optional circuit breaker. */
  breaker?: CircuitBreaker;
  /** Retryable status predicate (default 429 or ≥500). */
  isRetryable?: (status: number) => boolean;
  /** Injectable fetch for tests. */
  fetchImpl?: FetchFn;
  /** Per-attempt timeout in ms (default 30_000). 0 disables. */
  timeoutMs?: number;
};

/** Exported for tests — deterministic jitter. */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxDelayMs: number,
  jitter: number,
  random: () => number,
): number {
  const exp = Math.min(maxDelayMs, baseMs * 2 ** attempt);
  return Math.floor(exp + exp * jitter * random());
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const {
    failureThreshold = 5,
    resetMs = 30_000,
    halfOpenSuccesses = 1,
  } = options;

  let state: CircuitBreakerState = "closed";
  let failures = 0;
  let lastFailureAt: number | null = null;
  let halfOpenWins = 0;

  function transitionTo(newState: CircuitBreakerState): void {
    state = newState;
    if (newState === "closed") {
      failures = 0;
      halfOpenWins = 0;
      lastFailureAt = null;
    }
  }

  return {
    get state() {
      if (state === "open" && lastFailureAt != null && Date.now() - lastFailureAt >= resetMs) {
        state = "half-open";
        halfOpenWins = 0;
      }
      return state;
    },
    get failures() {
      return failures;
    },
    get lastFailureAt() {
      return lastFailureAt;
    },
    recordSuccess(): void {
      if (state === "half-open") {
        halfOpenWins++;
        if (halfOpenWins >= halfOpenSuccesses) {
          transitionTo("closed");
        }
      } else {
        transitionTo("closed");
      }
    },
    recordFailure(): void {
      failures++;
      lastFailureAt = Date.now();
      if (state === "half-open") {
        transitionTo("open");
      } else if (failures >= failureThreshold) {
        transitionTo("open");
      }
    },
    guard(): void {
      const current = this.state; // trigger half-open check
      if (current === "open") {
        throw new Error(
          `Circuit breaker OPEN — ${failures} consecutive failures, last at ${lastFailureAt}`,
        );
      }
    },
  };
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Fetch with retry, exponential backoff, and optional circuit breaker.
 * Returns the final Response (even if not ok) after exhausting retries.
 * Throws on network errors or non-retryable HTTP errors.
 */
export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    backoffMs: baseMs = 500,
    maxDelayMs = 10_000,
    jitter = 0.25,
    random = Math.random,
    breaker,
    isRetryable = (status: number) => status === 429 || status >= 500,
    timeoutMs = 30_000,
  } = options;

  const fetchImpl: FetchFn = options.fetchImpl ?? fetch;

  breaker?.guard();

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timedInit: RequestInit =
        timeoutMs > 0
          ? { ...init, signal: AbortSignal.timeout(timeoutMs) }
          : init;
      const res = await fetchImpl(input, timedInit);
      if (res.ok) {
        breaker?.recordSuccess();
        return res;
      }
      if (!isRetryable(res.status) || attempt >= retries) {
        breaker?.recordFailure();
        return res; // Return non-ok response when not retryable or out of retries
      }
      // Retryable HTTP error — treat as failure for breaker, but retry
      breaker?.recordFailure();
      lastErr = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      // AbortError / TimeoutError from AbortSignal.timeout — treat as retryable
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      breaker?.recordFailure();
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt >= retries) break;
    }

    if (attempt < retries) {
      const delay = computeBackoffMs(attempt, baseMs, maxDelayMs, jitter, random);
      // Native timer — @see https://bun.com/docs/api/utils#bunsleep
      await Bun.sleep(delay);
    }
  }

  throw lastErr ?? new Error("fetchWithRetry exhausted all attempts");
}
// EOF
