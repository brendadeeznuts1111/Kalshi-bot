// @see https://bun.com/docs/runtime/utils#bun-nanoseconds — Bun.nanoseconds
// @verified Bun.nanoseconds · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/utils#bun-nanoseconds
/**
 * Parallel secret fetch — Promise.allSettled over pass-cli item view.
 * Fetches multiple secrets concurrently with retry, timeout, cache, circuit breaker, and telemetry.
 */

import { withRetry, type RetryOptions } from './retry.ts';
import { spawnWithTimeout, type SpawnResult } from './timeout.ts';
import { SecretCacheManager } from './cache.ts';
import { createLogger } from './logger.ts';
import { CircuitBreaker } from './circuit.ts';
import { SecretTelemetry } from './secret-telemetry.ts';

export type SecretUri = string; // e.g. "pass://Kalshi Bot/Kalshi API/keyId"

export type SecretFetchResult = {
  uri: SecretUri;
  status: 'ok' | 'error';
  value?: string;
  error?: string;
  durationMs: number;
  fromCache: boolean;
};

export type ParallelFetchOptions = {
  passCli: string;
  cache?: SecretCacheManager;
  retry?: RetryOptions;
  timeoutMs?: number;
  logger?: ReturnType<typeof createLogger>;
  circuit?: CircuitBreaker;
  telemetry?: SecretTelemetry;
};

const log = createLogger({ prefix: 'parallel-fetch' });

async function fetchOne(uri: SecretUri, passCli: string, timeoutMs: number): Promise<SpawnResult> {
  return spawnWithTimeout(passCli, ['item', 'view', '--output', 'json', uri], {
    timeoutMs,
  });
}

function parseSecretValue(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed.value === 'string') return parsed.value;
    if (Array.isArray(parsed.content?.sections)) {
      for (const section of parsed.content.sections) {
        for (const field of section.fields ?? []) {
          if (field.type === 'hidden' && field.v) return field.v;
          if (typeof field.v === 'string') return field.v;
        }
      }
    }
    return null;
  } catch {
    const trimmed = stdout.trim();
    return trimmed || null;
  }
}

export async function fetchSecret(
  uri: SecretUri,
  opts: ParallelFetchOptions
): Promise<SecretFetchResult> {
  const { passCli, cache, retry, timeoutMs = 10_000, logger = log, circuit, telemetry } = opts;
  const startNs = Bun.nanoseconds();

  // 1. Check cache
  if (cache) {
    const cached = await cache.get(uri);
    if (cached != null) {
      const result: SecretFetchResult = {
        uri,
        status: 'ok',
        value: cached,
        durationMs: Math.round((Bun.nanoseconds() - startNs) / 1_000_000),
        fromCache: true,
      };
      telemetry?.record({ uri, durationMs: result.durationMs, status: 'cached', fromCache: true });
      return result;
    }
  }

  // 2. Fetch with retry + circuit breaker
  try {
    const fetchFn = () =>
      withRetry(
        () => fetchOne(uri, passCli, timeoutMs),
        retry ?? { maxAttempts: 2, baseMs: 500, jitter: true }
      );

    const result = circuit ? await circuit.execute(fetchFn) : await fetchFn();

    if (result.timedOut) {
      const r: SecretFetchResult = {
        uri,
        status: 'error',
        error: 'Timed out',
        durationMs: Math.round((Bun.nanoseconds() - startNs) / 1_000_000),
        fromCache: false,
      };
      telemetry?.record({
        uri,
        durationMs: r.durationMs,
        status: 'error',
        error: r.error,
        fromCache: false,
      });
      return r;
    }

    if (result.code !== 0) {
      const r: SecretFetchResult = {
        uri,
        status: 'error',
        error: result.stderr.trim() || `Exit code ${result.code}`,
        durationMs: Math.round((Bun.nanoseconds() - startNs) / 1_000_000),
        fromCache: false,
      };
      telemetry?.record({
        uri,
        durationMs: r.durationMs,
        status: 'error',
        error: r.error,
        fromCache: false,
      });
      return r;
    }

    const value = parseSecretValue(result.stdout);
    if (value == null) {
      const emptyField = result.stdout.trim().length === 0;
      const r: SecretFetchResult = {
        uri,
        status: 'error',
        error: emptyField
          ? 'Secret field is empty in vault'
          : 'Could not parse secret value from pass-cli output',
        durationMs: Math.round((Bun.nanoseconds() - startNs) / 1_000_000),
        fromCache: false,
      };
      telemetry?.record({
        uri,
        durationMs: r.durationMs,
        status: 'error',
        error: r.error,
        fromCache: false,
      });
      return r;
    }

    // 3. Write to cache
    if (cache) {
      await cache.set(uri, value);
    }

    const durationMs = Math.round((Bun.nanoseconds() - startNs) / 1_000_000);
    logger.debug('Fetched secret', { uri, durationMs });

    const r: SecretFetchResult = {
      uri,
      status: 'ok',
      value,
      durationMs,
      fromCache: false,
    };
    telemetry?.record({ uri, durationMs: r.durationMs, status: 'ok', fromCache: false });
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Math.round((Bun.nanoseconds() - startNs) / 1_000_000);
    const r: SecretFetchResult = {
      uri,
      status: 'error',
      error: msg,
      durationMs,
      fromCache: false,
    };
    telemetry?.record({
      uri,
      durationMs: r.durationMs,
      status: 'error',
      error: msg,
      fromCache: false,
    });
    return r;
  }
}

export async function fetchSecretsParallel(
  uris: SecretUri[],
  opts: ParallelFetchOptions
): Promise<SecretFetchResult[]> {
  const results = await Promise.allSettled(uris.map(uri => fetchSecret(uri, opts)));
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          uri: uris[i]!,
          status: 'error' as const,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          durationMs: 0,
          fromCache: false,
        }
  );
}
