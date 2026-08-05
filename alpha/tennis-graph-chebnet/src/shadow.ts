/**
 * Shadow runner — builds the graph from the event store, trains the
 * Chebyshev model walk-forward, and appends a shadow-log record.
 *
 * Usage: bun alpha/tennis-graph-chebnet/src/shadow.ts [--K=3] [--trainFrac=0.7]
 */
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { joinPath } from "../../../src/research/paths.ts";
import { buildPlayerGraph, type EventRow } from "./graph.ts";
import { trainGraphModel } from "./train.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const db = openEventStore({ readonly: true });
const rows = db
  .query(
    `SELECT event_id AS eventId, player_a AS playerA, player_b AS playerB,
            winner, loser, start_ts AS startTs, tournament
     FROM events
     WHERE winner != '' AND loser != '' AND outcome = 'completed'
     ORDER BY start_ts ASC`,
  )
  .all() as EventRow[];

const g = buildPlayerGraph(rows);
const K = Number(arg("K") ?? 3);
const frac = Number(arg("trainFrac") ?? 0.7);
const cutoff = [...g.matches.map((m) => m.tsMs)].sort((a, b) => a - b)[
  Math.floor(g.matches.length * frac)
]!;
const model = trainGraphModel(g, { K, cutoffMs: cutoff });

const rec = {
  kind: "shadow-train",
  ts: Date.now(),
  program: "tennis-graph-chebnet",
  K,
  players: g.players.length,
  edges: g.edges.length,
  matches: g.matches.length,
  excluded: g.excluded,
  cutoff: new Date(cutoff).toISOString(),
  train: model.trainStats,
  valid: model.validStats,
  baseline: { kind: "p=0.5", logLoss: Math.LN2, brier: 0.25 },
  beatsBaseline: model.validStats.brier < 0.25,
  filter: model.weights,
  bias: model.bias,
};
const logPath = joinPath(import.meta.dir, "../shadow-log.jsonl");
await Bun.write(logPath, (await Bun.file(logPath).exists() ? await Bun.file(logPath).text() : "") + JSON.stringify(rec) + "\n");
console.log(JSON.stringify(rec, null, 2));
