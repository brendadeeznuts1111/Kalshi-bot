/**
 * tracker.ts - stateful consensus tracker: keeps the previous snapshot's cluster
 * labels and emits merge/split/new/dissolved shifts on each new snapshot (the
 * steam-move alert, §193). Deterministic: clustering + detectShifts are both
 * order-stable given the same prints.
 */
import { clusterOddsPrints, type OddsPrint } from './odds-vector.ts';
import { detectShifts, type ConsensusShift } from './consensus.ts';

export interface ConsensusSnapshot {
  ts: number;
  prints: OddsPrint[];
  shifts: ConsensusShift[];
  labels: Record<string, number>;
  clusters: number;
  noise: number;
}

/**
 * Tracks consecutive snapshots. push(prints, ts) clusters, compares to the previous
 * snapshot, and returns the shifts (empty on the first snapshot or when stable).
 */
export class ConsensusTracker {
  private prev: { ts: number; labels: Record<string, number> } | null = null;

  push(prints: OddsPrint[], ts: number, opts: { minClusterSize?: number } = {}): ConsensusSnapshot {
    const r = clusterOddsPrints(prints, { minClusterSize: opts.minClusterSize ?? 3 });
    const labels: Record<string, number> = {};
    for (const pr of r.prints) labels[pr.id] = pr.label;
    const shifts = this.prev ? detectShifts(this.prev, { ts, labels }) : [];
    this.prev = { ts, labels };
    return { ts, prints, shifts, labels, clusters: [...r.clusters.keys()].length, noise: r.noiseCount };
  }

  reset(): void {
    this.prev = null;
  }
}