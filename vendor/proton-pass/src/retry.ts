// @see https://bun.com/docs/runtime/utils#bun-sleep — Bun.sleep
// @updated Bun.sleep · changed v0.5.6 · 2023-02-09 · https://bun.com/blog/bun-v0.5.6
// @updated Bun.sleep · changed v0.5.8 · 2023-03-18 · https://bun.com/blog/bun-v0.5.8
// @updated Bun.sleep · fixed v1.0.34 · 2024-03-22 · https://bun.com/blog/bun-v1.0.34
// @verified Bun.sleep · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/utils#bun-sleep
/**
 * Bun-native retry with exponential backoff.
 * Zero dependencies; uses Bun.sleep for backoff.
 */

export type RetryOptions = {
  maxAttempts?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  onRetry?: (err: Error, attempt: number, nextDelayMs: number) => void;
};

export class RetryExhaustedError extends Error {
  constructor(
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(`Retry exhausted after ${attempts} attempts: ${lastError.message}`);
  }
}

function jitteredDelay(baseMs: number, maxMs: number, attempt: number): number {
  const base = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * base * 0.3); // up to 30% jitter
  return base + jitter;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 10_000;
  const useJitter = opts.jitter !== false;

  let lastErr: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxAttempts) break;
      const delay = useJitter
        ? jitteredDelay(baseMs, maxMs, attempt - 1)
        : Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      opts.onRetry?.(lastErr, attempt, delay);
      await Bun.sleep(delay);
    }
  }

  throw new RetryExhaustedError(lastErr!, maxAttempts);
}
