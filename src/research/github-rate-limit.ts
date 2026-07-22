// @see https://bun.com/docs/runtime/utils#bun-sleep
// @see https://docs.github.com/en/rest/rate-limit/rate-limit
/** GitHub rate-limit buckets — pure helpers + preflight (no live calls in tests). */

import { $ } from "bun";
import { GitHubRateLimitError } from "./github-errors.ts";
import type { ResearchConfig } from "./types.ts";

export type GitHubRateLimitResource = "core" | "search" | "code_search";

export type GitHubRateLimitSnapshot = {
  resource: GitHubRateLimitResource;
  limit: number;
  remaining: number;
  reset: number;
};

type RateLimitWire = {
  limit?: number;
  remaining?: number;
  reset?: number;
};

export type GitHubRateLimitWire = {
  resources?: {
    core?: RateLimitWire;
    search?: RateLimitWire;
    code_search?: RateLimitWire;
  };
};

/** Map `gh` argv to the rate-limit bucket that backs the call. */
export function resolveGhRateLimitResource(args: string[]): GitHubRateLimitResource {
  if (args[0] === "search" && args[1] === "code") return "code_search";
  if (args[0] === "search") return "search";
  return "core";
}

export function maxWaitMsForResource(resource: GitHubRateLimitResource): number {
  switch (resource) {
    case "code_search":
      return 120_000;
    case "search":
      return 600_000;
    case "core":
      return 3_600_000;
  }
}

/** Seconds until reset — used for Bun.sleep when GITHUB_RATE_LIMIT_WAIT=1. */
export function computeWaitMs(resetSec: number, nowMs = Date.now(), resource: GitHubRateLimitResource = "core"): number {
  const waitMs = Math.max(2000, resetSec * 1000 - nowMs + 2000);
  return Math.min(waitMs, maxWaitMsForResource(resource));
}

export function parseRateLimitWire(wire: GitHubRateLimitWire): Partial<Record<GitHubRateLimitResource, GitHubRateLimitSnapshot>> {
  const out: Partial<Record<GitHubRateLimitResource, GitHubRateLimitSnapshot>> = {};
  for (const resource of ["core", "search", "code_search"] as const) {
    const row = wire.resources?.[resource];
    if (!row) continue;
    const limit = row.limit ?? 0;
    const remaining = row.remaining ?? 0;
    const reset = row.reset ?? 0;
    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) continue;
    out[resource] = { resource, limit, remaining, reset };
  }
  return out;
}

export function snapshotFromWire(
  wire: GitHubRateLimitWire,
  resource: GitHubRateLimitResource,
): GitHubRateLimitSnapshot | null {
  return parseRateLimitWire(wire)[resource] ?? null;
}

export function estimateCodeSearchCallsPerRepo(config: ResearchConfig): number {
  return config.keywords.authCodeSearch.length + config.keywords.orderCodeSearch.length;
}

export type InspectBudgetEstimate = {
  repoCount: number;
  uncachedRepoCount: number;
  codeSearchPerRepo: number;
  estimatedCodeSearchCalls: number;
  codeSearchRemaining: number | null;
  codeSearchLimit: number | null;
  codeSearchResetIso: string | null;
  canProceed: boolean;
  reason: string | null;
};

/** Fail-fast preflight — no API calls; inject snapshots in tests. */
export function evaluateInspectRateBudget(input: {
  repoCount: number;
  uncachedRepoCount: number;
  codeSearchPerRepo: number;
  codeSearch: GitHubRateLimitSnapshot | null;
  minRemaining?: number;
}): InspectBudgetEstimate {
  const minRemaining = input.minRemaining ?? 3;
  const estimatedCodeSearchCalls = input.uncachedRepoCount * input.codeSearchPerRepo;
  const snap = input.codeSearch;

  const base: InspectBudgetEstimate = {
    repoCount: input.repoCount,
    uncachedRepoCount: input.uncachedRepoCount,
    codeSearchPerRepo: input.codeSearchPerRepo,
    estimatedCodeSearchCalls,
    codeSearchRemaining: snap?.remaining ?? null,
    codeSearchLimit: snap?.limit ?? null,
    codeSearchResetIso: snap ? new Date(snap.reset * 1000).toISOString() : null,
    canProceed: true,
    reason: null,
  };

  if (input.uncachedRepoCount === 0) {
    return {
      ...base,
      canProceed: true,
      reason: "all repos served from inspect cache",
    };
  }

  if (!snap) {
    return { ...base, canProceed: false, reason: "code_search quota unavailable (gh api rate_limit failed)" };
  }

  if (snap.remaining < minRemaining) {
    return {
      ...base,
      canProceed: false,
      reason: `code_search exhausted (${snap.remaining}/${snap.limit}) — reset ${base.codeSearchResetIso}`,
    };
  }

  if (estimatedCodeSearchCalls > snap.remaining) {
    const waves = Math.ceil(estimatedCodeSearchCalls / Math.max(1, snap.limit));
    return {
      ...base,
      canProceed: false,
      reason:
        `inspect needs ~${estimatedCodeSearchCalls} code_search calls (${input.uncachedRepoCount} uncached × ${input.codeSearchPerRepo}) ` +
        `but only ${snap.remaining}/${snap.limit} remain (~${waves} min at ${snap.limit}/min). ` +
        `Wait for reset or set GITHUB_RATE_LIMIT_WAIT=1`,
    };
  }

  return base;
}

export function formatInspectBudgetEstimate(est: InspectBudgetEstimate): string {
  const lines = [
    `Inspect budget: ${est.uncachedRepoCount}/${est.repoCount} uncached repos × ${est.codeSearchPerRepo} code_search/repo ≈ ${est.estimatedCodeSearchCalls} calls`,
    `code_search: ${est.codeSearchRemaining ?? "?"}/${est.codeSearchLimit ?? "?"} remaining` +
      (est.codeSearchResetIso ? ` (reset ${est.codeSearchResetIso})` : ""),
  ];
  if (!est.canProceed && est.reason) {
    const chunk =
      est.codeSearchPerRepo > 0 && est.codeSearchRemaining !== null
        ? Math.max(1, Math.floor(est.codeSearchRemaining / est.codeSearchPerRepo))
        : null;
    if (chunk !== null && est.uncachedRepoCount > chunk) {
      lines.push(
        `chunk: run with at most ${chunk} uncached repos this window, or wait for reset`,
      );
    }
    lines.push(`blocked: ${est.reason}`);
  } else if (est.reason) {
    lines.push(est.reason);
  }
  return lines.join("\n");
}

export function skipRatePreflight(): boolean {
  const raw = Bun.env.RESEARCH_SKIP_RATE_PREFLIGHT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function readGitHubRateLimit(
  resource: GitHubRateLimitResource,
): Promise<GitHubRateLimitSnapshot | null> {
  const { exitCode, stdout } = await $`gh api rate_limit`.nothrow().quiet();
  if (exitCode !== 0) return null;
  try {
    return snapshotFromWire(JSON.parse(stdout.toString()) as GitHubRateLimitWire, resource);
  } catch {
    return null;
  }
}

/** Preflight inspect phase — fail fast before `gh search code` hammers the API. */
export async function ensureInspectRateBudget(input: {
  repoCount: number;
  uncachedRepoCount: number;
  config: ResearchConfig;
  minRemaining?: number;
}): Promise<InspectBudgetEstimate> {
  const codeSearchPerRepo = estimateCodeSearchCallsPerRepo(input.config);
  if (skipRatePreflight()) {
    const estimatedCodeSearchCalls = input.uncachedRepoCount * codeSearchPerRepo;
    return {
      repoCount: input.repoCount,
      uncachedRepoCount: input.uncachedRepoCount,
      codeSearchPerRepo,
      estimatedCodeSearchCalls,
      codeSearchRemaining: null,
      codeSearchLimit: null,
      codeSearchResetIso: null,
      canProceed: true,
      reason: "RESEARCH_SKIP_RATE_PREFLIGHT=1",
    };
  }

  const codeSearch = await readGitHubRateLimit("code_search");
  const est = evaluateInspectRateBudget({
    repoCount: input.repoCount,
    uncachedRepoCount: input.uncachedRepoCount,
    codeSearchPerRepo,
    codeSearch,
    minRemaining: input.minRemaining,
  });

  if (!est.canProceed) {
    throw new GitHubRateLimitError(est.reason ?? "inspect rate budget blocked", {
      resetAtMs: codeSearch ? codeSearch.reset * 1000 : null,
      source: "code_search/preflight",
    });
  }

  return est;
}
