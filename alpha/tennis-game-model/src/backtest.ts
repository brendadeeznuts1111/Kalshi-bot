/**
 * Backtest: Brier + fee-adjusted edge of game-model vs market mid on resolved
 * ITF events (corpus = 'trading' only — research-only rows never feed p_model
 * or graduation metrics).
 *
 * Clock axis: book_ticks.ts and score_snapshots.ts are both recv-clock epoch ms;
 * events.start_ts is an ISO string parsed onto the same ms axis. A tick counts
 * as pre-match only when tick.ts < start_ts; otherwise it is labelled in-play
 * (the first recorded tick may itself be in-play — the watch set promotes on
 * is_live, so we never pretend).
 *
 * Arms per event: first pre-match tick (if any) and first in-play tick (if any).
 * Vacuous means "no independent information": a pre-match row where BOTH players
 * are unknown to the corpus (default vs default → pModel carries nothing) —
 * NOT merely "pre-match" (with the real strength prior, pre-match rows with
 * known players are genuine model output). Rows are excluded from edge/fill
 * metrics but still reported.
 */
import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot } from "../../../src/institutions/alpha-signal-types.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import {
  DEFAULT_SLIPPAGE_MARGIN_CENTS,
  feePerContractCents,
  makerPassesThreshold,
  makerRateForSeries,
  MIN_CONTRACTS,
  rawEdgeCents,
} from "../../../src/institutions/kalshi-fees.ts";
import { loadScoreContext } from "./score-context.ts";
import { buildGameModelP } from "./game-model.ts";

export type BacktestPhase = "pre-match" | "in-play";

export type BacktestRow = {
  eventId: string;
  ticker: string;
  phase: BacktestPhase;
  /** No independent information (both players unknown → default-vs-default). */
  vacuous: boolean;
  outcome: 0 | 1;
  pModel: number;
  pMarket: number;
  brierModel: number;
  brierMarket: number;
  /** Brier of the standalone self-model prior (null when both players unknown). */
  brierSelfPrior: number | null;
  /** Maker-fee-and-slippage-adjusted edge (cents) of a hypothetical fill at mid. */
  feeAdjEdgeCents: number;
  /** Would pass the maker entry gate at this mid (per-series maker rate). */
  fill: boolean;
};

export type ArmSummary = {
  rows: number;
  vacuous: number;
  brierModel: number;
  brierMarket: number;
};

export type BacktestSummary = {
  rows: number;
  distinctEvents: number;
  vacuous: number;
  brierModel: number;
  brierMarket: number;
  /** Standalone self-prior quality on rows where it carries information. */
  selfPrior: { rows: number; brier: number };
  preMatch: ArmSummary;
  inPlay: ArmSummary;
  /** Mid-band (30–70¢) over non-vacuous rows. */
  midBand: {
    rows: number;
    brierModel: number;
    brierMarket: number;
    fills: number;
    meanFeeAdjEdgeCents: number;
  };
  /** Hypothetical maker fills at mid over non-vacuous rows. */
  fills: number;
  meanFeeAdjEdgeCents: number;
  coverage: "ok" | "insufficient";
};

function parseBook(json: string): BookSnapshot | null {
  try {
    return JSON.parse(json) as BookSnapshot;
  } catch {
    return null;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function summarizeArm(rows: BacktestRow[]): ArmSummary {
  return {
    rows: rows.length,
    vacuous: rows.filter((r) => r.vacuous).length,
    brierModel: mean(rows.map((r) => r.brierModel)),
    brierMarket: mean(rows.map((r) => r.brierMarket)),
  };
}

export function summarizeBacktest(rows: BacktestRow[]): BacktestSummary {
  const scored = rows.filter((r) => !r.vacuous);
  const midBand = scored.filter((r) => r.pMarket >= 0.3 && r.pMarket <= 0.7);
  const priorRows = rows.filter((r) => r.brierSelfPrior != null);
  return {
    rows: rows.length,
    distinctEvents: new Set(rows.map((r) => r.eventId)).size,
    vacuous: rows.length - scored.length,
    brierModel: mean(rows.map((r) => r.brierModel)),
    brierMarket: mean(rows.map((r) => r.brierMarket)),
    selfPrior: {
      rows: priorRows.length,
      brier: mean(priorRows.map((r) => r.brierSelfPrior as number)),
    },
    preMatch: summarizeArm(rows.filter((r) => r.phase === "pre-match")),
    inPlay: summarizeArm(rows.filter((r) => r.phase === "in-play")),
    midBand: {
      rows: midBand.length,
      brierModel: mean(midBand.map((r) => r.brierModel)),
      brierMarket: mean(midBand.map((r) => r.brierMarket)),
      fills: midBand.filter((r) => r.fill).length,
      meanFeeAdjEdgeCents: mean(midBand.map((r) => r.feeAdjEdgeCents)),
    },
    fills: scored.filter((r) => r.fill).length,
    meanFeeAdjEdgeCents: mean(scored.map((r) => r.feeAdjEdgeCents)),
    coverage: rows.length ? "ok" : "insufficient",
  };
}

type ResolvedRow = {
  event_id: string;
  outcome: number;
  winner: string;
  ticker: string;
  yes_side_label: string;
  start_ts: string;
};

type TickRow = {
  id: number;
  ts: number;
  levels_json: string;
};

function feeAdjustedRow(
  base: Omit<BacktestRow, "feeAdjEdgeCents" | "fill">,
  ticker: string,
): BacktestRow {
  const priceCents = Math.round(base.pMarket * 100);
  const feeAdjEdgeCents =
    rawEdgeCents(base.pModel, priceCents) -
    feePerContractCents(makerRateForSeries(ticker), MIN_CONTRACTS, priceCents) -
    DEFAULT_SLIPPAGE_MARGIN_CENTS;
  const fill = makerPassesThreshold(base.pModel, priceCents, MIN_CONTRACTS, ticker);
  return { ...base, feeAdjEdgeCents, fill };
}

export function runBacktest(dbPath: string = DEFAULT_EVENT_STORE_DB): BacktestSummary {
  const db = openEventStore({ dbPath, readonly: true });
  const resolved = db
    .query(
      `SELECT r.event_id, r.outcome, r.winner, m.ticker, m.yes_side_label,
              e.start_ts
       FROM resolutions r
       JOIN markets m ON m.event_id = r.event_id
       JOIN events e ON e.event_id = r.event_id
       WHERE (m.market_kind = 'match_winner' OR m.market_kind = '')
         AND r.corpus = 'trading'
         AND e.corpus = 'trading'
       ORDER BY r.event_id`,
    )
    .all() as ResolvedRow[];

  const rows: BacktestRow[] = [];

  for (const row of resolved) {
    const eventId = asCanonicalEventId(row.event_id);
    const ticker = asKalshiMarketTicker(row.ticker);
    const yesWon = row.winner === row.yes_side_label ? 1 : 0;
    const outcome = yesWon as 0 | 1;
    const startMs = Date.parse(row.start_ts);

    const ticks = db
      .query(
        `SELECT id, ts, levels_json FROM book_ticks
         WHERE event_id = $e AND ticker = $t
         ORDER BY ts ASC, id ASC`,
      )
      .all({ $e: unbrand(eventId), $t: unbrand(ticker) }) as TickRow[];
    if (!ticks.length) continue;

    // Pre-match only when the tick predates the scheduled start. When start_ts
    // is unparseable we cannot prove pre-match — label everything in-play.
    const isPreMatch = (ts: number) => Number.isFinite(startMs) && ts < startMs;
    const arms: Array<{ phase: BacktestPhase; tick: TickRow }> = [];
    const firstPre = ticks.find((t) => isPreMatch(t.ts));
    const firstInPlay = ticks.find((t) => !isPreMatch(t.ts));
    if (firstPre) arms.push({ phase: "pre-match", tick: firstPre });
    if (firstInPlay) arms.push({ phase: "in-play", tick: firstInPlay });

    for (const { phase, tick } of arms) {
      const book = parseBook(tick.levels_json);
      if (!book) continue;
      const mid = midFromBookSnapshot(book);
      if (mid == null) continue;

      // Timestamp-aligned score: only snapshots at or before this tick's ts.
      const score =
        phase === "in-play" ? loadScoreContext(db, eventId, ticker, tick.ts) : null;
      const model = buildGameModelP({
        db,
        ticker,
        eventId,
        currentMidCents: mid,
        score,
        asOfMs: tick.ts,
      });
      if (!model) continue;

      const pMarket = mid / 100;
      // Vacuous = no independent information: pre-match and both players
      // unknown to the corpus (default-vs-default prior). A pre-match row
      // with at least one known player is real model output, not an echo.
      const playersKnown = model.components.players_known ?? 0;
      const vacuous = phase === "pre-match" && playersKnown === 0;
      const brierSelfPrior =
        playersKnown > 0
          ? ((model.components.self_prior ?? model.pModel) - outcome) ** 2
          : null;

      rows.push(
        feeAdjustedRow(
          {
            eventId: unbrand(eventId),
            ticker: unbrand(ticker),
            phase,
            vacuous,
            outcome,
            pModel: model.pModel,
            pMarket,
            brierModel: (model.pModel - outcome) ** 2,
            brierMarket: (pMarket - outcome) ** 2,
            brierSelfPrior,
          },
          unbrand(ticker),
        ),
      );
    }
  }

  return summarizeBacktest(rows);
}

if (import.meta.main) {
  const dbPath = Bun.argv.find((a) => a.startsWith("--db="))?.slice("--db=".length);
  const summary = runBacktest(dbPath);
  if (summary.coverage === "insufficient") {
    console.error(
      "insufficient coverage: no resolved trading-corpus events with book ticks — " +
        "this is a data-coverage fact, not a backtest failure.",
    );
  }
  console.log(JSON.stringify(summary, null, 2));
}
