#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/reference/bun/argv
/**
 * Surface-specific Elo ratings from event-store.db with walk-forward predictions.
 *
 * Usage:
 *   bun scripts/train-elo.ts [--db path] [--cutoff YYYY-MM-DD] [--out path]
 *   bun --watch scripts/train-elo.ts
 *
 * Output: research/cache/p_elo_predictions.json — array of
 * { eventId, pA, eloA, eloB, surface }
 * Each entry is the Elo win probability for playerA at match time,
 * computed from pre-match ratings only (no future leakage).
 */
import { parseArgs } from "node:util";
import {
  asCanonicalEventId,
  type CanonicalEventId,
} from "../src/institutions/event-store/brands.ts";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";

// ── Types ──────────────────────────────────────────────────────

export type CompletedMatch = {
  eventId: CanonicalEventId;
  tournament: string;
  surface: string;
  startTs: string;
  playerA: string;
  playerB: string;
  winner: string;
  loser: string;
  scoreText: string;
  level: string;
};

export type SurfaceKey = "Hard" | "Clay" | "Grass" | "Indoor" | "Carpet";

export type EloMap = {
  /** Player name → surface-indexed Elo array. */
  current: Map<string, number[]>;
  /** Snapshot of Elos at prediction time for export. */
  snapshots: Map<string, number[][]>;
};

export type PredictionRow = {
  eventId: CanonicalEventId;
  playerA: string;
  playerB: string;
  pA: number;
  pB: number;
  eloA: number[];
  eloB: number[];
  surface: string;
  winner: string;
};

// ── Constants ───────────────────────────────────────────────────

const SURFACE_KEYS: SurfaceKey[] = ["Hard", "Clay", "Grass", "Indoor", "Carpet"];
export const SURFACE_INDEX: Record<string, number> = { Hard: 0, Clay: 1, Grass: 2, Indoor: 3, Carpet: 4 };
const INITIAL_ELO = 1500;
const K_FACTOR = 32;
const ELO_DIM = SURFACE_KEYS.length;
export const DEFAULT_ELO_OUTPUT = "research/cache/p_elo_predictions.json";

// ── SQL ─────────────────────────────────────────────────────────

export function queryCompletedMatches(db: ReturnType<typeof openEventStore>): CompletedMatch[] {
  type CompletedMatchRow = Omit<CompletedMatch, "eventId"> & { eventId: string };

  const rows = db
    .query(
      `SELECT event_id    AS eventId,
              tournament,
              surface,
              start_ts    AS startTs,
              player_a    AS playerA,
              player_b    AS playerB,
              winner,
              loser,
              score_text  AS scoreText,
              level
       FROM events
       WHERE corpus = 'trading'
         AND outcome = 'completed'
         AND surface IS NOT NULL
         AND surface != ''
         AND winner != ''
         AND loser != ''
       ORDER BY start_ts ASC`,
    )
    .all() as CompletedMatchRow[];

  return rows.map((row) => ({
    ...row,
    eventId: asCanonicalEventId(row.eventId),
  }));
}

// ── Elo Engine ──────────────────────────────────────────────────

function initElo(): number[] {
  return Array.from({ length: ELO_DIM }, () => INITIAL_ELO);
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function computeSurfaceElo(
  matches: CompletedMatch[],
  cutoffTs: string | null,
): { elos: EloMap; predictions: PredictionRow[] } {
  const current = new Map<string, number[]>();
  const snapshots = new Map<string, number[][]>();
  const predictions: PredictionRow[] = [];

  for (const m of matches) {
    // Initialize players if unseen
    if (!current.has(m.playerA)) current.set(m.playerA, initElo());
    if (!current.has(m.playerB)) current.set(m.playerB, initElo());

    const eloA = current.get(m.playerA)!;
    const eloB = current.get(m.playerB)!;
    const idx = SURFACE_INDEX[m.surface] ?? 0;

    // If this match is at or after the cutoff, record a prediction using pre-match Elos
    if (cutoffTs !== null && m.startTs >= cutoffTs) {
      const pA = expectedScore(eloA[idx], eloB[idx]);
      predictions.push({
        eventId: m.eventId,
        playerA: m.playerA,
        playerB: m.playerB,
        pA,
        pB: 1 - pA,
        eloA: [...eloA],
        eloB: [...eloB],
        surface: m.surface,
        winner: m.winner,
      });
      // Still update Elo after recording prediction (walk-forward: predict, then learn)
    }

    // Update Elo based on outcome
    const isAWinner = m.winner === m.playerA;
    const score = isAWinner ? 1 : 0;
    const expected = expectedScore(eloA[idx], eloB[idx]);
    const delta = K_FACTOR * (score - expected);

    const newEloA = [...eloA];
    const newEloB = [...eloB];
    newEloA[idx] = Math.round(eloA[idx] + delta);
    newEloB[idx] = Math.round(eloB[idx] - delta);

    current.set(m.playerA, newEloA);
    current.set(m.playerB, newEloB);

    // Record pre-match snapshot
    if (!snapshots.has(m.playerA)) snapshots.set(m.playerA, []);
    if (!snapshots.has(m.playerB)) snapshots.set(m.playerB, []);
    snapshots.get(m.playerA)!.push([...eloA]);
    snapshots.get(m.playerB)!.push([...eloB]);
  }

  return { elos: { current, snapshots }, predictions };
}

// ── CLI ─────────────────────────────────────────────────────────

export type TrainEloOptions = {
  dbPath?: string;
  cutoff?: string;
  out?: string;
  help?: boolean;
};

export function parseTrainEloArgv(argv: string[]): TrainEloOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      cutoff: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
      h: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    dbPath: typeof values.db === "string" ? values.db : undefined,
    cutoff: typeof values.cutoff === "string" ? values.cutoff : undefined,
    out: typeof values.out === "string" ? values.out : undefined,
    help: values.help === true || values.h === true,
  };
}

export function printTrainEloHelp(): void {
  console.log(`train-elo — surface-specific Elo ratings with walk-forward predictions

Usage:
  bun scripts/train-elo.ts [options]
  bun --watch scripts/train-elo.ts

Options:
  --db <path>        Event-store SQLite path (default: research/cache/event-store.db)
  --cutoff <date>    ISO date string (YYYY-MM-DD). Matches on/after this use pre-match Elo only.
                     When omitted, trains on ALL matches (no predictions).
  --out <path>       Output path for predictions JSON
                     (default: research/cache/p_elo_predictions.json)
  -h, --help         Show this help

Examples:
  bun scripts/train-elo.ts --cutoff=2024-01-01
  bun scripts/train-elo.ts --cutoff=2024-01-01 --out artifacts/p_elo.json
  bun --watch scripts/train-elo.ts --cutoff=2024-06-01
`);
}

export async function runTrainElo(opts: TrainEloOptions): Promise<number> {
  if (opts.help) {
    printTrainEloHelp();
    return 0;
  }

  await ensureEventStoreDir();
  const dbPath = opts.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const outPath = opts.out ?? DEFAULT_ELO_OUTPUT;
  const db = openEventStore({ dbPath, readonly: true });

  const matches = queryCompletedMatches(db);
  console.error(`Loaded ${matches.length} completed matches from ${dbPath}`);

  const cutoff = opts.cutoff ?? null;
  const { elos, predictions } = computeSurfaceElo(matches, cutoff);

  // Summary
  const playersWithHistory = [...elos.snapshots.entries()].filter(([, v]) => v.length > 0).length;
  const totalSnapshots = [...elos.snapshots.values()].reduce((s, v) => s + v.length, 0);
  console.error(`Players with history: ${playersWithHistory}`);
  console.error(`Total Elo snapshots recorded: ${totalSnapshots}`);

  if (cutoff !== null) {
    const nCorrect = predictions.filter((p) => {
      const predictedAWon = p.pA > 0.5;
      return predictedAWon ? p.winner === p.playerA : p.winner === p.playerB;
    }).length;
    const accuracy = predictions.length > 0 ? (nCorrect / predictions.length * 100).toFixed(1) : "0.0";
    console.error(`Predictions generated: ${predictions.length}  accuracy: ${accuracy}%`);

    // Show top predictions table
    const termRows = Math.max(5, (process.stdout.rows || 24) - 6);
    const topN = Math.min(termRows, predictions.length);
    const table = predictions.slice(0, topN).map((p) => ({
      eventId: p.eventId.slice(-12),
      surface: p.surface,
      playerA: p.playerA.slice(0, 14),
      playerB: p.playerB.slice(0, 14),
      "p(A)": (p.pA * 100).toFixed(0) + "%",
      "eloA/H": p.eloA[0],
      "eloB/H": p.eloB[0],
      correct: (p.pA > 0.5 ? p.winner === p.playerA : p.winner === p.playerB) ? "✓" : "✗",
    }));
    console.error(Bun.inspect.table(table, ["eventId", "surface", "playerA", "playerB", "p(A)", "correct"], { colors: true }));
  } else {
    console.error("No cutoff set — training only (no predictions exported).");
  }

  // Write predictions
  if (predictions.length > 0) {
    const payload = predictions.map((p) => ({
      eventId: p.eventId,
      p_elo: Math.round(p.pA * 1000) / 1000,
      eloA: p.eloA,
      eloB: p.eloB,
      surface: p.surface,
    }));
    await Bun.write(outPath, JSON.stringify(payload, null, 2));
    console.error(`Wrote ${payload.length} predictions to ${outPath}`);
  }

  return 0;
}

// ── Main ────────────────────────────────────────────────────────

if (import.meta.main) {
  const code = await runTrainElo(parseTrainEloArgv(Bun.argv.slice(2)));
  process.exit(code);
}
