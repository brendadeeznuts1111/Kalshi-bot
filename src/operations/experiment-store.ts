// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/hashing#bun-hash
import { CACHE_DIR, joinPath } from "../research/paths.ts";
import type { FactorialResult } from "./factorial.ts";
import type { ExperimentStatus } from "./experiment-runner.ts";

export const TENNIS_EXPERIMENTS_DIR = joinPath(CACHE_DIR, "tennis-experiments");
export const TENNIS_EXPERIMENTS_LATEST = joinPath(TENNIS_EXPERIMENTS_DIR, "latest.json");
export const TENNIS_EXPERIMENTS_HISTORY = joinPath(TENNIS_EXPERIMENTS_DIR, "history.jsonl");

export type ExperimentSessionArtifact = FactorialResult & {
  experimentId: string;
  at: string;
  status: ExperimentStatus;
  reason?: string | undefined;
  fingerprint: string;
};

function sessionFingerprint(result: FactorialResult, status: string): string {
  return String(
    Bun.hash(
      JSON.stringify({
        e: result.experimentId,
        n: result.totalObservations,
        g: result.grandMean,
        r2: result.rSquared,
        s: status,
      }),
    ),
  );
}

export async function ensureExperimentsArtifactDir(): Promise<void> {
  await Bun.write(joinPath(TENNIS_EXPERIMENTS_DIR, ".gitkeep"), "");
}

export async function persistExperimentSession(
  experimentId: string,
  result: FactorialResult,
  meta: { status: ExperimentStatus; reason?: string; at?: string },
  paths: { latest?: string; history?: string } = {},
): Promise<ExperimentSessionArtifact> {
  await ensureExperimentsArtifactDir();
  const latestPath = paths.latest ?? TENNIS_EXPERIMENTS_LATEST;
  const historyPath = paths.history ?? TENNIS_EXPERIMENTS_HISTORY;

  const artifact: ExperimentSessionArtifact = {
    ...result,
    experimentId,
    at: meta.at ?? new Date().toISOString(),
    status: meta.status,
    reason: meta.reason,
    fingerprint: sessionFingerprint(result, meta.status),
  };

  await Bun.write(latestPath, JSON.stringify(artifact, null, 2));
  const hist = Bun.file(historyPath);
  const prev = (await hist.exists()) ? await hist.text() : "";
  await Bun.write(historyPath, prev + `${JSON.stringify(artifact)}\n`);
  return artifact;
}

export async function loadLatestExperimentSession(
  latestPath: string = TENNIS_EXPERIMENTS_LATEST,
): Promise<ExperimentSessionArtifact | null> {
  const file = Bun.file(latestPath);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as ExperimentSessionArtifact;
  } catch {
    return null;
  }
}
