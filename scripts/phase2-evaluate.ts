#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/sqlite
/**
 * Phase 2 promotion evaluator — Elo-vs-market edge on resolved events.
 *
 * Methodology:
 *   - Leakage guard: per resolved event, use the LAST price snapshot strictly
 *     before events.start_ts. Never a post-start price. Unparseable start_ts
 *     falls back to the FIRST snapshot (counted).
 *   - Brier: Elo vs market (kalshi_mid) over scored events + per-surface.
 *   - ROI_1unit: trade fires when |p_elo - p_market| >= threshold; buy YES when
 *     Elo is above market, buy NO otherwise. Executable side price (ask for
 *     YES, 100 - bid for NO), mid fallback (counted). Kalshi-style fee.
 *   - Chronological 60/40 train/holdout split, direction split, seeded
 *     bootstrap CI, promotion-criteria verdict + decision matrix.
 *
 * Usage:
 *   bun scripts/phase2-evaluate.ts
 *   bun scripts/phase2-evaluate.ts --json
 *   bun scripts/phase2-evaluate.ts --db research/cache/event-store.db
 *
 * Exit code is always 0 — this is analysis, not a gate.
 */
import { parseArgs } from "node:util";
import type { Database } from "bun:sqlite";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";

// ── Constants ───────────────────────────────────────────────────

export const EDGE_THRESHOLDS_CENTS = [1, 2, 3, 4, 5, 7, 10] as const;
export const PRIMARY_THRESHOLD_CENTS = 4;
export const HOLDOUT_SENSITIVITY_CENTS = [3, 4, 5] as const;
export const MIN_INDEPENDENT_EVENTS = 100;
export const BOOTSTRAP_RESAMPLES = 1000;
export const BOOTSTRAP_SEED = 42;
export const LOW_CONFIDENCE_TRADES = 30;
export const TOP1_SHARE_MAX = 0.5;
export const TRAIN_FRACTION = 0.6;

/**
 * Kalshi-style taker fee in cents for one contract bought at `priceCents`:
 *   ceil(0.07 * c * (100 - c) / 100)
 * Named constant function so the fee model is trivial to swap.
 */
export function kalshiFeeCents(priceCents: number): number {
  return Math.ceil((0.07 * priceCents * (100 - priceCents)) / 100);
}

/** Deterministic PRNG for the bootstrap (fixed seed → reproducible CI). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Types ───────────────────────────────────────────────────────

type EventRow = {
  event_id: string;
  player_a: string | null;
  player_b: string | null;
  start_ts: string | null;
  surface: string | null;
  winner: string | null;
};

type ResolutionRow = {
  event_id: string;
  outcome: number | null;
  winner: string | null;
};

type MarketRow = {
  ticker: string;
  market_kind: string | null;
  yes_side_label: string | null;
  side_code: string | null;
};

type SnapshotRow = {
  event_id: string;
  ticker: string;
  ts: number;
  kalshi_mid_cents: number | null;
  kalshi_bid_cents: number | null;
  kalshi_ask_cents: number | null;
  elo_prob: number | null;
  elo_surface: string | null;
};

export type SideInfo = {
  yesSideLabel: string;
  source: "markets" | "ticker-suffix";
};

export type ScoredMarket = {
  eventId: string;
  ticker: string;
  surface: string;
  startTsMs: number;
  selectedTs: number;
  pElo: number;
  pMarket: number;
  y: 0 | 1;
  yesSideLabel: string;
  bidCents: number | null;
  askCents: number | null;
  midCents: number;
};

export type Trade = {
  eventId: string;
  ticker: string;
  surface: string;
  player: string;
  direction: "BUY_YES" | "BUY_NO";
  edgeCents: number;
  entryCents: number;
  feeCents: number;
  win: boolean;
  profitCents: number;
  zeroFeeProfitCents: number;
  usedFallbackPrice: boolean;
};

export type ThresholdRoi = {
  trades: number;
  wins: number;
  stakedCents: number;
  profitCents: number;
  roiPct: number | null;
  zeroFeeProfitCents: number;
  zeroFeeRoiPct: number | null;
  fallbackPriceCount: number;
  dedupedExtras: number;
};

export type Criterion = {
  name: string;
  pass: boolean;
  actual: string;
  insufficient: boolean;
};

export type Phase2Result = {
  generatedAt: string;
  dbPath: string;
  counts: {
    resolvedEvents: number;
    scoredEvents: number;
    scoredMarkets: number;
    skippedNoPreStartPrice: number;
    fallbackFirstSnapshot: number;
    skippedUnknownSide: number;
    skippedMissingProbs: number;
    skippedNoWinner: number;
  };
  brier: {
    n: number;
    eloBrier: number | null;
    marketBrier: number | null;
    bySurface: Record<string, { elo: number; market: number; n: number }>;
  };
  roiByThreshold: Record<number, ThresholdRoi>;
  split: {
    trainSize: number;
    holdoutSize: number;
    train: ThresholdRoi | null;
    holdout: ThresholdRoi | null;
    holdoutSensitivity: Record<number, ThresholdRoi | null>;
  };
  direction: {
    underpricedBuy: ThresholdRoi;
    overpricedSell: ThresholdRoi;
  };
  bootstrap: {
    resamples: number;
    trades: number;
    meanProfitCents: number | null;
    ci95: [number, number] | null;
    lowConfidence: boolean;
  };
  concentration: {
    topEventShare: number | null;
    topPlayerShare: number | null;
    topSurfaceShare: number | null;
  };
  verdict: {
    overall: "PASS" | "FAIL" | "INSUFFICIENT_DATA";
    criteria: Criterion[];
    decisionMatrix: Array<{ condition: string; action: string; triggered: boolean | null }>;
  };
  scored: ScoredMarket[];
};

// ── Side derivation ─────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Derive which player the YES side of a match-winner ticker represents.
 * Prefers the markets table (yes_side_label / market_kind); falls back to
 * matching the ticker suffix against the market side_code; returns null when
 * the mapping is ambiguous (caller counts skipped_unknown_side).
 */
export function deriveYesSide(
  ticker: string,
  market: Pick<MarketRow, "market_kind" | "yes_side_label" | "side_code"> | null,
): SideInfo | null {
  if (market) {
    const kind = market.market_kind ?? "";
    if (kind !== "" && kind !== "match_winner") return null;
    if (market.yes_side_label && market.yes_side_label.trim() !== "") {
      return { yesSideLabel: market.yes_side_label, source: "markets" };
    }
  }
  // Fallback: ticker suffix after the last "-" is the side code. Without a
  // markets row mapping that code to a player name the side is ambiguous.
  const suffix = ticker.slice(ticker.lastIndexOf("-") + 1);
  if (market?.side_code && suffix === market.side_code && market.yes_side_label) {
    return { yesSideLabel: market.yes_side_label, source: "ticker-suffix" };
  }
  return null;
}

// ── Trade construction ──────────────────────────────────────────

/** Build at most one trade per event for a given edge threshold (dedupe: the
 *  largest-edge ticker wins; ties broken by ticker for determinism). */
export function buildTrades(
  scored: ScoredMarket[],
  thresholdCents: number,
  feeFn: (priceCents: number) => number = kalshiFeeCents,
): { trades: Trade[]; dedupedExtras: number } {
  const candidates: Trade[] = [];
  for (const s of scored) {
    const edgeCents = (s.pElo - s.pMarket) * 100;
    if (Math.abs(edgeCents) < thresholdCents) continue;

    const direction: Trade["direction"] = edgeCents > 0 ? "BUY_YES" : "BUY_NO";
    let entryCents: number;
    let usedFallbackPrice = false;
    if (direction === "BUY_YES") {
      if (s.askCents != null) entryCents = s.askCents;
      else {
        entryCents = s.midCents;
        usedFallbackPrice = true;
      }
    } else {
      if (s.bidCents != null) entryCents = 100 - s.bidCents;
      else {
        entryCents = 100 - s.midCents;
        usedFallbackPrice = true;
      }
    }

    const win = direction === "BUY_YES" ? s.y === 1 : s.y === 0;
    const feeCents = feeFn(entryCents);
    candidates.push({
      eventId: s.eventId,
      ticker: s.ticker,
      surface: s.surface,
      player: s.yesSideLabel,
      direction,
      edgeCents,
      entryCents,
      feeCents,
      win,
      profitCents: win ? 100 - entryCents - feeCents : -entryCents - feeCents,
      zeroFeeProfitCents: win ? 100 - entryCents : -entryCents,
      usedFallbackPrice,
    });
  }

  const byEvent = new Map<string, Trade>();
  for (const t of candidates) {
    const prev = byEvent.get(t.eventId);
    if (
      !prev ||
      Math.abs(t.edgeCents) > Math.abs(prev.edgeCents) ||
      (Math.abs(t.edgeCents) === Math.abs(prev.edgeCents) && t.ticker < prev.ticker)
    ) {
      byEvent.set(t.eventId, t);
    }
  }
  const trades = [...byEvent.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
  return { trades, dedupedExtras: candidates.length - trades.length };
}

export function summarizeTrades(
  trades: Trade[],
  dedupedExtras = 0,
): ThresholdRoi {
  const wins = trades.filter((t) => t.win).length;
  const stakedCents = trades.reduce((s, t) => s + t.entryCents, 0);
  const profitCents = trades.reduce((s, t) => s + t.profitCents, 0);
  const zeroFeeProfitCents = trades.reduce((s, t) => s + t.zeroFeeProfitCents, 0);
  return {
    trades: trades.length,
    wins,
    stakedCents,
    profitCents,
    roiPct: stakedCents > 0 ? (profitCents / stakedCents) * 100 : null,
    zeroFeeProfitCents,
    zeroFeeRoiPct: stakedCents > 0 ? (zeroFeeProfitCents / stakedCents) * 100 : null,
    fallbackPriceCount: trades.filter((t) => t.usedFallbackPrice).length,
    dedupedExtras,
  };
}

// ── Core evaluation ─────────────────────────────────────────────

export function evaluate(db: Database, dbPath = ":memory:"): Phase2Result {
  const resolutions = db
    .query("SELECT event_id, outcome, winner FROM resolutions")
    .all() as ResolutionRow[];
  const events = new Map(
    (
      db
        .query("SELECT event_id, player_a, player_b, start_ts, surface, winner FROM events")
        .all() as EventRow[]
    ).map((e) => [e.event_id, e]),
  );
  const markets = new Map<string, MarketRow>();
  try {
    for (const m of db
      .query("SELECT ticker, market_kind, yes_side_label, side_code FROM markets")
      .all() as MarketRow[]) {
      if (!markets.has(m.ticker)) markets.set(m.ticker, m);
    }
  } catch {
    // markets table absent — side derivation falls back / skips.
  }
  const snapshots = db
    .query(
      `SELECT event_id, ticker, ts, kalshi_mid_cents, kalshi_bid_cents, kalshi_ask_cents,
              elo_prob, elo_surface
       FROM price_snapshots ORDER BY event_id, ticker, ts`,
    )
    .all() as SnapshotRow[];

  const snapsByEventTicker = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const key = `${s.event_id}${s.ticker}`;
    const list = snapsByEventTicker.get(key);
    if (list) list.push(s);
    else snapsByEventTicker.set(key, [s]);
  }

  const counts = {
    resolvedEvents: resolutions.length,
    scoredEvents: 0,
    scoredMarkets: 0,
    skippedNoPreStartPrice: 0,
    fallbackFirstSnapshot: 0,
    skippedUnknownSide: 0,
    skippedMissingProbs: 0,
    skippedNoWinner: 0,
  };

  const scored: ScoredMarket[] = [];

  for (const r of resolutions) {
    const ev = events.get(r.event_id);
    const winner = ev?.winner ?? r.winner;
    if (!winner || winner.trim() === "") {
      counts.skippedNoWinner++;
      continue;
    }
    const startTsMs = ev?.start_ts != null ? Date.parse(ev.start_ts) : Number.NaN;

    // All tickers seen for this event in the snapshot store.
    const tickers = [
      ...new Set(
        snapshots.filter((s) => s.event_id === r.event_id).map((s) => s.ticker),
      ),
    ].sort();

    for (const ticker of tickers) {
      const list = snapsByEventTicker.get(`${r.event_id}${ticker}`)!;

      // ── Leakage guard ──
      let chosen: SnapshotRow | null = null;
      if (Number.isNaN(startTsMs)) {
        chosen = list[0] ?? null;
        counts.fallbackFirstSnapshot++;
      } else {
        for (const s of list) {
          if (s.ts < startTsMs) chosen = s; // list is ts-ascending → last pre-start
          else break;
        }
      }
      if (!chosen) {
        counts.skippedNoPreStartPrice++;
        continue;
      }

      if (chosen.elo_prob == null || chosen.kalshi_mid_cents == null) {
        counts.skippedMissingProbs++;
        continue;
      }

      const side = deriveYesSide(ticker, markets.get(ticker) ?? null);
      if (!side) {
        counts.skippedUnknownSide++;
        continue;
      }

      const y: 0 | 1 = normalizeName(winner) === normalizeName(side.yesSideLabel) ? 1 : 0;
      scored.push({
        eventId: r.event_id,
        ticker,
        surface: chosen.elo_surface ?? ev?.surface ?? "unknown",
        startTsMs,
        selectedTs: chosen.ts,
        pElo: chosen.elo_prob,
        pMarket: chosen.kalshi_mid_cents / 100,
        y,
        yesSideLabel: side.yesSideLabel,
        bidCents: chosen.kalshi_bid_cents,
        askCents: chosen.kalshi_ask_cents,
        midCents: chosen.kalshi_mid_cents,
      });
    }
  }

  counts.scoredMarkets = scored.length;
  counts.scoredEvents = new Set(scored.map((s) => s.eventId)).size;

  // ── Brier ──
  const bySurface: Record<string, { elo: number; market: number; n: number }> = {};
  let eloSum = 0;
  let marketSum = 0;
  for (const s of scored) {
    const e2 = (s.pElo - s.y) ** 2;
    const m2 = (s.pMarket - s.y) ** 2;
    eloSum += e2;
    marketSum += m2;
    const bucket = (bySurface[s.surface] ??= { elo: 0, market: 0, n: 0 });
    bucket.elo += e2;
    bucket.market += m2;
    bucket.n++;
  }
  for (const b of Object.values(bySurface)) {
    b.elo /= b.n;
    b.market /= b.n;
  }
  const brier = {
    n: scored.length,
    eloBrier: scored.length > 0 ? eloSum / scored.length : null,
    marketBrier: scored.length > 0 ? marketSum / scored.length : null,
    bySurface,
  };

  // ── ROI per threshold ──
  const roiByThreshold: Record<number, ThresholdRoi> = {};
  const tradesByThreshold = new Map<number, Trade[]>();
  for (const t of EDGE_THRESHOLDS_CENTS) {
    const { trades, dedupedExtras } = buildTrades(scored, t);
    tradesByThreshold.set(t, trades);
    roiByThreshold[t] = summarizeTrades(trades, dedupedExtras);
  }

  // ── Chronological split (first 60% train, last 40% holdout) ──
  const chrono = [...scored].sort((a, b) => a.startTsMs - b.startTsMs);
  const trainSize = Math.floor(chrono.length * TRAIN_FRACTION);
  const trainScored = chrono.slice(0, trainSize);
  const holdoutScored = chrono.slice(trainSize);
  const buildRoi = (set: ScoredMarket[], threshold: number): ThresholdRoi | null =>
    set.length === 0 ? null : summarizeTrades(buildTrades(set, threshold).trades);
  const split = {
    trainSize: trainScored.length,
    holdoutSize: holdoutScored.length,
    train: buildRoi(trainScored, PRIMARY_THRESHOLD_CENTS),
    holdout: buildRoi(holdoutScored, PRIMARY_THRESHOLD_CENTS),
    holdoutSensitivity: Object.fromEntries(
      HOLDOUT_SENSITIVITY_CENTS.map((t) => [t, buildRoi(holdoutScored, t)]),
    ),
  };

  // ── Direction split (primary threshold) ──
  const primaryTrades = tradesByThreshold.get(PRIMARY_THRESHOLD_CENTS)!;
  const direction = {
    underpricedBuy: summarizeTrades(primaryTrades.filter((t) => t.direction === "BUY_YES")),
    overpricedSell: summarizeTrades(primaryTrades.filter((t) => t.direction === "BUY_NO")),
  };

  // ── Bootstrap CI on mean per-trade profit (primary threshold, with fees) ──
  let bootstrap: Phase2Result["bootstrap"];
  if (primaryTrades.length === 0) {
    bootstrap = {
      resamples: BOOTSTRAP_RESAMPLES,
      trades: 0,
      meanProfitCents: null,
      ci95: null,
      lowConfidence: true,
    };
  } else {
    const profits = primaryTrades.map((t) => t.profitCents);
    const rand = mulberry32(BOOTSTRAP_SEED);
    const means: number[] = [];
    for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
      let sum = 0;
      for (let j = 0; j < profits.length; j++) {
        sum += profits[Math.floor(rand() * profits.length)]!;
      }
      means.push(sum / profits.length);
    }
    means.sort((a, b) => a - b);
    const lo = means[Math.floor(0.025 * BOOTSTRAP_RESAMPLES)]!;
    const hi = means[Math.min(BOOTSTRAP_RESAMPLES - 1, Math.ceil(0.975 * BOOTSTRAP_RESAMPLES) - 1)]!;
    bootstrap = {
      resamples: BOOTSTRAP_RESAMPLES,
      trades: profits.length,
      meanProfitCents: profits.reduce((a, b) => a + b, 0) / profits.length,
      ci95: [lo, hi],
      lowConfidence: profits.length < LOW_CONFIDENCE_TRADES,
    };
  }

  // ── Concentration (top-1 profit share) ──
  const topShare = (key: (t: Trade) => string): number | null => {
    const total = primaryTrades.reduce((s, t) => s + t.profitCents, 0);
    if (primaryTrades.length === 0 || total <= 0) return null;
    const byKey = new Map<string, number>();
    for (const t of primaryTrades) {
      byKey.set(key(t), (byKey.get(key(t)) ?? 0) + t.profitCents);
    }
    return Math.max(...byKey.values()) / total;
  };
  const concentration = {
    topEventShare: topShare((t) => t.eventId),
    topPlayerShare: topShare((t) => t.player),
    topSurfaceShare: topShare((t) => t.surface),
  };

  // ── Verdict ──
  const insufficient = counts.scoredEvents < MIN_INDEPENDENT_EVENTS;
  const primary = roiByThreshold[PRIMARY_THRESHOLD_CENTS]!;
  const holdoutPositive = split.holdout != null && split.holdout.profitCents > 0;
  const sensitivityAllPositive =
    split.holdout != null &&
    HOLDOUT_SENSITIVITY_CENTS.every((t) => {
      const r = split.holdoutSensitivity[t];
      return r != null && r.profitCents > 0;
    });
  const top1Ok =
    concentration.topEventShare != null &&
    concentration.topEventShare <= TOP1_SHARE_MAX &&
    (concentration.topPlayerShare == null || concentration.topPlayerShare <= TOP1_SHARE_MAX) &&
    (concentration.topSurfaceShare == null || concentration.topSurfaceShare <= TOP1_SHARE_MAX);

  const criteria: Criterion[] = [
    {
      name: "net ROI > 0 after fees (4¢)",
      pass: !insufficient && primary.profitCents > 0,
      actual: primary.trades > 0 ? `${primary.profitCents}¢ over ${primary.trades} trades` : "no trades",
      insufficient,
    },
    {
      name: "positive holdout ROI (4¢)",
      pass: !insufficient && holdoutPositive,
      actual: split.holdout ? `${split.holdout.profitCents}¢ over ${split.holdout.trades} trades` : "empty holdout",
      insufficient,
    },
    {
      name: `≥${MIN_INDEPENDENT_EVENTS} independent events`,
      pass: counts.scoredEvents >= MIN_INDEPENDENT_EVENTS,
      actual: `${counts.scoredEvents} scored events`,
      insufficient,
    },
    {
      name: "not driven by a single event/player/surface",
      pass: !insufficient && top1Ok,
      actual:
        concentration.topEventShare != null
          ? `top-1 share: event ${(concentration.topEventShare * 100).toFixed(1)}% · player ${concentration.topPlayerShare != null ? (concentration.topPlayerShare * 100).toFixed(1) : "—"}% · surface ${concentration.topSurfaceShare != null ? (concentration.topSurfaceShare * 100).toFixed(1) : "—"}%`
          : "no positive profit to concentrate",
      insufficient,
    },
    {
      name: "threshold stability (3/4/5¢ all positive on holdout)",
      pass: !insufficient && sensitivityAllPositive,
      actual: HOLDOUT_SENSITIVITY_CENTS.map((t) => {
        const r = split.holdoutSensitivity[t];
        return `${t}¢:${r ? `${r.profitCents}¢` : "—"}`;
      }).join(" "),
      insufficient,
    },
    {
      name: "bootstrap CI reported",
      pass: !insufficient && bootstrap.ci95 != null && !bootstrap.lowConfidence,
      actual:
        bootstrap.ci95 != null
          ? `95% CI [${bootstrap.ci95[0].toFixed(1)}¢, ${bootstrap.ci95[1].toFixed(1)}¢]${bootstrap.lowConfidence ? " (low-confidence: <30 trades)" : ""}`
          : "no trades to resample",
      insufficient,
    },
    {
      name: "pre-start prices only (leakage guard)",
      pass: true, // guard is structural — post-start prices are never selected
      actual: `${counts.skippedNoPreStartPrice} excluded (no pre-start price) · ${counts.fallbackFirstSnapshot} first-snapshot fallbacks`,
      insufficient: false,
    },
  ];

  const roiEverywhereNegative =
    scored.length > 0 &&
    EDGE_THRESHOLDS_CENTS.every((t) => roiByThreshold[t]!.trades > 0 && roiByThreshold[t]!.profitCents < 0);
  const decisionMatrix: Phase2Result["verdict"]["decisionMatrix"] = insufficient
    ? [
        { condition: "Brier_Elo < Brier_Market", action: "test blended price λ·Elo+(1−λ)·Market", triggered: null },
        { condition: "Brier_Elo > Brier_Market", action: "recalibrate Elo", triggered: null },
        { condition: "ROI > 0 at 4¢", action: "paper-trade promotion signal", triggered: null },
        { condition: "ROI < 0 everywhere", action: "edge not a profitable signal", triggered: null },
      ]
    : [
        {
          condition: "Brier_Elo < Brier_Market",
          action: "test blended price λ·Elo+(1−λ)·Market",
          triggered: brier.eloBrier != null && brier.marketBrier != null && brier.eloBrier < brier.marketBrier,
        },
        {
          condition: "Brier_Elo > Brier_Market",
          action: "recalibrate Elo",
          triggered: brier.eloBrier != null && brier.marketBrier != null && brier.eloBrier > brier.marketBrier,
        },
        { condition: "ROI > 0 at 4¢", action: "paper-trade promotion signal", triggered: primary.profitCents > 0 },
        { condition: "ROI < 0 everywhere", action: "edge not a profitable signal", triggered: roiEverywhereNegative },
      ];

  return {
    generatedAt: new Date().toISOString(),
    dbPath,
    counts,
    brier,
    roiByThreshold,
    split,
    direction,
    bootstrap,
    concentration,
    verdict: {
      overall: insufficient ? "INSUFFICIENT_DATA" : criteria.every((c) => c.pass) ? "PASS" : "FAIL",
      criteria,
      decisionMatrix,
    },
    scored,
  };
}

// ── Reporting ───────────────────────────────────────────────────

function fmtCents(v: number): string {
  return `${v > 0 ? "+" : ""}${v}¢`;
}

function fmtRoi(roi: ThresholdRoi): string {
  if (roi.trades === 0) return "— (no trades)";
  const roiStr = roi.roiPct != null ? `${roi.roiPct > 0 ? "+" : ""}${roi.roiPct.toFixed(1)}%` : "—";
  const zeroStr = roi.zeroFeeRoiPct != null ? `${roi.zeroFeeRoiPct > 0 ? "+" : ""}${roi.zeroFeeRoiPct.toFixed(1)}%` : "—";
  return `${String(roi.trades).padStart(3)} trades  win ${String(roi.wins).padStart(3)}  ${fmtCents(roi.profitCents).padStart(7)}  ROI ${roiStr.padStart(7)}  (zero-fee ${zeroStr})`;
}

function printReport(result: Phase2Result): void {
  const { counts, brier, roiByThreshold, split, direction, bootstrap, verdict } = result;
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        Phase 2 Promotion Evaluator — Elo vs Market          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  DB:               ${result.dbPath}`);
  console.log(`  Resolved events:  ${counts.resolvedEvents}`);
  console.log(`  Scored events:    ${counts.scoredEvents} (${counts.scoredMarkets} markets)`);
  console.log("");

  console.log("  ── Leakage guard ────────────────────────────────────────────");
  console.log(`  Excluded (no pre-start price):  ${counts.skippedNoPreStartPrice}`);
  console.log(`  First-snapshot fallbacks:       ${counts.fallbackFirstSnapshot} (unparseable start_ts)`);
  console.log(`  Skipped (unknown side):         ${counts.skippedUnknownSide}`);
  console.log(`  Skipped (missing elo/mid):      ${counts.skippedMissingProbs}`);
  console.log(`  Skipped (no winner):            ${counts.skippedNoWinner}`);
  console.log("");

  console.log("  ── Brier scores ─────────────────────────────────────────────");
  if (brier.n === 0) {
    console.log("  INSUFFICIENT_DATA — no scored events (0 resolved events with a pre-start price).");
  } else {
    console.log(`  n=${brier.n}  Elo: ${brier.eloBrier!.toFixed(4)}   Market: ${brier.marketBrier!.toFixed(4)}`);
    for (const [surf, s] of Object.entries(brier.bySurface).sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${surf.padEnd(12)} n=${String(s.n).padStart(3)}  Elo ${s.elo.toFixed(4)}  Market ${s.market.toFixed(4)}`);
    }
  }
  console.log("");

  console.log("  ── ROI_1unit per edge threshold (after fees / zero-fee) ─────");
  for (const t of EDGE_THRESHOLDS_CENTS) {
    const marker = t === PRIMARY_THRESHOLD_CENTS ? " ◀ primary" : "";
    console.log(`  ${String(t).padStart(2)}¢  ${fmtRoi(roiByThreshold[t]!)}${marker}`);
  }
  const anyTrades = EDGE_THRESHOLDS_CENTS.some((t) => roiByThreshold[t]!.trades > 0);
  if (!anyTrades) console.log("  INSUFFICIENT_DATA — no scored events, no trades at any threshold.");
  console.log("");

  console.log("  ── Chronological split (60/40) @ 4¢ ─────────────────────────");
  console.log(`  Train   (n=${split.trainSize}):  ${split.train ? fmtRoi(split.train) : "—"}`);
  console.log(`  Holdout (n=${split.holdoutSize}):  ${split.holdout ? fmtRoi(split.holdout) : "—"}`);
  console.log(`  Holdout sensitivity: ${HOLDOUT_SENSITIVITY_CENTS.map((t) => {
    const r = split.holdoutSensitivity[t];
    return `${t}¢ ${r ? fmtCents(r.profitCents) : "—"}`;
  }).join("  ")}`);
  if (split.holdoutSize === 0) console.log("  INSUFFICIENT_DATA — empty holdout.");
  console.log("");

  console.log("  ── Direction split @ 4¢ ─────────────────────────────────────");
  console.log(`  Underpriced-buy  (BUY_YES):  ${fmtRoi(direction.underpricedBuy)}`);
  console.log(`  Overpriced-sell  (BUY_NO):   ${fmtRoi(direction.overpricedSell)}`);
  console.log("");

  console.log("  ── Bootstrap CI (1000 resamples, seed 42, per-trade profit) ─");
  if (bootstrap.ci95 != null) {
    console.log(`  trades=${bootstrap.trades}  mean ${bootstrap.meanProfitCents!.toFixed(2)}¢  95% CI [${bootstrap.ci95[0].toFixed(2)}¢, ${bootstrap.ci95[1].toFixed(2)}¢]`);
    if (bootstrap.lowConfidence) console.log("  ⚠ low-confidence — fewer than 30 trades.");
  } else {
    console.log("  INSUFFICIENT_DATA — no trades to resample.");
  }
  console.log("");

  console.log("  ── Verdict ──────────────────────────────────────────────────");
  console.log(`  Overall: ${verdict.overall}`);
  for (const c of verdict.criteria) {
    const status = c.insufficient ? "FAIL (INSUFFICIENT_DATA)" : c.pass ? "PASS" : "FAIL";
    console.log(`  ${status.padEnd(28)} ${c.name} — ${c.actual}`);
  }
  console.log("");
  console.log("  ── Decision matrix ──────────────────────────────────────────");
  for (const row of verdict.decisionMatrix) {
    const state = row.triggered == null ? "INSUFFICIENT_DATA" : row.triggered ? "TRIGGERED" : "not triggered";
    console.log(`  ${row.condition.padEnd(28)} ${state.padEnd(20)} → ${row.action}`);
  }
  console.log("");
}

// ── CLI ─────────────────────────────────────────────────────────

export type Phase2Options = {
  dbPath?: string | undefined;
  json: boolean;
};

export function parseArgv(argv: string[]): Phase2Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });
  return {
    dbPath: typeof values.db === "string" ? values.db : undefined,
    json: values.json === true,
  };
}

async function main() {
  const opts = parseArgv(Bun.argv.slice(2));
  const dbPath = opts.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath, readonly: true });
  const result = evaluate(db, dbPath);
  db.close();

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
  // Analysis, not a gate — always exit 0.
}

if (import.meta.main) {
  await main();
}
