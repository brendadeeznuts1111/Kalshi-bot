// @see https://bun.com/docs/runtime/hashing#bun-hash
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
      "auth-api",
      "authApi",
      "line",
      s.hasAuthInCode || s.hasV2Api || s.usesOfficialSdk,
      sc.authApi,
      25,
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
      "order-realism",
      "orderRealism",
      "line",
      s.hasLiveOrderPath || s.hasDryRunDefault,
      sc.orderRealism,
      25,
      orderEvidence,
      [
        s.hasLiveOrderPath && "live order path markers",
        s.hasDryRunDefault && "dry-run / paper default",
      ]
        .filter(Boolean)
        .join("; ") || "no order signals",
    ),
    detector(
      "tests-ci",
      "testsCi",
      "repo",
      s.hasTests || s.hasCi,
      sc.testsCi,
      15,
      [],
      [s.hasTests && "test tree", s.hasCi && "CI config"].filter(Boolean).join("; ") || "no test/ci",
    ),
    detector(
      "docs-setup",
      "docsSetup",
      "repo",
      s.hasSetupSection || s.readmeLength > 500,
      sc.docsSetup,
      15,
      [],
      [s.hasSetupSection && "setup section", s.hasStrategySection && "strategy section"]
        .filter(Boolean)
        .join("; ") || "thin readme",
    ),
    detector(
      "maintenance",
      "maintenance",
      "repo",
      Boolean(s.lastDefaultBranchCommitAt),
      sc.maintenance,
      10,
      [],
      s.lastDefaultBranchCommitAt
        ? `last default-branch commit ${s.lastDefaultBranchCommitAt}`
        : "unknown commit cadence",
    ),
    detector(
      "risk-controls",
      "riskControls",
      "strategy",
      s.riskKeywordHits.length > 0,
      sc.riskControls,
      10,
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

/** Stable fingerprint for evidence lines (local cache; audit uses sha3 via audit-adapter). */
export function evidenceFingerprint(lines: EvidenceLine[]): string {
  const payload = lines
    .map((l) => `${l.component}:${l.query}:${l.path}`)
    .sort()
    .join("\n");
  return String(Bun.hash(payload));
}
