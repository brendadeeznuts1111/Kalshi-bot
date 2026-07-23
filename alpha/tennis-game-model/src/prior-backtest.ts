/**
 * Prior-quality harness — standalone calibration of the self-model pre-match
 * prior on the FULL resolutions corpus (no book_ticks needed, unlike the
 * tick-joined backtest).
 *
 * For each resolved singles match (corpus='trading', outcome='completed'):
 *   p = strength prior for player_a, strengths computed as-of the match start
 *       (rolling: only resolutions with resolved_ts/start_ts strictly before
 *       the match start enter — no lookahead)
 *   outcome = 1 when player_a won.
 *
 * Reports Brier, log loss, decile calibration, and two naive baselines:
 *   - always-0.5
 *   - favorite-by-games: 0.65 for the player with the higher as-of strength
 *     when both known and distinct; 0.5 otherwise.
 *
 * CLI: bun src/prior-backtest.ts [--db=path] [--surface=Clay]
 */
import { Database } from "bun:sqlite";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { clampProb } from "./match-model.ts";
import { matchupPriorP, strengthFor } from "./player-strengths.ts";

export type PriorEvalRow = {
  eventId: string;
  startTs: string;
  surface: string;
  pModel: number;
  outcome: 0 | 1;
  playersKnown: 0 | 1 | 2;
};

export type CalibrationBucket = {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  empirical: number;
};

export type PriorEvalSummary = {
  matches: number;
  skipped: number;
  brier: number;
  logLoss: number;
  baselineHalf: { brier: number; logLoss: number };
  baselineFavorite: { brier: number; logLoss: number };
  bothKnown: { matches: number; brier: number; logLoss: number };
  calibration: CalibrationBucket[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function logLoss(p: number, y: 0 | 1): number {
  const c = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
}

type ResolvedMatchRow = {
  event_id: string;
  player_a: string;
  player_b: string;
  winner: string;
  start_ts: string;
  surface: string;
};

export function evaluatePrior(opts: {
  dbPath?: string;
  surface?: string;
  db?: Database;
}): PriorEvalSummary {
  const ownDb = opts.db ?? new Database(opts.dbPath ?? DEFAULT_EVENT_STORE_DB, { readonly: true });
  const db = ownDb;
  try {
    const rows = db
      .query(
        `SELECT e.event_id, e.player_a, e.player_b, e.winner, e.start_ts, e.surface
         FROM resolutions r
         JOIN events e ON e.event_id = r.event_id
         WHERE r.corpus = 'trading' AND e.corpus = 'trading'
           AND e.tour IN ('ITF-M', 'ITF-W')
           AND e.outcome = 'completed'
         ORDER BY e.start_ts ASC, e.event_id ASC`,
      )
      .all() as ResolvedMatchRow[];

    const evalRows: PriorEvalRow[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (row.winner !== row.player_a && row.winner !== row.player_b) {
        skipped++;
        continue;
      }
      const startMs = Date.parse(row.start_ts);
      if (!Number.isFinite(startMs)) {
        skipped++;
        continue;
      }
      // Strictly before this match's start — the outcome being evaluated must
      // not leak into its own strengths.
      const asOfMs = startMs - 1;
      const strengthOpts = { asOfMs, surface: opts.surface };
      const sA = strengthFor(db, row.player_a, strengthOpts);
      const sB = strengthFor(db, row.player_b, strengthOpts);
      const p = clampProb(matchupPriorP(sA.strength, sB.strength));
      evalRows.push({
        eventId: row.event_id,
        startTs: row.start_ts,
        surface: row.surface,
        pModel: p,
        outcome: row.winner === row.player_a ? 1 : 0,
        playersKnown: ((sA.known ? 1 : 0) + (sB.known ? 1 : 0)) as 0 | 1 | 2,
      });
    }

    const briers = evalRows.map((r) => (r.pModel - r.outcome) ** 2);
    const lls = evalRows.map((r) => logLoss(r.pModel, r.outcome));
    const fav = evalRows.map((r) => {
      // Favorite-by-games baseline on the same as-of strengths.
      if (r.playersKnown === 2 && Math.abs(r.pModel - 0.5) > 1e-12) {
        return r.pModel > 0.5 ? 0.65 : 0.35;
      }
      return 0.5;
    });
    const both = evalRows.filter((r) => r.playersKnown === 2);

    const calibration: CalibrationBucket[] = [];
    for (let i = 0; i < 10; i++) {
      const lo = i / 10;
      const hi = (i + 1) / 10;
      const inBucket = evalRows.filter(
        (r) => r.pModel >= lo && (i === 9 ? r.pModel <= hi : r.pModel < hi),
      );
      calibration.push({
        lo,
        hi,
        n: inBucket.length,
        meanP: mean(inBucket.map((r) => r.pModel)),
        empirical: mean(inBucket.map((r) => r.outcome)),
      });
    }

    return {
      matches: evalRows.length,
      skipped,
      brier: mean(briers),
      logLoss: mean(lls),
      baselineHalf: { brier: 0.25, logLoss: Math.log(2) },
      baselineFavorite: {
        brier: mean(evalRows.map((r, i) => (fav[i]! - r.outcome) ** 2)),
        logLoss: mean(evalRows.map((r, i) => logLoss(fav[i]!, r.outcome))),
      },
      bothKnown: {
        matches: both.length,
        brier: mean(both.map((r) => (r.pModel - r.outcome) ** 2)),
        logLoss: mean(both.map((r) => logLoss(r.pModel, r.outcome))),
      },
      calibration,
    };
  } finally {
    if (!opts.db) db.close();
  }
}

if (import.meta.main) {
  const dbPath = Bun.argv.find((a) => a.startsWith("--db="))?.slice("--db=".length);
  const surface = Bun.argv.find((a) => a.startsWith("--surface="))?.slice("--surface=".length);
  const summary = evaluatePrior({ dbPath, surface });
  console.log(JSON.stringify(summary, null, 2));
}
