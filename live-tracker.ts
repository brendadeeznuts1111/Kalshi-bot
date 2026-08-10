#!/usr/bin/env bun
/**
 * Live market event tracker (Pandora coefficient transitions).
 *
 *   bun live-tracker.ts diff old.json new.json --event-type MARKET_ADDED --sort-by time --limit 5
 *   bun live-tracker.ts diff --event-type MARKET_ADDED --sort-by time --limit 5
 *   bun live-tracker.ts watch --market-id #197510101 --format json --watch
 *   bun live-tracker.ts analyze --summary
 *   bun live-tracker.ts analyze --stats
 *   bun live-tracker.ts diff --columns File,Event,Detail --desc --output out.csv --format csv
 *   bun live-tracker.ts diff --tail 10 --watch --interval 2
 *
 * Logs: research/cache/live-tracker/event-{id}.jsonl
 */
import { watchEventOdds } from './src/inventory/event-lookup.ts';
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
  formatSummaryLine,
  loadTrackerEventsFromPaths,
  normalizeWireId,
  parseEventType,
  parseSortBy,
  summarizeEventTypes,
  type DiffQuery,
  type LiveTrackerEvent,
  type LiveTrackerEventType,
} from './src/inventory/live-tracker.ts';
import { CACHE_DIR, joinPath } from './src/research/paths.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) {
    const next = process.argv[idx + 1];
    if (next && !next.startsWith('--')) return next;
  }
  return undefined;
}

/** All values for a multi flag: --event-type A --event-type B or --event-type A,B */
function argValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === `--${name}`) {
      const next = process.argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.push(...next.split(',').map(s => s.trim()).filter(Boolean));
        i++;
      }
    } else if (a.startsWith(`--${name}=`)) {
      out.push(
        ...a
          .slice(name.length + 3)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      );
    }
  }
  return out;
}

function positionalAfterCmd(cmd: string): string[] {
  const idx = process.argv.indexOf(cmd);
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a.startsWith('--')) {
      // skip flag values
      const eq = a.includes('=');
      if (!eq) {
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
  bun live-tracker.ts watch   --market-id|#id [--seconds=30] [--format json|table|csv|markdown]
                              [--watch] [--log=path] [--output path]
  bun live-tracker.ts diff    [old.json] [new.json] [--from=path|glob]
                              [--event-type TYPE[,TYPE…]] [--sort-by time[,event]]
                              [--limit N] [--offset N] [--tail N] [--desc]
                              [--columns A,B,C] [--format table|json|csv|markdown]
                              [--summary] [--stats] [--output path]
                              [--watch] [--interval sec]
  bun live-tracker.ts analyze [files…] [--summary] [--stats] [--format …] [--output path]

Event types: ${LIVE_TRACKER_EVENT_TYPES.join(' | ')}
  aliases: market_on→MARKET_ADDED, market_off→MARKET_REMOVED, …

Examples:
  bun live-tracker.ts diff old.json new.json --event-type MARKET_ADDED --sort-by time --limit 5
  bun live-tracker.ts watch --market-id #197510101 --format json --watch
  bun live-tracker.ts analyze --summary
  bun live-tracker.ts diff --columns File,Event,Detail --desc
  bun live-tracker.ts diff --tail 20 --stats --output /tmp/out.json --format json
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
  const summary = summarizeEventTypes(all);
  const filteredSummary = summarizeEventTypes(rows);

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

async function writeOrPrint(body: string): Promise<void> {
  const out = argValue('output') ?? argValue('out');
  if (out) {
    await Bun.write(out, body.endsWith('\n') ? body : body + '\n');
    console.error(`wrote ${out} (${body.length} bytes)`);
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
      void appendTrackerLog(logPath, {
        at: u.at,
        eventId: u.eventId,
        lineCount: u.lineCount,
        offeredMarketCount: u.offeredMarketCount,
        events,
      });
    },
  });

  const all = history.flatMap(u =>
    eventsFromWatchUpdate(u, { includeTicks, file: logPath })
  );
  const body = json
    ? JSON.stringify(
        {
          watch: true,
          eventId,
          updates: history.length,
          eventCount: all.length,
          log: logPath,
          summary: summarizeEventTypes(all),
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

// ── analyze ────────────────────────────────────────────────────────────────
if (cmd === 'analyze') {
  const pos = positionalAfterCmd('analyze');
  const paths = pos.length ? pos : await resolveFromPaths();
  const events = paths.length
    ? await loadTrackerEventsFromPaths(paths)
    : [];
  // default analyze = summary
  if (!hasFlag('detail') && !hasFlag('stats')) {
    process.argv.push('--summary');
  }
  const body = renderOutput(events, events, parseDiffQuery());
  await writeOrPrint(body);
  process.exit(0);
}

usage(1);
