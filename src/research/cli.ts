#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/utils#bun-main
// @see https://bun.com/docs/runtime/environment-variables#bun-env
import { parseArgs } from "node:util";
import { inspectRepo } from "./inspect.ts";
import { discoverCandidates, loadConfig } from "./discover.ts";
import { applyGate } from "./gate.ts";
import { mapPool } from "./pool.ts";
import { scoreRepo, stackRank } from "./score.ts";
import { buildShortlist } from "./diversify.ts";
import { diffRuns, loadPreviousRun, loadRunById } from "./diff.ts";
import { writeOutputs } from "./report.ts";
import { writeAuditExports } from "./export-audit.ts";
import { ensureCacheDir, saveRun } from "./cache.ts";
import { ensureGh } from "./preflight.ts";
import { attachRepoReport } from "./evidence.ts";
import { DEFAULT_INSPECT_CONCURRENCY } from "./constants.ts";
import type { ResearchRun } from "./types.ts";

export type CliOptions = {
  json: boolean;
  exportAudit: boolean;
  shortlist?: number;
  minStars?: number;
  minForks?: number;
  maxAgeMonths?: number;
  diff?: string;
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
    },
    strict: false,
  });

  return {
    json: values.json === true,
    exportAudit: values["export-audit"] === true,
    shortlist: values.shortlist ? Number(values.shortlist) : undefined,
    diff: typeof values.diff === "string" ? values.diff : undefined,
    minStars: values["min-stars"] ? Number(values["min-stars"]) : undefined,
    minForks: values["min-forks"] ? Number(values["min-forks"]) : undefined,
    maxAgeMonths: values["max-age-months"] ? Number(values["max-age-months"]) : undefined,
  };
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runResearch(opts: CliOptions): Promise<ResearchRun> {
  ensureGh();
  await ensureCacheDir();

  const config = await loadConfig();
  const gate = {
    minStars: opts.minStars ?? envNumber("RESEARCH_MIN_STARS") ?? config.weights.gate.minStars,
    minForks: opts.minForks ?? envNumber("RESEARCH_MIN_FORKS") ?? config.weights.gate.minForks,
    maxAgeMonths:
      opts.maxAgeMonths ?? envNumber("RESEARCH_MAX_AGE_MONTHS") ?? config.weights.gate.maxAgeMonths,
  };
  const shortlistSize =
    opts.shortlist ?? envNumber("RESEARCH_SHORTLIST") ?? config.weights.shortlistSize;

  console.error("Discovering candidates...");
  const candidates = await discoverCandidates(config);
  console.error(`Discovered ${candidates.length} candidates`);

  const gated = applyGate(candidates, gate);
  console.error(`${gated.length} passed popularity gate`);

  console.error(`Inspecting repos (concurrency ${DEFAULT_INSPECT_CONCURRENCY})...`);
  const inspected = await mapPool(gated, DEFAULT_INSPECT_CONCURRENCY, async (repo) => {
    console.error(`  inspect ${repo.fullName}`);
    const signals = await inspectRepo(repo, config);
    const score = scoreRepo(repo, signals, config);
    return attachRepoReport({
      repo,
      signals,
      score,
      stackRank: stackRank(signals.primaryLanguage),
    });
  });

  const scored = inspected.sort((a, b) => b.score.total - a.score.total);
  const { shortlist, excludedSdkOnly } = buildShortlist(scored, config, shortlistSize);

  const run: ResearchRun = {
    runId: runId(),
    generatedAt: new Date().toISOString(),
    config: { shortlistSize, gate },
    stats: {
      discovered: candidates.length,
      gated: gated.length,
      inspected: inspected.length,
      shortlist: shortlist.length,
    },
    candidates,
    gated,
    scored,
    shortlist,
    excludedSdkOnly,
  };

  const baseline = opts.diff ? await loadRunById(opts.diff) : await loadPreviousRun();
  if (opts.diff && !baseline) {
    throw new Error(`No run found for --diff ${opts.diff}`);
  }

  const diff = diffRuns(baseline, run);
  saveRun(run.runId, run.generatedAt, run);
  await writeOutputs(run, diff);
  if (opts.exportAudit) {
    const auditDir = await writeAuditExports(run, config);
    if (auditDir) {
      console.error(`Audit export: ${auditDir}`);
    } else {
      console.error("Audit export: no high-value or watchlist shortlist candidates");
    }
  }
  return run;
}

if (import.meta.main) {
  const opts = parseCliOptions(Bun.argv.slice(2));
  try {
    const run = await runResearch(opts);
    if (opts.json) {
      await Bun.write(Bun.stdout, JSON.stringify(run, null, 2) + "\n");
    } else {
      console.log(`Run complete: ${run.runId}`);
      console.log(`Shortlist (${run.shortlist.length}):`);
      for (const [i, s] of run.shortlist.entries()) {
        const lic = s.repo.license.unlicensed ? " [UNLICENSED]" : "";
        console.log(`  ${i + 1}. ${s.repo.fullName} — ${s.score.total}${lic}`);
      }
      console.log("Reports: research/reports/latest.md");
      console.log("Browse:  bun run serve");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
