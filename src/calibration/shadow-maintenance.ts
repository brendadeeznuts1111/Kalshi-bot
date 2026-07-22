// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Shadow log maintenance — toxicity marking + outcome resolution.
 * Rewrites JSONL with recomputed hash chain after edits.
 */
import { fetchKalshiBookSnapshot, midFromBookSnapshot } from "../bot/kalshi-market-data.ts";
import type { FetchKalshiBookOptions } from "../bot/kalshi-market-data.ts";
import { joinPath } from "../research/paths.ts";
import { loadProgramManifest } from "../institutions/program-manifest.ts";
import {
  markDueToxicity,
  applyOutcomes,
  readShadowLog,
  writeShadowLog,
  verifyHashChain,
  recomputeHashChain,
  type ShadowLine,
} from "../institutions/shadow-line.ts";

const ROOT = joinPath(import.meta.dir, "../..");

export type ProgramShadowPaths = {
  manifest: Awaited<ReturnType<typeof loadProgramManifest>>;
  dir: string;
  logPath: string;
};

export async function resolveProgramShadow(
  programName: string,
  alphaRoot = joinPath(ROOT, "alpha"),
): Promise<ProgramShadowPaths> {
  const dir = joinPath(alphaRoot, programName);
  const manifestPath = joinPath(dir, "program.json");
  const manifest = await loadProgramManifest(manifestPath);
  const logPath = joinPath(dir, manifest.shadowLog);
  return { manifest, dir, logPath };
}

/** Parse CLI mids: --mid=TICKER:52 or repeated --mid=... */
export function parseMidArgs(argv: string[]): Record<string, number> {
  const mids: Record<string, number> = {};
  for (const a of argv) {
    if (!a.startsWith("--mid=")) continue;
    const raw = a.slice("--mid=".length);
    const colon = raw.lastIndexOf(":");
    if (colon <= 0) continue;
    const ticker = raw.slice(0, colon);
    const cents = Number(raw.slice(colon + 1));
    if (Number.isFinite(cents)) mids[ticker] = cents;
  }
  return mids;
}

export async function runToxicityMark(
  programName: string,
  midByTicker: Record<string, number>,
  options?: { now?: number; forceDue?: boolean; alphaRoot?: string },
): Promise<{ marked: number; pending: number; chainValid: boolean }> {
  const now = options?.now ?? Date.now();
  const { logPath } = await resolveProgramShadow(programName, options?.alphaRoot);
  const lines = await readShadowLog(logPath);
  const { lines: updated, marked, pending } = markDueToxicity(
    lines,
    midByTicker,
    now,
    { forceDue: options?.forceDue },
  );
  if (marked > 0) {
    await writeShadowLog(logPath, updated);
  }
  const chained = marked > 0 ? recomputeHashChain(updated) : lines;
  return { marked, pending, chainValid: verifyHashChain(chained) };
}

export async function runOutcomeResolution(
  programName: string,
  outcomesByEventId: Record<string, 0 | 1>,
): Promise<{ updated: number; chainValid: boolean }> {
  const { logPath } = await resolveProgramShadow(programName);
  const lines = await readShadowLog(logPath);
  const { lines: next, updated } = applyOutcomes(lines, outcomesByEventId);
  if (updated > 0) {
    await writeShadowLog(logPath, next);
  }
  const chained = updated > 0 ? recomputeHashChain(next) : lines;
  return { updated, chainValid: verifyHashChain(chained) };
}

export async function loadOutcomesFile(path: string): Promise<Record<string, 0 | 1>> {
  const raw = (await Bun.file(path).json()) as Record<string, number>;
  const out: Record<string, 0 | 1> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === 0 || v === 1) out[k] = v;
  }
  return out;
}

export function dueUnmarkedTradeTickers(
  lines: ShadowLine[],
  now = Date.now(),
  forceDue = false,
): string[] {
  const tickers = new Set<string>();
  for (const line of lines) {
    if (line.decision.action !== "trade") continue;
    if (line.toxicity.markedTs != null) continue;
    if (line.toxicity.dueTs > now && !forceDue) continue;
    tickers.add(line.ticker);
  }
  return [...tickers];
}

export async function fetchMidsForTickers(
  tickers: string[],
  options?: FetchKalshiBookOptions,
): Promise<Record<string, number>> {
  const mids: Record<string, number> = {};
  for (const ticker of tickers) {
    try {
      const book = await fetchKalshiBookSnapshot(ticker, options);
      const mid = midFromBookSnapshot(book);
      if (mid != null) mids[ticker] = mid;
    } catch (err) {
      console.warn(`Kalshi mid fetch failed for ${ticker}:`, err instanceof Error ? err.message : err);
    }
  }
  return mids;
}

export async function runAutoToxicityMark(
  programName: string,
  options?: {
    now?: number;
    forceDue?: boolean;
    fetch?: FetchKalshiBookOptions;
    manualMids?: Record<string, number>;
  },
): Promise<{ marked: number; pending: number; chainValid: boolean; fetched: string[] }> {
  const now = options?.now ?? Date.now();
  const { logPath } = await resolveProgramShadow(programName);
  const lines = await readShadowLog(logPath);
  const dueTickers = dueUnmarkedTradeTickers(lines, now, options?.forceDue);
  const fetched = options?.fetch ? await fetchMidsForTickers(dueTickers, options.fetch) : {};
  const mids = { ...fetched, ...options?.manualMids };
  const result = await runToxicityMark(programName, mids, { now, forceDue: options?.forceDue });
  return { ...result, fetched: Object.keys(fetched) };
}
