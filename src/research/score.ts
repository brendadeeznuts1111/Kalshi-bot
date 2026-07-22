import type { InspectionSignals, RepoCandidate, ResearchConfig, ScoreBreakdown } from "./types.ts";

const MS_PER_DAY = 86_400_000;

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
  const total = Math.max(0, Math.min(100, raw - licenseModifier));

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
  if (signals.hasAuthInCode) score += max * 0.35;
  if (signals.hasV2Api) score += max * 0.25;
  if (signals.hasRsaPss) score += max * 0.15;
  if (signals.usesOfficialSdk) score += max * 0.25;
  return Math.min(max, score);
}

function scoreOrderRealism(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.hasLiveOrderPath) score += max * 0.6;
  if (signals.hasDryRunDefault) score += max * 0.4;
  return Math.min(max, score);
}

function scoreTestsCi(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.hasTests) score += max * 0.6;
  if (signals.hasCi) score += max * 0.4;
  return Math.min(max, score);
}

function scoreDocs(signals: InspectionSignals, max: number): number {
  let score = 0;
  if (signals.readmeLength > 800) score += max * 0.4;
  if (signals.hasSetupSection) score += max * 0.35;
  if (signals.hasStrategySection) score += max * 0.25;
  return Math.min(max, score);
}

function scoreMaintenance(signals: InspectionSignals, max: number): number {
  if (!signals.lastDefaultBranchCommitAt) return max * 0.2;
  const ageDays = (Date.now() - new Date(signals.lastDefaultBranchCommitAt).getTime()) / MS_PER_DAY;
  if (ageDays <= 30) return max;
  if (ageDays <= 90) return max * 0.85;
  if (ageDays <= 180) return max * 0.65;
  if (ageDays <= 365) return max * 0.4;
  return max * 0.15;
}

function scoreRisk(signals: InspectionSignals, max: number): number {
  const hits = signals.riskKeywordHits.length;
  if (hits >= 3) return max;
  if (hits === 2) return max * 0.75;
  if (hits === 1) return max * 0.45;
  return 0;
}

function licenseAdjustment(repo: RepoCandidate, config: ResearchConfig): number {
  if (repo.license.unlicensed) return config.weights.license.unlicensedPenalty;
  if (repo.license.preferred) return 0;
  return 3;
}

export function stackRank(primaryLanguage: string | null): number {
  const lang = (primaryLanguage ?? "").toLowerCase();
  if (lang === "typescript" || lang === "javascript") return 3;
  if (lang === "python") return 2;
  if (lang === "rust" || lang === "go") return 1;
  return 0;
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
