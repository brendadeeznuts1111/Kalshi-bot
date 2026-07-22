/**
 * Local Kalshi orderbook reconstructed from WS snapshot + deltas.
 * @see https://docs.kalshi.com/websockets/orderbook-updates
 */
import type { BookLevel, BookSnapshot } from "../alpha-signal-types.ts";
import { isCrossedKalshiBook, yesAsksFromNoBids } from "../../bot/kalshi-book-parse.ts";

function sortBids(levels: BookLevel[]): BookLevel[] {
  return [...levels].sort((a, b) => b.priceCents - a.priceCents);
}
function sortAsks(levels: BookLevel[]): BookLevel[] {
  return [...levels].sort((a, b) => a.priceCents - b.priceCents);
}

export type LiveBookSide = "yes" | "no";

export type LiveOrderbook = {
  ticker: string;
  seq: number;
  /** Price cents → size (contracts, floored). */
  yes: Map<number, number>;
  no: Map<number, number>;
  ready: boolean;
};

function parseDollarPrice(raw: string): number | null {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  if (cents <= 0 || cents >= 100) return null;
  return cents;
}

function parseFpSize(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function levelsFromFpPairs(pairs: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(pairs)) return out;
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const price = parseDollarPrice(String(pair[0]));
    const size = parseFpSize(String(pair[1]));
    if (price == null || size == null || size <= 0) continue;
    out.set(price, size);
  }
  return out;
}

export function createEmptyLiveOrderbook(ticker: string): LiveOrderbook {
  return { ticker, seq: 0, yes: new Map(), no: new Map(), ready: false };
}

/** Apply full snapshot; resets yes/no maps. */
export function applyOrderbookSnapshot(
  book: LiveOrderbook,
  msg: {
    market_ticker?: string;
    yes_dollars_fp?: unknown;
    no_dollars_fp?: unknown;
  },
  seq: number,
): void {
  if (msg.market_ticker && msg.market_ticker !== book.ticker) {
    throw new Error(`snapshot ticker mismatch: ${msg.market_ticker} vs ${book.ticker}`);
  }
  book.yes = levelsFromFpPairs(msg.yes_dollars_fp);
  book.no = levelsFromFpPairs(msg.no_dollars_fp);
  book.seq = seq;
  book.ready = true;
}

/**
 * Apply incremental delta. Returns false if seq gap (caller should resync).
 * Size ≤ 0 removes the level.
 */
export function applyOrderbookDelta(
  book: LiveOrderbook,
  msg: {
    market_ticker?: string;
    price_dollars: string;
    delta_fp: string;
    side: string;
  },
  seq: number,
): boolean {
  if (!book.ready) return false;
  if (book.seq > 0 && seq !== book.seq + 1) {
    book.ready = false;
    return false;
  }
  if (msg.market_ticker && msg.market_ticker !== book.ticker) {
    book.ready = false;
    return false;
  }
  const price = parseDollarPrice(msg.price_dollars);
  const delta = Number(msg.delta_fp);
  if (price == null || !Number.isFinite(delta)) {
    book.ready = false;
    return false;
  }
  const side = msg.side === "yes" ? book.yes : msg.side === "no" ? book.no : null;
  if (!side) {
    book.ready = false;
    return false;
  }
  const next = (side.get(price) ?? 0) + Math.trunc(delta);
  if (next <= 0) side.delete(price);
  else side.set(price, next);
  book.seq = seq;
  return true;
}

export function liveOrderbookToSnapshot(book: LiveOrderbook, ts: number): BookSnapshot | null {
  if (!book.ready) return null;
  const yesBids: BookLevel[] = [...book.yes.entries()].map(([priceCents, size]) => ({
    priceCents,
    size,
  }));
  const noBids: BookLevel[] = [...book.no.entries()].map(([priceCents, size]) => ({
    priceCents,
    size,
  }));
  const bids = sortBids(yesBids);
  const asks = sortAsks(yesAsksFromNoBids(noBids));
  const yesBestBid = bids[0]?.priceCents ?? null;
  const noBestBid = sortBids(noBids)[0]?.priceCents ?? null;
  const crossed = isCrossedKalshiBook(yesBestBid, noBestBid);
  return {
    ts,
    bids,
    asks,
    seq: book.seq,
    ...(crossed ? { crossed: true as const } : {}),
  };
}
