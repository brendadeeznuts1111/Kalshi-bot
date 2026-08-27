/**
 * steam.ts — cross-book steam detection over real OddsPrint observations.
 *
 * A steam move is an implied-probability change for one (source, side) print
 * between consecutive observations. detectSteam() finds the earliest move in a
 * window (the leader, by timestamp only — no external origin list, no per-book
 * weighting) and scores followers by logit magnitude x step ratio x time decay.
 *
 * Invariants:
 *   - A price move is independent: each book's implied changes vs its own
 *     previous observation (previous keyed by OddsPrint.id).
 *   - Leadership = earliest move timestamp in the window. No origin weighting.
 *   - Every function is pure over immutable inputs (copy-on-write); no shared
 *     state is mutated. Errors are scoped per step in detectSteamFromEvents().
 */
import type { ClusterResult, OddsPrint } from "./cluster/odds-vector.ts";
import type { OddsEvent } from "./odds-types.ts";
import { eventsToOddsPrints } from "./signal-context.ts";

/** One observed implied-probability change for a print (source:event:side). */
export type SteamMove = {
  book: string; // print.source
  side: string; // print.side
  timestamp: number; // print.ts (epoch ms)
  delta: number; // newImplied - oldImplied
  oldImplied: number;
  newImplied: number;
};

export type SteamFollower = {
  book: string;
  side: string;
  lagMs: number;
  delta: number;
  score: number;
};

export type SteamEvent = SteamFollower & { leader: string; leaderSide: string };

export type SteamResult = {
  leader: string | null;
  leaderSide: string | null;
  leaderTs: number | null;
  moves: SteamMove[];
  followers: SteamFollower[];
  steamEvents: SteamEvent[];
};

export type SteamOptions = {
  /** Follower window after the leader move (ms). Default 5000. */
  windowMs?: number;
  /** Cap on the step ratio in the score. Default 3. */
  maxStepRatio?: number;
};

const DEFAULT_WINDOW_MS = 5000;
const DEFAULT_MAX_STEP_RATIO = 3;

/** Clamped logistic: p -> ln(p/(1-p)), safe at p in {0,1}. */
export function clampedLogit(p: number): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Diff current prints against their previous observation (keyed by print id).
 * A move exists only when the book's OWN implied value changed.
 */
export function collectSteamMoves(prints: OddsPrint[], previous: Map<string, OddsPrint>): SteamMove[] {
  const moves: SteamMove[] = [];
  for (const p of prints) {
    const prev = previous.get(p.id);
    if (prev && prev.implied !== p.implied) {
      moves.push({
        book: p.source,
        side: p.side,
        timestamp: p.ts,
        delta: p.implied - prev.implied,
        oldImplied: prev.implied,
        newImplied: p.implied,
      });
    }
  }
  return moves;
}

/** Self-calibrating typical step = mean |delta| of the observed moves (>= 1e-6). */
export function typicalStep(moves: SteamMove[]): number {
  if (moves.length === 0) return 1e-6;
  const sum = moves.reduce((acc, m) => acc + Math.abs(m.delta), 0);
  return Math.max(sum / moves.length, 1e-6);
}

/**
 * Steam score: logit magnitude x step ratio (capped) x time decay (1 at t=0).
 * Identical formula for every follower — no origin multiplier.
 */
export function steamScore(
  move: SteamMove,
  lagMs: number,
  windowMs: number,
  step: number,
  maxStepRatio = DEFAULT_MAX_STEP_RATIO,
): number {
  const magnitude = Math.abs(clampedLogit(move.newImplied) - clampedLogit(move.oldImplied));
  const stepFactor = Math.min(maxStepRatio, Math.abs(move.delta) / step);
  const timeFactor = Math.max(0, 1 - lagMs / windowMs);
  return magnitude * stepFactor * timeFactor;
}

/**
 * Detect steam: earliest move in the window is the leader; later moves within
 * windowMs follow. Returns empty result when there are no moves.
 */
export function detectSteam(
  prints: OddsPrint[],
  previous: Map<string, OddsPrint>,
  options: SteamOptions = {},
): SteamResult {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const moves = collectSteamMoves(prints, previous);
  const empty: SteamResult = { leader: null, leaderSide: null, leaderTs: null, moves, followers: [], steamEvents: [] };
  if (moves.length === 0) return empty;

  // Earliest timestamp wins; stable reduce keeps input order on ties.
  const leader = moves.reduce((a, b) => (a.timestamp <= b.timestamp ? a : b));
  const step = typicalStep(moves);
  const followers = moves
    .filter((m) => m !== leader && m.timestamp - leader.timestamp <= windowMs)
    .map((m) => ({
      book: m.book,
      side: m.side,
      lagMs: m.timestamp - leader.timestamp,
      delta: m.delta,
      score: steamScore(m, m.timestamp - leader.timestamp, windowMs, step, options.maxStepRatio),
    }));

  return {
    leader: leader.book,
    leaderSide: leader.side,
    leaderTs: leader.timestamp,
    moves,
    followers,
    steamEvents: followers.map((f) => ({ ...f, leader: leader.book, leaderSide: leader.side })),
  };
}

/**
 * Immutable apply: clone the cluster, update the leader print's implied and
 * timestamp, copy the move to follower books with the given latency. Missing
 * books leave their prints unchanged. The input cluster is never mutated.
 */
export function applySteamMove(
  cluster: ClusterResult,
  move: SteamMove,
  followerBooks: string[],
  latencyMs: number,
): ClusterResult {
  const prints = cluster.prints.map((p) => ({ ...p }));
  let touched = false;
  for (const p of prints) {
    if (p.source === move.book && p.side === move.side) {
      p.implied = move.newImplied;
      p.ts = move.timestamp;
      touched = true;
    } else if (followerBooks.includes(p.source) && p.side === move.side) {
      p.implied = move.newImplied;
      p.ts = move.timestamp + latencyMs;
      touched = true;
    }
  }
  if (!touched) return cluster;
  const clusters = new Map<number, OddsPrint[]>();
  for (const [label, group] of cluster.clusters) clusters.set(label, group.map((p) => ({ ...p })));
  return { ...cluster, prints, clusters };
}

/**
 * Ingest steps, scoped: parse OddsEvent[] into prints, then detect steam.
 * Each step's error is labeled; nothing is written or published here.
 */
export function detectSteamFromEvents(
  events: OddsEvent[],
  previous: Map<string, OddsPrint>,
  options: SteamOptions = {},
): SteamResult {
  let prints: OddsPrint[];
  try {
    prints = eventsToOddsPrints(events);
  } catch (err) {
    throw new Error("parse failed: " + (err instanceof Error ? err.message : String(err)));
  }
  try {
    return detectSteam(prints, previous, options);
  } catch (err) {
    throw new Error("steam detection failed: " + (err instanceof Error ? err.message : String(err)));
  }
}

/** Per-book time series (ts, implied) from cluster results, deduped by print id. */
export function bookTimeSeries(clusterResults: ClusterResult[]): Map<string, Array<{ timestamp: number; implied: number }>> {
  const series = new Map<string, Array<{ timestamp: number; implied: number }>>();
  const seen = new Set<string>();
  for (const result of clusterResults) {
    for (const p of result.prints) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const arr = series.get(p.source) ?? [];
      arr.push({ timestamp: p.ts, implied: p.implied });
      series.set(p.source, arr);
    }
  }
  for (const arr of series.values()) arr.sort((a, b) => a.timestamp - b.timestamp);
  return series;
}

/**
 * Align two per-book series by timestamp (nearest point within tolerance).
 * Returns pairs of (aTs, aImplied, bImplied) or empty when too few align.
 */
export function alignTimeSeries(
  a: Array<{ timestamp: number; implied: number }>,
  b: Array<{ timestamp: number; implied: number }>,
  toleranceMs = 1000,
): Array<{ ts: number; a: number; b: number }> {
  const aligned: Array<{ ts: number; a: number; b: number }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const diff = a[i]!.timestamp - b[j]!.timestamp;
    if (Math.abs(diff) <= toleranceMs) {
      aligned.push({ ts: Math.max(a[i]!.timestamp, b[j]!.timestamp), a: a[i]!.implied, b: b[j]!.implied });
      i++;
      j++;
    } else if (diff < 0) {
      i++;
    } else {
      j++;
    }
  }
  return aligned;
}

/**
 * Pearson correlation of two aligned series (empty/constant -> 0).
 */
export function seriesCorrelation(values: Array<{ a: number; b: number }>): number {
  if (values.length < 3) return 0;
  const n = values.length;
  const meanA = values.reduce((s, v) => s + v.a, 0) / n;
  const meanB = values.reduce((s, v) => s + v.b, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (const v of values) {
    const da = v.a - meanA;
    const db = v.b - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

export type LeadershipPair = { leader: string; follower: string; lagMs: number; confidence: number };
export type LeadershipResult = { leadershipPairs: LeadershipPair[] };

export type LeadershipOptions = {
  minPoints?: number; // default 3
  minCorrelation?: number; // default 0.8
  toleranceMs?: number;
};

/**
 * Pairwise leadership: books whose aligned implied series correlate above the
 * threshold; the one whose lag shifts ahead is the leader. Pure over inputs.
 */
/**
 * Evaluate one book pair: aligned correlation above threshold yields a
 * leadership pair; the book with the later mean timestamp is the leader.
 * Pure helper (keeps computeLeadership under the complexity ceiling).
 */
export function leadershipForPair(
  a: Array<{ timestamp: number; implied: number }>,
  b: Array<{ timestamp: number; implied: number }>,
  minPoints: number,
  minCorrelation: number,
  toleranceMs: number | undefined,
): { signedLagMs: number; confidence: number } | null {
  if (a.length < minPoints || b.length < minPoints) return null;
  const aligned = alignTimeSeries(a, b, toleranceMs);
  if (aligned.length < minPoints) return null;
  const correlation = seriesCorrelation(aligned);
  if (correlation < minCorrelation) return null;
  const meanA = a.reduce((s, x) => s + x.timestamp, 0) / a.length;
  const meanB = b.reduce((s, x) => s + x.timestamp, 0) / b.length;
  return { signedLagMs: meanB - meanA, confidence: correlation };
}

export function computeLeadership(
  clusterResults: ClusterResult[],
  options: LeadershipOptions = {},
): LeadershipResult {
  const minPoints = options.minPoints ?? 3;
  const minCorrelation = options.minCorrelation ?? 0.8;
  const series = bookTimeSeries(clusterResults);
  const books = Array.from(series.keys());
  const pairs: LeadershipPair[] = [];
  for (let i = 0; i < books.length; i++) {
    for (let j = i + 1; j < books.length; j++) {
      const pair = leadershipForPair(
        series.get(books[i]!)!,
        series.get(books[j]!)!,
        minPoints,
        minCorrelation,
        options.toleranceMs,
      );
      if (pair) {
        pairs.push({
          leader: pair.signedLagMs >= 0 ? books[i]! : books[j]!,
          follower: pair.signedLagMs >= 0 ? books[j]! : books[i]!,
          lagMs: Math.abs(pair.signedLagMs),
          confidence: pair.confidence,
        });
      }
    }
  }
  return { leadershipPairs: pairs };
}
