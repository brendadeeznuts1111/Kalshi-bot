#!/usr/bin/env bun
/**
 * alpha:consensus:watch - live repeated-snapshot consensus consumer: polls the
 * Odds API feed on an interval and pushes each snapshot through a
 * LiveConsensusStream (ConsensusTracker behind it), printing steam-move shifts
 * as they occur and a rolling summary artifact (research/outputs/).
 *
 * Usage: bun run alpha:consensus:watch [--sport=tennis] [--interval=60000]
 *        [--passes=0 (infinite)] [--min-cluster=3] [--region=us] [--markets=h2h]
 * Requires ODDS_API_KEY for live fetches. --input=odds.json plays a recorded
 * snapshot once (offline smoke).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchOdds } from '../src/alpha/odds-feed.ts';
import { eventsToOddsPrints } from '../src/alpha/signal-context.ts';
import { LiveConsensusStream } from '../src/alpha/cluster/live-consensus.ts';
import type { OddsEvent } from '../src/alpha/odds-types.ts';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'research', 'outputs');
const { values: aw } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    sport: { type: 'string' },
    interval: { type: 'string' },
    passes: { type: 'string' },
    'min-cluster': { type: 'string' },
    region: { type: 'string' },
    markets: { type: 'string' },
    input: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});
const str = (v: unknown, dflt: string): string => (typeof v === 'string' ? v : dflt);
const sport = str(aw.sport, 'tennis');
const intervalMs = Number(str(aw.interval, '60000'));
const passes = Number(str(aw.passes, '0'));
const minClusterSize = Number(str(aw['min-cluster'], '3'));
const region = str(aw.region, 'us');
const markets = str(aw.markets, 'h2h');
const inputFlag = typeof aw.input === 'string' ? aw.input : null;

const stream = new LiveConsensusStream({ minClusterSize });
mkdirSync(OUT, { recursive: true });

function summaryLine(ts: number, idx: number): string {
  const latest = stream.shiftHistory;
  const last = latest.at(-1);
  const shifts = latest.length
    ? latest.map((s) => s.kind + '@' + s.fromLabels.join('+') + '->' + s.toLabel).join(', ')
    : 'none';
  return '[' + new Date(ts).toISOString() + '] pass ' + idx + ' · shifts: ' + shifts + (last ? ' · last: ' + last.kind : '');
}

let pass = 0;
const loop = async (): Promise<number> => {
  for (;;) {
    pass += 1;
    let events: OddsEvent[];
    let ts = Date.now();
    try {
      const res = await fetchOdds(sport, { region, markets });
      events = res.events;
    } catch (err) {
      console.error('pass ' + pass + ': fetch failed - ' + (err instanceof Error ? err.message : String(err)));
      if (passes > 0 && pass >= passes) return 0;
      await Bun.sleep(intervalMs);
      continue;
    }
    const snap = stream.observeEvents(events, ts);
    console.log(summaryLine(ts, pass));
    if (snap && snap.shifts.length > 0) {
      for (const s of snap.shifts) {
        console.log('  STEAM-MOVE ' + s.kind + ' from [' + s.fromLabels.join(',') + '] -> ' + s.toLabel + ' (' + s.size + ' prints)');
      }
    }
    const artifact = {
      tool: 'tools/alpha-consensus-watch.ts',
      sport, region, markets, intervalMs, minClusterSize,
      passes: pass,
      snapshots: stream.tickCount,
      shiftHistory: stream.shiftHistory,
    };
    writeFileSync(join(OUT, 'odds-live-watch.json'), JSON.stringify(artifact, null, 2) + String.fromCharCode(10));
    if (passes > 0 && pass >= passes) return 0;
    await Bun.sleep(intervalMs);
  }
};

if (inputFlag) {
  const raw = JSON.parse(readFileSync(join(ROOT, inputFlag.slice('--input='.length)), 'utf8')) as OddsEvent[];
  const snap = stream.observeEvents(raw, Date.now());
  console.log(summaryLine(Date.now(), 1));
  console.log('clusters=' + (snap ? snap.clusters : 0) + ' noise=' + (snap ? snap.noise : 0) + ' shifts=' + stream.shiftHistory.length);
  process.exit(0);
}

if (import.meta.main) {
  console.log('alpha:consensus:watch - polling /sports/' + sport + '/odds every ' + intervalMs + 'ms (Ctrl+C to stop)');
  process.exit(await loop());
}

export {};
