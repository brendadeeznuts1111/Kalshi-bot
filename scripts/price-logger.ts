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
} from "../src/institutions/event-store/cross-market.ts";
import { fetchLiveCrossMarketOdds } from "../src/institutions/event-store/cross-market-live.ts";
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
  kalshiOpenInterest: number | null;
  polyProb: number | null;
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

function extractMidFromLevelsJson(levelsJson: string): BookMid {
  try {
    const book = JSON.parse(levelsJson);
    const bestBid = book.bids?.[0]?.priceCents ?? null;
    const bestAsk = book.asks?.[0]?.priceCents ?? null;
    const mid = bestBid != null && bestAsk != null ? Math.round((bestBid + bestAsk) / 2) : null;
    // Prefer explicit volume fields if a book serializer ever embeds them; else null
    // (filled from markets table in runSnapshotCycle).
    const volRaw = book.volume24h ?? book.volume_24h ?? book.volume ?? null;
    const oiRaw = book.openInterest ?? book.open_interest ?? null;
    const volume24h =
      volRaw != null && Number.isFinite(Number(volRaw)) && Number(volRaw) > 0
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

type MarketLiquidity = { volume24h: number | null; openInterest: number | null };

/**
 * Map ticker → 24h volume + OI from markets (SSOT for capacity when books omit volume).
 * Prefers volume_24h_fp, falls back to lifetime volume_fp.
 */
export function loadMarketLiquidityByTicker(
  db: ReturnType<typeof openEventStore>,
): Map<string, MarketLiquidity> {
  const map = new Map<string, MarketLiquidity>();
  try {
    // Prefer 24h volume when > 0; Kalshi often stores volume_24h_fp as "0.00"
    // which must NOT block fallback to lifetime volume_fp.
    const rows = db
      .query(
        `SELECT ticker,
                CASE
                  WHEN CAST(COALESCE(NULLIF(volume_24h_fp, ''), '0') AS REAL) > 0
                    THEN CAST(volume_24h_fp AS REAL)
                  ELSE CAST(COALESCE(NULLIF(volume_fp, ''), '0') AS REAL)
                END AS vol,
                CAST(COALESCE(NULLIF(open_interest_fp, ''), '0') AS REAL) AS oi
         FROM markets
         WHERE ticker IS NOT NULL AND ticker != ''`,
      )
      .all() as Array<{ ticker: string; vol: number; oi: number }>;
    for (const r of rows) {
      map.set(r.ticker, {
        volume24h: r.vol > 0 ? r.vol : null,
        openInterest: r.oi > 0 ? r.oi : null,
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
     kalshi_volume_24h, kalshi_open_interest,
     poly_prob, pinny_prob,
     elo_prob, elo_surface, elo_a, elo_b,
     rps_flag, div_flag, surface_edge, source)
  VALUES
    ($event_id, $match_key, $market_source, $ticker, $ts,
     $kalshi_mid_cents, $kalshi_bid_cents, $kalshi_ask_cents,
     $kalshi_volume_24h, $kalshi_open_interest,
     $poly_prob, $pinny_prob,
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

  // 1. Get events with book data
  const events = queryEventsWithBooks(db);
  if (events.length === 0) {
    console.error(`[${new Date(ts).toISOString()}] No events with book data.`);
    return { written: 0, built: 0, withVolume: 0, dryRun };
  }

  // 1b. Market liquidity (volume/OI) — levels_json does not carry volume today
  const marketLiq = loadMarketLiquidityByTicker(db);

  // 2. Live cross-market odds (Polymarket gamma; Pinnacle null until keyed).
  //    On failure: all-null — never fabricated (Enrichment Lock).
  const targets = events.map((e) => ({ ticker: e.ticker, playerA: e.playerA, playerB: e.playerB }));
  let oddsMap: Map<string, { polymarketProb: number | null; pinnacleProb: number | null }>;
  try {
    oddsMap = await fetchLiveCrossMarketOdds(targets);
  } catch (err) {
    console.error(`[${new Date(ts).toISOString()}] Live odds fetch failed (using nulls): ${err}`);
    oddsMap = new Map(targets.map((t) => [t.ticker, { polymarketProb: null, pinnacleProb: null }]));
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
        $kalshi_open_interest: row.kalshiOpenInterest,
        $poly_prob: row.polyProb,
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
    const volume24h = book.volume24h ?? liq?.volume24h ?? null;
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
      kalshiOpenInterest: openInterest,
      polyProb,
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
        ` (${first.ticker}: ${first.kalshiMidCents ?? "?"}¢` +
        ` vol=${first.kalshiVolume24h ?? "—"}` +
        ` Poly: ${first.polyProb != null ? (first.polyProb * 100).toFixed(0) + "%" : "—"}` +
        ` Pinny: ${first.pinnyProb != null ? (first.pinnyProb * 100).toFixed(0) + "%" : "—"})`,
    );
  }

  return { written, built: rows.length, withVolume, dryRun };
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
          `[${new Date().toISOString()}] dry-run complete · built=${result.built} withVolume=${result.withVolume}`,
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
