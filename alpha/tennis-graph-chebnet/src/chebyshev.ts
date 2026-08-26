/**
 * Chebyshev spectral blocks over the player graph.
 *
 * Scaled Laplacian L̃ = L − I = −A_norm (using the λmax ≤ 2 bound, so no
 * eigendecomposition), T_k via the three-term recurrence. Each block
 * t_k = T_k(L̃)·X is computed with sparse mat-vecs only — O(E·K).
 *
 * Learning per-block coefficients on these blocks is the learnable
 * Chebyshev filter: θ_k generalizes to a per-feature block weight, which
 * keeps the training objective linear (see train.ts).
 */

export type SparseGraph = {
  /** Node count. */
  n: number;
  /** CSR row offsets, length n+1. */
  rowPtr: Uint32Array;
  /** CSR column indices (sorted per row). */
  colIdx: Uint32Array;
  /** CSR normalized adjacency weights (A_norm = D^-1/2 W D^-1/2). */
  val: Float64Array;
};

/** Build normalized adjacency (CSR) from an undirected weighted edge list. */
export function csrFromEdges(
  n: number,
  edges: Array<{ a: number; b: number; w: number }>,
): SparseGraph {
  const deg = new Float64Array(n);
  const adj = new Map<number, Map<number, number>>();
  const add = (u: number, v: number, w: number) => {
    if (u === v) return;
    let row = adj.get(u);
    if (!row) adj.set(u, (row = new Map()));
    row.set(v, (row.get(v) ?? 0) + w);
  };
  for (const { a, b, w } of edges) {
    add(a, b, w);
    add(b, a, w);
    deg[a]! += w;
    deg[b]! += w;
  }
  const rowPtr = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i]! + (adj.get(i)?.size ?? 0);
  const colIdx = new Uint32Array(rowPtr[n]!);
  const val = new Float64Array(rowPtr[n]!);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const row = adj.get(i);
    if (!row) continue;
    const cols = [...row.keys()].sort((x, y) => x - y);
    for (const j of cols) {
      const w = row.get(j)!;
      colIdx[p] = j;
      val[p] = deg[i]! > 0 && deg[j]! > 0 ? w / Math.sqrt(deg[i]! * deg[j]!) : 0;
      p++;
    }
  }
  return { n, rowPtr, colIdx, val };
}

/** y ← A_norm · x (sparse mat-vec). */
export function spmv(g: SparseGraph, x: Float64Array, y: Float64Array): void {
  for (let i = 0; i < g.n; i++) {
    let s = 0;
    for (let p = g.rowPtr[i]!; p < g.rowPtr[i + 1]!; p++) s += g.val[p]! * x[g.colIdx[p]!]!;
    y[i] = s;
  }
}

/**
 * Chebyshev blocks over L̃ = −A_norm: returns [T_0x, T_1x, …, T_Kx]
 * as K+1 vectors of length n. T_0 = x, T_1 = −A_norm·x,
 * T_k = 2(−A_norm)T_{k-1} − T_{k-2}.
 */
export function chebyshevBlocks(g: SparseGraph, x: Float64Array, K: number): Float64Array[] {
  const blocks: Float64Array[] = [Float64Array.from(x)];
  if (K === 0) return blocks;
  const t1 = new Float64Array(g.n);
  spmv(g, x, t1);
  for (let i = 0; i < g.n; i++) t1[i] = -t1[i]!;
  blocks.push(t1);
  const tmp = new Float64Array(g.n);
  for (let k = 2; k <= K; k++) {
    const tk = new Float64Array(g.n);
    spmv(g, blocks[k - 1]!, tmp);
    for (let i = 0; i < g.n; i++) {
      // 2·L̃·T_{k-1} − T_{k-2}, L̃ = −A_norm → −2·spmv − T_{k-2}
      tk[i] = -2 * tmp[i]! - blocks[k - 2]![i]!;
    }
    blocks.push(tk);
  }
  return blocks;
}

/**
 * Multi-feature variant: X is n×F (row-major, fStride columns).
 * Returns blocks[k] as n×F row-major arrays.
 */
export function chebyshevBlocksMulti(
  g: SparseGraph,
  X: Float64Array,
  fStride: number,
  K: number,
): Float64Array[] {
  const out: Float64Array[] = [];
  for (let k = 0; k <= K; k++) out.push(new Float64Array(g.n * fStride));
  const col = new Float64Array(g.n);
  for (let f = 0; f < fStride; f++) {
    for (let i = 0; i < g.n; i++) col[i] = X[i * fStride + f]!;
    const blocks = chebyshevBlocks(g, col, K);
    for (let k = 0; k <= K; k++) {
      for (let i = 0; i < g.n; i++) out[k]![i * fStride + f] = blocks[k]![i]!;
    }
  }
  return out;
}
