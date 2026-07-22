// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/hashing#bun-hash
/**
 * Persist tennis Kalshi WS recorder session summaries (cache-only ground).
 * Mirrors live-canary-store: latest.json + history.jsonl.
 */
import { joinPath } from "../../research/paths.ts";
import type { WsRecorderSummary } from "./kalshi-ws-recorder.ts";

export const TENNIS_WS_RECORDER_DIR = joinPath("research/cache/tennis-ws-recorder");
export const TENNIS_WS_RECORDER_LATEST = joinPath(TENNIS_WS_RECORDER_DIR, "latest.json");
export const TENNIS_WS_RECORDER_HISTORY = joinPath(TENNIS_WS_RECORDER_DIR, "history.jsonl");

export type TennisWsRecorderSessionArtifact = WsRecorderSummary & {
  at: string;
  durationMs: number;
  subscribedTickers: number;
  /** Bun.hash of session counters — drift across runs is visible. */
  fingerprint: string;
};

function sessionFingerprint(summary: WsRecorderSummary): string {
  return String(
    Bun.hash(
      JSON.stringify({
        t: summary.ticksRecorded,
        s: summary.snapshots,
        d: summary.deltas,
        g: summary.seqGaps,
        r: summary.resyncRequests,
        e: summary.errors,
      }),
    ),
  );
}

export async function ensureTennisWsRecorderDir(): Promise<void> {
  await Bun.write(joinPath(TENNIS_WS_RECORDER_DIR, ".gitkeep"), "");
}

/** Write latest.json + append history.jsonl. */
export async function persistTennisWsRecorderSession(
  summary: WsRecorderSummary,
  meta: { durationMs: number; subscribedTickers: number; at?: string },
  paths: { latest?: string; history?: string } = {},
): Promise<TennisWsRecorderSessionArtifact> {
  await ensureTennisWsRecorderDir();
  const latestPath = paths.latest ?? TENNIS_WS_RECORDER_LATEST;
  const historyPath = paths.history ?? TENNIS_WS_RECORDER_HISTORY;

  const artifact: TennisWsRecorderSessionArtifact = {
    at: meta.at ?? new Date().toISOString(),
    durationMs: meta.durationMs,
    subscribedTickers: meta.subscribedTickers,
    fingerprint: sessionFingerprint(summary),
    ...summary,
  };

  await Bun.write(latestPath, JSON.stringify(artifact, null, 2));
  const hist = Bun.file(historyPath);
  const prev = (await hist.exists()) ? await hist.text() : "";
  await Bun.write(historyPath, prev + `${JSON.stringify(artifact)}\n`);
  return artifact;
}

export async function loadLatestTennisWsRecorderSession(
  latestPath: string = TENNIS_WS_RECORDER_LATEST,
): Promise<TennisWsRecorderSessionArtifact | null> {
  const file = Bun.file(latestPath);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as TennisWsRecorderSessionArtifact;
  } catch {
    return null;
  }
}

/** Last N sessions (newest last). */
export async function loadTennisWsRecorderHistory(
  limit = 20,
  historyPath: string = TENNIS_WS_RECORDER_HISTORY,
): Promise<TennisWsRecorderSessionArtifact[]> {
  const file = Bun.file(historyPath);
  if (!(await file.exists())) return [];
  const lines = (await file.text()).split("\n").filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  const out: TennisWsRecorderSessionArtifact[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as TennisWsRecorderSessionArtifact);
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

export type TennisWsRecorderTrend = {
  sessions: number;
  totalGaps: number;
  totalDeltas: number;
  totalResyncs: number;
  /** Share of sessions with seqGaps > 0. */
  gapSessionPct: number | null;
};

export function summarizeTennisWsRecorderTrend(
  sessions: readonly TennisWsRecorderSessionArtifact[],
): TennisWsRecorderTrend {
  if (sessions.length === 0) {
    return {
      sessions: 0,
      totalGaps: 0,
      totalDeltas: 0,
      totalResyncs: 0,
      gapSessionPct: null,
    };
  }
  let totalGaps = 0;
  let totalDeltas = 0;
  let totalResyncs = 0;
  let gapSessions = 0;
  for (const s of sessions) {
    totalGaps += s.seqGaps;
    totalDeltas += s.deltas;
    totalResyncs += s.resyncRequests;
    if (s.seqGaps > 0) gapSessions++;
  }
  return {
    sessions: sessions.length,
    totalGaps,
    totalDeltas,
    totalResyncs,
    gapSessionPct: Math.round((1000 * gapSessions) / sessions.length) / 10,
  };
}
