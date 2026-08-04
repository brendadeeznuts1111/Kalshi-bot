// @see https://bun.com/docs/runtime/sqlite
/**
 * Match-level liquidity aggregation for HQ REST.
 *
 * Derives volume / spread / liquidity_ok / tradable from markets + latest
 * book_ticks. Does not invent a matchHash — event_id is the SSOT key.
 *
 * Glossary: liquidity_ok, kalshi_spread, kalshi_volume, total_volume_usd.
 */
import type { Database } from "bun:sqlite";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import { midFromBookSnapshot } from "../../bot/kalshi-book-parse.ts";

/** Desk gates — necessary for liquidity_ok (not sufficient for desk trade). */
export const LIQUIDITY_GATES = {
  /** Min trailing 24h volume (Kalshi volume_24h_fp contracts ≈ notional). */
  minVolume24hFp: 500,
  /** Max bid–ask spread on preferred match-winner book (cents). */
  maxSpreadCents: 15,
  /** Mid band for tradable (deep favorites / longshots out). */
  midBandMinCents: 20,
  midBandMaxCents: 80,
} as const;

export type MatchLiquidityRow = {
  eventId: string;
  tournament: string;
  tour: string;
  sportKey: string;
  volumeFp: number;
  volume24hFp: number;
  openInterestFp: number;
  spreadCents: number | null;
  midCents: number | null;
  marketCount: number;
  bookTickCount: number;
  crossed: boolean;
  liquidityOk: boolean;
  tradable: boolean;
  updatedTs: number;
  source: string;
};

export type MatchLiquidityApiPayload = MatchLiquidityRow & {
  gates: typeof LIQUIDITY_GATES;
};

type MarketAgg = {
  eventId: string;
  tournament: string;
  tour: string;
  volumeFp: number;
  volume24hFp: number;
  openInterestFp: number;
  marketCount: number;
};

type BookAgg = {
  spreadCents: number | null;
  midCents: number | null;
  bookTickCount: number;
  crossed: boolean;
};

function fpNumber(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseBookSnapshot(levelsJson: string): BookSnapshot | null {
  try {
    const o = JSON.parse(levelsJson) as BookSnapshot;
    if (!o || !Array.isArray(o.bids) || !Array.isArray(o.asks)) return null;
    return o;
  } catch {
    return null;
  }
}

/** Spread (ask − bid) in cents; null if crossed or missing sides. */
export function spreadCentsFromBook(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bid = book.bids[0]?.priceCents;
  const ask = book.asks[0]?.priceCents;
  if (bid == null || ask == null) return null;
  if (ask < bid) return null;
  return ask - bid;
}

export function evaluateLiquidityGates(input: {
  volume24hFp: number;
  spreadCents: number | null;
  midCents: number | null;
  crossed: boolean;
  gates?: typeof LIQUIDITY_GATES;
}): { liquidityOk: boolean; tradable: boolean } {
  const g = input.gates ?? LIQUIDITY_GATES;
  const liquidityOk =
    !input.crossed &&
    input.volume24hFp >= g.minVolume24hFp &&
    input.spreadCents != null &&
    input.spreadCents <= g.maxSpreadCents;
  const midOk =
    input.midCents != null &&
    input.midCents >= g.midBandMinCents &&
    input.midCents <= g.midBandMaxCents;
  return {
    liquidityOk,
    tradable: liquidityOk && midOk,
  };
}

function loadMarketAgg(db: Database, eventId?: string): MarketAgg[] {
  const sql = `
    SELECT
      e.event_id AS eventId,
      e.tournament AS tournament,
      e.tour AS tour,
      COALESCE(SUM(CAST(COALESCE(m.volume_fp, '0') AS REAL)), 0) AS volumeFp,
      COALESCE(SUM(CAST(COALESCE(m.volume_24h_fp, '0') AS REAL)), 0) AS volume24hFp,
      COALESCE(SUM(CAST(COALESCE(m.open_interest_fp, '0') AS REAL)), 0) AS openInterestFp,
      COUNT(m.market_id) AS marketCount
    FROM events e
    LEFT JOIN markets m ON m.event_id = e.event_id
    ${eventId ? "WHERE e.event_id = $eventId" : ""}
    GROUP BY e.event_id
  `;
  const rows = eventId
    ? (db.query(sql).all({ $eventId: eventId }) as MarketAgg[])
    : (db.query(sql).all() as MarketAgg[]);
  return rows.map((r) => ({
    eventId: r.eventId,
    tournament: r.tournament ?? "",
    tour: r.tour ?? "",
    volumeFp: fpNumber(r.volumeFp),
    volume24hFp: fpNumber(r.volume24hFp),
    openInterestFp: fpNumber(r.openInterestFp),
    marketCount: Number(r.marketCount) || 0,
  }));
}

/**
 * Prefer latest match_winner book tick; fall back to any latest tick for the event.
 * Picks the tightest non-crossed spread among latest-per-ticker rows.
 */
function loadBookAgg(db: Database, eventId: string): BookAgg {
  const rows = db
    .query(
      `SELECT bt.ticker, bt.market_kind AS marketKind, bt.levels_json AS levelsJson, bt.ts
       FROM book_ticks bt
       INNER JOIN (
         SELECT ticker, MAX(ts) AS max_ts
         FROM book_ticks
         WHERE event_id = $eventId
         GROUP BY ticker
       ) latest ON latest.ticker IS bt.ticker AND latest.max_ts = bt.ts
       WHERE bt.event_id = $eventId`,
    )
    .all({ $eventId: eventId }) as Array<{
    ticker: string | null;
    marketKind: string;
    levelsJson: string;
    ts: number;
  }>;

  if (rows.length === 0) {
    return { spreadCents: null, midCents: null, bookTickCount: 0, crossed: false };
  }

  let anyCrossed = false;
  let best: { spread: number; mid: number | null; kindScore: number } | null = null;

  for (const row of rows) {
    const book = parseBookSnapshot(row.levelsJson);
    if (!book) continue;
    if (book.crossed) {
      anyCrossed = true;
      continue;
    }
    const spread = spreadCentsFromBook(book);
    const mid = midFromBookSnapshot(book);
    if (spread == null) continue;
    const kindScore = row.marketKind === "match_winner" || row.marketKind === "" ? 0 : 1;
    if (
      !best ||
      kindScore < best.kindScore ||
      (kindScore === best.kindScore && spread < best.spread)
    ) {
      best = { spread, mid, kindScore };
    }
  }

  return {
    spreadCents: best?.spread ?? null,
    midCents: best?.mid ?? null,
    bookTickCount: rows.length,
    crossed: anyCrossed && best == null,
  };
}

function sportKeyFromTour(tour: string): string {
  const t = tour.trim().toUpperCase();
  if (t === "ATP" || t === "WTA" || t === "ITF" || t.startsWith("ITF")) return "tennis";
  if (t === "NBA" || t === "NCAAB") return "basketball";
  if (t === "NFL" || t === "NCAAF") return "american_football";
  if (t === "MLB") return "baseball";
  return t ? t.toLowerCase() : "tennis";
}

function upsertRow(db: Database, row: MatchLiquidityRow): void {
  db.query(
    `INSERT INTO match_liquidity (
       event_id, tournament, tour, sport_key,
       volume_fp, volume_24h_fp, open_interest_fp,
       spread_cents, mid_cents, market_count, book_tick_count,
       crossed, liquidity_ok, tradable, updated_ts, source
     ) VALUES (
       $event_id, $tournament, $tour, $sport_key,
       $volume_fp, $volume_24h_fp, $open_interest_fp,
       $spread_cents, $mid_cents, $market_count, $book_tick_count,
       $crossed, $liquidity_ok, $tradable, $updated_ts, $source
     )
     ON CONFLICT(event_id) DO UPDATE SET
       tournament = excluded.tournament,
       tour = excluded.tour,
       sport_key = excluded.sport_key,
       volume_fp = excluded.volume_fp,
       volume_24h_fp = excluded.volume_24h_fp,
       open_interest_fp = excluded.open_interest_fp,
       spread_cents = excluded.spread_cents,
       mid_cents = excluded.mid_cents,
       market_count = excluded.market_count,
       book_tick_count = excluded.book_tick_count,
       crossed = excluded.crossed,
       liquidity_ok = excluded.liquidity_ok,
       tradable = excluded.tradable,
       updated_ts = excluded.updated_ts,
       source = excluded.source`,
  ).run({
    $event_id: row.eventId,
    $tournament: row.tournament,
    $tour: row.tour,
    $sport_key: row.sportKey,
    $volume_fp: row.volumeFp,
    $volume_24h_fp: row.volume24hFp,
    $open_interest_fp: row.openInterestFp,
    $spread_cents: row.spreadCents,
    $mid_cents: row.midCents,
    $market_count: row.marketCount,
    $book_tick_count: row.bookTickCount,
    $crossed: row.crossed ? 1 : 0,
    $liquidity_ok: row.liquidityOk ? 1 : 0,
    $tradable: row.tradable ? 1 : 0,
    $updated_ts: row.updatedTs,
    $source: row.source,
  });
}

function buildRow(db: Database, market: MarketAgg, now: number): MatchLiquidityRow {
  const book = loadBookAgg(db, market.eventId);
  const gates = evaluateLiquidityGates({
    volume24hFp: market.volume24hFp,
    spreadCents: book.spreadCents,
    midCents: book.midCents,
    crossed: book.crossed,
  });
  return {
    eventId: market.eventId,
    tournament: market.tournament,
    tour: market.tour,
    sportKey: sportKeyFromTour(market.tour),
    volumeFp: market.volumeFp,
    volume24hFp: market.volume24hFp,
    openInterestFp: market.openInterestFp,
    spreadCents: book.spreadCents,
    midCents: book.midCents,
    marketCount: market.marketCount,
    bookTickCount: book.bookTickCount,
    crossed: book.crossed,
    liquidityOk: gates.liquidityOk,
    tradable: gates.tradable,
    updatedTs: now,
    source: "event-store",
  };
}

/** Recompute one event (or all events when eventId omitted). Returns rows written. */
export function recomputeMatchLiquidity(db: Database, eventId?: string): number {
  const markets = loadMarketAgg(db, eventId);
  if (markets.length === 0) return 0;
  const now = Date.now();
  let n = 0;
  const tx = db.transaction((rows: MarketAgg[]) => {
    for (const m of rows) {
      upsertRow(db, buildRow(db, m, now));
      n++;
    }
  });
  tx(markets);
  return n;
}

/** Batch recompute for known event ids (e.g. after book poll). */
export function recomputeMatchLiquidityForEvents(db: Database, eventIds: string[]): number {
  const unique = [...new Set(eventIds.filter(Boolean))];
  let n = 0;
  for (const id of unique) {
    n += recomputeMatchLiquidity(db, id);
  }
  return n;
}

function mapSqlRow(r: Record<string, unknown>): MatchLiquidityRow {
  return {
    eventId: String(r.event_id ?? r.eventId ?? ""),
    tournament: String(r.tournament ?? ""),
    tour: String(r.tour ?? ""),
    sportKey: String(r.sport_key ?? r.sportKey ?? "tennis"),
    volumeFp: fpNumber(r.volume_fp as number),
    volume24hFp: fpNumber(r.volume_24h_fp as number),
    openInterestFp: fpNumber(r.open_interest_fp as number),
    spreadCents: r.spread_cents == null ? null : fpNumber(r.spread_cents as number),
    midCents: r.mid_cents == null ? null : fpNumber(r.mid_cents as number),
    marketCount: Number(r.market_count) || 0,
    bookTickCount: Number(r.book_tick_count) || 0,
    crossed: Number(r.crossed) === 1,
    liquidityOk: Number(r.liquidity_ok) === 1,
    tradable: Number(r.tradable) === 1,
    updatedTs: Number(r.updated_ts) || 0,
    source: String(r.source ?? "event-store"),
  };
}

export function getMatchLiquidity(db: Database, eventId: string): MatchLiquidityRow | null {
  const row = db
    .query(`SELECT * FROM match_liquidity WHERE event_id = $id`)
    .get({ $id: eventId }) as Record<string, unknown> | null;
  if (!row) return null;
  return mapSqlRow(row);
}

export function listMatchLiquidityByTournament(
  db: Database,
  tournamentKey: string,
  options: { sportKey?: string; limit?: number } = {},
): MatchLiquidityRow[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const sport = options.sportKey?.trim();
  const sql = sport
    ? `SELECT * FROM match_liquidity
       WHERE tournament = $t AND sport_key = $s
       ORDER BY volume_24h_fp DESC, updated_ts DESC
       LIMIT $lim`
    : `SELECT * FROM match_liquidity
       WHERE tournament = $t
       ORDER BY volume_24h_fp DESC, updated_ts DESC
       LIMIT $lim`;
  const rows = sport
    ? (db.query(sql).all({ $t: tournamentKey, $s: sport, $lim: limit }) as Record<string, unknown>[])
    : (db.query(sql).all({ $t: tournamentKey, $lim: limit }) as Record<string, unknown>[]);
  return rows.map(mapSqlRow);
}

export function toLiquidityApiPayload(row: MatchLiquidityRow): MatchLiquidityApiPayload {
  return { ...row, gates: LIQUIDITY_GATES };
}

/** Schema presence + gate math for offline proof (`bun run check:liquidity`). */
export function assertMatchLiquidityHealthy(db: Database): {
  ok: true;
  table: string;
  rowCount: number;
} {
  const tables = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='match_liquidity'`)
    .all() as Array<{ name: string }>;
  if (tables.length !== 1) {
    throw new Error("match_liquidity table missing — openEventStore / apply schema first");
  }
  const probe = evaluateLiquidityGates({
    volume24hFp: LIQUIDITY_GATES.minVolume24hFp,
    spreadCents: LIQUIDITY_GATES.maxSpreadCents,
    midCents: 50,
    crossed: false,
  });
  if (!probe.liquidityOk || !probe.tradable) {
    throw new Error("liquidity gate self-check failed at threshold boundary");
  }
  const fail = evaluateLiquidityGates({
    volume24hFp: LIQUIDITY_GATES.minVolume24hFp - 1,
    spreadCents: LIQUIDITY_GATES.maxSpreadCents,
    midCents: 50,
    crossed: false,
  });
  if (fail.liquidityOk) {
    throw new Error("liquidity gate self-check: expected volume under min to fail");
  }
  const count = (db.query(`SELECT COUNT(*) AS n FROM match_liquidity`).get() as { n: number }).n;
  return { ok: true, table: "match_liquidity", rowCount: count };
}
