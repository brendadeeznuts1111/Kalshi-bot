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
    public readonly attempts: number,
  ) {
    super(`Retry exhausted after ${attempts} attempts: ${lastError.message}`);
  }
}

function jitteredDelay(baseMs: number, maxMs: number, attempt: number): number {
  const base = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * base * 0.3); // up to 30% jitter
  return base + jitter;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
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
      const delay = useJitter ? jitteredDelay(baseMs, maxMs, attempt - 1) : Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      opts.onRetry?.(lastErr, attempt, delay);
      await Bun.sleep(delay);
    }
  }

  throw new RetryExhaustedError(lastErr!, maxAttempts);
}
