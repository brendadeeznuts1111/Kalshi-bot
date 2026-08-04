// @see https://bun.com/docs/runtime/sqlite
// @see https://docs.kalshi.com/api-reference/market/get-market
/**
 * Backfill markets.volume_* for tickers that have quotes but null volume
 * (common after book-only syncs wiped volume, or never wrote it).
 *
 * Public Kalshi market GET — no auth. Opt-in network path for
 * `liquidity:ground --fetch-volume` / `liquidity:backfill-volume`.
 */
import type { Database } from "bun:sqlite";
import {
  asKalshiMarketTicker,
  type KalshiMarketTicker,
  unbrand,
} from "./brands.ts";
import {
  fetchKalshiMarket,
  type KalshiFetchImpl,
  type KalshiMarketWire,
} from "../../bot/kalshi-events-api.ts";
import { recomputeMatchLiquidityForEvents } from "./match-liquidity.ts";

export type BackfillVolumeResult = {
  candidates: number;
  fetched: number;
  updated: number;
  skipped: number;
  errors: number;
  eventIds: string[];
};

function needsVolume(row: {
  volume_fp: string | null;
  volume_24h_fp: string | null;
}): boolean {
  const v = Number(row.volume_fp ?? 0);
  const v24 = Number(row.volume_24h_fp ?? 0);
  return !(Number.isFinite(v) && v > 0) && !(Number.isFinite(v24) && v24 > 0);
}

/** Tickers under quoted match_liquidity rows with zero volume on markets. */
export function listQuotedZeroVolumeTickers(
  db: Database,
  options: { limit?: number } = {},
): Array<{ ticker: KalshiMarketTicker; eventId: string }> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 2000);
  const rows = db
    .query(
      `SELECT DISTINCT m.ticker AS ticker, m.event_id AS eventId,
              m.volume_fp AS volume_fp, m.volume_24h_fp AS volume_24h_fp
       FROM markets m
       INNER JOIN match_liquidity ml ON ml.event_id = m.event_id
       WHERE ml.book_tick_count > 0
       LIMIT $lim`,
    )
    .all({ $lim: limit * 4 }) as Array<{
    ticker: string;
    eventId: string;
    volume_fp: string | null;
    volume_24h_fp: string | null;
  }>;

  const out: Array<{ ticker: KalshiMarketTicker; eventId: string }> = [];
  for (const r of rows) {
    if (!needsVolume(r)) continue;
    try {
      out.push({ ticker: asKalshiMarketTicker(r.ticker), eventId: r.eventId });
    } catch {
      continue;
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function applyMarketVolumeWire(
  db: Database,
  ticker: KalshiMarketTicker,
  wire: KalshiMarketWire,
): boolean {
  const vol = wire.volume_fp ?? null;
  const vol24 = wire.volume_24h_fp ?? null;
  const oi = wire.open_interest_fp ?? null;
  const bidSz = wire.yes_bid_size_fp ?? null;
  const askSz = wire.yes_ask_size_fp ?? null;
  if (vol == null && vol24 == null && oi == null) return false;

  const result = db
    .query(
      `UPDATE markets SET
         volume_fp = COALESCE($vol, volume_fp),
         volume_24h_fp = COALESCE($vol24, volume_24h_fp),
         open_interest_fp = COALESCE($oi, open_interest_fp),
         yes_bid_size_fp = COALESCE($bid, yes_bid_size_fp),
         yes_ask_size_fp = COALESCE($ask, yes_ask_size_fp)
       WHERE ticker = $ticker
         AND (
           volume_fp IS NULL OR volume_fp = '' OR CAST(volume_fp AS REAL) = 0
         )
         AND (
           volume_24h_fp IS NULL OR volume_24h_fp = '' OR CAST(volume_24h_fp AS REAL) = 0
         )`,
    )
    .run({
      $ticker: unbrand(ticker),
      $vol: vol,
      $vol24: vol24,
      $oi: oi,
      $bid: bidSz,
      $ask: askSz,
    });
  return (result.changes ?? 0) > 0;
}

/**
 * Fetch public market volume for quoted zero-vol tickers, update markets, recompute match_liquidity.
 */
export async function backfillQuotedMarketVolumes(
  db: Database,
  options: {
    limit?: number;
    fetchImpl?: KalshiFetchImpl;
    baseUrl?: string;
    /** Delay between requests (ms). Default 50. */
    pauseMs?: number;
    fetchMarket?: typeof fetchKalshiMarket;
  } = {},
): Promise<BackfillVolumeResult> {
  const candidates = listQuotedZeroVolumeTickers(db, { limit: options.limit ?? 100 });
  const fetchMarket = options.fetchMarket ?? fetchKalshiMarket;
  const pauseMs = options.pauseMs ?? 50;
  let fetched = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const eventIds = new Set<string>();

  for (const { ticker, eventId } of candidates) {
    try {
      const wire = await fetchMarket(ticker, {
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
      });
      fetched++;
      if (!wire) {
        skipped++;
        continue;
      }
      if (applyMarketVolumeWire(db, ticker, wire)) {
        updated++;
        eventIds.add(eventId);
      } else {
        skipped++;
      }
    } catch {
      errors++;
    }
    if (pauseMs > 0) await Bun.sleep(pauseMs);
  }

  if (eventIds.size > 0) {
    recomputeMatchLiquidityForEvents(db, [...eventIds]);
  }

  return {
    candidates: candidates.length,
    fetched,
    updated,
    skipped,
    errors,
    eventIds: [...eventIds],
  };
}
