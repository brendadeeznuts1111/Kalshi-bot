import type { InspectionSignals, RepoCandidate, ResearchConfig, ScoreBreakdown } from "./types.ts";
import {
  AUTH_SCORE_SHARES,
  DOCS_SCORE_SHARES,
  LICENSE_WEIGHTS,
  MAINTENANCE_AGE_DAYS,
  MAINTENANCE_SCORE_SHARES,
  MAX_QUALITY_SCORE,
  MS_PER_DAY,
  ORDER_SCORE_SHARES,
  README_SCORE_LONG_CHARS,
  RISK_HIT_FULL,
  RISK_SCORE_SHARES,
  STACK_RANK,
  TESTS_CI_SCORE_SHARES,
} from "./constants.ts";

export function scoreRepo(
  repo: RepoCandidate,
  signals: InspectionSignals,
  config: ResearchConfig,
): ScoreBreakdown {
  const w = config.weights.components;

  const authApi = scoreAuthApi(signals, w.authApi);
  const orderRealism = scoreOrderRealism(signals, w.orderRealism);
  const testsCi = scoreTestsCi(signals, w.testsCi);
  const docsSetup = scoreDocs(signals, w.docsSetup);
  const maintenance = scoreMaintenance(signals, w.maintenance);
  const riskControls = scoreRisk(signals, w.riskControls);

  const raw = authApi + orderRealism + testsCi + docsSetup + maintenance + riskControls;
  const licenseModifier = licenseAdjustment(repo, config);
  const total = Math.max(0, Math.min(MAX_QUALITY_SCORE, raw - licenseModifier));

  return {
    authApi,
    orderRealism,
    testsCi,
    docsSetup,
    maintenance,
    riskControls,
    licenseModifier,
    total,
  };
}

function scoreAuthApi(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.hasAuthInCode) score += max * AUTH_SCORE_SHARES.authInCode;
  if (signals.hasV2Api) score += max * AUTH_SCORE_SHARES.v2Api;
  if (signals.hasRsaPss) score += max * AUTH_SCORE_SHARES.rsaPss;
  if (signals.usesOfficialSdk) score += max * AUTH_SCORE_SHARES.officialSdk;
  if (signals.hasAuthFreshness) score += max * AUTH_SCORE_SHARES.authFreshness;
  return Math.min(max, score);
}

function scoreOrderRealism(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.hasLiveOrderPath) score += max * ORDER_SCORE_SHARES.liveOrderPath;
  if (signals.hasDryRunDefault) score += max * ORDER_SCORE_SHARES.dryRunDefault;
  if (signals.hasCentsPriceBounds) score += max * ORDER_SCORE_SHARES.centsBounds;
  if (signals.hasFeeAware) score += max * ORDER_SCORE_SHARES.feeAware;
  return Math.min(max, score);
}

function scoreTestsCi(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.hasTests) score += max * TESTS_CI_SCORE_SHARES.tests;
  if (signals.hasCi) score += max * TESTS_CI_SCORE_SHARES.ci;
  return Math.min(max, score);
}

function scoreDocs(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.readmeLength > README_SCORE_LONG_CHARS) score += max * DOCS_SCORE_SHARES.longReadme;
  if (signals.hasSetupSection) score += max * DOCS_SCORE_SHARES.setupSection;
  if (signals.hasStrategySection) score += max * DOCS_SCORE_SHARES.strategySection;
  return Math.min(max, score);
}

function scoreMaintenance(signals: InspectionSignals, max: number): number {
  if (!signals.lastDefaultBranchCommitAt) return max * MAINTENANCE_SCORE_SHARES.unknown;
  const ageDays =
    (Date.now() - new Date(signals.lastDefaultBranchCommitAt).getTime()) / MS_PER_DAY;
  if (ageDays <= MAINTENANCE_AGE_DAYS.fresh) return max * MAINTENANCE_SCORE_SHARES.fresh;
  if (ageDays <= MAINTENANCE_AGE_DAYS.recent) return max * MAINTENANCE_SCORE_SHARES.recent;
  if (ageDays <= MAINTENANCE_AGE_DAYS.medium) return max * MAINTENANCE_SCORE_SHARES.medium;
  if (ageDays <= MAINTENANCE_AGE_DAYS.year) return max * MAINTENANCE_SCORE_SHARES.year;
  return max * MAINTENANCE_SCORE_SHARES.stale;
}

function scoreRisk(signals: InspectionSignals, max: number): number {
  const hits = signals.riskKeywordHits.length;
  if (hits >= RISK_HIT_FULL) return max;
  if (hits === 2) return max * RISK_SCORE_SHARES.twoHits;
  if (hits === 1) return max * RISK_SCORE_SHARES.oneHit;
  return 0;
}

function licenseAdjustment(repo: RepoCandidate, config: ResearchConfig): number {
  if (repo.license.unlicensed) return config.weights.license.unlicensedPenalty;
  if (repo.license.preferred) return 0;
  return LICENSE_WEIGHTS.nonPreferredPenalty;
}

export function stackRank(primaryLanguage: string | null): number {
  const lang = (primaryLanguage ?? "").toLowerCase();
  if (lang === "typescript") return STACK_RANK.typescript;
  if (lang === "javascript") return STACK_RANK.javascript;
  if (lang === "python") return STACK_RANK.python;
  if (lang === "rust") return STACK_RANK.rust;
  if (lang === "go") return STACK_RANK.go;
  return STACK_RANK.other;
}

export function compareScored(
  a: { score: ScoreBreakdown; signals: InspectionSignals; repo: RepoCandidate },
  b: { score: ScoreBreakdown; signals: InspectionSignals; repo: RepoCandidate },
  threshold: number,
): number {
  const delta = b.score.total - a.score.total;
  if (Math.abs(delta) > threshold) return delta;
  const stackDelta = stackRank(b.signals.primaryLanguage) - stackRank(a.signals.primaryLanguage);
  if (stackDelta !== 0) return stackDelta;
  if (a.repo.license.preferred !== b.repo.license.preferred) {
    return a.repo.license.preferred ? -1 : 1;
  }
  return b.repo.stars - a.repo.stars;
}
