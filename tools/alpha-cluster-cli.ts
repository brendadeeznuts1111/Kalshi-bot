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
import { parseArgs } from 'node:util';
import { listFiles } from '../src/lib/glob.ts';
import { type OddsPrint } from '../src/alpha/cluster/odds-vector.ts';
import { ConsensusTracker } from '../src/alpha/cluster/tracker.ts';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'research', 'outputs');

export type ClusterCliOptions = {
  input: string | null;
  glob: string | null;
  k: number;
  minClusterSize: number;
  styled: boolean;
  format: 'table' | 'json' | 'yaml';
  verbose: boolean;
  help: boolean;
};

/**
 * Parse alpha:cluster flags with the Bun-recommended util.parseArgs
 * (official guide: research/cache/bun-docs/guides-process-argv.mdx, pinned
 * bun-v1.4.0 - 'To parse argv into a more useful format, use util.parseArgs').
 * strict:false keeps unknown flags lenient (repo convention); shorts -v/-h map
 * to verbose/help. Returns the error string for invalid flags.
 */
export function parseClusterCli(argv: string[]): { opts: ClusterCliOptions } | { error: string } {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        input: { type: 'string' },
        glob: { type: 'string' },
        k: { type: 'string' },
        'min-cluster': { type: 'string' },
        format: { type: 'string' },
        styled: { type: 'boolean' },
        verbose: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: false,
      allowPositionals: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const formatRaw = typeof values.format === 'string' ? values.format : 'table';
  if (formatRaw !== 'table' && formatRaw !== 'json' && formatRaw !== 'yaml') {
    return { error: '--format must be table|json|yaml (got ' + formatRaw + ')' };
  }
  const kRaw = typeof values.k === 'string' ? values.k : undefined;
  const mcRaw = typeof values['min-cluster'] === 'string' ? values['min-cluster'] : undefined;
  const k = kRaw !== undefined ? Number(kRaw) : 5;
  const minClusterSize = mcRaw !== undefined ? Number(mcRaw) : 3;
  if (kRaw !== undefined && (!Number.isFinite(k) || k < 1)) return { error: '--k must be a positive number (got ' + kRaw + ')' };
  if (mcRaw !== undefined && (!Number.isFinite(minClusterSize) || minClusterSize < 1)) return { error: '--min-cluster must be a positive number (got ' + mcRaw + ')' };
  const input = typeof values.input === 'string' ? values.input : null;
  const glob = typeof values.glob === 'string' ? values.glob : null;
  if (input && glob) return { error: '--input and --glob are mutually exclusive' };
  return {
    opts: {
      input,
      glob,
      k,
      minClusterSize,
      styled: values.styled === true,
      format: formatRaw as 'table' | 'json' | 'yaml',
      verbose: values.verbose === true,
      help: values.help === true,
    },
  };
}

/**
 * Load prints from --input (single file) or --glob (Bun.Glob over a cwd,
 * merged in sorted order). Returns { error } for no-match on glob.
 */
export function loadClusterPrints(
  opts: { input: string | null; glob: string | null },
  roots: { fileRoot: string; globCwd: string } = { fileRoot: ROOT, globCwd: OUT },
): { prints: OddsPrint[]; matched: number } | { error: string } {
  if (opts.input) {
    return { prints: JSON.parse(readFileSync(join(roots.fileRoot, opts.input), 'utf8')) as OddsPrint[], matched: 1 };
  }
  if (opts.glob) {
    const files = listFiles(opts.glob, { cwd: roots.globCwd, onlyFiles: true });
    const all: OddsPrint[] = [];
    for (const f of files) {
      all.push(...(JSON.parse(readFileSync(join(roots.globCwd, f), 'utf8')) as OddsPrint[]));
    }
    if (!all.length) return { error: '--glob matched no files under ' + roots.globCwd + ' (' + opts.glob + ')' };
    return { prints: all, matched: files.length };
  }
  return { prints: syntheticFixture(), matched: 1 };
}

export function clusterCliHelp(): string {
  return [
    'alpha:cluster - cluster odds prints (sources x events) with the heap-based',
    'HDBSCAN-style clusterer and emit labels + consensus-shift signals.',
    '',
    'Usage:',
    '  bun run alpha:cluster [options]',
    '',
    'Input (one of; default deterministic synthetic 3-pocket fixture):',
    '  --input <file>     JSON array of prints {source, eventId, side, implied, vig, ts}',
    '  --glob <pattern>   expand a glob over research/outputs/*.json (Bun.Glob, grounded)',
    '',
    'Clustering:',
    '  --k <n>            core-distance neighbors (default 5)',
    '  --min-cluster <n>  min cluster size (default 3)',
    '',
    'Output:',
    '  --format <fmt>     table|json|yaml console summary (yaml via Bun.YAML, §198; default table)',
    '  --styled           ANSI-rendered markdown summary (respects NO_COLOR/FORCE_COLOR, §205)',
    '  --verbose, -v      show per-source cluster membership table',
    '',
    'Other:',
    '  --help, -h         show this help',
    '',
    'Writes: research/outputs/odds-clusters.{json,md}',
  ].join('\n');
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
const { input, glob, k, minClusterSize, styled, format, verbose, help } = parsed.opts;
if (help) {
  console.log(clusterCliHelp());
  process.exit(0);
}
const useColor = styled && cliUseColor();

const loaded = loadClusterPrints({ input, glob });
if ('error' in loaded) {
  console.error('alpha:cluster: ' + loaded.error);
  process.exit(2);
}
if (glob) {
  console.error('alpha:cluster: --glob matched ' + loaded.matched + ' file(s) under research/outputs');
}
const prints = loaded.prints;

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
if (verbose) {
  // Per-source membership table (inspect.table properties filter, §202) - only meaningful in table mode.
  const rows = result.prints.map((p) => ({
    label: String(result.labels[p.id] ?? -1),
    source: p.source,
    event: p.eventId,
    implied: p.implied.toFixed(3),
  })).filter((r) => r.label !== '-1');
  const noiseRows = result.prints.map((p) => ({ label: 'noise', source: p.source, event: p.eventId, implied: p.implied.toFixed(3) })).filter((_r, i) => (result.labels[result.prints[i]!.id] ?? -1) === -1);
  console.log((Bun as any).inspect.table([...rows, ...noiseRows], ['label', 'source', 'event', 'implied'], { colors: useColor }));
}
console.log('output: research/outputs/odds-clusters.{json,md}');