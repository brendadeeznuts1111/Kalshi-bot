// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Calibration institution — scans alpha program manifests, tails shadow logs,
 * emits graduation / kill / baseline artifacts to calibration/artifacts/.
 */
import { joinPath } from "../research/paths.ts";
import type { ProgramManifest } from "../institutions/program-manifest.ts";
import { isBaselineProgram } from "../institutions/program-manifest.ts";
import {
  brierScore,
  brierStdErr,
  baselineBrierScore,
  readShadowLog,
  realizedEdgeMetrics,
  verifyHashChain,
  type ShadowLine,
} from "../institutions/shadow-line.ts";

export type CalibrationArtifactKind =
  | "graduation-proposal"
  | "kill-recommendation"
  | "baseline-report";

export type CalibrationArtifact = {
  kind: CalibrationArtifactKind;
  program: string;
  generatedAt: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  /** Human approval recorded separately — artifact is the proposal only. */
  status: "open";
};

export type ProgramMetrics = {
  totalLines: number;
  tradeLines: number;
  skipLines: number;
  skipReasons: Record<string, number>;
  resolvedLines: number;
  spanWeeks: number;
  hashChainValid: boolean;
  brier: number | null;
  brierStdErr: number | null;
  baselineBrier: number;
  empiricalBaselineBrier: number | null;
  toxicityMarked: number;
  toxicityAgainst: number;
  toxicityRate: number | null;
  partialFillCount: number;
  requestedContracts: number;
  filledContracts: number;
  fillCount: number;
  meanRealizedEdgeCentsPerFill: number | null;
};

const ROOT = joinPath(import.meta.dir, "../..");
export const CALIBRATION_ARTIFACTS_DIR = joinPath(ROOT, "calibration", "artifacts");

/** Sharp-consensus replication target (predicting 0.5 on fair coins yields exactly 0.25). */
export const DEFAULT_BASELINE_BRIER = 0.25;

/** True when watcher falls back to coin-flip placeholder — graduation must not fire. */
export function isStubBaseline(metrics: ProgramMetrics): boolean {
  return metrics.empiricalBaselineBrier == null;
}

export function graduationBlockedReason(
  manifest: ProgramManifest,
  metrics: ProgramMetrics,
): string | null {
  if (isBaselineProgram(manifest)) {
    return "baseline program — measuring stick, not a graduation candidate";
  }
  if (isStubBaseline(metrics)) {
    return "stub baseline active (0.25 placeholder) — empirical pinnacle-novig baseline required before graduation proposals";
  }
  return null;
}

export async function listAlphaPrograms(
  alphaRoot = joinPath(ROOT, "alpha"),
): Promise<Array<{ manifest: ProgramManifest; dir: string }>> {
  const glob = new Bun.Glob("*/program.json");
  const out: Array<{ manifest: ProgramManifest; dir: string }> = [];
  for await (const rel of glob.scan({ cwd: alphaRoot, onlyFiles: true })) {
    const dir = joinPath(alphaRoot, rel.replace(/\/program\.json$/, ""));
    const manifest = (await Bun.file(joinPath(alphaRoot, rel)).json()) as ProgramManifest;
    out.push({ manifest, dir });
  }
  return out;
}

export function computeMetrics(lines: ShadowLine[], baselineBrier = DEFAULT_BASELINE_BRIER): ProgramMetrics {
  const skipReasons: Record<string, number> = {};
  let tradeLines = 0;
  let skipLines = 0;
  let resolvedLines = 0;
  let toxicityMarked = 0;
  let toxicityAgainst = 0;
  let partialFillCount = 0;
  let requestedContracts = 0;
  let filledContracts = 0;

  for (const line of lines) {
    if (line.decision.action === "trade") tradeLines++;
    else {
      skipLines++;
      skipReasons[line.decision.reason] = (skipReasons[line.decision.reason] ?? 0) + 1;
    }
    if (line.outcome === 0 || line.outcome === 1) resolvedLines++;
    if (line.toxicity.markedTs != null) {
      toxicityMarked++;
      if (line.toxicity.movedAgainst) toxicityAgainst++;
    }
    if (line.decision.action === "trade") {
      const req = line.decision.contracts ?? 0;
      requestedContracts += req;
      filledContracts += line.filledContracts;
      if (req > 0 && line.filledContracts < req) partialFillCount++;
    }
  }

  const tsValues = lines.map((l) => l.ts).filter(Boolean);
  const spanMs =
    tsValues.length >= 2 ? Math.max(...tsValues) - Math.min(...tsValues) : 0;
  const spanWeeks = spanMs / (7 * 24 * 60 * 60 * 1000);
  const edge = realizedEdgeMetrics(lines);
  const empiricalBaselineBrier = baselineBrierScore(lines);
  const effectiveBaseline = empiricalBaselineBrier ?? baselineBrier;

  return {
    totalLines: lines.length,
    tradeLines,
    skipLines,
    skipReasons,
    resolvedLines,
    spanWeeks,
    hashChainValid: lines.length === 0 ? true : verifyHashChain(lines),
    brier: brierScore(lines),
    brierStdErr: brierStdErr(resolvedLines),
    baselineBrier: effectiveBaseline,
    empiricalBaselineBrier,
    toxicityMarked,
    toxicityAgainst,
    toxicityRate: toxicityMarked ? toxicityAgainst / toxicityMarked : null,
    partialFillCount,
    requestedContracts,
    filledContracts,
    fillCount: edge.fillCount,
    meanRealizedEdgeCentsPerFill: edge.meanRealizedEdgeCentsPerFill,
  };
}

export function evaluateProgram(
  manifest: ProgramManifest,
  metrics: ProgramMetrics,
): CalibrationArtifact[] {
  const artifacts: CalibrationArtifact[] = [];
  const at = new Date().toISOString();
  const gates = manifest.gates;

  artifacts.push({
    kind: "baseline-report",
    program: manifest.name,
    generatedAt: at,
    status: "open",
    evidence: {
      baseline: manifest.baseline,
      programStatus: manifest.status,
      metrics,
      note:
        metrics.brier == null
          ? "No resolved outcomes yet — Brier vs pinnacle-novig pending"
          : metrics.empiricalBaselineBrier != null
            ? `Program Brier ${metrics.brier.toFixed(4)} vs empirical pinnacle baseline ${metrics.empiricalBaselineBrier.toFixed(4)}`
            : `Program Brier ${metrics.brier.toFixed(4)} vs placeholder baseline ${metrics.baselineBrier}`,
      graduationBlocked: graduationBlockedReason(manifest, metrics),
    },
    recommendation:
      metrics.brier != null && metrics.brier >= metrics.baselineBrier
        ? "Replicates sharp consensus with extra steps — review cost vs incremental edge"
        : `Track vs ${manifest.baseline}; need resolved outcomes for Brier comparison`,
  });

  const spanAndChainMet =
    metrics.spanWeeks >= gates.shadowMinWeeks && metrics.hashChainValid;

  const brierSanity =
    metrics.brier != null &&
    metrics.resolvedLines >= gates.shadowMinSignals &&
    metrics.brier <= metrics.baselineBrier * (1 + gates.killBrierDriftPct / 100);

  const edgeGraduation =
    metrics.fillCount >= gates.graduationMinFills &&
    metrics.meanRealizedEdgeCentsPerFill != null &&
    metrics.meanRealizedEdgeCentsPerFill >= gates.graduationMinRealizedEdgeCentsPerFill;

  const gradBlock = graduationBlockedReason(manifest, metrics);

  if (
    manifest.status === "shadow" &&
    spanAndChainMet &&
    brierSanity &&
    edgeGraduation &&
    gradBlock == null
  ) {
    artifacts.push({
      kind: "graduation-proposal",
      program: manifest.name,
      generatedAt: at,
      status: "open",
      evidence: {
        metrics,
        gates,
        proposedStatus: "pilot",
        graduationDriver: "realized-edge-cents-after-fees",
        brierRole: "calibration-sanity-check",
      },
      recommendation:
        `Graduate to pilot — mean realized edge ${metrics.meanRealizedEdgeCentsPerFill!.toFixed(2)}c/contract after fees ` +
        `(${metrics.fillCount} fills), Brier ${metrics.brier!.toFixed(4)} within sanity band`,
    });
  }

  if (
    metrics.brier != null &&
    metrics.resolvedLines >= gates.shadowMinSignals &&
    metrics.brier > metrics.baselineBrier * (1 + gates.killBrierDriftPct / 100)
  ) {
    artifacts.push({
      kind: "kill-recommendation",
      program: manifest.name,
      generatedAt: at,
      status: "open",
      evidence: {
        metrics,
        killThresholdPct: gates.killBrierDriftPct,
        preCommittedAt: manifest.created,
      },
      recommendation: `Kill ${manifest.name} — Brier ${metrics.brier.toFixed(4)} exceeds pre-committed ${gates.killBrierDriftPct}% drift vs baseline ${metrics.baselineBrier}`,
    });
  }

  return artifacts;
}

export async function scanProgramsForArtifacts(
  alphaRoot = joinPath(ROOT, "alpha"),
): Promise<CalibrationArtifact[]> {
  const programs = await listAlphaPrograms(alphaRoot);
  const all: CalibrationArtifact[] = [];
  for (const { manifest, dir } of programs) {
    const logPath = joinPath(dir, manifest.shadowLog);
    const lines = await readShadowLog(logPath);
    const metrics = computeMetrics(lines);
    all.push(...evaluateProgram(manifest, metrics));
  }
  return all;
}

export async function writeCalibrationArtifacts(
  artifacts: CalibrationArtifact[],
  outDir = CALIBRATION_ARTIFACTS_DIR,
): Promise<string> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = joinPath(outDir, runId);
  await Bun.write(joinPath(dir, "manifest.json"), JSON.stringify({ runId, count: artifacts.length }, null, 2));
  for (const artifact of artifacts) {
    const name = `${artifact.program}-${artifact.kind}.json`;
    await Bun.write(joinPath(dir, name), JSON.stringify(artifact, null, 2) + "\n");
  }
  await Bun.write(joinPath(outDir, "latest-run.json"), JSON.stringify({ runId, dir, at: new Date().toISOString() }, null, 2));
  return dir;
}
