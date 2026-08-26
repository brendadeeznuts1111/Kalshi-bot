/**
 * hdbscan.ts — deterministic HDBSCAN-style clustering (heap-based).
 *
 * Pipeline: core distances -> mutual-reachability -> Prim MST (binary min-heap) ->
 * union-find dendrogram -> flat labels at the stability cutoff. Deterministic: every
 * iteration is ordered (no map-order dependence); edge ties break by (from, to).
 *
 * This is the zero-dependency native replacement for ml-hdbscan (repo discipline: no
 * npm runtime deps; §193).
 */
import { MinHeap } from '../../lib/min-heap.ts';

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Distance from each point to its k-th nearest neighbor (k = minClusterSize). */
export function coreDistances(points: number[][], k: number): number[] {
  const n = points.length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ds: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      ds.push(euclidean(points[i]!, points[j]!));
    }
    ds.sort((a, b) => a - b);
    const kk = Math.min(k, ds.length);
    out[i] = kk > 0 ? ds[kk - 1]! : 0;
  }
  return out;
}

/**
 * Mutual-reachability distance matrix (flat row-major n x n).
 * mrd(i,j) = max(core[i], core[j], euclidean(i,j)).
 */
export function mutualReachability(points: number[][], k: number): number[] {
  const n = points.length;
  const core = coreDistances(points, k);
  const mrd = new Array<number>(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      mrd[i * n + j] = i === j ? 0 : Math.max(core[i]!, core[j]!, euclidean(points[i]!, points[j]!));
    }
  }
  return mrd;
}

export interface MstEdge {
  from: number;
  to: number;
  weight: number;
}

/** Prim's MST over the MRD matrix using a binary min-heap. Returns n-1 edges sorted by weight. */
export function primMST(n: number, mrd: number[]): MstEdge[] {
  const edges: MstEdge[] = [];
  if (n <= 1) return edges;
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<{ weight: number; from: number } | null>(n).fill(null);
  const heap = new MinHeap<{ weight: number; to: number; from: number }>((a, b) => (a.weight === b.weight ? a.to < b.to : a.weight < b.weight));
  inTree[0] = true;
  for (let v = 1; v < n; v++) {
    const w = mrd[0 * n + v]!;
    best[v] = { weight: w, from: 0 };
    heap.push({ weight: w, to: v, from: 0 });
  }
  while (heap.size > 0) {
    const e = heap.pop()!;
    if (inTree[e.to]!) continue;
    inTree[e.to] = true;
    edges.push({ from: e.from, to: e.to, weight: e.weight });
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const w = mrd[e.to * n + v]!;
      if (best[v] === null || w < best[v]!.weight) {
        best[v] = { weight: w, from: e.to };
        heap.push({ weight: w, to: v, from: e.to });
      }
    }
  }
  return edges.sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);
}

/**
 * Flat labels via single-linkage with a DETERMINISTIC epsilon: the largest gap in the
 * sorted MST edge weights (the standard elbow). Edges above the cutoff do not merge;
 * components with >= minClusterSize get labels (root id), smaller ones are noise (-1).
 * An explicit epsilon overrides the gap heuristic.
 */
export function flatLabels(n: number, edges: MstEdge[], minClusterSize: number, epsilon?: number): number[] {
  const sorted = [...edges].sort((a, b) => a.weight - b.weight || a.from - b.from || a.to - b.to);
  let cut = epsilon;
  if (cut === undefined && sorted.length > 1) {
    const weights = sorted.map((e) => e.weight);
    const median = weights[Math.floor(weights.length / 2)]!;
    let largestGap = -1;
    let largestIdx = -1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]!.weight - sorted[i - 1]!.weight;
      if (gap > largestGap) { largestGap = gap; largestIdx = i; }
    }
    // significant only when the gap dwarfs the local edge scale (2x median) -
    // a dense pocket has natural small gaps and must stay ONE cluster
    if (largestGap > 2 * median && largestIdx > 0) {
      cut = (sorted[largestIdx - 1]!.weight + sorted[largestIdx]!.weight) / 2;
    }
  }
  const parent = Array.from({ length: n }, (_u, i) => i);
  const size = new Array<number>(n).fill(1);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== x) { const nx = parent[x]!; parent[x] = r; x = nx; }
    return r;
  };
  for (const e of sorted) {
    if (cut !== undefined && e.weight > cut) break;
    const ra = find(e.from);
    const rb = find(e.to);
    if (ra === rb) continue;
    if (size[ra]! < size[rb]!) { parent[ra] = rb; size[rb] = size[ra]! + size[rb]!; }
    else { parent[rb] = ra; size[ra] = size[ra]! + size[rb]!; }
  }
  const labels: number[] = new Array(n);
  const rootLabel = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (size[r]! >= minClusterSize) {
      let l = rootLabel.get(r);
      if (l === undefined) { l = rootLabel.size; rootLabel.set(r, l); }
      labels[i] = l;
    } else labels[i] = -1;
  }
  return labels;
}