// @see https://docs.kalshi.com/getting_started/orderbook_responses
/**
 * Kalshi orderbook wire → interior BookSnapshot.
 * Kalshi returns bids only; YES asks derive from NO bids at (100 − noPrice).
 */
import type { BookLevel, BookSnapshot } from "../institutions/alpha-signal-types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDollarLevel(pair: unknown): BookLevel | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const priceDollars = Number(pair[0]);
  const size = Math.floor(Number(pair[1]));
  if (!Number.isFinite(priceDollars) || !Number.isFinite(size) || size <= 0) return null;
  const priceCents = Math.round(priceDollars * 100);
  if (priceCents <= 0 || priceCents >= 100) return null;
  return { priceCents, size };
}

function parseLegacyCentLevel(pair: unknown): BookLevel | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const priceCents = Number(pair[0]);
  const size = Math.floor(Number(pair[1]));
  if (!Number.isFinite(priceCents) || !Number.isFinite(size) || size <= 0) return null;
  if (priceCents <= 0 || priceCents >= 100) return null;
  return { priceCents, size };
}

function bestFirstBids(levels: BookLevel[]): BookLevel[] {
  return [...levels].sort((a, b) => b.priceCents - a.priceCents);
}

function bestFirstAsks(levels: BookLevel[]): BookLevel[] {
  return [...levels].sort((a, b) => a.priceCents - b.priceCents);
}

/** NO bid at P implies YES ask at (100 − P) cents — binary reciprocity. */
export function yesAsksFromNoBids(noBids: BookLevel[]): BookLevel[] {
  return noBids.map((l) => ({
    priceCents: 100 - l.priceCents,
    size: l.size,
  }));
}

/** YES bid P + NO bid Q > 100 implies a transient crossed book (free-money anomaly). */
export function isCrossedKalshiBook(yesBestBidCents: number | null, noBestBidCents: number | null): boolean {
  if (yesBestBidCents == null || noBestBidCents == null) return false;
  return yesBestBidCents + noBestBidCents > 100;
}

export function midFromBookSnapshot(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  if (bestBid > bestAsk) return null;
  return Math.round((bestBid + bestAsk) / 2);
}

/** Parse Kalshi GET /markets/{ticker}/orderbook response at wire boundary. */
export function parseKalshiOrderbookWire(wire: unknown, seq = 0): BookSnapshot {
  if (!isRecord(wire)) {
    throw new Error("Kalshi orderbook wire must be an object");
  }

  const fp = isRecord(wire.orderbook_fp) ? wire.orderbook_fp : null;
  const legacy = isRecord(wire.orderbook) ? wire.orderbook : null;

  let yesBids: BookLevel[] = [];
  let noBids: BookLevel[] = [];

  if (fp) {
    const yesRaw = Array.isArray(fp.yes_dollars) ? fp.yes_dollars : [];
    const noRaw = Array.isArray(fp.no_dollars) ? fp.no_dollars : [];
    yesBids = yesRaw.map(parseDollarLevel).filter((l): l is BookLevel => l != null);
    noBids = noRaw.map(parseDollarLevel).filter((l): l is BookLevel => l != null);
  } else if (legacy) {
    const yesRaw = Array.isArray(legacy.yes) ? legacy.yes : [];
    const noRaw = Array.isArray(legacy.no) ? legacy.no : [];
    yesBids = yesRaw.map(parseLegacyCentLevel).filter((l): l is BookLevel => l != null);
    noBids = noRaw.map(parseLegacyCentLevel).filter((l): l is BookLevel => l != null);
  }

  const bids = bestFirstBids(yesBids);
  const asks = bestFirstAsks(yesAsksFromNoBids(noBids));
  const yesBestBid = bids[0]?.priceCents ?? null;
  const noBestBid = bestFirstBids(noBids)[0]?.priceCents ?? null;
  const crossed = isCrossedKalshiBook(yesBestBid, noBestBid);

  return {
    ts: Date.now(),
    bids,
    asks,
    seq,
    ...(crossed ? { crossed: true } : {}),
  };
}
