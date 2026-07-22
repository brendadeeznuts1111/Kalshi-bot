// @see https://bun.com/docs/runtime/utils#bun-deepequals
// @see https://bun.com/docs/runtime/hashing#bun-hash
// @see https://bun.com/docs/runtime/utils#bun-inspect
import type { InspectionSignals } from "./types.ts";
import { loadInspectCache, saveInspectCache } from "./cache.ts";
import { deepEqual, inspectBrief, stableHash } from "./bun-native.ts";

/** Structural equality for whole-repo inspect snapshots — used before SQLite writes. */
export function inspectionSignalsEqual(a: InspectionSignals, b: InspectionSignals): boolean {
  return deepEqual(a, b);
}

/** Stable fingerprint for logging / progress (hex Bun.hash of JSON payload). */
export function inspectSignalsDigest(signals: InspectionSignals): string {
  return stableHash(JSON.stringify(signals));
}

/** Reuse prior snapshot when default-branch HEAD unchanged (empty-commit push). */
export function canReusePriorInspectSnapshot(
  prior: InspectionSignals | null,
  lastCommit: string | null,
): prior is InspectionSignals {
  return Boolean(prior?.lastDefaultBranchCommitAt && lastCommit && prior.lastDefaultBranchCommitAt === lastCommit);
}

export type InspectPersistResult =
  | { action: "insert" }
  | { action: "update" }
  | { action: "unchanged"; digest: string };

/** Persist inspect snapshot; skip write when Bun.deepEquals matches existing row. */
export function persistInspectCache(
  repo: string,
  pushedAt: string,
  signals: InspectionSignals,
): InspectPersistResult {
  const existing = loadInspectCache(repo, pushedAt);
  if (existing && inspectionSignalsEqual(existing, signals)) {
    return { action: "unchanged", digest: inspectSignalsDigest(signals) };
  }
  saveInspectCache(repo, pushedAt, signals);
  return existing ? { action: "update" } : { action: "insert" };
}

export type InspectPersistStats = {
  inserts: number;
  updates: number;
  unchanged: number;
};

let persistStats: InspectPersistStats | null = null;

export function beginInspectPersistStats(): InspectPersistStats {
  persistStats = { inserts: 0, updates: 0, unchanged: 0 };
  return persistStats;
}

export function finishInspectPersistStats(): InspectPersistStats | null {
  const stats = persistStats;
  persistStats = null;
  return stats;
}

export function recordInspectPersist(result: InspectPersistResult): void {
  if (!persistStats) return;
  if (result.action === "insert") persistStats.inserts++;
  else if (result.action === "update") persistStats.updates++;
  else persistStats.unchanged++;
}

export function formatInspectPersistSummary(stats: InspectPersistStats): string {
  const parts: string[] = [];
  if (stats.inserts) parts.push(`${stats.inserts} new`);
  if (stats.updates) parts.push(`${stats.updates} updated`);
  if (stats.unchanged) parts.push(`${stats.unchanged} unchanged (Bun.deepEquals)`);
  return parts.length ? parts.join(", ") : "no inspect writes";
}

/** One-line inspect fingerprint for CLI progress (Bun.inspect, no ANSI). */
export function formatInspectSignalsBrief(signals: InspectionSignals): string {
  const tags = signals.strategyTags.length ? signals.strategyTags.join("+") : "—";
  return inspectBrief(
    {
      lang: signals.primaryLanguage ?? "—",
      tags,
      sdk: signals.usesOfficialSdk,
      auth: signals.hasAuthInCode,
      orders: signals.hasLiveOrderPath,
    },
    2,
  );
}
