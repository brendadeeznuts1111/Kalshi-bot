/**
 * consensus-history.ts — per (event, side) consensus snapshot store.
 *
 * The convergence detector (`classifyConvergence`) needs a PRIOR snapshot to
 * classify movement. This store persists the current consensus after each
 * report build (gitignored `research/cache/odds-consensus.json`, same
 * lifecycle as massey.db) and serves the previous one back:
 *
 *   report build N   → prior = snapshot from build N-1, then record build N
 *
 * Records are pruned per key (keep the latest KEEP_PER_KEY) and by age
 * (MAX_AGE_MS) so the file stays small. Pure record math + thin Bun.file IO;
 * every failure degrades to "no prior" (empty store), never a throw.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import { classifyConvergence, consensusSnapshot, type ConvergencePattern, type ConvergenceSnapshot } from "./value-patterns.ts";

export type ConsensusRecord = {
  eventId: string;
  side: string;
  ts: number;
  consensus: number;
  spread: number;
  bookmakers: number;
};

export type SnapshotStore = {
  records: ConsensusRecord[];
};

const MAX_AGE_MS = 24 * 60 * 60_000;
const KEEP_PER_KEY = 12;

const STORE_PATH = (root: string) => root + "/research/cache/odds-consensus.json";

export async function loadSnapshotStore(root: string): Promise<SnapshotStore> {
  const file = Bun.file(STORE_PATH(root));
  const parsed = (await file.json().catch(() => null)) as SnapshotStore | null;
  if (!parsed || !Array.isArray(parsed.records)) return { records: [] };
  return parsed;
}

export async function saveSnapshotStore(root: string, store: SnapshotStore): Promise<void> {
  await Bun.write(STORE_PATH(root), JSON.stringify(store, null, 2) + "\n");
}

const key = (r: ConsensusRecord) => r.eventId + "\u0000" + r.side;

/** Latest record for (eventId, side) — null when none recorded yet. */
export function latestRecord(store: SnapshotStore, eventId: string, side: string): ConsensusRecord | null {
  let latest: ConsensusRecord | null = null;
  for (const r of store.records) {
    if (r.eventId !== eventId || r.side !== side) continue;
    if (!latest || r.ts > latest.ts) latest = r;
  }
  return latest;
}

/** Build current records for every event×side quoting a valid consensus. */
export function currentRecords(events: OddsEvent[], now = Date.now()): ConsensusRecord[] {
  const records: ConsensusRecord[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    const sides = new Set<string>();
    for (const bk of ev.bookmakers) {
      for (const o of bk.markets[0]?.outcomes ?? []) sides.add(o.name);
    }
    for (const side of sides) {
      const snap = consensusSnapshot(events, ev.id, side);
      if (!snap) continue;
      const k = ev.id + "\u0000" + side;
      if (seen.has(k)) continue;
      seen.add(k);
      records.push({ eventId: ev.id, side, ts: snap.ts || now, consensus: snap.consensus, spread: snap.spread, bookmakers: snap.bookmakers });
    }
  }
  return records;
}

const toSnapshot = (r: ConsensusRecord): ConvergenceSnapshot =>
  ({ ts: r.ts, consensus: r.consensus, spread: r.spread, bookmakers: r.bookmakers });

/**
 * Merge new records into the store: prune by age, keep the latest
 * KEEP_PER_KEY per (event, side) key, drop exact duplicates.
 */
export function mergeRecords(store: SnapshotStore, incoming: ConsensusRecord[], now = Date.now()): SnapshotStore {
  const byKey = new Map<string, ConsensusRecord[]>();
  for (const r of [...store.records, ...incoming]) {
    if (now - r.ts > MAX_AGE_MS) continue;
    const list = byKey.get(key(r)) ?? [];
    if (!list.some((x) => x.ts === r.ts && x.consensus === r.consensus)) list.push(r);
    byKey.set(key(r), list);
  }
  const records: ConsensusRecord[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.ts - b.ts);
    records.push(...list.slice(-KEEP_PER_KEY));
  }
  return { records };
}

/**
 * Convergence classification for the report: current consensus vs the prior
 * stored snapshot per event×side. Emits one pattern per (event, side) with a
 * detectable movement, plus "stale" verdicts for aged quotes.
 */
export function classifyAgainstHistory(
  store: SnapshotStore,
  events: OddsEvent[],
  options?: { tightenPp?: number; widenPp?: number; movePp?: number; maxAgeMs?: number },
): ConvergencePattern[] {
  const out: ConvergencePattern[] = [];
  for (const rec of currentRecords(events)) {
    const prior = latestRecord(store, rec.eventId, rec.side);
    const pattern = classifyConvergence(rec.eventId, rec.side, toSnapshot(rec), prior ? toSnapshot(prior) : null, options);
    if (pattern) out.push(pattern);
  }
  return out;
}
