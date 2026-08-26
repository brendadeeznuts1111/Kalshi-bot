/**
 * consensus.ts - cluster merge/split detection between consecutive snapshots.
 * A merge = two distinct previous clusters now share one cluster (sources converging,
 * a possible steam move). A split = one previous cluster now spans two clusters.
 */

export type ShiftKind = 'merge' | 'split' | 'new-cluster' | 'dissolved';

export interface ConsensusShift {
  kind: ShiftKind;
  fromLabels: number[]; // previous cluster labels involved
  toLabel: number; // resulting cluster label (merge/new) or -1
  at: number; // snapshot timestamp (ms)
  size: number; // prints involved
}
/**
 * Compare two consecutive snapshots: prev.labels[printId] - label, next the same.
 * Detects merges (two prev clusters to one next cluster), splits (one prev cluster to
 * two next clusters), new clusters, and dissolved clusters. Deterministic ordering.
 */
export function detectShifts(prev: { ts: number; labels: Record<string, number> }, next: { ts: number; labels: Record<string, number> }): ConsensusShift[] {
  const shifts: ConsensusShift[] = [];
  // group by next label for the merge/new check
  const nextGroups = new Map<number, Map<string, number>>();
  for (const [id, nl] of Object.entries(next.labels)) {
    if (nl === -1) continue;
    const g = nextGroups.get(nl) ?? new Map<string, number>();
    g.set(id, prev.labels[id] ?? -1);
    nextGroups.set(nl, g);
  }
  for (const [nl, members] of [...nextGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const prevLabels = new Set<number>([...members.values()].filter((l) => l !== -1));
    if (prevLabels.size === 0) {
      shifts.push({ kind: 'new-cluster', fromLabels: [], toLabel: nl, at: next.ts, size: members.size });
    } else if (prevLabels.size > 1) {
      shifts.push({ kind: 'merge', fromLabels: [...prevLabels].sort((a, b) => a - b), toLabel: nl, at: next.ts, size: members.size });
    }
  }
  // splits: a prev cluster whose members are spread across more than one next cluster
  const prevGroups = new Map<number, Map<string, number>>();
  for (const [id, pl] of Object.entries(prev.labels)) {
    if (pl === -1) continue;
    const g = prevGroups.get(pl) ?? new Map<string, number>();
    g.set(id, next.labels[id] ?? -1);
    prevGroups.set(pl, g);
  }
  for (const [pl, members] of [...prevGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const nextLabels = new Set<number>([...members.values()].filter((l) => l !== -1));
    if (nextLabels.size === 0) {
      shifts.push({ kind: 'dissolved', fromLabels: [pl], toLabel: -1, at: next.ts, size: members.size });
    } else if (nextLabels.size > 1) {
      shifts.push({ kind: 'split', fromLabels: [pl], toLabel: -1, at: next.ts, size: members.size });
    }
  }
  return shifts;
}
