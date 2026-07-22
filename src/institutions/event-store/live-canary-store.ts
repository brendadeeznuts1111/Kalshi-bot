// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/hashing#bun-hash
/**
 * Persist tennis live canary runs under research/cache (gitignored).
 * Agent tennis grounds here without re-hitting Kalshi.
 */
import { CACHE_DIR, joinPath } from "../../research/paths.ts";
import type { KalshiEventTicker } from "./brands.ts";
import { parseKalshiEventTickersWire, unbrand } from "./brands.ts";
import type { LiveCanaryVerdict, LivePollSummary } from "./live-scores.ts";

export const TENNIS_CANARY_DIR = joinPath(CACHE_DIR, "tennis-canary");
export const TENNIS_CANARY_LATEST = joinPath(TENNIS_CANARY_DIR, "latest.json");
export const TENNIS_CANARY_HISTORY = joinPath(TENNIS_CANARY_DIR, "history.jsonl");

export type TennisCanaryArtifact = {
  at: string;
  /** 0 pass, 2 fail */
  exitCode: number;
  /** Bun.hash of compact verdict + counts — drift across fires is visible. */
  fingerprint: string;
  durationMs: number;
  dryRun: true;
  summary: {
    watched: number;
    polled: number;
    upserted: number;
    snapshotsAppended: number;
    live: number;
    milestoneMissing: number;
    wouldRetire: number;
    errors: number;
    wireMissingRows: number;
  };
  reasons: string[];
  warnings: string[];
  liveTickers: KalshiEventTicker[];
};

function compactFingerprint(input: {
  exitCode: number;
  summary: TennisCanaryArtifact["summary"];
  reasons: string[];
}): string {
  // Fast local fingerprint (not tamper-evident) — same class as evidence Bun.hash.
  return String(
    Bun.hash(
      JSON.stringify({
        e: input.exitCode,
        s: input.summary,
        r: input.reasons.slice(0, 5),
      }),
    ),
  );
}

export function buildCanaryArtifact(input: {
  summary: LivePollSummary;
  verdict: LiveCanaryVerdict;
  durationMs: number;
  liveTickers?: KalshiEventTicker[];
  at?: string;
}): TennisCanaryArtifact {
  const wireMissingRows = input.summary.rows.filter((r) => r.missingDetailKeys.length > 0)
    .length;
  const summary = {
    watched: input.summary.watched,
    polled: input.summary.polled,
    upserted: input.summary.upserted,
    snapshotsAppended: input.summary.snapshotsAppended,
    live: input.summary.live,
    milestoneMissing: input.summary.milestoneMissing,
    wouldRetire: input.summary.wouldRetire,
    errors: input.summary.errors.length,
    wireMissingRows,
  };
  const exitCode = input.verdict.exitCode;
  const liveTickers =
    input.liveTickers ?? input.summary.rows.filter((r) => r.isLive).map((r) => r.eventTicker);
  return {
    at: input.at ?? new Date().toISOString(),
    exitCode,
    fingerprint: compactFingerprint({
      exitCode,
      summary,
      reasons: input.verdict.reasons,
    }),
    durationMs: input.durationMs,
    dryRun: true,
    summary,
    reasons: input.verdict.reasons,
    warnings: input.verdict.warnings,
    liveTickers,
  };
}

function parseCanaryArtifactWire(raw: unknown): TennisCanaryArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "string" || typeof o.exitCode !== "number") return null;
  return {
    ...(o as Omit<TennisCanaryArtifact, "liveTickers">),
    liveTickers: parseKalshiEventTickersWire(o.liveTickers),
  };
}

export async function ensureCanaryDir(): Promise<void> {
  await Bun.write(joinPath(TENNIS_CANARY_DIR, ".gitkeep"), "");
}

/** Write latest.json + append history.jsonl. Returns latest path. */
export async function writeCanaryArtifact(art: TennisCanaryArtifact): Promise<string> {
  await ensureCanaryDir();
  const body = JSON.stringify(
    {
      ...art,
      liveTickers: art.liveTickers.map((t) => unbrand(t)),
    },
    null,
    2,
  );
  await Bun.write(TENNIS_CANARY_LATEST, body);
  const line = `${JSON.stringify({ ...art, liveTickers: art.liveTickers.map((t) => unbrand(t)) })}\n`;
  const hist = Bun.file(TENNIS_CANARY_HISTORY);
  const prev = (await hist.exists()) ? await hist.text() : "";
  await Bun.write(TENNIS_CANARY_HISTORY, prev + line);
  return TENNIS_CANARY_LATEST;
}

export async function loadLatestCanary(
  latestPath: string = TENNIS_CANARY_LATEST,
): Promise<TennisCanaryArtifact | null> {
  const file = Bun.file(latestPath);
  if (!(await file.exists())) return null;
  try {
    return parseCanaryArtifactWire(await file.json());
  } catch {
    return null;
  }
}

/** Last N history lines (newest last). */
export async function loadCanaryHistory(limit = 20): Promise<TennisCanaryArtifact[]> {
  const file = Bun.file(TENNIS_CANARY_HISTORY);
  if (!(await file.exists())) return [];
  const text = await file.text();
  const lines = text.split("\n").filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  const out: TennisCanaryArtifact[] = [];
  for (const line of slice) {
    try {
      const parsed = parseCanaryArtifactWire(JSON.parse(line));
      if (parsed) out.push(parsed);
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}
