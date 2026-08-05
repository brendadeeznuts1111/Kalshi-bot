#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/sqlite
/**
 * Market inefficiency analysis — correlate Elo fair vs market price with surface edge.
 *
 * Usage:
 *   bun run research:market-inefficiency
 *   bun run research:market-inefficiency -- --stats
 *   bun run research:market-inefficiency -- --export=signals.json
 *
 * Reads from price_snapshots in event-store.db.
 * Flags events where |market_price - elo_fair| > threshold as potential inefficiencies.
 */
import { parseArgs } from "node:util";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { inspect } from "util";

// ── Types ──────────────────────────────────────────────────────

type SignalRow = {
  eventId: string;
  ticker: string;
  ts: number;
  kalshiMidCents: number | null;
  eloProb: number | null;
  surfaceEdge: number | null;
  eloSurface: string | null;
};

type SignalSummary = {
  total: number;
  withElo: number;
  withEdge: number;
  tickers: number;
  firstTs: string;
  lastTs: string;
};

type Inefficiency = {
  ticker: string;
  ts: string;
  kalshiCents: number;
  eloPct: number;
  gapCents: number;
  surfaceEdge: number | null;
  surface: string | null;
};

// ── SQL ─────────────────────────────────────────────────────────

const QUERY_SIGNALS = `
  SELECT s.event_id    AS eventId,
         s.ticker,
         s.ts,
         s.kalshi_mid_cents AS kalshiMidCents,
         s.elo_prob    AS eloProb,
         s.surface_edge AS surfaceEdge,
         s.elo_surface AS eloSurface
  FROM price_snapshots s
  WHERE s.kalshi_mid_cents IS NOT NULL
    AND s.elo_prob IS NOT NULL
  ORDER BY s.ts
`;

const QUERY_SUMMARY = `
  SELECT COUNT(*)                       AS total,
         COUNT(elo_prob)                AS withElo,
         COUNT(surface_edge)            AS withEdge,
         COUNT(DISTINCT ticker)         AS tickers,
         MIN(ts)                        AS firstTs,
         MAX(ts)                        AS lastTs
  FROM price_snapshots
`;

// ── Analysis ────────────────────────────────────────────────────

function computeInefficiencies(
  rows: SignalRow[],
  gapThresholdCents = 5,
): { inefficiencies: Inefficiency[]; stats: ReturnType<typeof computeStats> } {
  const inefficiencies: Inefficiency[] = [];

  for (const r of rows) {
    if (r.kalshiMidCents == null || r.eloProb == null) continue;

    // Elo probability → implied cents
    const eloCents = Math.round(r.eloProb * 100);
    const gapCents = r.kalshiMidCents - eloCents;

    if (Math.abs(gapCents) >= gapThresholdCents) {
      inefficiencies.push({
        ticker: r.ticker,
        ts: new Date(r.ts).toISOString(),
        kalshiCents: r.kalshiMidCents,
        eloPct: Math.round(r.eloProb * 100),
        gapCents,
        surfaceEdge: r.surfaceEdge,
        surface: r.eloSurface,
      });
    }
  }

  const stats = computeStats(inefficiencies);
  return { inefficiencies, stats };
}

function computeStats(ineffs: Inefficiency[]) {
  if (ineffs.length === 0) return { count: 0, avgGap: 0, maxGap: 0, pctOverpriced: 0, pctUnderpriced: 0 };

  const totalGap = ineffs.reduce((s, i) => s + i.gapCents, 0);
  const overpriced = ineffs.filter((i) => i.gapCents > 0).length;
  const underpriced = ineffs.filter((i) => i.gapCents < 0).length;

  return {
    count: ineffs.length,
    avgGap: Math.round(totalGap / ineffs.length),
    maxGap: Math.max(...ineffs.map((i) => Math.abs(i.gapCents))),
    pctOverpriced: Math.round((overpriced / ineffs.length) * 100),
    pctUnderpriced: Math.round((underpriced / ineffs.length) * 100),
  };
}

function formatIneffTable(ineffs: Inefficiency[], topN = 15): string {
  if (ineffs.length === 0) return "No inefficiencies found at current threshold.";

  const top = ineffs.slice(0, topN);
  const header = `${"Ticker".padEnd(28)} ${"Gap".padStart(6)}  ${"Kalshi".padStart(5)}  ${"Elo".padStart(4)}  ${"Edge".padStart(5)}  ${"Surface".padEnd(8)}  ${"Timestamp".padEnd(24)}`;
  const sep = "─".repeat(85);
  const rows = top.map((i) => {
    const ticker = i.ticker.slice(-26).padEnd(28);
    const gap = (i.gapCents > 0 ? "+" : "") + String(i.gapCents).padStart(4) + "¢";
    const k = String(i.kalshiCents).padStart(4) + "¢";
    const e = String(i.eloPct).padStart(3) + "%";
    const edge = i.surfaceEdge != null ? String(i.surfaceEdge).padStart(4) : "  —";
    const surf = (i.surface ?? "—").padEnd(8);
    const ts = i.ts.slice(0, 19).replace("T", " ").padEnd(24);
    return `${ticker} ${gap.padStart(7)} ${k.padStart(6)} ${e.padStart(5)} ${edge.padStart(6)} ${surf} ${ts}`;
  });
  return [header, sep, ...rows].join("\n");
}

function printSummary(summary: SignalSummary, stats: ReturnType<typeof computeStats>, threshold: number): void {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        Market Inefficiency Analysis                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Data period: ${new Date(Number(summary.firstTs)).toISOString().slice(0,19).replace("T"," ")} → ${new Date(Number(summary.lastTs)).toISOString().slice(0,19).replace("T"," ")}`);
  console.log(`  Snapshots:   ${summary.total}`);
  console.log(`  With Elo:    ${summary.withElo}`);
  console.log(`  With edge:   ${summary.withEdge}`);
  console.log(`  Tickers:     ${summary.tickers}`);
  console.log(`  Threshold:   ${threshold}¢ gap`);
  console.log("");
  console.log(`  ⚡ Inefficiencies found: ${stats.count}`);
  if (stats.count > 0) {
    console.log(`  Average gap:  ${stats.avgGap > 0 ? "+" : ""}${stats.avgGap}¢`);
    console.log(`  Max gap:      ${stats.maxGap}¢`);
    console.log(`  Overpriced:   ${stats.pctOverpriced}% (Kalshi > Elo)`);
    console.log(`  Underpriced:  ${stats.pctUnderpriced}% (Kalshi < Elo)`);
  }
  console.log("");
}

// ── Phase 2: Brier score comparison ────────────────────────────

type BrierResult = {
  eloBrier: number | null;
  marketBrier: number | null;
  resolvedCount: number;
  bySurface: Record<string, { elo: number; market: number; n: number }>;
};

function computeBrierScores(db: ReturnType<typeof openEventStore>): BrierResult {
  const rows = db.query(`
    SELECT s.elo_prob, s.kalshi_mid_cents, r.outcome, s.elo_surface
    FROM price_snapshots s
    JOIN resolutions r ON r.event_id = s.event_id
    WHERE r.outcome IS NOT NULL AND s.elo_prob IS NOT NULL AND s.kalshi_mid_cents IS NOT NULL
  `).all() as Array<{ elo_prob: number; kalshi_mid_cents: number; outcome: number; elo_surface: string | null }>;

  const result: BrierResult = { eloBrier: null, marketBrier: null, resolvedCount: rows.length, bySurface: {} };

  if (rows.length < 5) return result; // too few samples

  let eloSum = 0, marketSum = 0;
  for (const r of rows) {
    const mktProb = r.kalshi_mid_cents / 100;
    eloSum += (r.elo_prob - r.outcome) ** 2;
    marketSum += (mktProb - r.outcome) ** 2;
    const surf = r.elo_surface ?? "unknown";
    if (!result.bySurface[surf]) result.bySurface[surf] = { elo: 0, market: 0, n: 0 };
    result.bySurface[surf].elo += (r.elo_prob - r.outcome) ** 2;
    result.bySurface[surf].market += (mktProb - r.outcome) ** 2;
    result.bySurface[surf].n++;
  }

  result.eloBrier = eloSum / rows.length;
  result.marketBrier = marketSum / rows.length;

  for (const surf of Object.keys(result.bySurface)) {
    const s = result.bySurface[surf];
    s.elo /= s.n;
    s.market /= s.n;
  }

  return result;
}

function printBrierAnalysis(brier: BrierResult): void {
  if (brier.resolvedCount < 5) {
    console.log("  📊 Brier: insufficient resolved snapshots (< 5). Let logger accumulate.");
    return;
  }
  const eloWins = brier.eloBrier! < brier.marketBrier!;
  console.log(`  📊 Brier scores (${brier.resolvedCount} resolved snapshots):`);
  console.log(`       Elo:    ${brier.eloBrier!.toFixed(4)} ${eloWins ? "✓ better" : ""}`);
  console.log(`       Market: ${brier.marketBrier!.toFixed(4)} ${eloWins ? "" : "✓ better"}`);
  console.log(`       Verdict: ${eloWins ? "Elo is better calibrated than market prices." : "Market contains information Elo lacks."}`);
  const surfaces = Object.entries(brier.bySurface).sort((a, b) => b[1].n - a[1].n);
  if (surfaces.length > 1) {
    console.log("");
    console.log("       By surface:");
    for (const [surf, s] of surfaces) {
      const surfEloWins = s.elo < s.market;
      console.log(`         ${surf.padEnd(10)} n=${String(s.n).padStart(4)}  Elo: ${s.elo.toFixed(4)}${surfEloWins ? " ←" : ""}  Market: ${s.market.toFixed(4)}${surfEloWins ? "" : " ←"}`);
    }
  }
  console.log("");
}

// ── Phase 2: ROI simulation ────────────────────────────────────

type RoiResult = {
  totalTrades: number;
  profitableTrades: number;
  totalProfitCents: number;
  roiPct: number;
  byThreshold: Record<number, { trades: number; wins: number; profitCents: number; roiPct: number }>;
};

function computeRoi(db: ReturnType<typeof openEventStore>): RoiResult {
  const rows = db.query(`
    SELECT s.elo_prob, s.kalshi_mid_cents, r.outcome
    FROM price_snapshots s
    JOIN resolutions r ON r.event_id = s.event_id
    WHERE r.outcome IS NOT NULL AND s.elo_prob IS NOT NULL AND s.kalshi_mid_cents IS NOT NULL
  `).all() as Array<{ elo_prob: number; kalshi_mid_cents: number; outcome: number }>;

  const thresholds = [2, 3, 4, 5, 10];
  const result: RoiResult = { totalTrades: 0, profitableTrades: 0, totalProfitCents: 0, roiPct: 0, byThreshold: {} };

  for (const t of thresholds) result.byThreshold[t] = { trades: 0, wins: 0, profitCents: 0, roiPct: 0 };

  for (const r of rows) {
    const gap = r.kalshi_mid_cents - Math.round(r.elo_prob * 100);
    const absGap = Math.abs(gap);

    if (absGap < 2) continue;

    // Simulate: if Kalshi < Elo (underpriced), buy YES at Kalshi. If Kalshi > Elo (overpriced), buy NO.
    // Profit = 100 - entry if correct, 0 - entry if wrong
    const entryCents = r.kalshi_mid_cents;
    const isOverpriced = gap > 0;
    // Buying NO on overpriced: profit = entryCents if outcome=0, else entryCents - 100
    // Buying YES on underpriced: profit = 100 - entryCents if outcome=1, else -entryCents
    let profitCents: number;
    if (isOverpriced) {
      profitCents = r.outcome === 0 ? entryCents : entryCents - 100;
    } else {
      profitCents = r.outcome === 1 ? 100 - entryCents : -entryCents;
    }

    for (const t of thresholds) {
      if (absGap >= t) {
        result.byThreshold[t].trades++;
        result.byThreshold[t].profitCents += profitCents;
        if (profitCents > 0) result.byThreshold[t].wins++;
      }
    }
  }

  for (const t of thresholds) {
    const b = result.byThreshold[t];
    b.roiPct = b.trades > 0 ? Math.round((b.profitCents / (b.trades * 50)) * 100) : 0;
  }

  // Use 4¢ as primary threshold
  const p = result.byThreshold[4];
  result.totalTrades = p.trades;
  result.profitableTrades = p.wins;
  result.totalProfitCents = p.profitCents;
  result.roiPct = p.roiPct;

  return result;
}

function printRoiAnalysis(roi: RoiResult): void {
  const thresholds = [2, 3, 4, 5, 10];
  console.log("  💰 ROI simulation (buy at Kalshi, close at resolution):");
  console.log("");
  console.log(`       ${"Threshold".padStart(10)}  ${"Trades".padStart(7)}  ${"Win%".padStart(5)}  ${"Profit".padStart(8)}  ${"ROI".padStart(5)}`);
  console.log(`       ${"─".repeat(10)}  ${"─".repeat(7)}  ${"─".repeat(5)}  ${"─".repeat(8)}  ${"─".repeat(5)}`);
  for (const t of thresholds) {
    const b = roi.byThreshold[t];
    const winPct = b.trades > 0 ? Math.round((b.wins / b.trades) * 100) : 0;
    const profitStr = b.profitCents > 0 ? `+${b.profitCents}` : String(b.profitCents);
    const roiStr = b.roiPct > 0 ? `+${b.roiPct}%` : `${b.roiPct}%`;
    const marker = t === 4 ? " ◀ primary" : "";
    console.log(`       ${String(t).padStart(9)}¢  ${String(b.trades).padStart(7)}  ${String(winPct).padStart(4)}%  ${profitStr.padStart(8)}¢  ${roiStr.padStart(5)}${marker}`);
  }
  console.log("");
  if (roi.totalTrades >= 10) {
    const verdict = roi.roiPct > 0
      ? `✅ ROI positive at 4¢ threshold. Consider paper trading with fixed sizing.`
      : `❌ ROI negative at 4¢ threshold. Edge is not yet tradable.`;
    console.log(`       ${verdict}`);
  } else {
    console.log(`       ⏳ Insufficient resolved trades (< 10) for a reliable verdict.`);
  }
  console.log("");
}

// ── CLI ────────────────────────────────────────────────────────

export type InefficiencyOptions = {
  dbPath?: string;
  threshold?: number;
  stats?: boolean;
  export?: string;
  top?: number;
  brier?: boolean;
  roi?: boolean;
  researchOnly?: boolean;
  filter?: string;
  surface?: string;
  minEdge?: number;
};

export function parseArgv(argv: string[]): InefficiencyOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      threshold: { type: "string" },
      stats: { type: "boolean", default: false },
      export: { type: "string" },
      top: { type: "string" },
      brier: { type: "boolean", default: false },
      roi: { type: "boolean", default: false },
      researchOnly: { type: "boolean", default: false },
      filter: { type: "string" },
      surface: { type: "string" },
      minEdge: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });
  return {
    dbPath: typeof values.db === "string" ? values.db : undefined,
    threshold: typeof values.threshold === "string" ? parseInt(values.threshold, 10) : 5,
    stats: values.stats === true,
    export: typeof values.export === "string" ? values.export : undefined,
    top: typeof values.top === "string" ? parseInt(values.top, 10) : 15,
    brier: values.brier === true,
    roi: values.roi === true,
    researchOnly: values["research-only"] === true,
    filter: typeof values.filter === "string" ? values.filter : undefined,
    surface: typeof values.surface === "string" ? values.surface : undefined,
    minEdge: typeof values.minEdge === "string" ? parseFloat(values.minEdge) : undefined,
  };
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgv(Bun.argv.slice(2));
  const db = openEventStore({ dbPath: opts.dbPath ?? DEFAULT_EVENT_STORE_DB, readonly: true });
  await runAnalysis(db, opts);
}

/** Run analysis with an existing DB handle and options. */
export async function runAnalysis(db: ReturnType<typeof openEventStore>, opts: Partial<InefficiencyOptions> = {}): Promise<void> {

  const summary = db.query(QUERY_SUMMARY).get() as SignalSummary;
  const rows = db.query(QUERY_SIGNALS).all() as SignalRow[];

  // Apply research-only filter: only events with basic metadata
  let filteredRows = rows;
  if (opts.filter?.match(/researchAllowed\s*=\s*true/i) || opts.researchOnly) {
    const completeIds = new Set(
      (db.query(`
        SELECT DISTINCT s.event_id
        FROM price_snapshots s
        JOIN events e ON e.event_id = s.event_id
        WHERE e.tournament IS NOT NULL AND e.tournament != ''
      `).all() as Array<{ event_id: string }>).map((r) => r.event_id),
    );
    filteredRows = rows.filter((r) => completeIds.has(r.eventId));
    console.error(`[filter] research-only: ${rows.length} → ${filteredRows.length} snapshots (${rows.length - filteredRows.length} excluded for missing tournament)`);
  }

  // Apply --surface filter against events table surface
  if (opts.surface) {
    const target = opts.surface.toLowerCase();
    const surfaceIds = new Set(
      (db.prepare("SELECT event_id FROM events WHERE LOWER(surface) = ?").all(target) as Array<{ event_id: string }>).map((r) => r.event_id),
    );
    filteredRows = filteredRows.filter((r) => surfaceIds.has(r.eventId));
    console.error(`[filter] surface=${opts.surface}: → ${filteredRows.length} snapshots`);
  }

  // Apply --minEdge filter. Units: values ≤ 1 are a probability fraction
  // (0.02 = 2% gap); values > 1 are cents (2 = 2¢ gap).
  if (opts.minEdge != null) {
    const minCents = opts.minEdge <= 1 ? opts.minEdge * 100 : opts.minEdge;
    filteredRows = filteredRows.filter((r) => {
      if (r.kalshiMidCents == null || r.eloProb == null) return false;
      return Math.abs(r.kalshiMidCents - Math.round(r.eloProb * 100)) >= minCents;
    });
    console.error(`[filter] minEdge=${opts.minEdge} (${minCents}¢): → ${filteredRows.length} snapshots`);
  }

  const { inefficiencies, stats } = computeInefficiencies(filteredRows, opts.threshold ?? 5);

  // Update summary to reflect filter
  summary.total = filteredRows.length;
  summary.withElo = filteredRows.filter((r) => r.eloProb != null).length;
  summary.withEdge = filteredRows.filter((r) => r.surfaceEdge != null).length;
  summary.tickers = new Set(filteredRows.map((r) => r.ticker)).size;

  printSummary(summary, stats, opts.threshold ?? 5);

  if (opts.brier) {
    const brier = computeBrierScores(db);
    printBrierAnalysis(brier);
  }

  if (opts.roi) {
    const roi = computeRoi(db);
    printRoiAnalysis(roi);
  }

  if (opts.stats) {
    // Already printed by printSummary
  }

  if (inefficiencies.length > 0) {
    console.log("  Top inefficiencies:");
    console.log("");
    console.log(formatIneffTable(inefficiencies, opts.top ?? 15));
    console.log("");
  }

  if (opts.export) {
    await Bun.write(
      opts.export,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataPeriod: { from: summary.firstTs, to: summary.lastTs },
          threshold: opts.threshold ?? 5,
          stats,
          inefficiencies: inefficiencies.slice(0, 100),
        },
        null,
        2,
      ),
    );
    console.log(`  Exported to ${opts.export}`);
  }
}

if (import.meta.main) {
  await main();
}
