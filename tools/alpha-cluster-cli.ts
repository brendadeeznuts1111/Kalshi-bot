#!/usr/bin/env bun
/**
 * alpha:cluster - cluster odds prints (sources x events) with the heap-based
 * HDBSCAN-style clusterer and emit labels + consensus-shift signals.
 *
 * Usage: bun run alpha:cluster [--input <odds.json>] [--k 5] [--min-cluster 3]
 * Input: a JSON array of prints { source, eventId, side, implied, vig, ts }.
 * Without --input, a deterministic synthetic 3-pocket fixture is used (offline).
 * Output: research/outputs/odds-clusters.{json,md}.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { clusterOddsPrints, type OddsPrint } from '../src/alpha/cluster/odds-vector.ts';
import { detectShifts } from '../src/alpha/cluster/consensus.ts';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'research', 'outputs');
const argv = Bun.argv.slice(2);
const inputFlag = argv.find((a) => a.startsWith('--input='));
const kFlag = argv.find((a) => a.startsWith('--k='));
const mcFlag = argv.find((a) => a.startsWith('--min-cluster='));
const k = kFlag ? Number(kFlag.slice('--k='.length)) : 5;
const minClusterSize = mcFlag ? Number(mcFlag.slice('--min-cluster='.length)) : 3;

function syntheticFixture(): OddsPrint[] {
  let s = 42;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pockets: Array<[string, number, number]> = [['kalshi', 0.30, 0.030], ['pinnacle', 0.55, 0.040], ['betfair', 0.80, 0.050]];
  const prints: OddsPrint[] = [];
  for (const [source, implied, vig] of pockets) {
    for (let i = 0; i < 8; i++) {
      prints.push({ id: source + ':' + i + ':yes', source, eventId: source + '-' + i, side: 'yes', implied: implied + (rnd() - 0.5) * 0.01, vig: vig + (rnd() - 0.5) * 0.001, ts: 1_700_000_000_000 });
    }
  }
  return prints;
}

const prints: OddsPrint[] = inputFlag
  ? (JSON.parse(readFileSync(join(ROOT, inputFlag.slice('--input='.length)), 'utf8')) as OddsPrint[])
  : syntheticFixture();

const result = clusterOddsPrints(prints, { k, minClusterSize });
// second snapshot (t+60s, slight move) for consensus shifts
const shifted = prints.map((pr) => ({ ...pr, ts: pr.ts + 60_000, implied: pr.implied + 0.02 }));
const result2 = clusterOddsPrints(shifted, { k, minClusterSize });
const prevLabels: Record<string, number> = {};
const nextLabels: Record<string, number> = {};
for (const pr of result.prints) prevLabels[pr.id] = pr.label;
for (const pr of result2.prints) nextLabels[pr.id] = pr.label;
const shifts = detectShifts({ ts: prints[0]?.ts ?? 0, labels: prevLabels }, { ts: (prints[0]?.ts ?? 0) + 60_000, labels: nextLabels });

mkdirSync(OUT, { recursive: true });
const summary = {
  input: inputFlag ? inputFlag.slice('--input='.length) : 'synthetic-fixture',
  prints: prints.length,
  clusters: [...result.clusters.keys()].length,
  noise: result.noiseCount,
  labels: result.labels,
  consensusShifts: shifts,
};
writeFileSync(join(OUT, 'odds-clusters.json'), JSON.stringify(summary, null, 2) + '\n');
const md: string[] = [
  '# Odds clustering (heap-based HDBSCAN-style)',
  '',
  'prints: ' + prints.length + ' · clusters: ' + summary.clusters + ' · noise: ' + summary.noise,
  'consensus shifts: ' + shifts.length,
  '',
];
for (const s of shifts) md.push('- ' + s.kind + ' from [' + s.fromLabels.join(',') + '] to ' + s.toLabel + ' (' + s.size + ' prints)');
writeFileSync(join(OUT, 'odds-clusters.md'), md.join('\n') + '\n');
console.log('alpha:cluster - ' + prints.length + ' prints, ' + summary.clusters + ' clusters, ' + summary.noise + ' noise, ' + shifts.length + ' shifts');
console.log('output: research/outputs/odds-clusters.{json,md}');