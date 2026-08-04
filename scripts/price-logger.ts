#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/sqlite
/**
 * Price logger daemon — periodic market snapshots with Elo + cross-market enrichment.
 *
 * Usage:
 *   bun run logging:start              # continuous (5min interval)
 *   bun run logging:start -- --once     # single snapshot, then exit
 *   bun run logging:start -- --interval=120
 *   bun run logging:dry                 # build one cycle, print stats, no INSERT
 *
 * Writes to price_snapshots table in event-store.db.
 * Volume: markets.volume_24h_fp / volume_fp joined by ticker (levels_json has no volume).
 */
import { parseArgs } from "node:util";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  queryEventsWithBooks,
  surfaceEdgeFor,
  type EventBookRow,
} from "../src/institutions/event-store/cross-market.ts";
import { fetchLiveCrossMarketOdds } from "../src/institutions/event-store/cross-market-live.ts";
import type { CrossMarketOdds } from "../src/institutions/event-store/types.ts";
import {
  fetchTennisBoard,
  type TennisBoard,
  type TennisMarketView,
} from "../src/research/tennis-events.ts";
import {
  computeSurfaceElo,
  expectedScore,
  queryCompletedMatches,
  SURFACE_INDEX,
} from "../scripts/train-elo.ts";

// ── Types ──────────────────────────────────────────────────────

type BookMid = {
  eventId: string;
  ticker: string;
  bidCents: number | null;
  askCents: number | null;
  midCents: number | null;
  volume24h: number | null;
  openInterest: number | null;
};

type SnapshotRow = {
  eventId: string;
  matchKey: string;
  marketSource: string;
  ticker: string;
  ts: number;
  kalshiMidCents: number | null;
  kalshiBidCents: number | null;
  kalshiAskCents: number | null;
  kalshiVolume24h: number | null;
  kalshiVolumeLifetime: number;
  kalshiOpenInterest: number | null;
  staleVolume: number;
  polyProb: number | null;
  polyVolume24h: number | null;
  polyVolumeLifetime: number | null;
  polyLiquidity: number | null;
  polyOpenInterest: number | null;
  polymarketEventId: string | null; // brand-ok — opaque external provider primary key
  polymarketMatchMethod: CrossMarketOdds["polymarketMatchMethod"];
  pinnyProb: number | null;
  eloProb: number | null;
  eloSurface: string | null;
  eloA: number | null;
  eloB: number | null;
  rpsFlag: number;
  divFlag: number;
  surfaceEdge: number;
};

// ── Helpers ─────────────────────────────────────────────────────

/** Canonical player name normalization — lowercase, strip accents, collapse spaces. */
function normalizePlayer(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Build a stable cross-source match key from player pair + event identifier. */
function buildMatchKey(playerA: string, playerB: string, eventId: string): string {
  const a = normalizePlayer(playerA);
  const b = normalizePlayer(playerB);
  return `${[a, b].sort().join("|")}|${eventId.slice(-8)}`;
}

type LinkedBoardMarket = {
  eventId: string;
  tournament: string;
  playerA: string;
  playerB: string;
  surface: string;
  yesSideLabel: string;
};

/** Join the current Kalshi board to event-store identity and build logger inputs. */
export function linkCurrentBoardEvents(
  db: ReturnType<typeof openEventStore>,
  board: TennisBoard,
): EventBookRow[] {
  const lookup = db.prepare(
    `SELECT m.event_id AS eventId,
            e.tournament AS tournament,
            e.player_a AS playerA,
            e.player_b AS playerB,
            e.surface AS surface,
            m.yes_side_label AS yesSideLabel
     FROM markets m
     JOIN events e ON e.event_id = m.event_id
     WHERE m.ticker = $ticker
     LIMIT 1`,
  );
  const rows: EventBookRow[] = [];
  const seenEventIds = new Set<string>();

  for (const series of board.series) {
    if (series.state !== "ok") continue;
    for (const event of series.events) {
      const linked = event.markets
        .map((market) => ({
          market,
          store: lookup.get({ $ticker: market.ticker }) as LinkedBoardMarket | null,
        }))
        .filter(
          (entry): entry is { market: TennisMarketView; store: LinkedBoardMarket } =>
            entry.store !== null,
        );
      if (linked.length === 0) continue;
      const preferred =
        linked.find(
          ({ market, store }) =>
            normalizePlayer(market.player ?? store.yesSideLabel) ===
            normalizePlayer(store.playerA),
        ) ?? linked[0]!;
      if (seenEventIds.has(preferred.store.eventId)) continue;
      seenEventIds.add(preferred.store.eventId);

      const { market, store } = preferred;
      const levelsJson = JSON.stringify({
        eventId: store.eventId,
        ticker: market.ticker,
        bids:
          market.yesBidCents === null
            ? []
            : [{ priceCents: market.yesBidCents, size: 0 }],
        asks:
          market.yesAskCents === null
            ? []
            : [{ priceCents: market.yesAskCents, size: 0 }],
        volume24h: market.volume24h ?? 0,
        openInterest: market.openInterest ?? 0,
      });
      rows.push({
        eventId: store.eventId,
        ticker: market.ticker,
        tournament: store.tournament,
        playerA: store.playerA,
        playerB: store.playerB,
        surface: store.surface,
        levelsJson,
      });
    }
  }
  return rows;
}

function extractMidFromLevelsJson(levelsJson: string): BookMid {
  try {
    const book = JSON.parse(levelsJson);
    const bestBid = book.bids?.[0]?.priceCents ?? null;
    const bestAsk = book.asks?.[0]?.priceCents ?? null;
    const mid = bestBid != null && bestAsk != null ? Math.round((bestBid + bestAsk) / 2) : null;
    // Prefer explicit volume fields if a book serializer ever embeds them; else null
    // (filled from markets table in runSnapshotCycle).
    const volRaw = book.volume24h ?? book.volume_24h ?? null;
    const oiRaw = book.openInterest ?? book.open_interest ?? null;
    const volume24h =
      volRaw != null && Number.isFinite(Number(volRaw)) && Number(volRaw) >= 0
        ? Number(volRaw)
        : null;
    const openInterest =
      oiRaw != null && Number.isFinite(Number(oiRaw)) && Number(oiRaw) > 0
        ? Number(oiRaw)
        : null;
    return {
      eventId: book.eventId ?? "",
      ticker: book.ticker ?? "",
      bidCents: bestBid,
      askCents: bestAsk,
      midCents: mid,
      volume24h,
      openInterest,
    };
  } catch {
    return { eventId: "", ticker: "", bidCents: null, askCents: null, midCents: null, volume24h: null, openInterest: null };
  }
}

type MarketLiquidity = {
  volume24h: number;
  volumeLifetime: number;
  openInterest: number;
};

/**
 * Map ticker → independently parsed 24h volume, lifetime volume, and OI.
 * A real 24h zero remains zero and is never replaced with lifetime volume.
 */
export function loadMarketLiquidityByTicker(
  db: ReturnType<typeof openEventStore>,
): Map<string, MarketLiquidity> {
  const map = new Map<string, MarketLiquidity>();
  try {
    const rows = db
      .query(
        `SELECT ticker,
                CAST(COALESCE(NULLIF(TRIM(volume_24h_fp), ''), '0') AS REAL) AS vol24,
                CAST(COALESCE(NULLIF(TRIM(volume_fp), ''), '0') AS REAL) AS volLifetime,
                CAST(COALESCE(NULLIF(open_interest_fp, ''), '0') AS REAL) AS oi
         FROM markets
         WHERE ticker IS NOT NULL AND ticker != ''`,
      )
      .all() as Array<{
        ticker: string;
        vol24: number;
        volLifetime: number;
        oi: number;
      }>;
    for (const r of rows) {
      map.set(r.ticker, {
        volume24h: r.vol24,
        volumeLifetime: r.volLifetime,
        openInterest: r.oi,
      });
    }
  } catch {
    /* markets table missing/shape drift — snapshots still write mids */
  }
  return map;
}

/** Parse score_text like "6-3 6-4" to compute games won share. */
function gamesWonShare(scoreText: string, winner: string, playerA: string, playerB: string): number {
  const sets = scoreText.split(/\s+/).filter(Boolean);
  let winnerGames = 0;
  let loserGames = 0;
  for (const set of sets) {
    const parts = set.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      // First number is always winner's games in Kalshi score format
      if (winner === playerA || winner === playerB) {
        winnerGames += parts[0];
        loserGames += parts[1];
      } else {
        winnerGames += parts[1];
        loserGames += parts[0];
      }
    }
  }
  const total = winnerGames + loserGames;
  return total > 0 ? winnerGames / total : 0.5;
}

// ── SQL ─────────────────────────────────────────────────────────

const INSERT_SNAPSHOT = `
  INSERT INTO price_snapshots
    (event_id, match_key, market_source, ticker, ts,
     kalshi_mid_cents, kalshi_bid_cents, kalshi_ask_cents,
     kalshi_volume_24h, kalshi_volume_lifetime, kalshi_open_interest, stale_volume,
     poly_prob, poly_volume_24h, poly_volume_lifetime, poly_liquidity,
     poly_open_interest, polymarket_event_id, polymarket_match_method, pinny_prob,
     elo_prob, elo_surface, elo_a, elo_b,
     rps_flag, div_flag, surface_edge, source)
  VALUES
    ($event_id, $match_key, $market_source, $ticker, $ts,
     $kalshi_mid_cents, $kalshi_bid_cents, $kalshi_ask_cents,
     $kalshi_volume_24h, $kalshi_volume_lifetime, $kalshi_open_interest, $stale_volume,
     $poly_prob, $poly_volume_24h, $poly_volume_lifetime, $poly_liquidity,
     $poly_open_interest, $polymarket_event_id, $polymarket_match_method, $pinny_prob,
     $elo_prob, $elo_surface, $elo_a, $elo_b,
     $rps_flag, $div_flag, $surface_edge, 'price-logger')
`;

// ── Main loop ──────────────────────────────────────────────────

/** Parse a --filter string into predicate functions. */
function parseFilter(
  filter: string,
): { matches: (ticker: string, mid: number | null) => boolean } {
  const parts = filter.split(",").map((s) => s.trim()).filter(Boolean);
  const keyValues: Array<{ key: string; value: string; numeric: boolean }> = [];
  let bareRps = false;

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      if (part === "rps" || part === "div") bareRps = true;
      continue;
    }
    const key = part.slice(0, eqIdx).toLowerCase();
    const value = part.slice(eqIdx + 1);
    const num = parseFloat(value);
    keyValues.push({ key, value, numeric: !isNaN(num) });
  }

  return {
    matches: (_ticker: string, _mid: number | null) => {
      for (const kv of keyValues) {
        // Apply against snapshot columns by key name
        if (kv.key === "tier") {
          // tier is not in snapshots — we skip this filter in price-logger
          continue;
        }
        if (kv.key === "minedge" || kv.key === "min_edge") {
          const threshold = kv.numeric ? parseFloat(kv.value) : 0;
          if (_mid == null || _mid < threshold) return false;
        }
        if (kv.key === "maxedge" || kv.key === "max_edge") {
          const threshold = kv.numeric ? parseFloat(kv.value) : 100;
          if (_mid != null && _mid > threshold) return false;
        }
      }
      return true;
    },
  };
}

export type LoggerOptions = {
  dbPath?: string;
  once?: boolean;
  interval?: number;
  dashboard?: boolean;
  /** Build one cycle and print stats without INSERT or health bumps. */
  dryRun?: boolean;
  /** Comma-separated key=value filters or bare keywords (e.g. "rps", "tier=ATP250,minEdge=3"). */
  filter?: string;
};

export function parseLoggerArgv(argv: string[]): LoggerOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      once: { type: "boolean", default: false },
      interval: { type: "string" },
      dashboard: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false },
      filter: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  return {
    dbPath: typeof values.db === "string" ? values.db : undefined,
    once: values.once === true || values["dry-run"] === true || values.dryRun === true,
    interval: typeof values.interval === "string" ? parseInt(values.interval, 10) : undefined,
    dashboard: values.dashboard === true,
    dryRun: values["dry-run"] === true || values.dryRun === true,
    filter: typeof values.filter === "string" ? values.filter : undefined,
  };
}

export type SnapshotCycleResult = {
  written: number;
  built: number;
  withVolume: number;
  withPolymarket: number;
  staleVolume: number;
  dryRun: boolean;
};

export async function runSnapshotCycle(
  db: ReturnType<typeof openEventStore>,
  tickerOverrides?: Map<string, BookMid>,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  const result = await runSnapshotCycleDetailed(db, tickerOverrides, opts);
  return result.written;
}

export async function runSnapshotCycleDetailed(
  db: ReturnType<typeof openEventStore>,
  tickerOverrides?: Map<string, BookMid>,
  opts: { dryRun?: boolean } = {},
): Promise<SnapshotCycleResult> {
  const dryRun = opts.dryRun === true;
  const ts = Date.now();

  // 1. Prefer the current tradable board; retain recorded books as an outage fallback.
  let events: EventBookRow[] = [];
  try {
    const board = await fetchTennisBoard({ nowMs: ts });
    events = linkCurrentBoardEvents(db, board);
  } catch (error) {
    console.error(`[${new Date(ts).toISOString()}] Kalshi board fetch failed: ${error}`);
  }
  if (events.length === 0) events = queryEventsWithBooks(db);
  if (events.length === 0) {
    console.error(`[${new Date(ts).toISOString()}] No events with book data.`);
    return {
      written: 0,
      built: 0,
      withVolume: 0,
      withPolymarket: 0,
      staleVolume: 0,
      dryRun,
    };
  }

  // 1b. Market liquidity (volume/OI) — levels_json does not carry volume today
  const marketLiq = loadMarketLiquidityByTicker(db);

  // 2. Live cross-market odds (Polymarket gamma; Pinnacle null until keyed).
  //    On failure: all-null — never fabricated (Enrichment Lock).
  const targets = events.map((e) => ({
    ticker: e.ticker,
    playerA: e.playerA,
    playerB: e.playerB,
    tournament: e.tournament,
  }));
  let oddsMap: Map<string, CrossMarketOdds>;
  try {
    oddsMap = await fetchLiveCrossMarketOdds(targets);
  } catch (err) {
    console.error(`[${new Date(ts).toISOString()}] Live odds fetch failed (using nulls): ${err}`);
    oddsMap = new Map(
      targets.map((target) => [
        target.ticker,
        {
          polymarketProb: null,
          polymarketVolume24h: null,
          polymarketVolumeLifetime: null,
          polymarketLiquidity: null,
          polymarketOpenInterest: null,
          polymarketEventId: null,
          polymarketMatchMethod: null,
          pinnacleProb: null,
        },
      ]),
    );
  }

  // 3. Elo fair at capture time — train on all completed matches, predict current board.
  const completed = queryCompletedMatches(db);
  const { elos } = computeSurfaceElo(completed, null);

  function eloFairFor(playerA: string, playerB: string, surface: string): {
    prob: number | null;
    eloA: number | null;
    eloB: number | null;
  } {
    const idx = SURFACE_INDEX[surface] ?? 0;
    const a = elos.current.get(playerA);
    const b = elos.current.get(playerB);
    if (!a || !b) return { prob: null, eloA: a?.[idx] ?? null, eloB: b?.[idx] ?? null };
    return { prob: expectedScore(a[idx], b[idx]), eloA: a[idx], eloB: b[idx] };
  }

  // 4. Build and write snapshots
  let written = 0;
  const stmt = db.prepare(INSERT_SNAPSHOT);
  const insertMany = db.transaction((rows: SnapshotRow[]) => {
    for (const row of rows) {
      stmt.run({
        $event_id: row.eventId,
        $match_key: row.matchKey,
        $market_source: row.marketSource,
        $ticker: row.ticker,
        $ts: row.ts,
        $kalshi_mid_cents: row.kalshiMidCents,
        $kalshi_bid_cents: row.kalshiBidCents,
        $kalshi_ask_cents: row.kalshiAskCents,
        $kalshi_volume_24h: row.kalshiVolume24h,
        $kalshi_volume_lifetime: row.kalshiVolumeLifetime,
        $kalshi_open_interest: row.kalshiOpenInterest,
        $stale_volume: row.staleVolume,
        $poly_prob: row.polyProb,
        $poly_volume_24h: row.polyVolume24h,
        $poly_volume_lifetime: row.polyVolumeLifetime,
        $poly_liquidity: row.polyLiquidity,
        $poly_open_interest: row.polyOpenInterest,
        $polymarket_event_id: row.polymarketEventId,
        $polymarket_match_method: row.polymarketMatchMethod,
        $pinny_prob: row.pinnyProb,
        $elo_prob: row.eloProb,
        $elo_surface: row.eloSurface,
        $elo_a: row.eloA,
        $elo_b: row.eloB,
        $rps_flag: row.rpsFlag,
        $div_flag: row.divFlag,
        $surface_edge: row.surfaceEdge,
      });
    }
  });

  // LRU-bounded profile cache (max 5000 entries — covers active players)
  const getProfileSurface = db.prepare(
    "SELECT surfaces FROM player_profiles WHERE player_name = ?",
  );
  const profileCache = new Map<string, string | null>();
  const MAX_PROFILE_CACHE = 5000;
  function getProfileSurfaceCached(name: string): string | null {
    const hit = profileCache.get(name);
    if (hit !== undefined) return hit;
    if (profileCache.size >= MAX_PROFILE_CACHE) {
      // Evict oldest (first key)
      const first = profileCache.keys().next().value;
      if (first !== undefined) profileCache.delete(first);
    }
    const row = getProfileSurface.get(name) as { surfaces: string | null } | null;
    const val = row?.surfaces ?? null;
    profileCache.set(name, val);
    return val;
  }

  let missingSurfaceWarned = false;
  const rows: SnapshotRow[] = [];
  for (const e of events) {
    const book = tickerOverrides?.get(e.ticker) ?? extractMidFromLevelsJson(e.levelsJson);
    const liq = marketLiq.get(e.ticker);
    const volume24h = book.volume24h ?? liq?.volume24h ?? 0;
    const volumeLifetime = liq?.volumeLifetime ?? 0;
    const openInterest = book.openInterest ?? liq?.openInterest ?? null;
    const odds = oddsMap.get(e.ticker);
    const polyProb = odds?.polymarketProb ?? null;
    const pinnyProb = odds?.pinnacleProb ?? null;
    const fair = eloFairFor(e.playerA, e.playerB, e.surface ?? "");
    const surf = e.surface?.trim();
    if (!surf && !missingSurfaceWarned) {
      console.error(`[price-logger] Warning: empty surface for ${e.ticker} — defaulting to hard`);
      missingSurfaceWarned = true;
    }
    const aSurf = getProfileSurfaceCached(e.playerA);
    const bSurf = getProfileSurfaceCached(e.playerB);
    const sEdge = surfaceEdgeFor(aSurf, bSurf, surf ?? "hard");

    rows.push({
      eventId: e.eventId,
      matchKey: buildMatchKey(e.playerA, e.playerB, e.eventId),
      marketSource: "kalshi",
      ticker: e.ticker,
      ts,
      kalshiMidCents: book.midCents,
      kalshiBidCents: book.bidCents,
      kalshiAskCents: book.askCents,
      kalshiVolume24h: volume24h,
      kalshiVolumeLifetime: volumeLifetime,
      kalshiOpenInterest: openInterest,
      staleVolume: volume24h === 0 && volumeLifetime > 0 ? 1 : 0,
      polyProb,
      polyVolume24h: odds?.polymarketVolume24h ?? null,
      polyVolumeLifetime: odds?.polymarketVolumeLifetime ?? null,
      polyLiquidity: odds?.polymarketLiquidity ?? null,
      polyOpenInterest: odds?.polymarketOpenInterest ?? null,
      polymarketEventId: odds?.polymarketEventId ?? null,
      polymarketMatchMethod: odds?.polymarketMatchMethod ?? null,
      pinnyProb,
      eloProb: fair.prob,
      eloSurface: e.surface ?? null,
      eloA: fair.eloA,
      eloB: fair.eloB,
      rpsFlag: 0,
      divFlag: 0,
      surfaceEdge: sEdge,
    });
  }

  const withVolume = rows.filter((r) => r.kalshiVolume24h != null && r.kalshiVolume24h > 0).length;
  const withPolymarket = rows.filter((row) => row.polyProb !== null).length;
  const staleVolume = rows.filter((row) => row.staleVolume === 1).length;

  if (rows.length > 0 && !dryRun) {
    insertMany(rows);
    written = rows.length;
  }

  if (rows.length > 0) {
    const first = rows[0]!;
    const verb = dryRun ? "would write" : "written";
    console.error(
      `[${new Date(ts).toISOString()}] ${rows.length} snapshots ${verb}` +
        (dryRun ? " (dry-run)" : "") +
        ` · volume=${withVolume}/${rows.length}` +
        ` · poly=${withPolymarket}/${rows.length}` +
        ` · stale-volume=${staleVolume}` +
        ` (${first.ticker}: ${first.kalshiMidCents ?? "?"}¢` +
        ` vol=${first.kalshiVolume24h ?? "—"}` +
        ` Poly: ${first.polyProb != null ? (first.polyProb * 100).toFixed(0) + "%" : "—"}` +
        ` Pinny: ${first.pinnyProb != null ? (first.pinnyProb * 100).toFixed(0) + "%" : "—"})`,
    );
  }

  return {
    written,
    built: rows.length,
    withVolume,
    withPolymarket,
    staleVolume,
    dryRun,
  };
}

export async function runLogger(opts: LoggerOptions): Promise<void> {
  await ensureEventStoreDir();
  const dbPath = opts.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const intervalMs = (opts.interval ?? 300) * 1000;
  const dryRun = opts.dryRun === true;

  const db = openEventStore({ dbPath });

  // Track previous mids per ticker for delta display
  const prevMids = new Map<string, number>();

  const bumpHealth = db.prepare(
    `UPDATE logger_health
     SET last_snapshot_at = $ts,
         total_snapshots = total_snapshots + $written
     WHERE id = 1`,
  );
  const bumpError = db.prepare(
    `UPDATE logger_health
     SET total_errors = total_errors + 1,
         last_error = $err,
         last_error_at = $ts
     WHERE id = 1`,
  );

  console.error(
    `Price logger starting — db: ${dbPath}` +
      (dryRun ? " (dry-run, no INSERT)" : ` interval: ${intervalMs / 1000}s`),
  );

  let iteration = 0;
  const filterFn = opts.filter ? parseFilter(opts.filter) : null;

  while (true) {
    iteration++;
    const cycleStart = Bun.nanoseconds();
    try {
      const result = await runSnapshotCycleDetailed(db, undefined, { dryRun });
      const count = result.written;
      if (!dryRun) {
        bumpHealth.run({ $ts: Date.now(), $written: count });
      }

      // Show deltas: query latest snapshot mids vs previous cycle (skip dry-run)
      if (count > 0 && !dryRun) {
        const latest = db.query(
          `SELECT ticker, kalshi_mid_cents FROM price_snapshots
           ORDER BY id DESC LIMIT $limit`,
        ).all({ $limit: count }) as Array<{ ticker: string; kalshi_mid_cents: number | null }>;
        const deltaParts: string[] = [];
        for (const row of latest) {
          if (filterFn && !filterFn.matches(row.ticker, row.kalshi_mid_cents)) continue;
          const mid = row.kalshi_mid_cents;
          if (mid == null) continue;
          const prev = prevMids.get(row.ticker);
          prevMids.set(row.ticker, mid);
          if (prev != null) {
            const diff = mid - prev;
            if (Math.abs(diff) > 0) {
              const sign = diff > 0 ? "+" : "";
              deltaParts.push(`${row.ticker.slice(-8)}: ${sign}${diff}¢`);
            }
          }
        }
        const deltaStr = deltaParts.length > 0 ? `  [${deltaParts.slice(0, 5).join(" ")}${deltaParts.length > 5 ? " …" : ""}]` : "";
        const total = db.query("SELECT COUNT(*) AS n FROM price_snapshots").get() as { n: number };
        if (opts.dashboard) {
          console.clear();
          const topEvents = db.query(`
            SELECT s.ticker, s.kalshi_mid_cents, s.elo_prob, s.surface_edge, s.ts
            FROM price_snapshots s
            WHERE s.kalshi_mid_cents IS NOT NULL
            ORDER BY s.id DESC LIMIT 20
          `).all() as Array<{ ticker: string; kalshi_mid_cents: number; elo_prob: number | null; surface_edge: number | null; ts: number }>;
          const tableData = topEvents.map((r) => ({
            Ticker: r.ticker.slice(-20),
            Price: r.kalshi_mid_cents != null ? `${r.kalshi_mid_cents}¢` : "—",
            Elo: r.elo_prob != null ? `${Math.round(r.elo_prob * 100)}%` : "—",
            Edge: r.surface_edge != null ? `${r.surface_edge > 0 ? "+" : ""}${r.surface_edge}` : "—",
          }));
          console.log(`📊 Price Logger — #${iteration}  ·  ${total.n} total snapshots`);
          console.log("");
          console.log(Bun.inspect.table(tableData, { colors: true }));
          console.log("");
          console.log(`  Deltas: ${deltaStr || "none"}`);
        } else {
          console.error(
            `[${new Date().toISOString()}] #${iteration}: ${count} new · ${total.n} total${deltaStr}`,
          );
        }
      } else if (dryRun) {
        console.error(
          `[${new Date().toISOString()}] dry-run complete · built=${result.built}` +
            ` withVolume=${result.withVolume}` +
            ` withPolymarket=${result.withPolymarket}` +
            ` staleVolume=${result.staleVolume}`,
        );
      }
    } catch (err) {
      if (!dryRun) {
        bumpError.run({ $err: String(err), $ts: Date.now() });
      }
      console.error(`[${new Date().toISOString()}] Error: ${err}`);
    }

    if (opts.once || dryRun) break;
    // Sleep only the remainder of the interval (Bun.nanoseconds = monotonic ns)
    const elapsedMs = (Bun.nanoseconds() - cycleStart) / 1e6;
    await Bun.sleep(Math.max(0, intervalMs - elapsedMs));
  }
}

// ── Main ────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseLoggerArgv(Bun.argv.slice(2));
  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await runLogger(opts);
}
