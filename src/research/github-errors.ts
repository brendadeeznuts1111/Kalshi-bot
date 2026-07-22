// @see https://bun.com/docs/runtime/environment-variables#bun-env
/** GitHub API errors — rate limit circuit + cache miss/degraded paths. */

export type GitHubCacheKind = "search" | "inspect" | "api";

export type GitHubRemediationAction =
  | "retry_after_reset"
  | "use_cached_run"
  | "reduce_scope"
  | "abort";

export type GitHubResearchErrorContext = {
  dimension?: string;
  minStars?: number;
  minForks?: number;
};

export type GitHubErrorEnrichment = GitHubResearchErrorContext & {
  staleDataRunId?: string;
  staleDataAgeMs?: number | null;
  /** Set when staleDataRunId comes from another dimension's cached run. */
  staleDataSourceDimension?: string;
  cachedDataAvailable?: boolean;
  blockedOperations?: string[];
};

export class GitHubRateLimitError extends Error {
  readonly resetAtMs: number | null;
  readonly source: string;
  readonly context: GitHubResearchErrorContext;

  constructor(
    message: string,
    options: {
      resetAtMs?: number | null;
      source?: string;
      context?: GitHubResearchErrorContext;
    } = {},
  ) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.resetAtMs = options.resetAtMs ?? null;
    this.source = options.source ?? "github";
    this.context = options.context ?? {};
  }

  resetIso(): string | null {
    return this.resetAtMs ? new Date(this.resetAtMs).toISOString() : null;
  }
}

/** Rate limit active and no usable cache entry — fail fast with a typed error. */
export class GitHubCacheMissError extends GitHubRateLimitError {
  readonly cacheKind: GitHubCacheKind;
  readonly cacheKey: string;

  constructor(
    message: string,
    options: {
      resetAtMs?: number | null;
      source?: string;
      context?: GitHubResearchErrorContext;
      cacheKind: GitHubCacheKind;
      cacheKey: string;
    },
  ) {
    super(message, options);
    this.name = "GitHubCacheMissError";
    this.cacheKind = options.cacheKind;
    this.cacheKey = options.cacheKey;
  }
}

/** Served from disk cache because live GitHub API is unavailable (rate limit). */
export class GitHubDegradedCacheError extends GitHubRateLimitError {
  readonly cacheKind: GitHubCacheKind;
  readonly cacheKey: string;

  constructor(
    message: string,
    options: {
      resetAtMs?: number | null;
      source?: string;
      context?: GitHubResearchErrorContext;
      cacheKind: GitHubCacheKind;
      cacheKey: string;
    },
  ) {
    super(message, options);
    this.name = "GitHubDegradedCacheError";
    this.cacheKind = options.cacheKind;
    this.cacheKey = options.cacheKey;
  }
}

type RateLimitBudget = {
  remaining?: number | null;
  limit?: number | null;
  resource?: "search" | "core" | "code_search";
};

let trippedUntilMs: number | null = null;
let tripSource: string | null = null;
let trippedAtMs: number | null = null;
let rateLimitBudget: RateLimitBudget = { remaining: null, limit: null, resource: undefined };
let activeResearchErrorContext: GitHubResearchErrorContext | null = null;

export function isGitHubRateLimitError(err: unknown): err is GitHubRateLimitError {
  return err instanceof GitHubRateLimitError;
}

export function isGitHubCacheMissError(err: unknown): err is GitHubCacheMissError {
  return err instanceof GitHubCacheMissError;
}

export function isGitHubDegradedCacheError(err: unknown): err is GitHubDegradedCacheError {
  return err instanceof GitHubDegradedCacheError;
}

/** Any error that should abort a research run (rate limit or cache miss under limit). */
export function isGitHubApiAbortError(err: unknown): err is GitHubRateLimitError {
  return isGitHubRateLimitError(err);
}

/** Test helper — clear tripped state. */
export function resetGitHubRateLimitCircuit(): void {
  trippedUntilMs = null;
  tripSource = null;
  trippedAtMs = null;
  rateLimitBudget = { remaining: null, limit: null, resource: undefined };
  activeResearchErrorContext = null;
}

export function beginGitHubResearchErrorContext(ctx: GitHubResearchErrorContext): void {
  resetGitHubRateLimitCircuit();
  activeResearchErrorContext = ctx;
}

export function finishGitHubResearchErrorContext(): void {
  activeResearchErrorContext = null;
}

export function currentGitHubResearchErrorContext(): GitHubResearchErrorContext | null {
  return activeResearchErrorContext;
}

export function isGitHubRateLimitTripped(): boolean {
  if (trippedUntilMs === null) return false;
  if (Date.now() >= trippedUntilMs) {
    resetGitHubRateLimitCircuit();
    return false;
  }
  return true;
}

export function tripGitHubRateLimit(
  resetAtSec: number | null,
  source: string,
  budget: RateLimitBudget = {},
): void {
  const resetMs =
    typeof resetAtSec === "number" && Number.isFinite(resetAtSec)
      ? resetAtSec * 1000
      : Date.now() + 60_000;
  if (trippedUntilMs === null) {
    trippedAtMs = Date.now();
  }
  trippedUntilMs = Math.max(trippedUntilMs ?? 0, resetMs);
  tripSource = source;
  rateLimitBudget = {
    remaining: budget.remaining ?? rateLimitBudget.remaining ?? null,
    limit: budget.limit ?? rateLimitBudget.limit ?? null,
    resource: budget.resource ?? rateLimitBudget.resource,
  };
}

export function currentRateLimitResetMs(): number | null {
  return trippedUntilMs;
}

export function getGitHubCircuitState(): {
  tripped: boolean;
  trippedAt: string | null;
  remainingBudget: number | null;
  limit: number | null;
  resource: "search" | "core" | "code_search" | null;
} {
  return {
    tripped: isGitHubRateLimitTripped(),
    trippedAt: trippedAtMs ? new Date(trippedAtMs).toISOString() : null,
    remainingBudget: rateLimitBudget.remaining ?? null,
    limit: rateLimitBudget.limit ?? null,
    resource: rateLimitBudget.resource ?? null,
  };
}

export function assertGitHubRateBudget(source: string): void {
  if (!isGitHubRateLimitTripped()) return;
  throw circuitOpenError(source);
}

export function throwCacheMissIfTripped(cacheKind: GitHubCacheKind, cacheKey: string): void {
  if (!isGitHubRateLimitTripped()) return;
  throw new GitHubCacheMissError(
    `GitHub rate limit active — no cached ${cacheKind} data for \`${cacheKey}\`. Aborting instead of calling the API.`,
    {
      resetAtMs: trippedUntilMs,
      source: tripSource ?? cacheKind,
      context: activeResearchErrorContext ?? undefined,
      cacheKind,
      cacheKey,
    },
  );
}

function circuitOpenError(source: string): GitHubRateLimitError {
  const resetIso = trippedUntilMs ? new Date(trippedUntilMs).toISOString() : "unknown";
  return new GitHubRateLimitError(
    `GitHub API rate limit active (tripped by ${tripSource ?? source}) — reset after ${resetIso}. Skipping further API calls.`,
    {
      resetAtMs: trippedUntilMs,
      source: tripSource ?? source,
      context: activeResearchErrorContext ?? undefined,
    },
  );
}

/** Opt-in long wait + retry (cron / manual recovery). Default: fail fast. */
export function shouldWaitForRateLimitReset(): boolean {
  const raw = Bun.env.GITHUB_RATE_LIMIT_WAIT?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function retryAfterSeconds(resetAtMs: number | null): number | null {
  if (!resetAtMs) return null;
  const sec = Math.ceil((resetAtMs - Date.now()) / 1000);
  return sec > 0 ? sec : 0;
}

function blockedOperationsFor(err: GitHubRateLimitError): string[] {
  if (err instanceof GitHubCacheMissError) {
    if (err.cacheKind === "search") return ["discover"];
    return ["inspect"];
  }
  if (/search\/repositories|search/i.test(err.source)) return ["discover"];
  if (/preflight/i.test(err.source)) return ["discover", "inspect"];
  return ["discover", "inspect"];
}

function buildResearchRetryCommand(ctx: GitHubResearchErrorContext): string {
  const dimension = ctx.dimension ?? "market-making";
  const parts = [`bun run research -- --dimension=${dimension}`];
  if (ctx.minStars !== undefined) parts.push(`--min-stars=${ctx.minStars}`);
  if (ctx.minForks !== undefined) parts.push(`--min-forks=${ctx.minForks}`);
  return parts.join(" ");
}

function buildCachedRunCommand(dimension: string, runId: string): string {
  return `bun run agent patterns --dimension=${dimension} --run=${runId}`;
}

function pickRemediationAction(
  err: GitHubRateLimitError,
  impact: GitHubApiErrorWire["impact"],
  circuit: GitHubApiErrorWire["circuit"],
): GitHubRemediationAction {
  if (impact.cachedDataAvailable && impact.staleDataRunId) return "use_cached_run";
  if (err.resetAtMs && retryAfterSeconds(err.resetAtMs) !== null) return "retry_after_reset";
  if (
    circuit.remainingBudget !== null &&
    circuit.remainingBudget > 0 &&
    !circuit.tripped &&
    /search/i.test(err.source)
  ) {
    return "reduce_scope";
  }
  return "abort";
}

function buildRemediation(
  err: GitHubRateLimitError,
  ctx: GitHubResearchErrorContext,
  enrichment: GitHubErrorEnrichment,
  action: GitHubRemediationAction,
): GitHubApiErrorWire["remediation"] {
  const dimension = ctx.dimension ?? enrichment.dimension ?? "market-making";
  const resetIso = err.resetIso();

  if (action === "use_cached_run" && enrichment.staleDataRunId) {
    const runId = enrichment.staleDataRunId;
    const sourceDimension = enrichment.staleDataSourceDimension ?? dimension;
    const crossDimension =
      enrichment.staleDataSourceDimension !== undefined &&
      enrichment.staleDataSourceDimension !== dimension;
    return {
      action,
      command: buildCachedRunCommand(sourceDimension, runId),
      alternative: crossDimension
        ? `Use cached data from ${enrichment.staleDataSourceDimension} dimension run with --run=${runId}`
        : `Use cached data from a previous run with --run=${runId}`,
      eta: null,
    };
  }

  if (action === "reduce_scope") {
    const minStars = (ctx.minStars ?? 0) + 5;
    const cmd = buildResearchRetryCommand({ ...ctx, dimension, minStars });
    return {
      action,
      command: cmd,
      alternative: "Retry with fewer discover queries or higher --min-stars to reduce inspect load",
      eta: resetIso,
    };
  }

  if (action === "retry_after_reset") {
    return {
      action,
      command: buildResearchRetryCommand({ ...ctx, dimension }),
      alternative: enrichment.staleDataRunId
        ? `Use cached data from a previous run with --run=${enrichment.staleDataRunId}`
        : "Set GITHUB_RATE_LIMIT_WAIT=1 to opt into blocking wait until reset",
      eta: resetIso,
    };
  }

  return {
    action: "abort",
    command: "bun run agent status",
    alternative: enrichment.staleDataRunId
      ? `Inspect last successful run: bun run agent patterns --dimension=${dimension} --run=${enrichment.staleDataRunId}`
      : "Wait for GitHub rate limit reset before retrying the batch",
    eta: resetIso,
  };
}

export type GitHubApiErrorWire = {
  code: "rate_limit" | "cache_miss";
  message: string;
  resetAt: string | null;
  retryAfterSeconds: number | null;
  source: string;
  cacheKind?: GitHubCacheKind;
  cacheKey?: string;
  remediation: {
    action: GitHubRemediationAction;
    command: string;
    alternative: string;
    eta: string | null;
  };
  impact: {
    dimension: string | null;
    blockedOperations: string[];
    cachedDataAvailable: boolean;
    staleDataAge: string | null;
    staleDataRunId?: string;
    staleDataSourceDimension?: string;
  };
  circuit: {
    tripped: boolean;
    trippedAt: string | null;
    remainingBudget: number | null;
    limit: number | null;
    resource: "search" | "core" | "code_search" | null;
  };
};

export function serializeGitHubApiError(
  err: GitHubRateLimitError,
  enrichment: GitHubErrorEnrichment = {},
): GitHubApiErrorWire {
  const ctx: GitHubResearchErrorContext = {
    ...activeResearchErrorContext,
    ...err.context,
    ...enrichment,
  };
  const circuit = getGitHubCircuitState();
  const blockedOperations = enrichment.blockedOperations ?? blockedOperationsFor(err);
  const staleDataAgeMs =
    enrichment.staleDataAgeMs ??
    (enrichment.staleDataRunId ? enrichment.staleDataAgeMs : null) ??
    null;
  const cachedDataAvailable =
    enrichment.cachedDataAvailable ??
    Boolean(enrichment.staleDataRunId);

  const impact: GitHubApiErrorWire["impact"] = {
    dimension: ctx.dimension ?? null,
    blockedOperations,
    cachedDataAvailable,
    staleDataAge:
      typeof staleDataAgeMs === "number" && Number.isFinite(staleDataAgeMs)
        ? `${Math.max(0, Math.round(staleDataAgeMs / 1000))}s`
        : null,
    staleDataRunId: enrichment.staleDataRunId,
    staleDataSourceDimension: enrichment.staleDataSourceDimension,
  };

  const action = pickRemediationAction(err, impact, circuit);
  const remediation = buildRemediation(err, ctx, enrichment, action);

  return {
    code: err instanceof GitHubCacheMissError ? "cache_miss" : "rate_limit",
    message: err.message,
    resetAt: err.resetIso(),
    retryAfterSeconds: retryAfterSeconds(err.resetAtMs),
    source: err.source,
    cacheKind: err instanceof GitHubCacheMissError ? err.cacheKind : undefined,
    cacheKey: err instanceof GitHubCacheMissError ? err.cacheKey : undefined,
    remediation,
    impact,
    circuit,
  };
}

export function formatRateLimitAbortMessage(err: GitHubRateLimitError): string {
  const reset = err.resetIso();
  const lines = [err.message];
  if (reset) lines.push(`Retry after: ${reset}`);
  if (err instanceof GitHubCacheMissError) {
    lines.push(`Cache miss: ${err.cacheKind} · ${err.cacheKey}`);
  }
  if (err instanceof GitHubDegradedCacheError) {
    lines.push(`Degraded cache: ${err.cacheKind} · ${err.cacheKey}`);
  }
  return lines.join("\n");
}

export function formatRateLimitRemediation(
  err: GitHubRateLimitError,
  enrichment: GitHubErrorEnrichment = {},
): string {
  const wire = serializeGitHubApiError(err, enrichment);
  const lines: string[] = [];

  const dim = wire.impact.dimension ?? "research";
  lines.push(`⚠ ${dim} blocked — ${wire.code === "cache_miss" ? "no cache fallback" : "rate limit exceeded"}`);

  if (wire.retryAfterSeconds !== null && wire.retryAfterSeconds > 0) {
    const mins = Math.ceil(wire.retryAfterSeconds / 60);
    lines.push(
      `  Retry in ${mins} minute${mins === 1 ? "" : "s"} · or run: ${wire.remediation.command}`,
    );
  } else {
    lines.push(`  Next: ${wire.remediation.command}`);
  }

  if (wire.remediation.alternative) {
    lines.push(`  ${wire.remediation.alternative}`);
  }

  if (wire.circuit.tripped) {
    const trippedAt = wire.circuit.trippedAt
      ? wire.circuit.trippedAt.slice(11, 16)
      : "?";
    const limit = wire.circuit.limit ?? "?";
    const remaining = wire.circuit.remainingBudget ?? 0;
    lines.push(`  Circuit tripped at ${trippedAt} · ${remaining}/${limit} remaining`);
  }

  if (wire.impact.staleDataRunId && wire.remediation.action === "use_cached_run") {
    const crossDimension =
      wire.impact.staleDataSourceDimension !== undefined &&
      wire.impact.staleDataSourceDimension !== wire.impact.dimension;
    const sourceNote = crossDimension
      ? ` · from ${wire.impact.staleDataSourceDimension} dimension`
      : "";
    lines.push(
      `  Prior run: ${wire.impact.staleDataRunId} (${wire.impact.staleDataAge ?? "unknown age"})${sourceNote}`,
    );
  }

  return lines.join("\n");
}
