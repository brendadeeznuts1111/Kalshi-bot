/**
 * Player graph builder — events SSOT → nodes/edges/labels, gated by the
 * Enrichment Lock: a match enters the graph only when BOTH players have a
 * known nationality AND the tournament has a known tier and country.
 * Unknowns are excluded (DATA_INCOMPLETE), never imputed.
 *
 * Pure over input rows — the CLI feeds event-store rows; tests feed fixtures.
 */
import {
  geoForTournament,
  nationalityForPlayer,
  tierFromTournament,
} from "../../../src/research/tennis-meta.ts";

export type EventRow = {
  eventId: string;
  playerA: string;
  playerB: string;
  winner: string;
  loser: string;
  startTs: string; // ISO
  tournament: string;
};

export type BuiltGraph = {
  players: string[];
  playerIdx: Map<string, number>;
  /** Symmetrized weighted edges for the spectral layer. */
  edges: Array<{ a: number; b: number; w: number }>;
  /** Directed labeled matches (index into players). */
  matches: Array<{ winner: number; loser: number; tsMs: number }>;
  excluded: { nationality: number; tier: number; country: number };
};

export const NODE_FEATURES = 3; // [winRate-0.5, log1p(wins), log1p(losses)]

export function buildPlayerGraph(rows: readonly EventRow[]): BuiltGraph {
  const playerIdx = new Map<string, number>();
  const players: string[] = [];
  const idx = (name: string): number => {
    let i = playerIdx.get(name);
    if (i == null) {
      i = players.length;
      players.push(name);
      playerIdx.set(name, i);
    }
    return i;
  };
  const edgeW = new Map<string, { a: number; b: number; w: number }>();
  const matches: BuiltGraph["matches"] = [];
  const excluded = { nationality: 0, tier: 0, country: 0 };

  for (const r of rows) {
    if (!r.winner || !r.loser || r.winner === r.loser) continue;
    if (!nationalityForPlayer(r.winner) || !nationalityForPlayer(r.loser)) {
      excluded.nationality += 1;
      continue;
    }
    if (!tierFromTournament(r.tournament)) {
      excluded.tier += 1;
      continue;
    }
    if (!geoForTournament(r.tournament)) {
      excluded.country += 1;
      continue;
    }
    const tsMs = Date.parse(r.startTs);
    if (!Number.isFinite(tsMs)) continue;
    const w = idx(r.winner);
    const l = idx(r.loser);
    matches.push({ winner: w, loser: l, tsMs });
    const key = w < l ? `${w}|${l}` : `${l}|${w}`;
    const e = edgeW.get(key) ?? { a: Math.min(w, l), b: Math.max(w, l), w: 0 };
    e.w += 1;
    edgeW.set(key, e);
  }
  return { players, playerIdx, edges: [...edgeW.values()], matches, excluded };
}

/**
 * Node feature matrix (n×NODE_FEATURES row-major) computed ONLY from
 * matches with tsMs < cutoffMs — the no-leakage contract for the
 * walk-forward split.
 */
export function nodeFeatures(
  g: BuiltGraph,
  cutoffMs: number,
): Float64Array {
  const n = g.players.length;
  const wins = new Float64Array(n);
  const losses = new Float64Array(n);
  for (const m of g.matches) {
    if (m.tsMs >= cutoffMs) continue;
    wins[m.winner]! += 1;
    losses[m.loser]! += 1;
  }
  const X = new Float64Array(n * NODE_FEATURES);
  for (let i = 0; i < n; i++) {
    const tot = wins[i]! + losses[i]!;
    // Bayesian-smoothed win rate (prior: 4 matches at 0.5) — raw 1-match
    // records (100%/0%) are the dominant overfitting source on sparse graphs
    X[i * NODE_FEATURES] = (wins[i]! + 2) / (tot + 4) - 0.5;
    X[i * NODE_FEATURES + 1] = Math.log1p(wins[i]!);
    X[i * NODE_FEATURES + 2] = Math.log1p(losses[i]!);
  }
  return X;
}

/**
 * Walk-forward split: train matches strictly before cutoffMs, validation
 * matches at/after. Graph structure (edges) must also respect the cutoff —
 * filter edges by rebuilding from train matches only.
 */
export function splitByTime(
  g: BuiltGraph,
  cutoffMs: number,
): { train: BuiltGraph["matches"]; valid: BuiltGraph["matches"] } {
  const train = g.matches.filter((m) => m.tsMs < cutoffMs);
  const valid = g.matches.filter((m) => m.tsMs >= cutoffMs);
  return { train, valid };
}

/** Edges derived only from train-period matches (no leakage in structure). */
export function edgesFromMatches(
  matches: ReadonlyArray<BuiltGraph["matches"][number]>,
): Array<{ a: number; b: number; w: number }> {
  const edgeW = new Map<string, { a: number; b: number; w: number }>();
  for (const m of matches) {
    const a = Math.min(m.winner, m.loser);
    const b = Math.max(m.winner, m.loser);
    const key = `${a}|${b}`;
    const e = edgeW.get(key) ?? { a, b, w: 0 };
    e.w += 1;
    edgeW.set(key, e);
  }
  return [...edgeW.values()];
}
