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
import { resolveColorMode } from '../src/lib/color/theme.ts';
import { listFiles } from '../src/lib/glob.ts';
import { clusterMetadata, type OddsPrint } from '../src/alpha/cluster/odds-vector.ts';
import { ConsensusTracker } from '../src/alpha/cluster/tracker.ts';
import { renderStyledInPty } from '../src/alpha/cluster/pty.ts';
import { styledRGB } from '../src/lib/color/index.ts';

const ROOT = join(import.meta.dir, '..');
const OUT = join(ROOT, 'research', 'outputs');

export type ClusterCliOptions = {
  input: string | null;
  glob: string | null;
  k: number;
  minClusterSize: number;
  styled: boolean;
  ptyPin: boolean;
  format: 'table' | 'json' | 'yaml';
  verbose: boolean;
  help: boolean;
};

/**
 * Parse alpha:cluster flags with the Bun-recommended util.parseArgs
 * (official guide: research/cache/bun-docs/guides-process-argv.md, from the
 * llm.txt index, bun 1.4.0 - 'To parse argv into a more useful format, use
 * util.parseArgs').
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
        'pty-pin': { type: 'boolean' },
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
      ptyPin: values['pty-pin'] === true,
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
    '  --pty-pin          render the styled summary inside a Bun.Terminal PTY (captures the true',
    '                     TTY output even when piped; requires a PTY — else falls back, §197)',
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
 * Backed by resolveColorMode (grounded §211): NO_COLOR wins, FORCE_COLOR 1|2|3
 * forces 16/256/16m, TTY default 16m, piped -> none.
 */
export function cliUseColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveColorMode(env) !== 'none';
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
const { input, glob, k, minClusterSize, styled, ptyPin, format, verbose, help } = parsed.opts;
if (help) {
  console.log(clusterCliHelp());
  process.exit(0);
}
const wantStyled = styled || ptyPin;
const useColor = wantStyled && cliUseColor();

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
if (wantStyled) {
  const styledMd = ['# Odds consensus', '', '**' + prints.length + '** prints · **' + summary.clusters + '** clusters · **' + summary.noise + '** noise', 'consensus shifts: ' + shifts.length, '', ...shifts.map((s) => '- ' + s.kind + ' from [' + s.fromLabels.join(',') + '] to ' + s.toLabel + ' (' + s.size + ' prints)')].join('\n');
  const plain = () => renderClusterSummary({ prints: prints.length, clusters: result.clusters, noise: result.noise, shifts: shifts.length, labels: result.labels }, format);
  if (ptyPin) {
    // §197: host the styled renderer inside a Bun.Terminal PTY so the true TTY
    // output is captured even when stdout is piped. Graceful fallback when the
    // environment denies PTY allocation ("Failed to open PTY", D13).
    const pinned = await renderStyledInPty(styledMd);
    if ('ansi' in pinned) {
      console.log(pinned.ansi);
    } else {
      console.error('alpha:cluster: --pty-pin unavailable (' + pinned.unavailable + ') — falling back');
      console.log(useColor ? (Bun as any).markdown.ansi(styledMd) : plain());
    }
  } else if (useColor) {
    console.log((Bun as any).markdown.ansi(styledMd));
  } else {
    console.log(plain());
  }
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
  // Cluster metadata (S214): consensus / spread / tightness per cluster.
  const byLabel = new Map<number, OddsPrint[]>();
  for (const p of result.prints) {
    const l = result.labels[p.id] ?? -1;
    if (l === -1) continue;
    const arr = byLabel.get(l) ?? [];
    arr.push(p);
    byLabel.set(l, arr);
  }
  for (const [label, members] of [...byLabel.entries()].sort((a, b) => a[0] - b[0])) {
    const m = clusterMetadata(members);
    // Consensus gradient via styledRGB (Bun.color RGB-array path, §235): loose
    // clusters red/orange, tight clusters green — only when the caller's color
    // gate is on (resolveColorMode; Bun.color('ansi') is env-driven).
    const t = Math.max(0, Math.min(1, ((m.consensus ?? 0.5) - 0.5) / 0.5));
    const rgb: [number, number, number] = [Math.round(255 * (1 - t)), Math.round(60 + 170 * t), Math.round(40 + 40 * t)];
    const shown = useColor ? styledRGB(String(label), rgb) : String(label);
    console.log('  cluster ' + shown + ': consensus=' + m.consensus!.toFixed(4) + ' spread=' + m.spread!.toFixed(4) + ' tightness=' + m.tightness!.toFixed(4) + ' (' + m.prints + ' prints)');
  }
}
console.log('output: research/outputs/odds-clusters.{json,md}');