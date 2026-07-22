// @see https://bun.com/docs/runtime/hashing#bun-hash
import {
  COMPONENT_WEIGHTS,
  DETECTOR_IDS,
  README_DOCS_MATCH_CHARS,
} from "./constants.ts";
import type {
  DetectorResult,
  EvidenceLine,
  RepoReport,
  ScoredRepo,
  ScoreComponent,
} from "./types.ts";

function evidenceFromHits(
  hits: ScoredRepo["signals"]["authHits"] | ScoredRepo["signals"]["orderHits"],
  component: EvidenceLine["component"],
): EvidenceLine[] {
  const lines: EvidenceLine[] = [];
  for (const hit of hits) {
    for (const path of hit.paths) {
      lines.push({ scope: "line", query: hit.query, path, component });
    }
  }
  return lines;
}

function detector(
  id: string,
  component: ScoreComponent,
  scope: DetectorResult["scope"],
  matched: boolean,
  pointsContributed: number,
  maxPoints: number,
  evidence: EvidenceLine[],
  rationale: string,
): DetectorResult {
  return { id, component, scope, matched, pointsContributed, maxPoints, evidence, rationale };
}

export function deriveLiftNotes(item: ScoredRepo): string {
  const s = item.signals;
  const parts: string[] = [];

  if (s.isSdkOnly) return "SDK-only wrapper — not liftable as a trading stack.";

  if (s.hasLiveOrderPath && s.hasAuthInCode) {
    parts.push("Auth + order paths present — candidate for lifting signing and execution modules separately.");
  } else if (s.hasAuthInCode) {
    parts.push("Auth path only — lift signing/client module; strategy likely coupled.");
  } else if (s.hasLiveOrderPath) {
    parts.push("Order path without strong auth signals — verify signing before reuse.");
  } else {
    parts.push("No live auth/order line evidence — treat as reference or paper-only.");
  }

  if (s.hasDryRunDefault) parts.push("Dry-run default detected — safe to sandbox.");
  if (s.hasTests && s.hasCi) parts.push("Tests + CI — lower integration risk when extracting.");
  if (!s.hasTests) parts.push("Missing test coverage on extracted paths.");

  return parts.join(" ");
}

export function buildDetectors(item: ScoredRepo): DetectorResult[] {
  const s = item.signals;
  const sc = item.score;
  const authEvidence = evidenceFromHits(s.authHits, "authApi");
  const orderEvidence = evidenceFromHits(s.orderHits, "orderRealism");

  return [
    detector(
      DETECTOR_IDS.authApi,
      "authApi",
      "line",
      s.hasAuthInCode || s.hasV2Api || s.usesOfficialSdk,
      sc.authApi,
      COMPONENT_WEIGHTS.authApi,
      authEvidence,
      [
        s.hasAuthInCode && "KALSHI access headers in code",
        s.hasV2Api && "trade-api/v2",
        s.hasRsaPss && "RSA-PSS signing",
        s.usesOfficialSdk && "official SDK markers",
      ]
        .filter(Boolean)
        .join("; ") || "no auth signals",
    ),
    detector(
      DETECTOR_IDS.orderRealism,
      "orderRealism",
      "line",
      s.hasLiveOrderPath || s.hasDryRunDefault,
      sc.orderRealism,
      COMPONENT_WEIGHTS.orderRealism,
      orderEvidence,
      [
        s.hasLiveOrderPath && "live order path markers",
        s.hasDryRunDefault && "dry-run / paper default",
      ]
        .filter(Boolean)
        .join("; ") || "no order signals",
    ),
    detector(
      DETECTOR_IDS.testsCi,
      "testsCi",
      "repo",
      s.hasTests || s.hasCi,
      sc.testsCi,
      COMPONENT_WEIGHTS.testsCi,
      [],
      [s.hasTests && "test tree", s.hasCi && "CI config"].filter(Boolean).join("; ") || "no test/ci",
    ),
    detector(
      DETECTOR_IDS.docsSetup,
      "docsSetup",
      "repo",
      s.hasSetupSection || s.readmeLength > README_DOCS_MATCH_CHARS,
      sc.docsSetup,
      COMPONENT_WEIGHTS.docsSetup,
      [],
      [s.hasSetupSection && "setup section", s.hasStrategySection && "strategy section"]
        .filter(Boolean)
        .join("; ") || "thin readme",
    ),
    detector(
      DETECTOR_IDS.maintenance,
      "maintenance",
      "repo",
      Boolean(s.lastDefaultBranchCommitAt),
      sc.maintenance,
      COMPONENT_WEIGHTS.maintenance,
      [],
      s.lastDefaultBranchCommitAt
        ? `last default-branch commit ${s.lastDefaultBranchCommitAt}`
        : "unknown commit cadence",
    ),
    detector(
      DETECTOR_IDS.riskControls,
      "riskControls",
      "strategy",
      s.riskKeywordHits.length > 0,
      sc.riskControls,
      COMPONENT_WEIGHTS.riskControls,
      s.riskKeywordHits.map((k) => ({
        scope: "line" as const,
        query: k,
        path: "(readme/code aggregate)",
        component: "riskControls" as const,
      })),
      s.riskKeywordHits.length ? s.riskKeywordHits.join(", ") : "no risk keywords",
    ),
  ];
}

export function buildRepoReport(item: ScoredRepo, generatedAt = new Date().toISOString()): RepoReport {
  return {
    fullName: item.repo.fullName,
    generatedAt,
    score: item.score,
    detectors: buildDetectors(item),
    liftNotes: deriveLiftNotes(item),
    strategyTags: item.signals.strategyTags,
  };
}

export function attachRepoReport(item: ScoredRepo, generatedAt?: string): ScoredRepo {
  return { ...item, report: buildRepoReport(item, generatedAt) };
}

/** Stable fingerprint for evidence lines — local cache/dedup only (not tamper-evident). */
export function evidenceFingerprint(lines: EvidenceLine[]): string {
  // Bun.hash is fast and fine for in-process dedup; audit export uses sha3-256 via audit-adapter.
  const payload = lines
    .map((l) => `${l.component}:${l.query}:${l.path}`)
    .sort()
    .join("\n");
  return String(Bun.hash(payload));
}
