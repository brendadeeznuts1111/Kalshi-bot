/**
 * Kalshi orderbook_delta `seq` is per subscription (sid), not per market_ticker.
 * @see https://docs.kalshi.com/websockets/orderbook-updates
 */
export type OrderbookStreamState = {
  sid?: number;
  lastSeq: number;
};

export function createOrderbookStreamState(sid?: number): OrderbookStreamState {
  return { sid, lastSeq: 0 };
}

/** Advance stream seq or detect gap / duplicate. */
export function advanceOrderbookStreamSeq(
  stream: OrderbookStreamState,
  seq: number,
): "ok" | "gap" | "duplicate" {
  if (stream.lastSeq === 0) {
    stream.lastSeq = seq;
    return "ok";
  }
  if (seq === stream.lastSeq + 1) {
    stream.lastSeq = seq;
    return "ok";
  }
  if (seq <= stream.lastSeq) return "duplicate";
  return "gap";
}

export function resetOrderbookStreamSeq(stream: OrderbookStreamState): void {
  stream.lastSeq = 0;
}
