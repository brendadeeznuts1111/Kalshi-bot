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
  /**
   * Min volume (contracts ≈ notional). Prefer trailing 24h (`volume_24h_fp`);
   * fall back to lifetime `volume_fp` when 24h is zero/missing (common on ITF sync).
   */
  minVolume24hFp: 500,
  /** Max bid–ask spread on preferred match-winner book (cents). */
  maxSpreadCents: 15,
  /** Mid band for tradable (deep favorites / longshots out). */
  midBandMinCents: 20,
  midBandMaxCents: 80,
  /**
   * Max age of a non-empty book quote used for gates (ms).
   * Default 14d — offline event-store snapshots are often multi-day old;
   * set lower (e.g. 15–60m) for live desk.
   */
  quoteMaxAgeMs: 14 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Volume used for desk gates: 24h when present, else lifetime.
 * Stores both columns on the row; only the gate uses this blend.
 */
export function effectiveVolumeForGate(volume24hFp: number, volumeFp: number): number {
  if (volume24hFp > 0) return volume24hFp;
  return volumeFp > 0 ? volumeFp : 0;
}

/** True when book has a two-sided top of book (empty bids/asks do not count). */
export function bookHasTopOfBook(book: BookSnapshot): boolean {
  const bid = book.bids[0]?.priceCents;
  const ask = book.asks[0]?.priceCents;
  return bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask);
}

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
  /** Lifetime volume — used when volume24hFp is 0. */
  volumeFp?: number;
  spreadCents: number | null;
  midCents: number | null;
  crossed: boolean;
  gates?: typeof LIQUIDITY_GATES;
}): { liquidityOk: boolean; tradable: boolean; volumeForGate: number } {
  const g = input.gates ?? LIQUIDITY_GATES;
  const volumeForGate = effectiveVolumeForGate(input.volume24hFp, input.volumeFp ?? 0);
  const liquidityOk =
    !input.crossed &&
    volumeForGate >= g.minVolume24hFp &&
    input.spreadCents != null &&
    input.spreadCents <= g.maxSpreadCents;
  const midOk =
    input.midCents != null &&
    input.midCents >= g.midBandMinCents &&
    input.midCents <= g.midBandMaxCents;
  return {
    liquidityOk,
    tradable: liquidityOk && midOk,
    volumeForGate,
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
 * Per ticker: walk ticks newest→oldest and take the first non-empty top-of-book
 * within {@link LIQUIDITY_GATES.quoteMaxAgeMs}. Empty latest shells no longer
 * hide a good prior quote (common after REST polls with no depth).
 *
 * Across tickers: prefer match_winner, then tightest spread.
 */
function loadBookAgg(
  db: Database,
  eventId: string,
  options: { maxAgeMs?: number; nowMs?: number } = {},
): BookAgg {
  const maxAgeMs = options.maxAgeMs ?? LIQUIDITY_GATES.quoteMaxAgeMs;
  const nowMs = options.nowMs ?? Date.now();
  const rows = db
    .query(
      `SELECT ticker, market_kind AS marketKind, levels_json AS levelsJson, ts
       FROM book_ticks
       WHERE event_id = $eventId
       ORDER BY ticker ASC, ts DESC`,
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

  // First non-empty quote per ticker (rows already newest-first within ticker).
  const quoteByTicker = new Map<
    string,
    { marketKind: string; book: ReturnType<typeof parseBookSnapshot> & object; ts: number }
  >();
  for (const row of rows) {
    const key = row.ticker ?? "";
    if (quoteByTicker.has(key)) continue;
    if (nowMs - row.ts > maxAgeMs) continue;
    const book = parseBookSnapshot(row.levelsJson);
    if (!book || !bookHasTopOfBook(book)) continue;
    quoteByTicker.set(key, { marketKind: row.marketKind, book, ts: row.ts });
  }

  if (quoteByTicker.size === 0) {
    return { spreadCents: null, midCents: null, bookTickCount: 0, crossed: false };
  }

  let anyCrossed = false;
  let quotedCount = 0;
  let best: { spread: number; mid: number | null; kindScore: number } | null = null;

  for (const { marketKind, book } of quoteByTicker.values()) {
    quotedCount++;
    if (book.crossed) {
      anyCrossed = true;
      continue;
    }
    const spread = spreadCentsFromBook(book);
    const mid = midFromBookSnapshot(book);
    if (spread == null) continue;
    const kindScore = marketKind === "match_winner" || marketKind === "" ? 0 : 1;
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
    bookTickCount: quotedCount,
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
    volumeFp: market.volumeFp,
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

/**
 * Compact desk flags for live board join (eventTicker → match_liquidity).
 * `quoted` is book_tick_count > 0 (glossary desk.quoted).
 */
export type DeskLiquidityFlags = {
  liquidityOk: boolean;
  tradable: boolean;
  quoted: boolean;
  spreadCents: number | null;
  midCents: number | null;
  volume24hFp: number;
  volumeFp: number;
  volumeForGate: number;
};

export function deskFlagsFromRow(row: MatchLiquidityRow): DeskLiquidityFlags {
  return {
    liquidityOk: row.liquidityOk,
    tradable: row.tradable,
    quoted: row.bookTickCount > 0,
    spreadCents: row.spreadCents,
    midCents: row.midCents,
    volume24hFp: row.volume24hFp,
    volumeFp: row.volumeFp,
    volumeForGate: effectiveVolumeForGate(row.volume24hFp, row.volumeFp),
  };
}

/** Full-table index for O(1) board enrichment. Empty when table missing. */
export function listDeskLiquidityByEventId(db: Database): Map<string, DeskLiquidityFlags> {
  const out = new Map<string, DeskLiquidityFlags>();
  if (!matchLiquidityTablePresent(db)) return out;
  const rows = db
    .query(
      `SELECT event_id, liquidity_ok, tradable, book_tick_count,
              spread_cents, mid_cents, volume_24h_fp, volume_fp
       FROM match_liquidity`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    const eventId = String(r.event_id ?? "");
    if (!eventId) continue;
    const volume24hFp = fpNumber(r.volume_24h_fp as number);
    const volumeFp = fpNumber(r.volume_fp as number);
    out.set(eventId, {
      liquidityOk: Number(r.liquidity_ok) === 1,
      tradable: Number(r.tradable) === 1,
      quoted: (Number(r.book_tick_count) || 0) > 0,
      spreadCents: r.spread_cents == null ? null : fpNumber(r.spread_cents as number),
      midCents: r.mid_cents == null ? null : fpNumber(r.mid_cents as number),
      volume24hFp,
      volumeFp,
      volumeForGate: effectiveVolumeForGate(volume24hFp, volumeFp),
    });
  }
  return out;
}

export function listMatchLiquidityByTournament(
  db: Database,
  tournamentKey: string,
  options: { sportKey?: string; limit?: number } = {},
): MatchLiquidityRow[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const sport = options.sportKey?.trim();
  // Rank by gate volume (24h preferred, else lifetime) so zero-vol24 rows still surface.
  const sql = sport
    ? `SELECT * FROM match_liquidity
       WHERE tournament = $t AND sport_key = $s
       ORDER BY CASE WHEN volume_24h_fp > 0 THEN volume_24h_fp ELSE volume_fp END DESC,
                updated_ts DESC
       LIMIT $lim`
    : `SELECT * FROM match_liquidity
       WHERE tournament = $t
       ORDER BY CASE WHEN volume_24h_fp > 0 THEN volume_24h_fp ELSE volume_fp END DESC,
                updated_ts DESC
       LIMIT $lim`;
  const rows = sport
    ? (db.query(sql).all({ $t: tournamentKey, $s: sport, $lim: limit }) as Record<string, unknown>[])
    : (db.query(sql).all({ $t: tournamentKey, $lim: limit }) as Record<string, unknown>[]);
  return rows.map(mapSqlRow);
}

export function toLiquidityApiPayload(row: MatchLiquidityRow): MatchLiquidityApiPayload {
  return { ...row, gates: LIQUIDITY_GATES };
}

/** Glossary concept ids bound to the desk liquidity board (HQ + partners). */
export const LIQUIDITY_BOARD_CONCEPTS = {
  liquidityOk: "liquidity_ok",
  tradable: "desk.tradable",
  quoted: "desk.quoted",
  volume: "kalshi_volume",
  spread: "kalshi_spread",
  totalVolume: "total_volume_usd",
  kpis: [
    "kpi.tight_markets",
    "kpi.tradable_matches",
    "kpi.quoted_books",
    "kpi.median_spread",
    "kpi.board_volume",
  ],
} as const;

export type LiquidityTournamentRollup = {
  tournament: string;
  count: number;
  liquidityOk: number;
  tradable: number;
  volume: number;
};

export type LiquidityBoardPayload = {
  schemaVersion: 1;
  summary: MatchLiquiditySummary;
  gates: typeof LIQUIDITY_GATES;
  concepts: typeof LIQUIDITY_BOARD_CONCEPTS;
  medianSpreadCents: number | null;
  boardVolume: number;
  top: MatchLiquidityApiPayload[];
  byTournament: LiquidityTournamentRollup[];
};

/** HQ / partners board payload from match_liquidity (+ glossary concept map). */
export function buildLiquidityBoardPayload(
  db: Database,
  options: { topLimit?: number; tournamentLimit?: number } = {},
): LiquidityBoardPayload {
  const summary = summarizeMatchLiquidity(db);
  const topLimit = Math.min(Math.max(options.topLimit ?? 24, 1), 100);
  const tournamentLimit = Math.min(Math.max(options.tournamentLimit ?? 16, 1), 50);

  let medianSpreadCents: number | null = null;
  let boardVolume = 0;
  let byTournament: LiquidityTournamentRollup[] = [];

  if (summary.tablePresent) {
    const mid = db
      .query(
        `SELECT spread_cents AS s FROM match_liquidity
         WHERE spread_cents IS NOT NULL
         ORDER BY spread_cents`,
      )
      .all() as Array<{ s: number }>;
    if (mid.length) {
      medianSpreadCents = mid[Math.floor(mid.length / 2)]!.s;
    }
    boardVolume =
      (
        db
          .query(
            `SELECT COALESCE(SUM(
               CASE WHEN volume_24h_fp > 0 THEN volume_24h_fp ELSE volume_fp END
             ), 0) AS v FROM match_liquidity`,
          )
          .get() as { v: number }
      ).v ?? 0;

    byTournament = (
      db
        .query(
          `SELECT
             tournament AS tournament,
             COUNT(*) AS count,
             COALESCE(SUM(liquidity_ok), 0) AS liquidityOk,
             COALESCE(SUM(tradable), 0) AS tradable,
             COALESCE(SUM(CASE WHEN volume_24h_fp > 0 THEN volume_24h_fp ELSE volume_fp END), 0) AS volume
           FROM match_liquidity
           GROUP BY tournament
           ORDER BY volume DESC
           LIMIT $lim`,
        )
        .all({ $lim: tournamentLimit }) as Array<Record<string, number | string>>
    ).map((r) => ({
      tournament: String(r.tournament ?? ""),
      count: Number(r.count) || 0,
      liquidityOk: Number(r.liquidityOk) || 0,
      tradable: Number(r.tradable) || 0,
      volume: Number(r.volume) || 0,
    }));
  }

  const topRows = listTopMatchLiquidity(db, { limit: topLimit * 2 });
  topRows.sort((a, b) => {
    const score = (r: MatchLiquidityRow) =>
      (r.tradable ? 4 : 0) + (r.liquidityOk ? 2 : 0) + (r.bookTickCount > 0 ? 1 : 0);
    const d = score(b) - score(a);
    if (d !== 0) return d;
    const va = a.volume24hFp > 0 ? a.volume24hFp : a.volumeFp;
    const vb = b.volume24hFp > 0 ? b.volume24hFp : b.volumeFp;
    return vb - va;
  });

  return {
    schemaVersion: 1,
    summary,
    gates: LIQUIDITY_GATES,
    concepts: LIQUIDITY_BOARD_CONCEPTS,
    medianSpreadCents,
    boardVolume,
    top: topRows.slice(0, topLimit).map(toLiquidityApiPayload),
    byTournament,
  };
}


/** Machine summary for data-plane snapshot + WebView ground KPIs. */
export type MatchLiquiditySummary = {
  total: number;
  liquidityOk: number;
  tradable: number;
  quoted: number;
  withSpread: number;
  vol24Pos: number;
  lifetimeOnly500: number;
  tablePresent: boolean;
};

export function matchLiquidityTablePresent(db: Database): boolean {
  const tables = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name='match_liquidity'`)
    .all() as Array<{ name: string }>;
  return tables.length === 1;
}

export function summarizeMatchLiquidity(db: Database): MatchLiquiditySummary {
  if (!matchLiquidityTablePresent(db)) {
    return {
      total: 0,
      liquidityOk: 0,
      tradable: 0,
      quoted: 0,
      withSpread: 0,
      vol24Pos: 0,
      lifetimeOnly500: 0,
      tablePresent: false,
    };
  }
  const row = db
    .query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(liquidity_ok), 0) AS liquidityOk,
         COALESCE(SUM(tradable), 0) AS tradable,
         COALESCE(SUM(CASE WHEN book_tick_count > 0 THEN 1 ELSE 0 END), 0) AS quoted,
         COALESCE(SUM(CASE WHEN spread_cents IS NOT NULL THEN 1 ELSE 0 END), 0) AS withSpread,
         COALESCE(SUM(CASE WHEN volume_24h_fp > 0 THEN 1 ELSE 0 END), 0) AS vol24Pos,
         COALESCE(SUM(CASE WHEN volume_24h_fp = 0 AND volume_fp >= 500 THEN 1 ELSE 0 END), 0) AS lifetimeOnly500
       FROM match_liquidity`,
    )
    .get() as Record<string, number>;
  return {
    total: Number(row.total) || 0,
    liquidityOk: Number(row.liquidityOk) || 0,
    tradable: Number(row.tradable) || 0,
    quoted: Number(row.quoted) || 0,
    withSpread: Number(row.withSpread) || 0,
    vol24Pos: Number(row.vol24Pos) || 0,
    lifetimeOnly500: Number(row.lifetimeOnly500) || 0,
    tablePresent: true,
  };
}

/** Top rows for dashboards — effective volume desc. */
export function listTopMatchLiquidity(
  db: Database,
  options: { limit?: number; onlyQuoted?: boolean; onlyOk?: boolean } = {},
): MatchLiquidityRow[] {
  if (!matchLiquidityTablePresent(db)) return [];
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  const where: string[] = [];
  if (options.onlyQuoted) where.push("book_tick_count > 0");
  if (options.onlyOk) where.push("liquidity_ok = 1");
  const sql = `
    SELECT * FROM match_liquidity
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE WHEN volume_24h_fp > 0 THEN volume_24h_fp ELSE volume_fp END DESC,
             updated_ts DESC
    LIMIT $lim`;
  const rows = db.query(sql).all({ $lim: limit }) as Record<string, unknown>[];
  return rows.map(mapSqlRow);
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
    volumeFp: 0,
    spreadCents: LIQUIDITY_GATES.maxSpreadCents,
    midCents: 50,
    crossed: false,
  });
  if (!probe.liquidityOk || !probe.tradable) {
    throw new Error("liquidity gate self-check failed at threshold boundary");
  }
  const fail = evaluateLiquidityGates({
    volume24hFp: LIQUIDITY_GATES.minVolume24hFp - 1,
    volumeFp: 0,
    spreadCents: LIQUIDITY_GATES.maxSpreadCents,
    midCents: 50,
    crossed: false,
  });
  if (fail.liquidityOk) {
    throw new Error("liquidity gate self-check: expected volume under min to fail");
  }
  const lifetimeFallback = evaluateLiquidityGates({
    volume24hFp: 0,
    volumeFp: LIQUIDITY_GATES.minVolume24hFp,
    spreadCents: 5,
    midCents: 50,
    crossed: false,
  });
  if (!lifetimeFallback.liquidityOk) {
    throw new Error("liquidity gate self-check: lifetime volume fallback should pass");
  }
  const count = (db.query(`SELECT COUNT(*) AS n FROM match_liquidity`).get() as { n: number }).n;
  return { ok: true, table: "match_liquidity", rowCount: count };
}
