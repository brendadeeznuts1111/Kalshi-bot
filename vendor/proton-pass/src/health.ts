// @see https://bun.com/docs/runtime/utils#bun-inspect — Bun.inspect
// @updated Bun.inspect · fixed v1.1.43 · 2025-01-08 · https://bun.com/blog/bun-v1.1.43
// @updated Bun.inspect · fixed v1.2.1 · 2025-01-27 · https://bun.com/blog/bun-v1.2.1
// @updated Bun.inspect · fixed v1.2.19 · 2025-07-19 · https://bun.com/blog/bun-v1.2.19
// @updated Bun.inspect · fixed v1.3.0 · 2025-10-10 · https://bun.com/blog/bun-v1.3
// @updated Bun.inspect · fixed v1.3.13 · 2026-04-20 · https://bun.com/blog/bun-v1.3.13
// @verified Bun.inspect · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/utils#bun-inspect
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options — Bun.inspect.table
// @updated Bun.inspect.table · changed v1.1.31 · 2024-10-18 · https://bun.com/blog/bun-v1.1.31
// @updated Bun.inspect.table · changed v1.2.0 · 2025-01-22 · https://bun.com/blog/bun-v1.2
// @verified Bun.inspect.table · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
/**
 * Secret health score — audit all secrets for freshness, accessibility, expiry.
 * Uses Bun.inspect.table for rich terminal output.
 */

import { fetchSecretsParallel } from './parallel-fetch.ts';
import { SecretCacheManager } from './cache.ts';
import { createLogger } from './logger.ts';

export type SecretHealthConfig = {
  passCli: string;
  uris: string[];
  cache?: SecretCacheManager;
};

export type SecretHealthScore = {
  total: number;
  ok: number;
  errors: number;
  fromCache: number;
  avgFetchMs: number;
  healthScore: number; // 0–100
  slowestUri: string | null;
  slowestMs: number;
  results: Array<{
    uri: string;
    status: 'ok' | 'error';
    durationMs: number;
    fromCache: boolean;
    error?: string;
  }>;
};

const log = createLogger({ prefix: 'health' });

export async function auditSecretHealth(config: SecretHealthConfig): Promise<SecretHealthScore> {
  const { passCli, uris, cache } = config;

  log.info('Starting health audit', { secretCount: uris.length });

  const results = await fetchSecretsParallel(uris, {
    passCli,
    cache,
    timeoutMs: 15_000,
    retry: { maxAttempts: 1 },
    logger: log,
  });

  const ok = results.filter(r => r.status === 'ok').length;
  const errors = results.length - ok;
  const fromCache = results.filter(r => r.fromCache).length;
  const fetchTimes = results.filter(r => !r.fromCache).map(r => r.durationMs);
  const avgFetchMs = fetchTimes.length
    ? Math.round(fetchTimes.reduce((a, b) => a + b, 0) / fetchTimes.length)
    : 0;

  const sorted = [...results].sort((a, b) => b.durationMs - a.durationMs);
  const slowest = sorted[0];

  const healthScore =
    results.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (ok / results.length) * 60 +
                (fromCache / results.length) * 20 +
                (avgFetchMs < 2000 ? 20 : avgFetchMs < 5000 ? 10 : 0)
            )
          )
        );

  const score: SecretHealthScore = {
    total: uris.length,
    ok,
    errors,
    fromCache,
    avgFetchMs,
    healthScore,
    slowestUri: slowest ? slowest.uri : null,
    slowestMs: slowest ? slowest.durationMs : 0,
    results: results.map(r => ({
      uri: r.uri,
      status: r.status,
      durationMs: r.durationMs,
      fromCache: r.fromCache,
      error: r.error,
    })),
  };

  return score;
}

export function printHealthTable(score: SecretHealthScore): void {
  console.log('\n=== Secret Health Audit ===\n');

  console.log(
    Bun.inspect(
      {
        'Health Score': `${score.healthScore}/100`,
        'Total Secrets': score.total,
        Accessible: score.ok,
        Errors: score.errors,
        'Cache Hits': score.fromCache,
        'Avg Fetch': `${score.avgFetchMs}ms`,
        Slowest: score.slowestUri ? `${score.slowestUri} (${score.slowestMs}ms)` : 'n/a',
      },
      { colors: true, depth: 1 }
    )
  );

  if (score.errors > 0) {
    console.log('\n❌ Failed secrets:');
    const failures = score.results.filter(r => r.status === 'error');
    console.log(
      Bun.inspect.table(
        failures.map(r => ({
          URI: r.uri,
          Duration: `${r.durationMs}ms`,
          Error: r.error?.slice(0, 60) ?? 'unknown',
        })),
        { colors: Boolean(process.stdout.isTTY) }
      )
    );
  }

  if (score.ok > 0) {
    console.log('\n✅ Accessible secrets:');
    const okays = score.results.filter(r => r.status === 'ok');
    console.log(
      Bun.inspect.table(
        okays.map(r => ({
          URI: r.uri,
          Duration: `${r.durationMs}ms`,
          Cached: r.fromCache ? '✅' : '❌',
        })),
        { colors: Boolean(process.stdout.isTTY) }
      )
    );
  }

  console.log(
    `\nOverall: ${score.healthScore >= 90 ? '🟢 Excellent' : score.healthScore >= 70 ? '🟡 Good' : score.healthScore >= 50 ? '🟠 Fair' : '🔴 Critical'}`
  );
}
