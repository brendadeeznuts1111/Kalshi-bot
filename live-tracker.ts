#!/usr/bin/env bun
/**
 * Live market event tracker (Pandora coefficient transitions).
 *
 *   bun live-tracker.ts diff old.json new.json --event-type MARKET_ADDED --sort-by time --limit 5
 *   bun live-tracker.ts diff --event-type MARKET_ADDED --sort-by time --limit 5
 *   bun live-tracker.ts watch --market-id #197510101 --format json --watch
 *   bun live-tracker.ts watch --market-id #197510101 --notify   # Telegram on MARKET_REMOVED / OTB
 *   bun live-tracker.ts analyze --summary
 *   bun live-tracker.ts analyze --stats
 *   bun live-tracker.ts analyze --sport=tennis --phase=live [--sort-by severity|family|id]
 *   bun live-tracker.ts analyze --sport=tennis --phase=live --columns=ev --sort-rows=voidDelta --csv
 *   bun live-tracker.ts patterns [--sort-by family|id] [--desc] [--json|--inspect]
 *   bun live-tracker.ts diff --columns File,Event,Detail --desc --output out.csv --format csv
 *   bun live-tracker.ts diff --tail 10 --watch --interval 2
 *   bun live-tracker.ts chart --event 197510101 --market 3 --event 197510101 --market 4 --overlay --out compare.svg
 *
 * Logs: research/cache/live-tracker/event-{id}.jsonl
 */
import { argValue, argValues, hasFlag } from './src/cli/argv.ts';
import {
  LIVE_TRACKER_EVENT_TYPES,
  appendTrackerLog,
  computeEventStats,
  defaultLiveTrackerLogPath,
  diffEventLists,
  eventsFromWatchUpdate,
  eventsToObjects,
  filterAndSortEvents,
  formatEventsCsv,
  formatEventsTable,
  loadTrackerEventsFromPaths,
  normalizeWireId,
  parseEventType,
  weightTrackerEvents,
  type LiveTrackerEvent,
} from './src/inventory/live-tracker.ts';
import {
  buildPriceSeriesMany,
  parseEventMarketPairs,
  renderPriceChartSvg,
} from './src/inventory/live-tracker-chart.ts';
import { watchEventOdds } from './src/inventory/pandora-listen.ts';
import { CACHE_DIR, joinPath } from './src/research/paths.ts';

type LiveTrackerEventType = (typeof LIVE_TRACKER_EVENT_TYPES)[number];
type SortKey = 'time' | 'event' | 'type' | 'detail' | 'file' | 'eventid';

type DiffQuery = {
  eventTypes?: LiveTrackerEventType[];
  eventType?: LiveTrackerEventType | null;
  eventId?: string | number | null;
  marketType?: string | null;
  period?: string | null;
  sortBy?: SortKey | SortKey[];
  desc?: boolean;
  limit?: number;
  offset?: number;
  tail?: number;
  columns?: string[];
};

function formatSummaryLine(
  summary: Array<{ eventType: string; count: number }>
): string {
  if (!summary.length) return '(no events)';
  return summary.map(s => `${s.eventType}: ${s.count}`).join(', ');
}

function byTypeSummary(events: LiveTrackerEvent[]) {
  return computeEventStats(events).byType;
}

function parseSortBy(raw: string | undefined | null): SortKey[] {
  if (!raw?.trim()) return ['time'];
  const keys = raw
    .split(',')
    .map(s => s.trim().toLowerCase().replace(/[^a-z]/g, '') as SortKey)
    .filter(Boolean);
  const allowed = new Set<SortKey>([
    'time',
    'event',
    'type',
    'detail',
    'file',
    'eventid',
  ]);
  const out = keys.filter(k => allowed.has(k));
  return out.length ? out : ['time'];
}

const BOOLEAN_FLAGS = new Set([
  'desc',
  'detail',
  'json',
  'inspect',
  'overlay',
  'spandora',
  'stats',
  'summary',
  'ticks',
  'verbose',
  'watch',
  'notify',
  'force-notify',
  'open',
  'html',
  'table',
  'csv',
  'bake',
  'write-sample',
  'all-columns',
  'no-color',
  'rows-desc',
]);

function positionalAfterCmd(cmd: string): string[] {
  const idx = process.argv.indexOf(cmd);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.includes('=');
      const name = a.slice(2);
      if (!eq && !BOOLEAN_FLAGS.has(name)) {
        const next = process.argv[i + 1];
        if (next && !next.startsWith('--')) i++;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

function usage(code = 1): never {
  console.error(`live-tracker — Pandora market transition log

Usage:
  bun live-tracker.ts watch   --market-id|#id [--seconds=30] [--notify] [--format json|table|csv|markdown]
                              [--watch] [--log=path] [--output path]
  bun live-tracker.ts diff    [old.json] [new.json] [--from=path|glob]
                              [--event-type TYPE[,TYPE…]] [--sort-by time[,event]]
                              [--limit N] [--offset N] [--tail N] [--desc]
                              [--columns A,B,C] [--format table|json|csv|markdown]
                              [--summary] [--stats] [--output path]
                              [--watch] [--interval sec]
  bun live-tracker.ts analyze [files…] [--summary] [--stats] [--format …] [--output path]
                              [--sport=tennis] [--phase=live|prematch]
                              [--sort-by severity|family|id] [--desc] [--verbose]
                              [--inspect|--json|--table|--html|--csv] [--columns desk|odds|settlement|patterns|ev|all|a,b,…]
                              [--sort-rows voidRisk|voidDelta|voidEv|maxSeverity|time|…] [--rows-desc]
                              [--bake]   # write docs/artifacts live-tracker-analyze-* (+ .html)
  bun live-tracker.ts patterns [--sort-by family|severity|id] [--desc] [--json|--inspect]
  bun live-tracker.ts chart   --event ID --market TYPE [--event ID --market TYPE …]
                              [--period m] [--overlay] [--out=compare.svg]
                              [--from=path|glob]   # default: research/cache/live-tracker/event-*.jsonl

Event types: ${LIVE_TRACKER_EVENT_TYPES.join(' | ')}
  aliases: market_on→MARKET_ADDED, market_off→MARKET_REMOVED, …

diff --sort-by fields: time | event | type | detail | file | eventid
patterns/analyze --sort-by fields: family | severity | id  (comma-separated; --desc)
analyze --columns presets: desk | odds | settlement | patterns | ev | all  (or comma keys)
analyze --sort-rows: voidRisk | voidDelta | voidEv | maxSeverity | time | eventType | marketClass
  (comma-separated; orthogonal to pattern --sort-by). Default: voidRisk,maxSeverity,time
  (ev preset → voidDelta,voidEv,time). --rows-desc reverses display order.

Examples:
  bun live-tracker.ts diff old.json new.json --event-type MARKET_ADDED --sort-by time --limit 5
  bun live-tracker.ts watch --market-id #197510101 --format json --watch
  bun live-tracker.ts analyze --summary
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=desk --table
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=ev --inspect --no-color
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=ev --sort-rows=voidDelta --csv
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=all --bake
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=desk --html --output /tmp/desk.html
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=desk,ev --html --open
  bun live-tracker.ts analyze --sport=tennis --phase=live --columns=ev --html   # writes cache path if no --output
  bun live-tracker.ts patterns --sort-by family,id
  bun live-tracker.ts patterns --sort-by id --desc
  bun live-tracker.ts patterns --inspect          # TTY Bun.inspect (sorted keys, depth 4)
  bun live-tracker.ts chart --event 197510101 --market 3 --event 197510101 --market 4 --overlay --out compare.svg
`);
  process.exit(code);
}

const cmd = process.argv[2];
if (!cmd || cmd === '-h' || cmd === '--help') usage(0);

const format = (argValue('format') ?? 'table').toLowerCase();
const json = format === 'json' || hasFlag('json');

function parseColumns(): string[] | undefined {
  const c = argValue('columns');
  if (!c) return undefined;
  return c.split(',').map(s => s.trim()).filter(Boolean);
}

function parseEventTypes(): LiveTrackerEventType[] {
  const raws = argValues('event-type');
  const typeAlias = argValues('type');
  const all = [...raws, ...typeAlias];
  if (!all.length) return [];
  const out: LiveTrackerEventType[] = [];
  for (const r of all) {
    const p = parseEventType(r);
    if (!p) {
      console.error(`unknown --event-type ${r}`);
      process.exit(2);
    }
    out.push(p);
  }
  return out;
}

function parseDiffQuery(): DiffQuery {
  const limitRaw = argValue('limit');
  const offsetRaw = argValue('offset');
  const tailRaw = argValue('tail');
  return {
    eventTypes: parseEventTypes(),
    eventId: argValue('market-id') ?? argValue('event-id') ?? argValue('id'),
    marketType: argValue('market-type'),
    period: argValue('period'),
    sortBy: parseSortBy(argValue('sort-by') ?? 'time'),
    desc: hasFlag('desc'),
    limit: limitRaw ? Math.max(1, Number(limitRaw) || 1) : undefined,
    offset: offsetRaw ? Math.max(0, Number(offsetRaw) || 0) : undefined,
    tail: tailRaw ? Math.max(1, Number(tailRaw) || 1) : undefined,
    columns: parseColumns(),
  };
}

async function resolveFromPaths(extra: string[] = []): Promise<string[]> {
  const from = argValue('from');
  const hits: string[] = [...extra];
  if (from) {
    if (from.includes('*')) {
      const g = new Bun.Glob(from);
      for await (const p of g.scan('.')) hits.push(p);
    } else {
      hits.push(from);
    }
  }
  if (hits.length) return [...new Set(hits)].sort();

  const dir = joinPath(CACHE_DIR, 'live-tracker');
  const g = new Bun.Glob('*.jsonl');
  try {
    for await (const p of g.scan(dir)) {
      hits.push(joinPath(dir, p));
    }
  } catch {
    /* empty */
  }
  return hits.sort();
}

function renderOutput(
  events: LiveTrackerEvent[],
  all: LiveTrackerEvent[],
  q: DiffQuery
): string {
  const rows = filterAndSortEvents(events, q);
  const summary = byTypeSummary(all);
  const filteredSummary = byTypeSummary(rows);

  if (hasFlag('summary') && !hasFlag('stats')) {
    if (json || format === 'json') {
      return JSON.stringify(
        {
          total: all.length,
          matched: rows.length,
          summary: formatSummaryLine(filteredSummary),
          byType: filteredSummary,
        },
        null,
        2
      );
    }
    return (
      `matched ${rows.length}/${all.length}\n` +
      formatSummaryLine(filteredSummary)
    );
  }

  if (hasFlag('stats')) {
    const stats = computeEventStats(rows);
    if (json || format === 'json') {
      return JSON.stringify({ matched: rows.length, total: all.length, stats }, null, 2);
    }
    const lines = [
      `stats · matched ${rows.length}/${all.length}`,
      `  by type: ${formatSummaryLine(stats.byType)}`,
      `  time: ${stats.minTime ?? '—'} → ${stats.maxTime ?? '—'}`,
      `  span: ${stats.spanMs != null ? `${(stats.spanMs / 1000).toFixed(2)}s` : '—'}`,
      `  gap mean/min/max: ${
        stats.meanGapMs != null
          ? `${(stats.meanGapMs / 1000).toFixed(2)}s / ${(stats.minGapMs! / 1000).toFixed(2)}s / ${(stats.maxGapMs! / 1000).toFixed(2)}s`
          : '—'
      }`,
    ];
    if (!hasFlag('summary') && rows.length && format === 'table') {
      lines.push('', formatEventsTable(rows, q.columns));
    }
    return lines.join('\n');
  }

  if (format === 'json' || json) {
    return JSON.stringify(
      {
        count: rows.length,
        total: all.length,
        query: q,
        summary: filteredSummary,
        events: eventsToObjects(rows, q.columns),
      },
      null,
      2
    );
  }
  if (format === 'csv') {
    return formatEventsCsv(rows, q.columns);
  }
  if (format === 'markdown' || format === 'md') {
    return formatEventsTable(rows, q.columns);
  }
  // table
  const table = formatEventsTable(rows, q.columns);
  return `${table}\n# ${rows.length}/${all.length} events`;
}

async function writeOrPrint(
  body: string,
  options?: { defaultPath?: string; open?: boolean },
): Promise<void> {
  const out = argValue('output') ?? argValue('out') ?? options?.defaultPath;
  if (out) {
    const { dirname } = await import('node:path');
    const dir = dirname(out);
    if (dir && dir !== '.' && dir !== '/') {
      try {
        await Bun.$`mkdir -p ${dir}`.quiet();
      } catch {
        /* best-effort */
      }
    }
    await Bun.write(out, body.endsWith('\n') ? body : body + '\n');
    console.error(`wrote ${out} (${body.length} bytes)`);
    if (options?.open || hasFlag('open')) {
      try {
        await Bun.$`open ${out}`.quiet();
        console.error(`opened ${out}`);
      } catch (err) {
        console.error(
          `open failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    console.log(body);
  }
}

async function loadDiffEvents(): Promise<{
  all: LiveTrackerEvent[];
  paths: string[];
  mode: 'two-file' | 'logs';
}> {
  const pos = positionalAfterCmd('diff');
  // two-file: diff old.json new.json
  if (pos.length >= 2) {
    const [oldP, newP] = pos;
    const [prev, next] = await Promise.all([
      loadTrackerEventsFromPaths([oldP!]),
      loadTrackerEventsFromPaths([newP!]),
    ]);
    if (!(await Bun.file(oldP!).exists()) || !(await Bun.file(newP!).exists())) {
      throw new Error(`missing file(s): ${oldP} / ${newP}`);
    }
    const all =
      prev.length || next.length
        ? diffEventLists(prev, next, { oldFile: oldP, newFile: newP })
        : [];
    const events = all.length ? all : next.map(e => ({ ...e, file: newP }));
    return { all: events, paths: [oldP!, newP!], mode: 'two-file' };
  }
  if (pos.length === 1) {
    const events = await loadTrackerEventsFromPaths([pos[0]!]);
    return { all: events, paths: [pos[0]!], mode: 'logs' };
  }
  const paths = await resolveFromPaths();
  const all = await loadTrackerEventsFromPaths(paths);
  return { all, paths, mode: 'logs' };
}

// ── watch (live Pandora) ───────────────────────────────────────────────────
if (cmd === 'watch') {
  const idRaw =
    argValue('market-id') ??
    argValue('event-id') ??
    argValue('id') ??
    process.argv[3];
  if (!idRaw || idRaw.startsWith('--')) {
    console.error('watch requires --market-id / --event-id');
    usage(1);
  }
  const eventId = Number(normalizeWireId(idRaw));
  if (!Number.isFinite(eventId)) {
    console.error(`invalid id: ${idRaw}`);
    process.exit(2);
  }

  const seconds = Math.min(
    Math.max(
      Number(argValue('seconds') ?? (hasFlag('watch') ? '60' : '30')) || 30,
      5
    ),
    600
  );
  const host =
    argValue('host') ?? (hasFlag('spandora') ? 'spandora' : 'pandora');
  const logPath = argValue('log') ?? defaultLiveTrackerLogPath(eventId);
  const includeTicks = hasFlag('ticks');

  console.error(
    `live-tracker watch event=${eventId} host=${host} ${seconds}s → ${logPath}`
  );

  const history = await watchEventOdds(eventId, {
    seconds,
    pandoraHost: host,
    onUpdate: u => {
      const events = eventsFromWatchUpdate(u, { includeTicks });
      if (json || format === 'json') {
        console.log(
          JSON.stringify(
            {
              at: u.at,
              eventId: u.eventId,
              lineCount: u.lineCount,
              offeredMarketCount: u.offeredMarketCount,
              events,
            },
            null,
            hasFlag('watch') ? 0 : 2
          )
        );
      } else if (events.length) {
        console.log(formatEventsTable(events));
      } else {
        console.error(
          `${u.at} tick lines=${u.lineCount} offered=${u.offeredMarketCount}`
        );
      }
      // stampTrackerLogRecord dual-writes at/atMs + time/timeMs on disk
      void appendTrackerLog(logPath, {
        at: u.at,
        eventId: u.eventId,
        lineCount: u.lineCount,
        offeredMarketCount: u.offeredMarketCount,
        events,
      });
      if (hasFlag('notify') && events.length) {
        void import('./src/inventory/live-tracker-alerts.ts').then(m =>
          m.maybeNotifyLiveTrackerAlerts({
            eventId,
            events,
            force: hasFlag('force-notify'),
          })
        );
      }
    },
  });

  const all = history.flatMap(u =>
    eventsFromWatchUpdate(u, { includeTicks, file: logPath })
  );
  if (hasFlag('notify') && all.length) {
    const { plan, telegram } = await import(
      './src/inventory/live-tracker-alerts.ts'
    ).then(m =>
      m.maybeNotifyLiveTrackerAlerts({
        eventId,
        events: all,
        force: hasFlag('force-notify'),
      })
    );
    console.error(
      `live-alerts: ${plan.reason} alerts=${plan.alerts.length} newKeys=${plan.newKeys.length} telegram=${telegram}`
    );
  }
  const body = json
    ? JSON.stringify(
        {
          watch: true,
          eventId,
          updates: history.length,
          eventCount: all.length,
          log: logPath,
          summary: byTypeSummary(all),
        },
        null,
        2
      )
    : `# watch done updates=${history.length} events=${all.length} log=${logPath}` +
      (all.length
        ? '\n' +
          formatEventsTable(
            filterAndSortEvents(all, { sortBy: ['time'] })
          )
        : '');
  if (!hasFlag('watch') || argValue('output')) {
    await writeOrPrint(json ? body : body);
  } else if (!json) {
    console.error(
      `# watch done updates=${history.length} events=${all.length} log=${logPath}`
    );
  }
  process.exit(0);
}

// ── diff ───────────────────────────────────────────────────────────────────
if (cmd === 'diff') {
  const q = parseDiffQuery();
  const intervalSec = Math.max(
    0.5,
    Number(argValue('interval') ?? '2') || 2
  );

  const runOnce = async (clear: boolean) => {
    const { all, paths, mode } = await loadDiffEvents();
    if (!paths.length && !all.length) {
      console.error(
        'no tracker logs — run: bun live-tracker.ts watch --market-id <id>\n' +
          '  or: bun live-tracker.ts diff old.json new.json'
      );
      process.exit(1);
    }
    const body = renderOutput(all, all, q);
    if (clear && hasFlag('watch') && !argValue('output')) {
      console.clear();
      console.error(
        `live-tracker diff [${mode}] ${paths.map(p => p.split('/').pop()).join(' → ')} · ${new Date().toISOString()}`
      );
    }
    await writeOrPrint(body);
  };

  await runOnce(false);

  if (hasFlag('watch')) {
    console.error(`# watching every ${intervalSec}s (Ctrl-C to stop)`);
    for (;;) {
      await Bun.sleep(intervalSec * 1000);
      await runOnce(true);
    }
  }
  process.exit(0);
}

// ── patterns (sport-wide edge catalog) ─────────────────────────────────────
if (cmd === 'patterns') {
  const {
    formatEdgePatternCatalog,
    listEdgePatterns,
    edgePatternsByFamily,
    parseEdgePatternSortBy,
    sortEdgePatterns,
  } = await import('./src/settlement/index.ts');
  const sortBy = parseEdgePatternSortBy(argValue('sort-by'), ['family', 'id']);
  const desc = hasFlag('desc');
  const catalog = sortEdgePatterns(listEdgePatterns(), { sortBy, desc }).map(p => ({
    id: p.id,
    family: p.family,
    title: p.title,
    description: p.description,
    scope: p.scope,
  }));
  const payload = {
    sortBy,
    desc,
    families: edgePatternsByFamily(),
    patterns: catalog,
  };

  // --json: machine JSON. --inspect: Bun.inspect(snapshot, { colors, depth, sorted }).
  if (hasFlag('inspect') || argValue('format') === 'inspect') {
    const { inspectSnapshot } = await import('./src/research/bun-native.ts');
    const colors =
      !hasFlag('no-color') &&
      Boolean(process.stdout.isTTY) &&
      process.env.NO_COLOR == null;
    const depthRaw = argValue('depth');
    const depth = depthRaw != null && Number.isFinite(Number(depthRaw)) ? Number(depthRaw) : 4;
    const text = inspectSnapshot(payload, { colors, depth, sorted: true });
    await writeOrPrint(text.endsWith('\n') ? text : text + '\n');
    process.exit(0);
  }
  if (hasFlag('json') || argValue('format') === 'json') {
    await writeOrPrint(JSON.stringify(payload, null, 2) + '\n');
    process.exit(0);
  }
  await writeOrPrint(formatEdgePatternCatalog({ sortBy, desc }));
  process.exit(0);
}

// ── analyze ────────────────────────────────────────────────────────────────
if (cmd === 'analyze') {
  const pos = positionalAfterCmd('analyze');
  const paths = pos.length ? pos : await resolveFromPaths();
  let events = paths.length
    ? await loadTrackerEventsFromPaths(paths)
    : [];
  // Optional shell settlement + edge patterns (plive/ezlive rules)
  const sportId = argValue('sport');
  if (sportId) {
    const {
      parseEdgePatternSortBy,
      parseAnalyzeRowSortBy,
      buildAnalyzeSchemaDocument,
      formatAnalyzeCsv,
      renderSportAnalyze,
    } = await import('./src/settlement/index.ts');
    const { inspectSnapshot } = await import('./src/research/bun-native.ts');
    const phase =
      argValue('phase') === 'prematch' ? 'prematch' : 'live';
    const sortBy = parseEdgePatternSortBy(argValue('sort-by'), ['severity', 'id']);
    const desc = hasFlag('desc');
    const weighted = weightTrackerEvents(events, {
      sportId,
      phase,
      period: argValue('period') ?? undefined,
      patternSort: { sortBy, desc },
    });
    // --columns desk|odds|settlement|patterns|ev|all|key1,key2
    const colArg = argValue('columns');
    // --sort-rows voidRisk,voidDelta (display order; orthogonal to pattern --sort-by)
    const sortRowsArg = argValue('sort-rows');
    const rowSortBy = sortRowsArg ? parseAnalyzeRowSortBy(sortRowsArg) : undefined;
    const rowSortDesc = hasFlag('rows-desc');
    const colors =
      !hasFlag('no-color') &&
      Boolean(process.stdout.isTTY) &&
      process.env.NO_COLOR == null;
    const render = renderSportAnalyze({
      sportId,
      phase,
      sortBy,
      desc,
      events: weighted,
      columns: hasFlag('all-columns')
        ? ['all']
        : colArg
          ? colArg.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
      colors,
      rowSortBy,
      rowSortDesc,
    });
    const { artifact, banner, inspectMeta, tableInspect, tableMarkdown } = render;

    // Optional bake to docs/artifacts for sample table SSOT (always full multi-preset)
    if (hasFlag('bake') || hasFlag('write-sample')) {
      const { joinPath } = await import('./src/research/paths.ts');
      const schemaPath = joinPath(
        process.cwd(),
        'docs/artifacts/live-tracker-analyze-schema.json',
      );
      const samplePath = joinPath(
        process.cwd(),
        'docs/artifacts/live-tracker-analyze-sample.json',
      );
      const tablePath = joinPath(
        process.cwd(),
        'docs/artifacts/live-tracker-analyze-sample.md',
      );
      const htmlPath = joinPath(
        process.cwd(),
        'docs/artifacts/live-tracker-analyze-sample.html',
      );
      await Bun.write(
        schemaPath,
        JSON.stringify(buildAnalyzeSchemaDocument(), null, 2) + '\n',
      );
      await Bun.write(samplePath, JSON.stringify(artifact, null, 2) + '\n');
      await Bun.write(tablePath, render.markdownReport + '\n');
      await Bun.write(htmlPath, render.htmlReport);
      console.error(
        `baked ${schemaPath}\n      ${samplePath}\n      ${tablePath}\n      ${htmlPath}`,
      );
    }

    if (hasFlag('inspect') || argValue('format') === 'inspect') {
      const depthRaw = argValue('depth');
      const depth = depthRaw != null && Number.isFinite(Number(depthRaw)) ? Number(depthRaw) : 6;
      const meta = inspectSnapshot(inspectMeta, { colors, depth, sorted: true });
      await writeOrPrint(meta + '\n\n' + tableInspect + '\n');
      process.exit(0);
    }
    if (hasFlag('json') || argValue('format') === 'json') {
      await writeOrPrint(JSON.stringify(artifact, null, 2) + '\n');
      process.exit(0);
    }
    if (hasFlag('html') || argValue('format') === 'html') {
      // Honors --columns: desk → focused; desk,ev → multi-select; all → full
      const colLabel =
        colArg?.replace(/,/g, '-') ??
        (hasFlag('all-columns') ? 'all' : 'desk');
      const defaultHtml = joinPath(
        CACHE_DIR,
        'live-tracker',
        `analyze-${sportId}-${phase}-${colLabel}.html`,
      );
      await writeOrPrint(render.htmlView, {
        defaultPath: argValue('output') || argValue('out') ? undefined : defaultHtml,
        open: hasFlag('open'),
      });
      process.exit(0);
    }
    if (hasFlag('csv') || argValue('format') === 'csv') {
      await writeOrPrint(formatAnalyzeCsv(artifact.rows, render.columns));
      process.exit(0);
    }
    if (hasFlag('table') || argValue('format') === 'table') {
      await writeOrPrint(banner + '\n\n' + tableInspect + '\n');
      process.exit(0);
    }
    // Markdown narrative + selected-column table (+ banner summary)
    const lines: string[] = [
      banner,
      '',
      tableMarkdown,
      '',
    ];
    if (hasFlag('verbose')) {
      for (const e of weighted) {
        if (!('settlement' in e) || !e.settlement) continue;
        const s = e.settlement;
        lines.push(
          `${e.time} ${e.eventType} mkt=${e.marketType ?? '?'} per=${e.period ?? 'm'} ` +
            `${s.summary}`,
        );
        lines.push(`  → ${s.sizingNote}`);
        for (const h of s.patterns ?? []) {
          if (h.severity === 'info') continue;
          lines.push(`  → [${h.severity}] ${h.patternId} (${h.family}): ${h.note}`);
        }
      }
    }
    if (!artifact.rows.length) {
      lines.push('(no PRICE_CHANGE/MARKET_ADDED rows to weight)');
    }
    await writeOrPrint(lines.join('\n') + '\n');
    process.exit(0);
  }
  // default analyze = summary
  if (!hasFlag('detail') && !hasFlag('stats')) {
    process.argv.push('--summary');
  }
  const body = renderOutput(events, events, parseDiffQuery());
  await writeOrPrint(body);
  process.exit(0);
}

// ── chart (price overlay SVG) ──────────────────────────────────────────────
if (cmd === 'chart') {
  const pairs = parseEventMarketPairs(process.argv);
  if (!pairs.length) {
    console.error(
      'chart requires --event ID --market TYPE (repeatable pairs)\n' +
        '  e.g. --event 197510101 --market 3 --event 197510101 --market 4'
    );
    process.exit(2);
  }
  const period = argValue('period');
  if (period) {
    for (const p of pairs) p.period = period;
  }
  // Load logs for unique event ids (default cache path) + optional --from
  const eventIds = [...new Set(pairs.map(p => String(p.eventId)))];
  const fromGlob = argValue('from');
  const paths: string[] = [];
  if (fromGlob) {
    const globber = new Bun.Glob(fromGlob);
    for await (const p of globber.scan('.')) paths.push(p);
  } else {
    for (const id of eventIds) {
      paths.push(defaultLiveTrackerLogPath(id));
    }
  }
  const existing = [];
  for (const p of paths) {
    if (await Bun.file(p).exists()) existing.push(p);
  }
  if (!existing.length) {
    console.error(
      `no tracker logs for events ${eventIds.join(', ')}\n` +
        `  run: bun live-tracker.ts watch --market-id ${eventIds[0]} --seconds=30`
    );
    process.exit(1);
  }
  const events = await loadTrackerEventsFromPaths(existing);
  const series = buildPriceSeriesMany(events, pairs);
  const overlay = hasFlag('overlay') || !hasFlag('no-overlay');
  const svg = renderPriceChartSvg(series, {
    overlay,
    title:
      argValue('title') ??
      `live-tracker chart · ${series.map(s => s.label).join(' vs ')}`,
  });
  const out =
    argValue('out') ?? argValue('output') ?? 'compare.svg';
  await Bun.write(out, svg);
  const pts = series.reduce((n, s) => n + s.points.length, 0);
  console.error(
    `wrote ${out} · series=${series.length} points=${pts} logs=${existing.length}` +
      series.map(s => `\n  ${s.label}: ${s.points.length} pts`).join('')
  );
  process.exit(0);
}

usage(1);
