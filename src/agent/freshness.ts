/**
 * Run-level data freshness for CLI badges (miss taxonomy #4).
 * No rotor catalog / pulse coupling.
 */
import type { ResearchRun } from "../research/types.ts";
import type { AuditExportTier } from "../research/audit-adapter.ts";
import { hasDegradedCacheUsage } from "../research/github-cache-stats.ts";

export type DataFreshness = {
  stale: boolean;
  ageMs: number | null;
};

/** Age of a research run from `generatedAt` to now; null when timestamp is invalid. */
export function runGeneratedAgeMs(generatedAt: string): number | null {
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Date.now() - t);
}

const STALE_RUN_AGE_MS = 24 * 60 * 60 * 1000;

/** Stale when run used degraded cache or `generatedAt` is older than 24h. */
export function resolveRunDataFreshness(run: ResearchRun): DataFreshness {
  const ageMs = runGeneratedAgeMs(run.generatedAt);
  const cache = run.stats.cache;
  if (cache && (hasDegradedCacheUsage(cache) || cache.inspectDegradedHits > 0)) {
    return { stale: true, ageMs };
  }
  if (ageMs !== null && ageMs > STALE_RUN_AGE_MS) {
    return { stale: true, ageMs };
  }
  return { stale: false, ageMs };
}

export function formatDataFreshnessSuffix(opts: {
  stale: boolean;
  ageMs?: number | null;
}): string {
  if (!opts.stale) return "";
  if (typeof opts.ageMs === "number" && Number.isFinite(opts.ageMs) && opts.ageMs >= 0) {
    const minutes = Math.max(1, Math.round(opts.ageMs / 60_000));
    return ` 🕒 ${minutes}m ago`;
  }
  return " 🕒 stale";
}

/** Audit-tier + freshness label (no rotor verification). */
export function formatTierBadge(opts: {
  auditTier?: AuditExportTier | null;
  stale?: boolean;
  ageMs?: number | null;
}): string {
  let base: string;
  if (opts.auditTier === "high-value") base = "high-value";
  else if (opts.auditTier === "watchlist") base = "watchlist";
  else base = "scored";
  return base + formatDataFreshnessSuffix({ stale: opts.stale ?? false, ageMs: opts.ageMs });
}
