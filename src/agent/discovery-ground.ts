/**
 * Discovery-grounded sub-agent mesh over cache.db — no live GitHub.
 *
 * Roles: status · cache · miss · nextActions
 *
 * Coverage uses the **discover** gate (broad search strings), not apply gate.
 * Cache hits are layered: exact hash → qualifier-normalized → bare phrase.
 * Unstamped discoverGate is inferred from discoveryMiss.searchQueries or cache.
 */
import {
  countInspectCacheRepos,
  hasAnySearchCache,
  hasSearchCacheForQuery,
  listSearchCacheQueries,
  loadFallbackRunFromDb,
  loadLatestProductionRunAnyDimension,
  loadLatestRunFromDb,
} from "../research/cache.ts";
import {
  DEFAULT_DIMENSION,
  loadDimensionsFile,
  normalizeDimensionId,
  resolveDimensionQueries,
  runDimension,
  type ResolvedDimensionQueries,
} from "../research/dimensions.ts";
import {
  analyzeDiscoveryMiss,
  type DiscoveryMissAlternate,
  type DiscoveryMissStats,
} from "../research/discovery-miss.ts";
import { resolveDiscoverGate } from "../research/discover-gate.ts";
import {
  buildRepoSearchQuery,
  hasBarePhraseInStrippedQueries,
  inferDiscoverGateFromCachedQueries,
  inferDiscoverGateFromSearchQueries,
  loadConfig,
  stripRepoSearchQualifiers,
  type DiscoverGate,
} from "../research/discover.ts";
import type { GateMissStats } from "../research/gate-miss.ts";
import type { ResearchRun } from "../research/types.ts";
import { formatAgentStatus, getAgentStatus, type AgentStatus } from "./agent-status.ts";

const FALLBACK_APPLY_GATE: DiscoverGate = { minStars: 5, minForks: 3, maxAgeMonths: 18 };
const COLD_QUERY_DISPLAY_CAP = 6;

export type CoverageHit = "exact" | "normalized" | "bare";
export type DiscoverGateSource = "stamped" | "inferred-miss" | "inferred-cache" | "resolved";

export type DiscoveryGroundCache = {
  /** Any row in search_cache (global). */
  searchCacheReady: boolean;
  inspectCacheRepos: number;
  /** Dimension query coverage against search_cache (discover-gate strings). */
  dimensionQueryTotal: number;
  dimensionQueryCached: number;
  /** e.g. "2/6" or "n/a" when dimension unknown. */
  dimensionCoverageLabel: string;
  /** Exact discover-query hash hits. */
  coverageExact: number;
  /** Same bare query after stripping stars:/forks:/pushed:. */
  coverageNormalized: number;
  /** Weak substring contains (last resort). */
  coverageBare: number;
  /** Dimension bare queries with no cache coverage. */
  coldQueries: string[];
};

export type DiscoveryGroundMiss = {
  kind: "discovery" | "gate" | "both" | "none" | "no-run" | "unknown-dimension";
  discoveryMiss: DiscoveryMissStats | null;
  gateMiss: GateMissStats | null;
  proposedAlternates: DiscoveryMissAlternate[];
  hint: string | null;
  /** Sibling production run when this dimension has none. */
  crossDimensionFallback: { runId: string; dimension: string } | null;
};

export type DiscoveryGroundReport = {
  generatedAt: string;
  dimension: string;
  grounded: true;
  source: "cache.db";
  status: AgentStatus;
  cache: DiscoveryGroundCache;
  miss: DiscoveryGroundMiss;
  nextActions: string[];
  /** Gates used for this report (apply = shortlist; discover = search_cache keys). */
  gates: {
    apply: DiscoverGate;
    discover: DiscoverGate;
    /** How discover was chosen when config.discoverGate was absent. */
    discoverSource: DiscoverGateSource;
  };
};

function loadScopedRun(dimension?: string): ResearchRun | null {
  const requested = dimension?.trim();
  if (requested) return loadLatestRunFromDb({ dimension: requested });
  return loadLatestProductionRunAnyDimension();
}

export type CoverageMatchContext = {
  normalizedIndex: Set<string>;
  strippedQueries: string[];
};

export function buildCoverageMatchContext(
  cachedQueries: string[] = listSearchCacheQueries(),
): CoverageMatchContext {
  const strippedQueries: string[] = [];
  for (const q of cachedQueries) {
    const n = stripRepoSearchQualifiers(q);
    if (n) strippedQueries.push(n);
  }
  return {
    normalizedIndex: new Set(strippedQueries),
    strippedQueries,
  };
}

/**
 * Exact discover key, else qualifier-normalized equality, else bare phrase.
 * Pass a prebuilt match context when scoring many queries.
 */
export function dimensionQueryCached(
  bareQuery: string,
  discoverGate: DiscoverGate,
  ctx?: CoverageMatchContext,
): CoverageHit | false {
  const searchQuery = buildRepoSearchQuery(bareQuery, discoverGate);
  if (hasSearchCacheForQuery(searchQuery)) return "exact";

  const match = ctx ?? buildCoverageMatchContext();
  const want = stripRepoSearchQualifiers(searchQuery);
  if (want && match.normalizedIndex.has(want)) return "normalized";

  if (hasBarePhraseInStrippedQueries(bareQuery, match.strippedQueries)) return "bare";
  return false;
}

function coverageForQueries(queries: string[], discoverGate: DiscoverGate): {
  total: number;
  cached: number;
  label: string;
  exact: number;
  normalized: number;
  bare: number;
  coldQueries: string[];
} {
  const ctx = buildCoverageMatchContext();
  let exact = 0;
  let normalized = 0;
  let bare = 0;
  const coldQueries: string[] = [];
  for (const q of queries) {
    const hit = dimensionQueryCached(q, discoverGate, ctx);
    if (hit === "exact") exact++;
    else if (hit === "normalized") normalized++;
    else if (hit === "bare") bare++;
    else coldQueries.push(q);
  }
  const cached = exact + normalized + bare;
  const total = queries.length;
  return {
    total,
    cached,
    label: total === 0 ? "n/a" : `${cached}/${total}`,
    exact,
    normalized,
    bare,
    coldQueries,
  };
}

function applyCoverage(cache: DiscoveryGroundCache, cov: ReturnType<typeof coverageForQueries>): void {
  cache.dimensionQueryTotal = cov.total;
  cache.dimensionQueryCached = cov.cached;
  cache.dimensionCoverageLabel = cov.label;
  cache.coverageExact = cov.exact;
  cache.coverageNormalized = cov.normalized;
  cache.coverageBare = cov.bare;
  cache.coldQueries = cov.coldQueries;
}

async function resolveApplyGate(run: ResearchRun | null): Promise<DiscoverGate> {
  try {
    const config = await loadConfig();
    return run?.config.gate ?? config.weights.gate;
  } catch {
    return run?.config.gate ?? FALLBACK_APPLY_GATE;
  }
}

/**
 * Discover gate precedence: stamped → discoveryMiss.searchQueries →
 * cache rows for dimension bares → resolveDiscoverGate(apply).
 */
export function resolveDiscoverGateForGround(input: {
  apply: DiscoverGate;
  run: ResearchRun | null;
  bareQueries: string[];
  cachedQueries?: string[];
}): { discover: DiscoverGate; discoverSource: DiscoverGateSource } {
  const { apply, run, bareQueries } = input;
  if (run?.config.discoverGate) {
    return { discover: run.config.discoverGate, discoverSource: "stamped" };
  }

  const missQueries = run?.discoveryMiss?.searchQueries;
  if (missQueries?.length) {
    const inferred = inferDiscoverGateFromSearchQueries(missQueries, apply);
    if (inferred) {
      return { discover: inferred, discoverSource: "inferred-miss" };
    }
  }

  const cached = input.cachedQueries ?? listSearchCacheQueries();
  if (bareQueries.length > 0 && cached.length > 0) {
    const inferred = inferDiscoverGateFromCachedQueries(bareQueries, cached, apply);
    if (inferred) {
      return { discover: inferred, discoverSource: "inferred-cache" };
    }
  }

  return { discover: resolveDiscoverGate(apply), discoverSource: "resolved" };
}

async function synthesizeNoRunMiss(
  dimension: string,
  apply: DiscoverGate,
  discover: DiscoverGate,
): Promise<{
  kind: "no-run" | "unknown-dimension";
  proposedAlternates: DiscoveryMissAlternate[];
  discoveryMiss: DiscoveryMissStats | null;
  hint: string;
  resolved: ResolvedDimensionQueries | null;
}> {
  try {
    const file = await loadDimensionsFile();
    const resolved = resolveDimensionQueries(file, dimension);
    const discoveryMiss =
      analyzeDiscoveryMiss(dimension, resolved, apply, file, 0, discover) ?? null;
    return {
      kind: "no-run",
      proposedAlternates: discoveryMiss?.alternateQueries ?? [],
      discoveryMiss,
      hint: `No production run for dimension=${dimension} — warm cache or run research`,
      resolved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unknown = /unknown research dimension/i.test(msg);
    return {
      kind: unknown ? "unknown-dimension" : "no-run",
      proposedAlternates: [],
      discoveryMiss: null,
      hint: msg,
      resolved: null,
    };
  }
}

function buildMissFromRun(run: ResearchRun): DiscoveryGroundMiss {
  const discoveryMiss = run.discoveryMiss ?? null;
  const gateMiss = run.gateMiss ?? null;
  if (discoveryMiss && gateMiss) {
    return {
      kind: "both",
      discoveryMiss,
      gateMiss,
      proposedAlternates: discoveryMiss.alternateQueries,
      hint: discoveryMiss.relaxedGateHint ?? gateMiss.retryHint,
      crossDimensionFallback: null,
    };
  }
  if (discoveryMiss) {
    return {
      kind: "discovery",
      discoveryMiss,
      gateMiss: null,
      proposedAlternates: discoveryMiss.alternateQueries,
      hint: discoveryMiss.relaxedGateHint,
      crossDimensionFallback: null,
    };
  }
  if (gateMiss) {
    return {
      kind: "gate",
      discoveryMiss: null,
      gateMiss,
      proposedAlternates: [],
      hint: gateMiss.retryHint,
      crossDimensionFallback: null,
    };
  }
  return {
    kind: "none",
    discoveryMiss: null,
    gateMiss: null,
    proposedAlternates: [],
    hint: null,
    crossDimensionFallback: null,
  };
}

function coveragePartial(cache: DiscoveryGroundCache): boolean {
  return (
    cache.dimensionQueryTotal > 0 &&
    cache.dimensionQueryCached < cache.dimensionQueryTotal
  );
}

function buildNextActions(input: {
  dimension: string;
  status: AgentStatus;
  cache: DiscoveryGroundCache;
  miss: DiscoveryGroundMiss;
  run: ResearchRun | null;
}): string[] {
  const { dimension, status, cache, miss, run } = input;
  const actions: string[] = [];
  const dimFlag = `--dimension=${dimension}`;
  const covered = cache.dimensionQueryCached > 0;
  const partial = coveragePartial(cache);
  const coldN = cache.coldQueries.length;

  if (miss.kind === "unknown-dimension") {
    actions.push("bun run agent ground   # list a valid --dimension from the hint above");
    return dedupeActions(actions);
  }

  if (!status.latestRun) {
    if (miss.crossDimensionFallback) {
      actions.push(
        `bun run agent status --dimension=${miss.crossDimensionFallback.dimension}   # sibling run ${miss.crossDimensionFallback.runId}`,
      );
    }
    if (partial) {
      actions.push(
        `bun run research -- ${dimFlag}   # warm ${coldN} cold discover queries (${cache.dimensionCoverageLabel})`,
      );
      actions.push(
        covered
          ? `bun run research:dry -- ${dimFlag}   # offline under-samples until coverage is full`
          : `bun run research:dry -- ${dimFlag}   # after a live warm`,
      );
    } else if (covered) {
      actions.push(
        `bun run research:dry -- ${dimFlag}   # offline probe (${cache.dimensionCoverageLabel} discover queries cached)`,
      );
      actions.push(`bun run research -- ${dimFlag}   # live refresh when ready`);
    } else {
      actions.push(`bun run research -- ${dimFlag}   # warm search_cache (live; coverage cold)`);
      actions.push(`bun run research:dry -- ${dimFlag}   # after a live warm`);
    }
    if (miss.discoveryMiss?.retryCommand) {
      actions.push(miss.discoveryMiss.retryCommand);
    }
    return dedupeActions(actions);
  }

  if ((miss.kind === "discovery" || miss.kind === "both") && miss.discoveryMiss?.retryCommand) {
    actions.push(miss.discoveryMiss.retryCommand);
  }
  if ((miss.kind === "gate" || miss.kind === "both") && miss.gateMiss?.retryCommand) {
    actions.push(miss.gateMiss.retryCommand);
  }

  if (partial) {
    actions.push(
      `bun run research -- ${dimFlag}   # warm ${coldN} cold discover queries (${cache.dimensionCoverageLabel})`,
    );
  }

  if (
    covered &&
    (miss.kind === "discovery" || miss.kind === "both" || run?.stats.discovered === 0)
  ) {
    actions.push(
      partial
        ? `bun run research:dry -- ${dimFlag}   # offline under-samples until coverage is full`
        : `bun run research:dry -- ${dimFlag}`,
    );
  }

  if (status.latestRun.shortlist > 0) {
    actions.push(`bun run agent patterns --dimension=${dimension}`);
    actions.push("bun run agent blueprint");
  } else if (miss.kind === "none") {
    if (covered && !partial) {
      actions.push(`bun run research:dry -- ${dimFlag}   # offline; shortlist empty`);
    }
    if (!partial) {
      actions.push(`bun run research -- ${dimFlag}   # refresh; shortlist empty`);
    }
    actions.push(`bun run agent report --dimension=${dimension}`);
    actions.push("bun run agent blueprint");
  }

  if (status.latestRun.stale) {
    actions.push(`bun run research -- ${dimFlag}   # refresh stale run`);
  }

  return dedupeActions(actions);
}

function dedupeActions(actions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of actions) {
    const key = a.replace(/\s+#.*$/, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function emptyCache(): DiscoveryGroundCache {
  return {
    searchCacheReady: hasAnySearchCache(),
    inspectCacheRepos: countInspectCacheRepos(),
    dimensionQueryTotal: 0,
    dimensionQueryCached: 0,
    dimensionCoverageLabel: "n/a",
    coverageExact: 0,
    coverageNormalized: 0,
    coverageBare: 0,
    coldQueries: [],
  };
}

/** Cache-only discovery-grounded triage (status + cache + miss + next actions). */
export async function runDiscoveryGround(options?: {
  dimension?: string;
}): Promise<DiscoveryGroundReport> {
  const dimension = normalizeDimensionId(options?.dimension ?? DEFAULT_DIMENSION);
  const status = getAgentStatus(options?.dimension?.trim() ? dimension : undefined);
  const run = loadScopedRun(options?.dimension?.trim() ? dimension : undefined);
  const apply = await resolveApplyGate(run);

  const cache = emptyCache();
  let miss: DiscoveryGroundMiss;
  let bareQueries: string[] = [];
  let discover = resolveDiscoverGate(apply);
  let discoverSource: DiscoverGateSource = "resolved";

  if (!run) {
    // Provisional discover for miss synthesis; refine from cache once queries known.
    const provisional = resolveDiscoverGateForGround({
      apply,
      run: null,
      bareQueries: [],
    });
    discover = provisional.discover;
    discoverSource = provisional.discoverSource;

    const synth = await synthesizeNoRunMiss(dimension, apply, discover);
    let crossDimensionFallback: { runId: string; dimension: string } | null = null;
    if (synth.kind === "no-run") {
      const fb = loadFallbackRunFromDb({ dimension });
      if (fb) {
        crossDimensionFallback = { runId: fb.runId, dimension: runDimension(fb) };
      }
    }
    if (synth.resolved) {
      bareQueries = synth.resolved.queries;
      const refined = resolveDiscoverGateForGround({
        apply,
        run: null,
        bareQueries,
      });
      discover = refined.discover;
      discoverSource = refined.discoverSource;
      applyCoverage(cache, coverageForQueries(bareQueries, discover));
    }
    miss = {
      kind: synth.kind,
      discoveryMiss: synth.discoveryMiss,
      gateMiss: null,
      proposedAlternates: synth.proposedAlternates,
      hint: synth.hint,
      crossDimensionFallback,
    };
  } else {
    miss = buildMissFromRun(run);
    try {
      const file = await loadDimensionsFile();
      const resolved = resolveDimensionQueries(file, runDimension(run));
      bareQueries = resolved.queries;
      const refined = resolveDiscoverGateForGround({
        apply,
        run,
        bareQueries,
      });
      discover = refined.discover;
      discoverSource = refined.discoverSource;
      applyCoverage(cache, coverageForQueries(bareQueries, discover));
    } catch {
      const refined = resolveDiscoverGateForGround({
        apply,
        run,
        bareQueries: [],
      });
      discover = refined.discover;
      discoverSource = refined.discoverSource;
    }
  }

  const gates = { apply, discover, discoverSource };
  const scopedDimension = run ? runDimension(run) : dimension;
  const nextActions = buildNextActions({
    dimension: scopedDimension,
    status,
    cache,
    miss,
    run,
  });

  return {
    generatedAt: new Date().toISOString(),
    dimension: scopedDimension,
    grounded: true,
    source: "cache.db",
    status,
    cache,
    miss,
    nextActions,
    gates,
  };
}

export function formatDiscoveryGround(report: DiscoveryGroundReport): string {
  const dGate = report.gates.discover;
  const aGate = report.gates.apply;
  const covBits =
    report.cache.dimensionQueryTotal > 0
      ? ` (exact ${report.cache.coverageExact}, normalized ${report.cache.coverageNormalized}, bare ${report.cache.coverageBare})`
      : "";
  const lines: string[] = [
    "Kalshi agent ground — discovery-grounded sub-agents",
    `Source: ${report.source} · dimension=${report.dimension}`,
    `Gates: discover stars≥${dGate.minStars}/forks≥${dGate.minForks} (${report.gates.discoverSource}) · apply stars≥${aGate.minStars}/forks≥${aGate.minForks}`,
    "",
    "── status ──",
    formatAgentStatus(report.status, { compact: true }),
    "",
    "── cache ──",
    `search_cache: ${report.cache.searchCacheReady ? "ready" : "empty"} (global)`,
    `dimension coverage: ${report.cache.dimensionCoverageLabel} discover queries${covBits}`,
    `inspect_cache repos: ${report.cache.inspectCacheRepos}`,
  ];

  if (report.cache.coldQueries.length > 0) {
    const shown = report.cache.coldQueries.slice(0, COLD_QUERY_DISPLAY_CAP);
    const more = report.cache.coldQueries.length - shown.length;
    lines.push(`cold queries (${report.cache.coldQueries.length}):`);
    for (const q of shown) lines.push(`  · ${q}`);
    if (more > 0) lines.push(`  · … +${more} more`);
  }

  lines.push("", "── miss ──");

  if (report.miss.kind === "none") {
    lines.push("No discovery/gate miss on latest production run");
  } else if (report.miss.kind === "unknown-dimension") {
    lines.push(report.miss.hint ?? "Unknown dimension");
  } else if (report.miss.kind === "no-run") {
    lines.push(report.miss.hint ?? "No production run");
    if (report.miss.crossDimensionFallback) {
      lines.push(
        `Cross-dimension fallback: ${report.miss.crossDimensionFallback.runId} (${report.miss.crossDimensionFallback.dimension})`,
      );
    }
    if (report.miss.proposedAlternates.length) {
      lines.push("Proposed alternate queries (dimensions.json):");
      for (const alt of report.miss.proposedAlternates) {
        lines.push(`  · ${alt.query} — ${alt.rationale}`);
      }
    }
  } else if (
    (report.miss.kind === "discovery" || report.miss.kind === "both") &&
    report.miss.discoveryMiss
  ) {
    const d = report.miss.discoveryMiss;
    lines.push(`Discovery miss: 0 candidates (${d.queriesTried.length} queries tried)`);
    if (d.relaxedGateHint) lines.push(d.relaxedGateHint);
    for (const alt of d.alternateQueries) {
      lines.push(`  · ${alt.query} — ${alt.rationale}`);
    }
    lines.push(`Probe: ${d.retryCommand}`);
  }

  if ((report.miss.kind === "gate" || report.miss.kind === "both") && report.miss.gateMiss) {
    const g = report.miss.gateMiss;
    if (report.miss.kind === "both") lines.push("");
    lines.push(`Gate miss: ${g.rejected} rejected`);
    if (g.retryHint) lines.push(g.retryHint);
    if (g.retryCommand) lines.push(`Probe: ${g.retryCommand}`);
    for (const nm of g.nearMisses.slice(0, 3)) {
      lines.push(`  · ${nm.fullName} — ${nm.summary}`);
    }
  }

  lines.push("", "── next actions ──");
  if (report.nextActions.length === 0) {
    lines.push("(none — run looks healthy; try agent patterns / blueprint)");
  } else {
    for (let i = 0; i < report.nextActions.length; i++) {
      lines.push(`${i + 1}. ${report.nextActions[i]}`);
    }
  }

  return lines.join("\n");
}
