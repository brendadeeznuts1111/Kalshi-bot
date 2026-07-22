/**
 * Component lift map from a research run — pure scoring, no rotor.
 */
import type { ResearchRun, ScoredRepo } from "../research/types.ts";
import type { ScoreComponentKey } from "../research/constants.ts";
import { SCORE_COMPONENTS, COMPONENT_WEIGHTS } from "../research/constants.ts";
import { loadResearchRun } from "../research/cache.ts";
import { runDimension } from "../research/dimensions.ts";
import { buildRepoReport } from "../research/evidence.ts";
import {
  isHighValueCandidate,
  resolveAuditExportTier,
  type AuditExportTier,
} from "../research/audit-adapter.ts";
import {
  formatTierBadge,
  resolveRunDataFreshness,
  type DataFreshness,
} from "./freshness.ts";
import {
  isTtyStdout,
  formatInspectTable,
  liftTableRows,
  padDisplay,
  shortlistSummaryTableRows,
} from "../research/terminal-out.ts";
import {
  loadRepoPatternReport,
  patternReportSourceRel,
  pickPatternSliceForComponent,
  type LiftPatternRef,
  type RepoPatternReport,
} from "./pattern-extract.ts";
import { formatPatternMissSummary } from "./pattern-miss.ts";

export type { LiftPatternRef };

export type LiftRecommendation = {
  component: ScoreComponentKey;
  repo: string;
  points: number;
  maxPoints: number;
  matched: boolean;
  rationale: string;
  auditTier: AuditExportTier | null;
  pattern: LiftPatternRef | null;
};

export type ShortlistSummary = {
  fullName: string;
  total: number;
  auditTier: AuditExportTier | null;
  license: string | null;
  unlicensed: boolean;
};

export type SuggestLiftResult = {
  runId: string;
  generatedAt: string;
  dimension: string;
  recommendations: LiftRecommendation[];
  shortlist: ShortlistSummary[];
  notes: string[];
  dataFreshness: DataFreshness;
};

function componentPoints(item: ScoredRepo, component: ScoreComponentKey): number {
  return item.score[component];
}

function componentMax(component: ScoreComponentKey): number {
  return COMPONENT_WEIGHTS[component];
}

function detectorFor(item: ScoredRepo, component: ScoreComponentKey) {
  const report = item.report ?? buildRepoReport(item);
  return report.detectors.find((d) => d.component === component);
}

function bestForComponent(
  shortlist: ScoredRepo[],
  component: ScoreComponentKey,
  generatedAt: string,
): LiftRecommendation {
  let best: ScoredRepo | null = null;
  let bestPoints = -1;

  for (const item of shortlist) {
    const pts = componentPoints(item, component);
    if (pts > bestPoints) {
      best = item;
      bestPoints = pts;
    }
  }

  if (!best) {
    return {
      component,
      repo: "",
      points: 0,
      maxPoints: componentMax(component),
      matched: false,
      rationale: "No shortlist candidates",
      auditTier: null,
      pattern: null,
    };
  }

  const report = best.report ?? buildRepoReport(best, generatedAt);
  const detector = detectorFor(best, component);
  const auditTier = resolveAuditExportTier(report);
  return {
    component,
    repo: best.repo.fullName,
    points: bestPoints,
    maxPoints: componentMax(component),
    matched: detector?.matched ?? false,
    rationale: detector?.rationale ?? "No detector rationale",
    auditTier,
    pattern: null,
  };
}

export function suggestLiftFromRun(run: ResearchRun): SuggestLiftResult {
  const shortlist = run.shortlist;
  const notes: string[] = [];

  const auditReady = shortlist.filter((item) => {
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    return isHighValueCandidate(report);
  });

  const watchlistReady = shortlist.filter((item) => {
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    return resolveAuditExportTier(report) === "watchlist";
  });

  if (auditReady.length === 0) {
    notes.push(
      "No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).",
    );
  } else if (auditReady.length === 1) {
    notes.push(`Primary high-value audit export: ${auditReady[0]!.repo.fullName}.`);
  } else {
    notes.push(`${auditReady.length} repos qualify for high-value audit export.`);
  }

  if (watchlistReady.length) {
    notes.push(
      `Watchlist tier (${watchlistReady.length}): ${watchlistReady.map((s) => s.repo.fullName).join(", ")} — auditable at ≥65/≥12, status open.`,
    );
  }

  const unlicensed = shortlist.filter((s) => s.repo.license.unlicensed);
  if (unlicensed.length) {
    notes.push(
      `License warning: ${unlicensed.map((s) => s.repo.fullName).join(", ")} lack usable OSS license.`,
    );
  }

  const recommendations = SCORE_COMPONENTS.map((component) =>
    bestForComponent(shortlist, component, run.generatedAt),
  );

  const uniqueRepos = new Set(recommendations.map((r) => r.repo).filter(Boolean));
  if (uniqueRepos.size > 1) {
    notes.push(
      "Composite bot: lift modules per component from different repos (see recommendations map).",
    );
  }

  const dataFreshness = resolveRunDataFreshness(run);

  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    dimension: runDimension(run),
    recommendations,
    shortlist: shortlist.map((item) => {
      const report = item.report ?? buildRepoReport(item, run.generatedAt);
      const auditTier = resolveAuditExportTier(report);
      return {
        fullName: item.repo.fullName,
        total: item.score.total,
        auditTier,
        license: item.repo.license.spdxId ?? item.repo.license.name,
        unlicensed: item.repo.license.unlicensed,
      };
    }),
    notes,
    dataFreshness,
  };
}

export async function attachPatternsToLift(
  result: SuggestLiftResult,
  run: ResearchRun,
  loadRepoPatterns: (
    dimension: string,
    repo: string,
    run: ResearchRun,
  ) => Promise<RepoPatternReport | null> = loadRepoPatternsForLift,
): Promise<SuggestLiftResult> {
  const source = patternReportSourceRel(result.dimension);
  const recommendations = await Promise.all(
    result.recommendations.map(async (rec) => {
      if (!rec.repo) return rec;
      const repoPatterns = await loadRepoPatterns(result.dimension, rec.repo, run);
      if (!repoPatterns) return rec;
      const slice = pickPatternSliceForComponent(repoPatterns, rec.component);
      if (!slice.summary && !slice.excerpt && !slice.misses?.length) return rec;
      return {
        ...rec,
        pattern: {
          summary: slice.summary || formatPatternMissSummary(slice.misses ?? []),
          excerpt: slice.excerpt,
          file: slice.file,
          source,
          misses: slice.misses,
        },
      };
    }),
  );
  return { ...result, recommendations };
}

async function loadRepoPatternsForLift(
  dimension: string,
  repoFullName: string,
  run: ResearchRun,
): Promise<RepoPatternReport | null> {
  // Cache-only — blueprint/lift must not spend code_search quota.
  return loadRepoPatternReport(dimension, repoFullName, run, { allowLiveFetch: false });
}

export function loadRunForLift(runId?: string, dimension?: string): ResearchRun | null {
  return loadResearchRun({ runId, dimension });
}

/** @deprecated alias — use loadRunForLift */
export const loadRunForSuggest = loadRunForLift;

export function formatLift(result: SuggestLiftResult): string {
  const freshness = result.dataFreshness;
  const lines: string[] = [
    `Lift suggestions — run ${result.runId} (${result.generatedAt})`,
    `Dimension: ${result.dimension}`,
    "",
    "Lift map:",
  ];

  const liftRows = liftTableRows(
    result.recommendations.map((rec) => ({
      component: rec.component,
      repo: rec.repo || "—",
      score: rec.repo ? `${rec.points}/${rec.maxPoints}` : "—",
      badge:
        rec.repo !== ""
          ? formatTierBadge({
              auditTier: rec.auditTier,
              stale: freshness.stale,
              ageMs: freshness.ageMs,
            })
          : "—",
    })),
  );

  if (isTtyStdout() && liftRows.length) {
    lines.push(formatInspectTable(liftRows, ["component", "repo", "score", "badge"]));
    for (const rec of result.recommendations) {
      if (!rec.repo) continue;
      lines.push(`  ${rec.component}: ${rec.rationale}`);
      if (rec.pattern?.summary) lines.push(`    ↳ pattern: ${rec.pattern.summary}`);
      if (rec.pattern?.misses?.length && !rec.pattern.summary.includes("Manual review")) {
        lines.push(`    ↳ review: ${formatPatternMissSummary(rec.pattern.misses)}`);
      }
    }
  } else {
    for (const rec of result.recommendations) {
      const badge =
        rec.repo !== ""
          ? ` ${formatTierBadge({
              auditTier: rec.auditTier,
              stale: freshness.stale,
              ageMs: freshness.ageMs,
            })}`
          : "";
      lines.push(
        `  ${padDisplay(rec.component, 14)} ← ${rec.repo || "—"} (${rec.points}/${rec.maxPoints})${badge}`,
      );
      lines.push(`    ${rec.rationale}`);
      if (rec.pattern?.summary) {
        lines.push(`    ↳ pattern: ${rec.pattern.summary}`);
      }
    }
  }

  lines.push("", "Shortlist:");
  if (isTtyStdout() && result.shortlist.length) {
    lines.push(
      formatInspectTable(
        shortlistSummaryTableRows(
          result.shortlist.map((s) => ({
            fullName: s.fullName,
            total: s.total,
            badge: formatTierBadge({
              auditTier: s.auditTier,
              stale: freshness.stale,
              ageMs: freshness.ageMs,
            }),
            license: s.unlicensed ? "UNLICENSED" : (s.license ?? "ok"),
          })),
        ),
        ["#", "repo", "score", "badge", "license"],
      ),
    );
  } else {
    for (const s of result.shortlist) {
      const lic = s.unlicensed ? " UNLICENSED" : "";
      const badge = formatTierBadge({
        auditTier: s.auditTier,
        stale: freshness.stale,
        ageMs: freshness.ageMs,
      });
      lines.push(`  ${s.fullName} — ${s.total} — ${badge}${lic}`);
    }
  }

  if (result.notes.length) {
    lines.push("", "Notes:");
    for (const n of result.notes) lines.push(`  • ${n}`);
  }

  return lines.join("\n");
}
