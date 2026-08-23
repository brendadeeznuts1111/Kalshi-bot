#!/usr/bin/env bun
/**
 * `bun run massey:edge-flags` — automatic Massey edge flags vs live book odds.
 *
 * Joins the latest Massey snapshots against priced book events (skin_events
 * + the latest odds_ticks per side via odds_event_id) and flags events where
 * |massey implied - line implied| clears the threshold.
 *
 * Usage:
 *   bun run massey:edge-flags -- --sport=tennis
 *   bun run massey:edge-flags -- --sport=volleyball --threshold=0.08 --report
 *
 * Flags:
 *   --sport      book sport bucket (tennis | volleyball | basketball | ...).
 *   --threshold  |edge| flag threshold as a fraction (default 0.05 = 5pp).
 *   --rows=N     print first N flags (default 10; 0 = all).
 *   --json       also emit the flags artifact JSON to stdout.
 *   --report     write research/outputs/massey-edge-flags.md + .json.
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { openMasseyDb } from '../src/institutions/massey/store.ts';
import { loadMasseySnapshotsForBucket } from '../src/institutions/massey/crossref.ts';
import { loadPricedBookEvents } from '../src/institutions/event-store/odds-ticks-store.ts';
import {
  computeEdgeFlags,
  formatEdgeFlagsJson,
  formatEdgeFlagsMarkdown,
} from '../src/institutions/massey/edge-flags.ts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = join(import.meta.dir, '../research/outputs');

async function main(): Promise<void> {
  assertBunAtLeast('1.4.0', 'massey:edge-flags');
  const sport = argValue('sport') ?? 'tennis';
  const thresholdPct = Number(argValue('threshold') ?? '0.05') || 0.05;
  const json = hasFlag('json');
  const report = hasFlag('report');
  const rowsLimit = Number(argValue('rows') ?? '10') || 0;

  const masseyDb = openMasseyDb();
  const bookDb = openEventStore({ readonly: true });
  const events = loadPricedBookEvents(bookDb, sport);
  const masseyByTarget = loadMasseySnapshotsForBucket(masseyDb, sport);
  const flags = computeEdgeFlags(events, masseyByTarget, { thresholdPct });
  const generatedAt = new Date().toISOString();
  const meta = { sport, thresholdPct, generatedAt };

  const shown = rowsLimit > 0 ? flags.slice(0, rowsLimit) : flags;
  for (const f of shown) {
    const side = f.side === 'home' ? f.homeSide! : f.awaySide!;
    console.log(
      [f.league, f.home, f.away, side.edgePct.toFixed(1) + '%', f.side, f.matchKey ?? ''].join('  '),
    );
  }
  const positive = flags.filter((f) => f.maxEdgePct > 0).length;
  const negative = flags.length - positive;
  const withOdds = events.filter((e) => e.homeDecimal != null || e.awayDecimal != null).length;
  console.log(
    'summary: ' + events.length + ' events (' + withOdds + ' with live odds) · ' + flags.length +
      ' flag(s) at |edge| ≥ ' + (thresholdPct * 100).toFixed(1) + '% · ' + positive +
      ' positive / ' + negative + ' negative',
  );

  if (json) console.log(formatEdgeFlagsJson(flags, meta));
  if (report) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    await Bun.write(join(OUTPUT_DIR, 'massey-edge-flags.json'), formatEdgeFlagsJson(flags, meta));
    await Bun.write(join(OUTPUT_DIR, 'massey-edge-flags.md'), formatEdgeFlagsMarkdown(flags, meta));
    console.log('wrote ' + join(OUTPUT_DIR, 'massey-edge-flags.md') + ' + .json');
  }
}

await main();
