/**
 * live-consensus.ts — stateful live consensus stream: feeds repeated odds
 * snapshots into a ConsensusTracker and surfaces steam-move shifts as they
 * happen (the live consumer of the heap clusterer, §193).
 *
 * The alpha:cluster CLI's two manual pushes are the static demo; this stream
 * is what a polling loop (alpha:consensus:watch) drives: observe() per pass,
 * shifts accumulate into a bounded rolling window for alerting/UI.
 */
import { eventsToOddsPrints } from '../signal-context.ts';
import type { OddsEvent } from '../odds-types.ts';
import type { OddsPrint } from './odds-vector.ts';
import type { ConsensusShift } from './consensus.ts';
import { ConsensusTracker, type ConsensusSnapshot } from './tracker.ts';

export interface LiveConsensusOptions {
  minClusterSize?: number;
  /** Rolling shift-history window size (default 20). */
  windowSize?: number;
}

/**
 * Drives one ConsensusTracker across repeated snapshots. Every push returns the
 * snapshot (with its shifts) and appends those shifts to a bounded history.
 */
export class LiveConsensusStream {
  private tracker = new ConsensusTracker();
  private history: ConsensusShift[] = [];
  private ticks = 0;
  constructor(private readonly opts: LiveConsensusOptions = {}) {}

  /** Push a raw The Odds API events snapshot (converts to prints first). */
  observeEvents(events: OddsEvent[], ts: number): ConsensusSnapshot | null {
    return this.observe(eventsToOddsPrints(events), ts);
  }

  /** Push one prints snapshot; null when fewer than 2 prints (nothing to cluster). */
  observe(prints: OddsPrint[], ts: number): ConsensusSnapshot | null {
    if (prints.length < 2) return null;
    this.ticks += 1;
    const snap =
      this.opts.minClusterSize !== undefined
        ? this.tracker.push(prints, ts, { minClusterSize: this.opts.minClusterSize })
        : this.tracker.push(prints, ts);
    this.history.push(...snap.shifts);
    const limit = this.opts.windowSize ?? 20;
    if (this.history.length > limit) this.history.splice(0, this.history.length - limit);
    return snap;
  }

  /** Bounded rolling shift history (steam-move alerts across the live window). */
  get shiftHistory(): readonly ConsensusShift[] {
    return this.history;
  }

  /** Snapshots ingested since construction/last reset. */
  get tickCount(): number {
    return this.ticks;
  }

  reset(): void {
    this.tracker.reset();
    this.history = [];
    this.ticks = 0;
  }
}
