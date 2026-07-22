// @see https://bun.com/docs/runtime/utils#bun-sleep
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
// @see https://docs.github.com/en/rest/rate-limit/rate-limit
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
/** GitHub rate-limit buckets — pure helpers + preflight (no live calls in tests). */

import { GitHubRateLimitError, shouldWaitForRateLimitReset } from "./github-errors.ts";
import { GITHUB_API_ORIGIN, resolveGitHubToken } from "./github-network.ts";
import type { ResearchConfig } from "./types.ts";
import type { DimensionId } from "./dimensions.ts";
import type { PhaseTimingsMs } from "./phase-timing.ts";
import { phaseTimingTableRows } from "./phase-timing.ts";
import { formatInspectTable } from "./terminal-out.ts";

const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "kalshi-bot-research";

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
    return { ...base, canProceed: false, reason: "code_search quota unavailable (rate_limit fetch failed)" };
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

export type InspectAllowance = {
  allowed: boolean;
  /** Why live inspect may proceed even when fail-fast budget says no. */
  mode: "within_budget" | "multi_wave_wait" | "blocked";
  detail: string;
};

/**
 * Whether inspect may start. Fail-fast budget alone is not enough when the operator
 * opted into `GITHUB_RATE_LIMIT_WAIT=1` (multi-wave crawl with Bun.sleep on 403).
 */
export function resolveInspectAllowance(
  est: InspectBudgetEstimate,
  opts?: { waitForReset?: boolean },
): InspectAllowance {
  if (est.canProceed) {
    return {
      allowed: true,
      mode: "within_budget",
      detail: est.reason ?? "inspect fits current code_search remaining",
    };
  }
  const wait = opts?.waitForReset ?? shouldWaitForRateLimitReset();
  if (wait) {
    const waves =
      est.codeSearchLimit && est.codeSearchLimit > 0
        ? Math.ceil(est.estimatedCodeSearchCalls / est.codeSearchLimit)
        : null;
    return {
      allowed: true,
      mode: "multi_wave_wait",
      detail:
        `GITHUB_RATE_LIMIT_WAIT=1 — multi-wave inspect allowed` +
        (waves !== null ? ` (~${waves} min at ${est.codeSearchLimit}/min)` : ""),
    };
  }
  return {
    allowed: false,
    mode: "blocked",
    detail: est.reason ?? "inspect rate budget blocked",
  };
}

/**
 * Synthetic code_search quota for `--offline` dry-runs (no live rate_limit fetch).
 * Sized so estimated inspect calls fit — answers cache readiness, not live rate limits.
 */
export function offlineCodeSearchSnapshot(estimatedCalls = 0): GitHubRateLimitSnapshot {
  const minRemaining = 3;
  const remaining = estimatedCalls === 0 ? 10 : Math.max(estimatedCalls, minRemaining);
  // Keep remaining ≤ limit so the table reads coherently (e.g. 294/294, not 294/10).
  const limit = Math.max(10, remaining);
  return {
    resource: "code_search",
    limit,
    remaining,
    reset: Math.floor(Date.now() / 1000) + 3600,
  };
}

export type DryRunPlan = {
  dimension: DimensionId;
  label: string;
  discovered: number;
  gated: number;
  uncached: number;
  shortlistSize: number;
  gate: { minStars: number; minForks: number; maxAgeMonths: number };
  budget: InspectBudgetEstimate;
  allowance: InspectAllowance;
  timings?: PhaseTimingsMs;
  /** True when plan was built with --offline (cache-only, no live GitHub). */
  offline?: boolean;
  /** Offline/ETag search_cache hits during discover. */
  searchCacheHits?: number;
};

export function formatDryRunPlan(plan: DryRunPlan): string {
  const { budget, allowance } = plan;
  const chunk =
    budget.codeSearchPerRepo > 0 && budget.codeSearchRemaining !== null
      ? Math.max(1, Math.floor(budget.codeSearchRemaining / budget.codeSearchPerRepo))
      : null;
  const waves =
    budget.codeSearchLimit && budget.codeSearchLimit > 0
      ? Math.ceil(budget.estimatedCodeSearchCalls / budget.codeSearchLimit)
      : null;

  const discoveryRows: Array<{ metric: string; value: string | number }> = [
    { metric: "candidates", value: plan.discovered },
    { metric: "passed gate", value: plan.gated },
    {
      metric: "apply gate",
      value: `min-stars=${plan.gate.minStars} min-forks=${plan.gate.minForks} max-age-months=${plan.gate.maxAgeMonths}`,
    },
  ];
  if (plan.searchCacheHits !== undefined) {
    discoveryRows.push({
      metric: plan.offline ? "search_cache hits" : "search ETag hits",
      value: plan.searchCacheHits,
    });
  }

  const budgetRows: Array<{ metric: string; value: string | number }> = [
    { metric: "uncached repos", value: `${plan.uncached}/${plan.gated}` },
    { metric: "code_search/repo", value: budget.codeSearchPerRepo },
    { metric: "estimated calls", value: `~${budget.estimatedCodeSearchCalls}` },
    {
      metric: plan.offline ? "quota (synthetic)" : "quota",
      value:
        `${budget.codeSearchRemaining ?? "?"}/${budget.codeSearchLimit ?? "?"}` +
        (plan.offline
          ? " — offline sized to estimate"
          : budget.codeSearchResetIso
            ? ` (reset ${budget.codeSearchResetIso})`
            : ""),
    },
  ];
  if (!plan.offline && chunk !== null && plan.uncached > chunk) {
    budgetRows.push({ metric: "this window", value: `≤${chunk} uncached repo${chunk === 1 ? "" : "s"}` });
  }

  const sections = [
    `Research dry-run${plan.offline ? " (offline)" : ""} — ${plan.dimension} (${plan.label})`,
    "",
    "Discovery",
    formatInspectTable(discoveryRows, ["metric", "value"]).trimEnd(),
    "",
    "Inspect budget",
    formatInspectTable(budgetRows, ["metric", "value"]).trimEnd(),
  ];
  if (plan.offline) {
    sections.push("", "Mode: offline — search_cache only; synthetic code_search quota (no live GitHub)");
  }

  if (plan.timings && phaseTimingTableRows(plan.timings).length) {
    sections.push("", "Timing", formatInspectTable(phaseTimingTableRows(plan.timings), ["phase", "duration"]).trimEnd());
  }

  sections.push("");

  if (plan.offline) {
    if (allowance.allowed) {
      sections.push(
        `Verdict: offline plan ready — inspect would need ~${budget.estimatedCodeSearchCalls} code_search calls ` +
          `(${plan.uncached} uncached; live quota not checked)`,
      );
    } else {
      sections.push("Verdict: offline plan incomplete — see budget reason");
      if (budget.reason) sections.push(`  ${budget.reason}`);
    }
    sections.push("");
    sections.push("Next (live — spends GitHub quota):");
    sections.push(`  bun run research -- --dimension=${plan.dimension} --min-stars=${plan.gate.minStars}`);
    sections.push(`  bun run rate-limit:status -- --gated=${plan.gated} --uncached=${plan.uncached}`);
  } else if (allowance.allowed) {
    if (allowance.mode === "within_budget") {
      sections.push("Verdict: allowed — inspect fits current code_search quota");
    } else {
      sections.push(
        "Verdict: allowed — multi-wave inspect (GITHUB_RATE_LIMIT_WAIT=1)" +
          (waves !== null ? `, ~${waves} min at ${budget.codeSearchLimit}/min` : ""),
      );
    }
    sections.push("");
    sections.push("Next:");
    if (allowance.mode === "multi_wave_wait") {
      sections.push(
        `  GITHUB_RATE_LIMIT_WAIT=1 bun run research -- --dimension=${plan.dimension} --min-stars=${plan.gate.minStars}`,
      );
    } else {
      sections.push(`  bun run research -- --dimension=${plan.dimension} --min-stars=${plan.gate.minStars}`);
    }
  } else {
    sections.push("Verdict: blocked — inspect would exceed code_search quota");
    if (waves !== null) {
      sections.push(`  need ~${budget.estimatedCodeSearchCalls} calls; ~${waves} min with GITHUB_RATE_LIMIT_WAIT=1`);
    }
    sections.push("");
    sections.push("Next:");
    if (chunk !== null && plan.uncached > chunk) {
      sections.push(`  wait for reset, raise --min-stars, or inspect ≤${chunk} repo(s) this window`);
    } else {
      sections.push("  wait for code_search reset or raise --min-stars");
    }
    sections.push(
      `  GITHUB_RATE_LIMIT_WAIT=1 bun run research -- --dimension=${plan.dimension} --min-stars=${plan.gate.minStars}`,
    );
  }

  return sections.join("\n");
}

export function skipRatePreflight(): boolean {
  const raw = Bun.env.RESEARCH_SKIP_RATE_PREFLIGHT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function readGitHubRateLimit(
  resource: GitHubRateLimitResource,
): Promise<GitHubRateLimitSnapshot | null> {
  try {
    const token = await resolveGitHubToken();
    const res = await fetch(`${GITHUB_API_ORIGIN}/rate_limit`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": USER_AGENT,
      },
    });
    if (!res.ok) return null;
    return snapshotFromWire((await res.json()) as GitHubRateLimitWire, resource);
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

  const allowance = resolveInspectAllowance(est);
  if (!allowance.allowed) {
    throw new GitHubRateLimitError(allowance.detail, {
      resetAtMs: codeSearch ? codeSearch.reset * 1000 : null,
      source: "code_search/preflight",
    });
  }

  if (allowance.mode === "multi_wave_wait") {
    return {
      ...est,
      canProceed: true,
      reason: allowance.detail,
    };
  }

  return est;
}
