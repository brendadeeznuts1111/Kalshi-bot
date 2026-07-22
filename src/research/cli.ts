#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/utils#bun-main
// @see https://bun.com/docs/runtime/environment-variables#bun-env
import { parseArgs } from "node:util";
import { inspectRepo } from "./inspect.ts";
import { discoverCandidates, loadConfig } from "./discover.ts";
import { applyGate } from "./gate.ts";
import { analyzeGateMiss } from "./gate-miss.ts";
import { analyzeDiscoveryMiss } from "./discovery-miss.ts";
import { mapPool } from "./pool.ts";
import { isGitHubApiAbortError } from "./github-errors.ts";
import { scoreRepo, stackRank } from "./score.ts";
import { buildShortlist } from "./diversify.ts";
import { diffRuns, loadPreviousRun, loadRunById } from "./diff.ts";
import { writeOutputs } from "./report.ts";
import { writeAuditExports } from "./export-audit.ts";
import { ensureCacheDir, saveRun, loadInspectCache } from "./cache.ts";
import { ensureGh } from "./preflight.ts";
import { ensureGhRateBudget, GitHubRateLimitError } from "./gh.ts";
import { ensureInspectRateBudget, formatInspectBudgetEstimate } from "./github-rate-limit.ts";
import {
  beginGitHubResearchErrorContext,
  buildGitHubErrorEnrichment,
  finishGitHubResearchErrorContext,
  formatRateLimitRemediation,
  serializeGitHubApiError,
} from "./gh.ts";
import { beginResearchCacheStats, finishResearchCacheStats, formatCacheStatsSummary, hasDegradedCacheUsage } from "./github-cache-stats.ts";
import {
  beginInspectPersistStats,
  finishInspectPersistStats,
  formatInspectPersistSummary,
  formatInspectSignalsBrief,
  inspectionSignalsEqual,
} from "./inspect-utils.ts";
import { warmGitHubApiNetwork } from "./github-network.ts";
import { attachRepoReport } from "./evidence.ts";
import { DEFAULT_INSPECT_CONCURRENCY } from "./constants.ts";
import { dimensionArtifactBasename, normalizeDimensionId, runDimension } from "./dimensions.ts";
import { REPORT_DIR, joinPath } from "./paths.ts";
import type { ResearchRun } from "./types.ts";
import { emitResearchProgress, isResearchIpcChild, logResearchProgress, logResearchStatus, type ResearchProgressSink } from "./research-progress.ts";
import { isTtyStdout, printInspectTable, shortlistTableRows } from "./terminal-out.ts";

export type CliOptions = {
  json: boolean;
  exportAudit: boolean;
  dimension?: string;
  shortlist?: number;
  minStars?: number;
  minForks?: number;
  maxAgeMonths?: number;
  diff?: string;
  openReport?: boolean;
  onProgress?: ResearchProgressSink;
};

function envNumber(key: string): number | undefined {
  const raw = Bun.env[key];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function parseCliOptions(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      "export-audit": { type: "boolean", default: false },
      shortlist: { type: "string" },
      diff: { type: "string" },
      "min-stars": { type: "string" },
      "min-forks": { type: "string" },
      "max-age-months": { type: "string" },
      dimension: { type: "string" },
      "open-report": { type: "boolean", default: false },
    },
    strict: false,
  });

  const dimensionRaw =
    typeof values.dimension === "string"
      ? values.dimension
      : Bun.env.RESEARCH_DIMENSION?.trim() || undefined;

  return {
    json: values.json === true,
    exportAudit: values["export-audit"] === true,
    dimension: dimensionRaw,
    shortlist: values.shortlist ? Number(values.shortlist) : undefined,
    diff: typeof values.diff === "string" ? values.diff : undefined,
    minStars: values["min-stars"] ? Number(values["min-stars"]) : undefined,
    minForks: values["min-forks"] ? Number(values["min-forks"]) : undefined,
    maxAgeMonths: values["max-age-months"] ? Number(values["max-age-months"]) : undefined,
    openReport: values["open-report"] === true,
  };
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export { buildResearchSpawnArgs } from "./research-progress.ts";

export function printResearchRunSummary(run: ResearchRun): void {
  const dimension = runDimension(run);
  console.log(`Run complete: ${run.runId} (dimension=${dimension})`);
  if (isTtyStdout() && run.shortlist.length) {
    console.log(`Shortlist (${run.shortlist.length}):`);
    printInspectTable(
      shortlistTableRows(run.shortlist, { hyperlinks: true }),
      ["#", "repo", "score", "auth", "orders", "license"],
    );
  } else {
    console.log(`Shortlist (${run.shortlist.length}):`);
    for (const [i, s] of run.shortlist.entries()) {
      const lic = s.repo.license.unlicensed ? " [UNLICENSED]" : "";
      console.log(`  ${i + 1}. ${s.repo.fullName} — ${s.score.total}${lic}`);
    }
  }
  const reportBase = dimensionArtifactBasename(dimension);
  console.log(`Reports: research/reports/${reportBase}.md`);
  console.log("Browse:  bun run serve");
}

export async function runResearch(opts: CliOptions): Promise<ResearchRun> {
  const progress = (message: Parameters<typeof logResearchProgress>[0]) =>
    logResearchProgress(message, opts.onProgress);
  ensureGh();
  warmGitHubApiNetwork();
  await ensureCacheDir();
  beginResearchCacheStats();
  beginInspectPersistStats();

  const config = await loadConfig();
  const gate = {
    minStars: opts.minStars ?? envNumber("RESEARCH_MIN_STARS") ?? config.weights.gate.minStars,
    minForks: opts.minForks ?? envNumber("RESEARCH_MIN_FORKS") ?? config.weights.gate.minForks,
    maxAgeMonths:
      opts.maxAgeMonths ?? envNumber("RESEARCH_MAX_AGE_MONTHS") ?? config.weights.gate.maxAgeMonths,
  };
  const shortlistSize =
    opts.shortlist ?? envNumber("RESEARCH_SHORTLIST") ?? config.weights.shortlistSize;

  const dimension = normalizeDimensionId(opts.dimension ?? config.dimensions.defaultDimension);

  beginGitHubResearchErrorContext({
    dimension,
    minStars: gate.minStars,
    minForks: gate.minForks,
  });

  progress({ type: "phase", phase: "discover", dimension });
  logResearchStatus(`Discovering candidates (dimension=${dimension})...`);
  await ensureGhRateBudget();
  const { candidates, querySet } = await discoverCandidates(config, dimension, gate);
  logResearchStatus(`Discovered ${candidates.length} candidates (${querySet.label})`);

  const discoveryMiss =
    candidates.length === 0
      ? analyzeDiscoveryMiss(dimension, querySet, gate, config.dimensions, candidates.length)
      : undefined;
  if (discoveryMiss) {
    logResearchStatus(discoveryMiss.relaxedGateHint);
    for (const alt of discoveryMiss.alternateQueries) {
      logResearchStatus(`  alternate query: \`${alt.query}\` — ${alt.rationale}`);
    }
    logResearchStatus(`  probe: ${discoveryMiss.retryCommand}`);
  }

  const gated = applyGate(candidates, gate);
  const gateMiss = analyzeGateMiss(candidates, gated, gate, { dimension });
  progress({
    type: "stats",
    discovered: candidates.length,
    gated: gated.length,
    label: querySet.label,
  });
  progress({ type: "phase", phase: "gate", dimension, detail: `${gated.length} passed gate` });
  logResearchStatus(`${gated.length} passed popularity gate`);
  if (gateMiss) {
    logResearchStatus(gateMiss.retryHint ?? "Gate miss — no near-miss candidates to probe");
    for (const nm of gateMiss.nearMisses) {
      logResearchStatus(`  near miss: ${nm.fullName} — ${nm.summary}`);
    }
  }

  progress({ type: "phase", phase: "inspect", dimension, detail: `concurrency ${DEFAULT_INSPECT_CONCURRENCY}` });
  const uncachedCount = gated.filter((repo) => loadInspectCache(repo.fullName, repo.pushedAt) === null).length;
  const inspectBudget = await ensureInspectRateBudget({
    repoCount: gated.length,
    uncachedRepoCount: uncachedCount,
    config,
  });
  logResearchStatus(formatInspectBudgetEstimate(inspectBudget));
  logResearchStatus(`Inspecting repos (concurrency ${DEFAULT_INSPECT_CONCURRENCY})...`);
  let inspectCacheHits = 0;
  let inspectIndex = 0;
  const inspected = await mapPool(
    gated,
    DEFAULT_INSPECT_CONCURRENCY,
    async (repo) => {
      inspectIndex++;
      const cachedSnapshot = loadInspectCache(repo.fullName, repo.pushedAt);
      const hadCache = cachedSnapshot !== null;
      if (hadCache) inspectCacheHits++;
      const signals = await inspectRepo(repo, config);
      progress({
        type: "inspect",
        repo: repo.fullName,
        n: inspectIndex,
        total: gated.length,
        cached: hadCache,
        brief: formatInspectSignalsBrief(signals),
      });
      if (cachedSnapshot && !inspectionSignalsEqual(cachedSnapshot, signals)) {
        logResearchStatus(`Inspect cache drift: ${repo.fullName} (Bun.deepEquals mismatch)`);
      }
      const score = scoreRepo(repo, signals, config);
      return attachRepoReport({
        repo,
        signals,
        score,
        stackRank: stackRank(signals.primaryLanguage),
      });
    },
    { failFast: isGitHubApiAbortError },
  );

  if (inspectCacheHits > 0) {
    logResearchStatus(`Inspect cache: ${inspectCacheHits}/${gated.length} repos skipped gh (unchanged pushed_at)`);
  }

  const inspectPersistStats = finishInspectPersistStats();
  if (inspectPersistStats && (inspectPersistStats.inserts || inspectPersistStats.updates || inspectPersistStats.unchanged)) {
    logResearchStatus(`Inspect persist: ${formatInspectPersistSummary(inspectPersistStats)}`);
  }

  const cacheStats = finishResearchCacheStats();
  if (cacheStats) {
    logResearchStatus(`Cache summary: ${formatCacheStatsSummary(cacheStats)}`);
    if (hasDegradedCacheUsage(cacheStats)) {
      logResearchStatus("Warning: run used stale cache under GitHub rate limit — verify results before acting on them.");
    }
  }

  const scored = inspected.sort((a, b) => b.score.total - a.score.total);
  progress({ type: "phase", phase: "score", dimension });
  const { shortlist, excludedSdkOnly } = buildShortlist(scored, config, shortlistSize);

  const run: ResearchRun = {
    runId: runId(),
    generatedAt: new Date().toISOString(),
    dimension,
    config: { shortlistSize, gate },
    stats: {
      discovered: candidates.length,
      gated: gated.length,
      inspected: inspected.length,
      shortlist: shortlist.length,
      cache: cacheStats ?? undefined,
    },
    candidates,
    gated,
    scored,
    shortlist,
    excludedSdkOnly,
    gateMiss,
    discoveryMiss,
  };

  const baseline = opts.diff ? await loadRunById(opts.diff, dimension) : await loadPreviousRun(dimension);
  if (opts.diff && !baseline) {
    throw new Error(`No run found for --diff ${opts.diff}`);
  }

  const diff = diffRuns(baseline, run);
  progress({ type: "phase", phase: "write", dimension });
  saveRun(run.runId, run.generatedAt, run);
  await writeOutputs(run, diff, { dimensionLabel: querySet.label });
  if (opts.exportAudit) {
    const auditDir = await writeAuditExports(run, config);
    if (auditDir) {
      logResearchStatus(`Audit export: ${auditDir}`);
    } else {
      logResearchStatus("Audit export: no high-value or watchlist shortlist candidates");
    }
  }
  progress({
    type: "complete",
    runId: run.runId,
    dimension,
    shortlist: run.shortlist.length,
  });
  finishGitHubResearchErrorContext();
  return run;
}

if (import.meta.main) {
  const opts = parseCliOptions(Bun.argv.slice(2));
  try {
    const run = await runResearch(opts);
    if (opts.json) {
      await Bun.write(Bun.stdout, JSON.stringify(run, null, 2) + "\n");
    } else if (!isResearchIpcChild()) {
      printResearchRunSummary(run);
      if (opts.openReport) {
        const reportPath = joinPath(REPORT_DIR, `${dimensionArtifactBasename(runDimension(run))}.md`);
        // @see https://bun.com/docs/runtime/utils#bun-openineditor
        Bun.openInEditor(reportPath);
      }
    }
  } catch (err) {
    finishResearchCacheStats();
    if (err instanceof GitHubRateLimitError) {
      const enrichment = buildGitHubErrorEnrichment(err);
      const wire = serializeGitHubApiError(err, enrichment);
      emitResearchProgress(
        { type: "error", message: wire.message, exitCode: 2 },
        opts.onProgress,
      );
      if (opts.json) {
        console.error(JSON.stringify({ ok: false, ...wire }, null, 2));
      } else {
        console.error(formatRateLimitRemediation(err, enrichment));
      }
      finishGitHubResearchErrorContext();
      process.exit(2);
    }
    const message = err instanceof Error ? err.message : String(err);
    emitResearchProgress({ type: "error", message, exitCode: 1 }, opts.onProgress);
    finishGitHubResearchErrorContext();
    console.error(message);
    process.exit(1);
  }
}
