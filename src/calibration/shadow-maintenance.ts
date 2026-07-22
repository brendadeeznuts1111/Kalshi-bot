// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Shadow log maintenance — append-only toxicity marks + outcome resolutions.
 * Prediction lines are never rewritten; watcher joins marks at read time.
 */
import { fetchKalshiBookSnapshot, midFromBookSnapshot } from "../bot/kalshi-market-data.ts";
import type { FetchKalshiBookOptions } from "../bot/kalshi-market-data.ts";
import { joinPath } from "../research/paths.ts";
import { loadProgramManifest } from "../institutions/program-manifest.ts";
import {
  appendOutcomeResolutions,
  appendToxicityMarks,
  materializeShadowLines,
  readShadowLogEntries,
  selectDueToxicityMarks,
  verifyHashChainEntries,
  type ShadowLogEntry,
  type ShadowPredictionLine,
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

export type ToxicityMarkOptions = {
  now?: number;
  /** Test-only — marks outside the 60s window produce wrong toxicity data. */
  forceDue?: boolean;
  alphaRoot?: string;
};

export async function runToxicityMark(
  programName: string,
  midByTicker: Record<string, number>,
  options?: ToxicityMarkOptions,
): Promise<{ marked: number; pending: number; missed: number; chainValid: boolean }> {
  const now = options?.now ?? Date.now();
  const { manifest, logPath } = await resolveProgramShadow(programName, options?.alphaRoot);
  const entries = await readShadowLogEntries(logPath);
  const { toMark, pending, missed } = selectDueToxicityMarks(entries, now, {
    forceDue: options?.forceDue,
    allowStaleMark: options?.forceDue === true && Bun.env.NODE_ENV === "test",
  });

  const marks: Array<{ line: ShadowPredictionLine; midCents: number; markedTs: number }> = [];
  let stillPending = pending;

  for (const line of toMark) {
    const mid = midByTicker[line.ticker];
    if (mid == null) {
      stillPending++;
      continue;
    }
    marks.push({ line, midCents: mid, markedTs: now });
  }

  const marked = marks.length
    ? await appendToxicityMarks(logPath, manifest.name, marks)
    : 0;

  const chainValid = verifyHashChainEntries(await readShadowLogEntries(logPath));
  return { marked, pending: stillPending, missed, chainValid };
}

export async function runOutcomeResolution(
  programName: string,
  outcomesByEventId: Record<string, 0 | 1>,
  options?: { alphaRoot?: string },
): Promise<{ updated: number; chainValid: boolean }> {
  const { manifest, logPath } = await resolveProgramShadow(programName, options?.alphaRoot);
  const entries = await readShadowLogEntries(logPath);
  const updated = await appendOutcomeResolutions(logPath, manifest.name, outcomesByEventId, entries);
  const chainValid = verifyHashChainEntries(await readShadowLogEntries(logPath));
  return { updated, chainValid };
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
  entries: ShadowLogEntry[],
  now = Date.now(),
  forceDue = false,
): string[] {
  const { toMark } = selectDueToxicityMarks(entries, now, {
    forceDue,
    allowStaleMark: forceDue && Bun.env.NODE_ENV === "test",
  });
  return [...new Set(toMark.map((line) => line.ticker))];
}

export async function fetchMidsForTickers(
  tickers: string[],
  options?: FetchKalshiBookOptions,
): Promise<Record<string, number>> {
  const mids: Record<string, number> = {};
  for (const ticker of tickers) {
    try {
      const book = await fetchKalshiBookSnapshot(ticker, options);
      if (book.crossed) {
        console.warn(`Kalshi book crossed for ${ticker} — skipping toxicity mid`);
        continue;
      }
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
    alphaRoot?: string;
  },
): Promise<{
  marked: number;
  pending: number;
  missed: number;
  chainValid: boolean;
  fetched: string[];
}> {
  const now = options?.now ?? Date.now();
  const { logPath } = await resolveProgramShadow(programName, options?.alphaRoot);
  const entries = await readShadowLogEntries(logPath);
  const dueTickers = dueUnmarkedTradeTickers(entries, now, options?.forceDue);
  const fetched = options?.fetch ? await fetchMidsForTickers(dueTickers, options.fetch) : {};
  const mids = { ...fetched, ...options?.manualMids };
  const result = await runToxicityMark(programName, mids, {
    now,
    forceDue: options?.forceDue,
    alphaRoot: options?.alphaRoot,
  });
  return { ...result, fetched: Object.keys(fetched) };
}

/** Sweep all alpha programs for lines in the 60s toxicity mark window. */
export async function runToxicitySweep(
  options?: Omit<NonNullable<Parameters<typeof runAutoToxicityMark>[1]>, "alphaRoot"> & {
    programs?: string[];
  },
): Promise<Array<{ program: string; marked: number; pending: number; missed: number }>> {
  const { listAlphaPrograms } = await import("./watcher.ts");
  const programs =
    options?.programs ??
    (await listAlphaPrograms()).map(({ manifest }) => manifest.name);
  const results: Array<{ program: string; marked: number; pending: number; missed: number }> = [];

  for (const program of programs) {
    const result = await runAutoToxicityMark(program, {
      now: options?.now,
      forceDue: options?.forceDue,
      fetch: options?.fetch ?? {},
      manualMids: options?.manualMids,
    });
    if (result.marked > 0 || result.pending > 0 || result.missed > 0) {
      results.push({
        program,
        marked: result.marked,
        pending: result.pending,
        missed: result.missed,
      });
    }
  }

  return results;
}
