/**
 * odds-vector.ts — adapt odds prints into clustering vectors and run the clusterer.
 *
 * A print is one vig-stripped odds observation: (source, eventId, side, implied, vig, ts).
 * The clustering vector is [implied%, vig, tsNormalized] (z-scored) — consensus pockets
 * across sources, per §193 / the heap-clustering ask.
 */
import { mutualReachability, primMST, flatLabels } from './hdbscan.ts';

export interface OddsPrint {
  id: string; // source:eventId:side
  source: string;
  eventId: string;
  side: string;
  implied: number; // vig-stripped implied probability, 0..1
  vig: number; // vig/overround fraction
  ts: number; // epoch ms
}

export interface ClusterResult {
  labels: number[];
  prints: Array<OddsPrint & { label: number }>;
  clusters: Map<number, OddsPrint[]>;
  noiseCount: number;
  epsilon: number | undefined;
}

/** z-score normalize each column in place on a copy. */
export function zscore(vectors: number[][]): number[][] {
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0) return [];
  const means: number[] = [];
  const stds: number[] = [];
  for (let d = 0; d < dim; d++) {
    const col = vectors.map((v) => v[d]!);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) * (b - mean), 0) / col.length) || 1;
    means.push(mean);
    stds.push(sd);
  }
  return vectors.map((v) => v.map((x, d) => (x - means[d]!) / stds[d]!));
}

/** Build the clustering vector for a print: [implied%, vig, tsSeconds]. */
export function printVector(p: OddsPrint): number[] {
  return [p.implied * 100, p.vig * 100, p.ts / 1000];
}

/**
 * Cluster odds prints. Returns labels aligned with the input order plus a labeled
 * view. Deterministic given the same prints (see hdbscan.ts).
 */
export function clusterOddsPrints(prints: OddsPrint[], opts: { k?: number; minClusterSize?: number } = {}): ClusterResult {
  // HDBSCAN convention: k (core-distance neighbors) tracks minClusterSize unless
  // given explicitly - a k larger than the pocket size makes the core distance a
  // far point and collapses the MRD (observed in the tracker tests, §193).
  const k = opts.k ?? opts.minClusterSize ?? 5;
  const minClusterSize = opts.minClusterSize ?? 3;
  if (prints.length < 2) return { labels: prints.map(() => -1), prints: prints.map((p) => ({ ...p, label: -1 })), clusters: new Map(), noiseCount: prints.length, epsilon: undefined };
  const vectors = zscore(prints.map(printVector));
  const mrd = mutualReachability(vectors, Math.min(k, prints.length - 1));
  const mst = primMST(prints.length, mrd);
  const labels = flatLabels(prints.length, mst, minClusterSize);
  const labeled = prints.map((p, i) => ({ ...p, label: labels[i]! }));
  const clusters = new Map<number, OddsPrint[]>();
  for (const l of labeled) {
    if (l.label === -1) continue;
    const arr = clusters.get(l.label) ?? [];
    arr.push(l);
    clusters.set(l.label, arr);
  }
  return { labels, prints: labeled, clusters, noiseCount: labeled.filter((l) => l.label === -1).length, epsilon: undefined };
}