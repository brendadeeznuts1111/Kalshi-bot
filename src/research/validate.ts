import { MAX_QUALITY_SCORE, SCORE_COMPONENTS } from "./constants.ts";
import type { DetectorResult, EvidenceLine, RepoReport, ScoreBreakdown } from "./types.ts";

const SCOPES = ["line", "file", "repo", "strategy"] as const;

export function isRepoReport(value: unknown): value is RepoReport {
  if (!value || typeof value !== "object") return false;
  const r = value as RepoReport;
  if (typeof r.fullName !== "string" || !r.fullName.includes("/")) return false;
  if (typeof r.generatedAt !== "string") return false;
  if (typeof r.liftNotes !== "string" || !r.liftNotes.length) return false;
  if (!Array.isArray(r.strategyTags) || !Array.isArray(r.detectors)) return false;
  if (!isScoreBreakdown(r.score)) return false;
  return r.detectors.every(isDetectorResult);
}

export function validateRepoReport(value: unknown): RepoReport {
  if (!isRepoReport(value)) {
    throw new Error("Invalid RepoReport: structural validation failed");
  }
  return value;
}

function isScoreBreakdown(s: ScoreBreakdown): boolean {
  if (!s || typeof s !== "object") return false;
  for (const k of SCORE_COMPONENTS) {
    if (typeof s[k] !== "number" || s[k] < 0) return false;
  }
  if (typeof s.licenseModifier !== "number" || typeof s.total !== "number") return false;
  if (s.total < 0 || s.total > MAX_QUALITY_SCORE) return false;
  return true;
}

function isDetectorResult(d: DetectorResult): boolean {
  if (!d || typeof d !== "object") return false;
  if (typeof d.id !== "string" || typeof d.rationale !== "string") return false;
  if (typeof d.matched !== "boolean") return false;
  if (!(SCORE_COMPONENTS as readonly string[]).includes(d.component)) return false;
  if (!(SCOPES as readonly string[]).includes(d.scope)) return false;
  if (typeof d.pointsContributed !== "number" || typeof d.maxPoints !== "number") return false;
  if (!Array.isArray(d.evidence)) return false;
  return d.evidence.every(isEvidenceLine);
}

function isEvidenceLine(e: EvidenceLine): boolean {
  if (!e || typeof e !== "object") return false;
  if (e.scope !== "line") return false;
  if (typeof e.query !== "string" || typeof e.path !== "string") return false;
  return ["authApi", "orderRealism", "feeAware", "riskControls", "strategy"].includes(e.component);
}
