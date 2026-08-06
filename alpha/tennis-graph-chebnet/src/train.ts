/**
 * Walk-forward trainer for the Chebyshev graph model.
 *
 * Model: score = Σ_k w_k · (t_k[winner] − t_k[loser]) + b, where t_k are
 * Chebyshev spectral blocks of the node features over the train-period
 * graph. P(win) = σ(score). This is logistic regression on spectral
 * block-difference features — the per-block weights w_k ARE the learnable
 * Chebyshev filter coefficients (linear objective, no backprop through
 * the recurrence needed).
 */
import { csrFromEdges, chebyshevBlocksMulti, type SparseGraph } from "./chebyshev.ts";
import {
  edgesFromMatches,
  nodeFeatures,
  NODE_FEATURES,
  type BuiltGraph,
} from "./graph.ts";

export type TrainedModel = {
  K: number;
  /** weights[k][f] — per-block, per-feature coefficients (the filter). */
  weights: number[][];
  bias: number;
  cutoffMs: number;
  trainStats: { n: number; logLoss: number; brier: number; accuracy: number };
  validStats: { n: number; logLoss: number; brier: number; accuracy: number };
  players: string[];
  excluded: BuiltGraph["excluded"];
};

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function metrics(pairs: Array<{ p: number; y: number }>) {
  if (pairs.length === 0) return { n: 0, logLoss: 0, brier: 0, accuracy: 0 };
  let ll = 0, br = 0, ok = 0;
  for (const { p, y } of pairs) {
    const pc = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
    ll -= y * Math.log(pc) + (1 - y) * Math.log(1 - pc);
    br += (p - y) ** 2;
    if ((p > 0.5) === (y === 1)) ok += 1;
  }
  return { n: pairs.length, logLoss: ll / pairs.length, brier: br / pairs.length, accuracy: ok / pairs.length };
}

export function trainGraphModel(
  g: BuiltGraph,
  options: { K?: number; cutoffMs?: number; epochs?: number; lr?: number; l2?: number } = {},
): TrainedModel {
  const K = options.K ?? 3;
  const epochs = options.epochs ?? 200;
  const lr = options.lr ?? 0.05;
  const l2 = options.l2 ?? 1e-2;
  const sorted = g.matches.map((m) => m.tsMs).sort((a, b) => a - b);
  const cutoffMs = options.cutoffMs ?? sorted[Math.floor(sorted.length * 0.7)] ?? Date.now();

  const trainMatches = g.matches.filter((m) => m.tsMs < cutoffMs);
  const validMatches = g.matches.filter((m) => m.tsMs >= cutoffMs);
  const graph: SparseGraph = csrFromEdges(g.players.length, edgesFromMatches(trainMatches));
  const X = nodeFeatures(g, cutoffMs);
  const blocks = chebyshevBlocksMulti(graph, X, NODE_FEATURES, K);

  // Feature vector per match: concat over k of (t_k[a] − t_k[b])
  const dim = (K + 1) * NODE_FEATURES;
  const feat = (a: number, b: number): number[] => {
    const v = new Array<number>(dim);
    let d = 0;
    for (let k = 0; k <= K; k++) {
      const blk = blocks[k]!;
      for (let f = 0; f < NODE_FEATURES; f++) {
        v[d++] = blk[a * NODE_FEATURES + f]! - blk[b * NODE_FEATURES + f]!;
      }
    }
    return v;
  };

  const W = new Float64Array(dim);
  let bias = 0;
  const train = trainMatches.map((m) => ({ x: feat(m.winner, m.loser), y: 1 }));
  // Balance: also train the reverse direction as y=0 (same match, swapped)
  for (const m of trainMatches) train.push({ x: feat(m.loser, m.winner), y: 0 });

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gW = new Float64Array(dim);
    let gB = 0;
    for (const { x, y } of train) {
      let z = bias;
      for (let d = 0; d < dim; d++) z += W[d]! * x[d]!;
      const err = sigmoid(z) - y;
      for (let d = 0; d < dim; d++) gW[d] += err * x[d]!;
      gB += err;
    }
    const inv = 1 / train.length;
    for (let d = 0; d < dim; d++) W[d] -= lr * (gW[d]! * inv + l2 * W[d]!);
    bias -= lr * gB * inv;
  }

  const evalSet = (matches: typeof trainMatches) =>
    matches.map((m) => {
      const x = feat(m.winner, m.loser);
      let z = bias;
      for (let d = 0; d < dim; d++) z += W[d]! * x[d]!;
      return { p: sigmoid(z), y: 1 };
    });

  const weights: number[][] = [];
  for (let k = 0; k <= K; k++) {
    weights.push([...W.slice(k * NODE_FEATURES, (k + 1) * NODE_FEATURES)]);
  }
  return {
    K,
    weights,
    bias,
    cutoffMs,
    trainStats: metrics(evalSet(trainMatches)),
    validStats: metrics(evalSet(validMatches)),
    players: g.players,
    excluded: g.excluded,
  };
}

/** P(a beats b) for a trained model — requires recomputed blocks upstream; v0 CLI-only. */
export { sigmoid };
