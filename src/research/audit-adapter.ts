// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher
// @see https://bun.com/blog/bun-v1.3.13#sha3-support-in-webcrypto-and-node-crypto
/**
 * Wire shapes for monorepo audit SSOT ingestion (option 1).
 * Parse with lib/audit/parseAuditFinding at the monorepo boundary — not imported here.
 */
import type { EvidenceLine, RepoReport, ResearchConfig, ResearchRun } from "./types.ts";
import { buildRepoReport } from "./evidence.ts";
import { validateRepoReport } from "./validate.ts";
import { auditEvidenceRelPath } from "./paths.ts";
import {
  AUDIT_CONCEPT_SHORTLIST_ID,
  AUDIT_EVIDENCE_RELATED_DOC,
  AUDIT_RELATED_CONCEPT_IDS,
  DETECTOR_IDS,
  HIGH_VALUE_MIN_COMPONENT_POINTS,
  HIGH_VALUE_MIN_TOTAL_SCORE,
  MAX_QUALITY_SCORE,
  WATCHLIST_MIN_COMPONENT_POINTS,
  WATCHLIST_MIN_TOTAL_SCORE,
} from "./constants.ts";

export type AuditExportTier = "high-value" | "watchlist";

/** AuditFinding-compatible wire (ids are opaque until monorepo parse*). */
export type AuditFindingWire = {
  id: string;
  kind: "AuditFinding";
  title: string;
  description: string;
  status: "confirmed" | "open" | "mitigated";
  publishedAt: string;
  discoveredIn?: string;
  evidence: AuditEvidenceWire;
  related?: string[];
  relatedDocs?: string[];
  meta?: { buildPin?: string; emitter?: string; tier?: AuditExportTier };
};

export type AuditEvidenceWire = {
  path: string;
  algorithm: "sha3-256";
  digest: string;
  mediaType: string;
};

export type AuditConceptWire = {
  id: string;
  kind: "AuditConcept";
  title: string;
  description: string;
  publishedAt: string;
  related?: string[];
  relatedDocs?: string[];
  meta?: { buildPin?: string; emitter?: string };
};

export type AuditFindingBundle = {
  finding: AuditFindingWire;
  repoReport: RepoReport;
  evidenceNdjson: string;
};

export type AuditRunExport = {
  runId: string;
  generatedAt: string;
  concept: AuditConceptWire;
  bundles: AuditFindingBundle[];
};

const EMITTER = "kalshi-bot-research";
const BUILD_PIN = "0.2.0";

export function sha3Hex(payload: string): string {
  const hasher = new Bun.CryptoHasher("sha3-256");
  hasher.update(payload);
  return hasher.digest("hex");
}

export function evidenceNdjson(report: RepoReport): string {
  const lines = report.detectors.flatMap((d) => d.evidence);
  if (!lines.length) return "";
  return lines.map((e) => JSON.stringify(e)).join("\n");
}

/** Exact bytes written to the evidence NDJSON file (includes trailing newline when non-empty). */
export function evidenceFileBody(ndjson: string): string {
  return ndjson ? `${ndjson}\n` : "";
}

export function digestEvidenceBody(body: string): string {
  return sha3Hex(body);
}

export function evidenceExportPath(_runId: string, fullName: string): string {
  return auditEvidenceRelPath(fullName);
}

/**
 * Returns whether a repo report meets audit promotion thresholds
 * ({@link HIGH_VALUE_MIN_TOTAL_SCORE} total, auth + order detectors matched
 * with {@link HIGH_VALUE_MIN_COMPONENT_POINTS} each).
 *
 * @param report - Validated or buildable per-repo SSOT
 * @returns `true` when the report should export as an AuditFinding candidate
 */
export function isHighValueCandidate(report: RepoReport): boolean {
  const auth = report.detectors.find((d) => d.id === DETECTOR_IDS.authApi);
  const orders = report.detectors.find((d) => d.id === DETECTOR_IDS.orderRealism);
  return (
    report.score.total >= HIGH_VALUE_MIN_TOTAL_SCORE &&
    (auth?.matched ?? false) &&
    (orders?.matched ?? false) &&
    (auth?.pointsContributed ?? 0) >= HIGH_VALUE_MIN_COMPONENT_POINTS &&
    (orders?.pointsContributed ?? 0) >= HIGH_VALUE_MIN_COMPONENT_POINTS
  );
}

function authOrderDetectorPoints(report: RepoReport): {
  authMatched: boolean;
  orderMatched: boolean;
  authPoints: number;
  orderPoints: number;
} {
  const auth = report.detectors.find((d) => d.id === DETECTOR_IDS.authApi);
  const orders = report.detectors.find((d) => d.id === DETECTOR_IDS.orderRealism);
  return {
    authMatched: auth?.matched ?? false,
    orderMatched: orders?.matched ?? false,
    authPoints: auth?.pointsContributed ?? 0,
    orderPoints: orders?.pointsContributed ?? 0,
  };
}

/**
 * Watchlist tier: below high-value bar but still auditable (≥65 total, auth+order ≥12 each).
 * Mutually exclusive with {@link isHighValueCandidate}.
 */
export function isWatchlistCandidate(report: RepoReport): boolean {
  if (isHighValueCandidate(report)) return false;
  const { authMatched, orderMatched, authPoints, orderPoints } = authOrderDetectorPoints(report);
  return (
    report.score.total >= WATCHLIST_MIN_TOTAL_SCORE &&
    authMatched &&
    orderMatched &&
    authPoints >= WATCHLIST_MIN_COMPONENT_POINTS &&
    orderPoints >= WATCHLIST_MIN_COMPONENT_POINTS
  );
}

/** Highest export tier for this report, or null when not auditable. */
export function resolveAuditExportTier(report: RepoReport): AuditExportTier | null {
  if (isHighValueCandidate(report)) return "high-value";
  if (isWatchlistCandidate(report)) return "watchlist";
  return null;
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

function findingId(fullName: string): string {
  return `kalshi-repo-${fullName.replace("/", "-").toLowerCase()}`;
}

export function shortlistRulesConcept(config: ResearchConfig, publishedAt: string): AuditConceptWire {
  const majors = config.keywords.majorStrategyTags.join(", ");
  return {
    id: AUDIT_CONCEPT_SHORTLIST_ID,
    kind: "AuditConcept",
    title: "Kalshi bot shortlist diversity constraints",
    description: [
      `Portfolio selection over scored repos: size ${config.weights.shortlistSize},`,
      `max ${config.weights.maxPerTag} per strategy tag,`,
      `min 1 per major tag (${majors}),`,
      `TS/JS tiebreak within ${config.weights.stackTiebreakThreshold} points.`,
      "Operates above single-repo RepoReport — see docs/FACTOR_STACK.md shortlist scope.",
    ].join(" "),
    publishedAt: isoDate(publishedAt),
    related: ["sha3-integrity"],
    relatedDocs: [AUDIT_EVIDENCE_RELATED_DOC],
    meta: { emitter: EMITTER, buildPin: BUILD_PIN },
  };
}

/**
 * Maps a {@link RepoReport} to monorepo `AuditFinding` wire JSON (parse at boundary
 * with `parseAuditFinding`). Evidence path points at committed JSONL; digest is sha3-256.
 *
 * @param report - Per-repo SSOT from `buildRepoReport`
 * @param runId - Research run id stored in `discoveredIn`
 * @param options.status - Finding status (default `"open"`)
 * @returns AuditFinding-compatible wire object (opaque string ids until monorepo parse)
 */
export function repoReportToAuditFindingWire(
  report: RepoReport,
  runId: string,
  options?: { status?: AuditFindingWire["status"]; tier?: AuditExportTier },
): AuditFindingWire {
  validateRepoReport(report);
  const tier = options?.tier ?? resolveAuditExportTier(report) ?? "watchlist";
  const ndjson = evidenceNdjson(report);
  const body = evidenceFileBody(ndjson);
  const digest = digestEvidenceBody(body);
  const path = evidenceExportPath(runId, report.fullName);
  const tierNote =
    tier === "watchlist"
      ? " Watchlist tier — below high-value export threshold; verify before lift."
      : "";

  return {
    id: findingId(report.fullName),
    kind: "AuditFinding",
    title: `Kalshi bot candidate: ${report.fullName}`,
    description: [
      `Quality score ${report.score.total}/${MAX_QUALITY_SCORE}.`,
      `Strategy: ${report.strategyTags.join(", ") || "none"}.`,
      report.liftNotes,
      tierNote,
    ]
      .join(" ")
      .trim(),
    status: options?.status ?? "open",
    publishedAt: isoDate(report.generatedAt),
    discoveredIn: runId,
    evidence: {
      path,
      algorithm: "sha3-256",
      digest,
      mediaType: "application/jsonl",
    },
    related: [...AUDIT_RELATED_CONCEPT_IDS],
    relatedDocs: [AUDIT_EVIDENCE_RELATED_DOC],
    meta: { emitter: EMITTER, buildPin: BUILD_PIN, tier },
  };
}

/** sha3-256 fingerprint for audit export (Phase 2 path; local cache keeps Bun.hash). */
export function evidenceSha3Fingerprint(lines: EvidenceLine[]): string {
  const payload = lines
    .map((l) => `${l.component}:${l.query}:${l.path}`)
    .sort()
    .join("\n");
  return sha3Hex(payload);
}

/** Alias for {@link repoReportToAuditFindingWire} — RepoReport → AuditFinding wire. */
export const adaptToAuditFinding = repoReportToAuditFindingWire;

export function buildAuditRunExport(
  run: ResearchRun,
  config: ResearchConfig,
  options?: { repo?: string },
): AuditRunExport {
  const concept = shortlistRulesConcept(config, run.generatedAt);
  const bundles: AuditFindingBundle[] = [];
  const repoFilter = options?.repo?.trim().toLowerCase();

  for (const item of run.shortlist) {
    if (repoFilter && item.repo.fullName.toLowerCase() !== repoFilter) continue;
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    const tier = resolveAuditExportTier(report);
    if (!tier) continue;
    const ndjson = evidenceNdjson(report);
    bundles.push({
      finding: repoReportToAuditFindingWire(report, run.runId, { tier, status: "open" }),
      repoReport: report,
      evidenceNdjson: ndjson,
    });
  }

  return { runId: run.runId, generatedAt: run.generatedAt, concept, bundles };
}
