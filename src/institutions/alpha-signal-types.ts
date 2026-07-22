/** Shared alpha-program wire types — tenants + calibration watcher. */

export interface BookLevel {
  priceCents: number;
  size: number;
}

export interface BookSnapshot {
  ts: number;
  bids: BookLevel[];
  asks: BookLevel[];
  seq: number;
  /** Transient yesBid+noBid>100 — skip mid/VWAP; do not treat as tradeable. */
  crossed?: boolean;
}

export interface Decision {
  action: "trade" | "skip";
  side?: "yes" | "no";
  contracts?: number;
  limitCents?: number;
  reason: string;
}

export interface SignalContext {
  ticker: string;
  eventId: string;
  book: BookSnapshot;
  pModel: number;
  components: Record<string, number>;
  contracts?: number;
}
