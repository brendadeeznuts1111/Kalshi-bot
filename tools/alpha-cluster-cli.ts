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
import { type OddsPrint } from '../src/alpha/cluster/odds-vector.ts';
import { ConsensusTracker } from '../src/alpha/cluster/tracker.ts';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'research', 'outputs');

export type ClusterCliOptions = {
  input: string | null;
  k: number;
  minClusterSize: number;
  styled: boolean;
  format: 'table' | 'json' | 'yaml';
};

/** Parse alpha:cluster flags; returns the error string for invalid flags. */
export function parseClusterCli(argv: string[]): { opts: ClusterCliOptions } | { error: string } {
  const inputFlag = argv.find((a) => a.startsWith('--input='));
  const kFlag = argv.find((a) => a.startsWith('--k='));
  const mcFlag = argv.find((a) => a.startsWith('--min-cluster='));
  const fmtFlag = argv.find((a) => a.startsWith('--format='));
  const styled = argv.includes('--styled');
  const formatRaw = fmtFlag ? fmtFlag.slice('--format='.length) : 'table';
  if (formatRaw !== 'table' && formatRaw !== 'json' && formatRaw !== 'yaml') {
    return { error: '--format must be table|json|yaml (got ' + formatRaw + ')' };
  }
  const k = kFlag ? Number(kFlag.slice('--k='.length)) : 5;
  const minClusterSize = mcFlag ? Number(mcFlag.slice('--min-cluster='.length)) : 3;
  if (kFlag && !Number.isFinite(k) || k < 1) return { error: '--k must be a positive number (got ' + kFlag + ')' };
  if (mcFlag && !Number.isFinite(minClusterSize) || minClusterSize < 1) return { error: '--min-cluster must be a positive number (got ' + mcFlag + ')' };
  return {
    opts: {
      input: inputFlag ? inputFlag.slice('--input='.length) : null,
      k,
      minClusterSize,
      styled,
      format: formatRaw as 'table' | 'json' | 'yaml',
    },
  };
}

/**
 * Auto color gate (audit §205): the CALLER must decide color - Bun.inspect and
 * markdown.ansi ignore NO_COLOR/FORCE_COLOR once colors are requested explicitly.
 */
export function cliUseColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '' && env.NO_COLOR !== '0') return false;
  if (env.FORCE_COLOR === '0') return false;
  return true;
}

/** Render the console summary in table/json/yaml formats (yaml via Bun.YAML, §198). */
export function renderClusterSummary(
  summary: { prints: number; clusters: number; noise: number; shifts: number; labels: Record<string, number> },
  format: 'table' | 'json' | 'yaml',
): string {
  if (format === 'json') {
    return JSON.stringify({ prints: summary.prints, clusters: summary.clusters, noise: summary.noise, consensusShifts: summary.shifts, labels: summary.labels }, null, 2);
  }
  if (format === 'yaml') {
    return (Bun as any).YAML.stringify({ prints: summary.prints, clusters: summary.clusters, noise: summary.noise, consensusShifts: summary.shifts, labels: summary.labels });
  }
  return 'alpha:cluster - ' + summary.prints + ' prints, ' + summary.clusters + ' clusters, ' + summary.noise + ' noise, ' + summary.shifts + ' shifts';
}

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

const parsed = parseClusterCli(Bun.argv.slice(2));
if ('error' in parsed) {
  console.error('alpha:cluster: ' + parsed.error);
  process.exit(2);
}
const { input, k, minClusterSize, styled, format } = parsed.opts;
const useColor = styled && cliUseColor();

const prints: OddsPrint[] = input
  ? (JSON.parse(readFileSync(join(ROOT, input), 'utf8')) as OddsPrint[])
  : syntheticFixture();

const tracker = new ConsensusTracker();
const result = tracker.push(prints, prints[0]?.ts ?? 0, { minClusterSize });
// second snapshot (t+60s, slight move) for consensus shifts
const shifted = prints.map((pr) => ({ ...pr, ts: pr.ts + 60_000, implied: pr.implied + 0.02 }));
const result2 = tracker.push(shifted, (prints[0]?.ts ?? 0) + 60_000, { minClusterSize });
const shifts = result2.shifts;

mkdirSync(OUT, { recursive: true });
const summary = {
  input: input ?? 'synthetic-fixture',
  prints: prints.length,
  clusters: result.clusters,
  noise: result.noise,
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
if (styled && useColor) {
  const styledMd = ['# Odds consensus', '', '**' + prints.length + '** prints · **' + summary.clusters + '** clusters · **' + summary.noise + '** noise', 'consensus shifts: ' + shifts.length, '', ...shifts.map((s) => '- ' + s.kind + ' from [' + s.fromLabels.join(',') + '] to ' + s.toLabel + ' (' + s.size + ' prints)')].join('\n');
  console.log((Bun as any).markdown.ansi(styledMd));
} else {
  console.log(renderClusterSummary({ prints: prints.length, clusters: result.clusters, noise: result.noise, shifts: shifts.length, labels: result.labels }, format));
}
console.log('output: research/outputs/odds-clusters.{json,md}');