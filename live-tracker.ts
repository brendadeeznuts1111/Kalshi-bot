#!/usr/bin/env bun
/**
 * Live market event tracker (Pandora coefficient transitions).
 *
 *   bun live-tracker.ts diff --event-type MARKET_ADDED --sort-by time --limit 5
 *   bun live-tracker.ts watch --market-id #197510101 --format json --watch
 *   bun live-tracker.ts analyze --summary
 *   bun live-tracker.ts diff --columns File,Event,Detail --desc
 *
 * Logs: research/cache/live-tracker/event-{id}.jsonl
 */
import { watchEventOdds } from './src/inventory/event-lookup.ts';
import {
  LIVE_TRACKER_EVENT_TYPES,
  appendTrackerLog,
  defaultLiveTrackerLogPath,
  eventsFromWatchUpdate,
  eventsToObjects,
  filterAndSortEvents,
  formatEventsTable,
  loadTrackerEventsFromPaths,
  normalizeWireId,
  parseEventType,
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

function usage(code = 1): never {
  console.error(`live-tracker — Pandora market transition log

Usage:
  bun live-tracker.ts watch  --market-id|#eventId [--seconds=30] [--format json|table] [--watch] [--log=path]
  bun live-tracker.ts diff   [--from=path|glob] [--event-type TYPE] [--sort-by time|event|detail|file]
                             [--limit N] [--columns A,B,C] [--desc] [--format json|table]
  bun live-tracker.ts analyze [--from=path|glob] [--summary] [--format json|table]

Event types: ${LIVE_TRACKER_EVENT_TYPES.join(' | ')}
  (aliases: market_on→MARKET_ADDED, market_off→MARKET_REMOVED, …)

Examples:
  bun live-tracker.ts diff --event-type MARKET_ADDED --sort-by time --limit 5
  bun live-tracker.ts watch --market-id #197510101 --format json --watch
  bun live-tracker.ts analyze --summary
  bun live-tracker.ts diff --columns File,Event,Detail --desc
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

function parseDiffQuery(): DiffQuery {
  const etRaw = argValue('event-type') ?? argValue('type');
  let eventType: LiveTrackerEventType | null = null;
  if (etRaw) {
    eventType = parseEventType(etRaw);
    if (!eventType) {
      console.error(`unknown --event-type ${etRaw}`);
      process.exit(2);
    }
  }
  const sortRaw = (argValue('sort-by') ?? 'time').toLowerCase();
  const sortBy = (
    ['time', 'event', 'detail', 'file'].includes(sortRaw)
      ? sortRaw
      : 'time'
  ) as DiffQuery['sortBy'];
  const limitRaw = argValue('limit');
  return {
    eventType,
    eventId: argValue('market-id') ?? argValue('event-id') ?? argValue('id'),
    marketType: argValue('market-type'),
    period: argValue('period'),
    sortBy,
    desc: hasFlag('desc'),
    limit: limitRaw ? Math.max(1, Number(limitRaw) || 1) : undefined,
    columns: parseColumns(),
  };
}

async function resolveFromPaths(): Promise<string[]> {
  const from = argValue('from');
  if (from) {
    // support simple globs via Bun.Glob
    if (from.includes('*')) {
      const g = new Bun.Glob(from);
      const hits: string[] = [];
      for await (const p of g.scan('.')) hits.push(p);
      return hits.sort();
    }
    return [from];
  }
  // default: all tracker logs
  const dir = joinPath(CACHE_DIR, 'live-tracker');
  const g = new Bun.Glob('*.jsonl');
  const hits: string[] = [];
  try {
    for await (const p of g.scan(dir)) {
      hits.push(joinPath(dir, p));
    }
  } catch {
    /* empty */
  }
  return hits.sort();
}

function emitEvents(events: LiveTrackerEvent[], q: DiffQuery): void {
  const rows = filterAndSortEvents(events, q);
  if (json) {
    console.log(
      JSON.stringify(
        {
          count: rows.length,
          total: events.length,
          query: q,
          events: eventsToObjects(rows, q.columns),
          raw: rows,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatEventsTable(rows, q.columns));
    console.error(`# ${rows.length}/${events.length} events`);
  }
}

// ── watch ──────────────────────────────────────────────────────────────────
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
    Math.max(Number(argValue('seconds') ?? (hasFlag('watch') ? '60' : '30')) || 30, 5),
    600
  );
  const host = argValue('host') ?? (hasFlag('spandora') ? 'spandora' : 'pandora');
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
      if (json) {
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
  if (!json) {
    console.error(
      `# watch done updates=${history.length} events=${all.length} log=${logPath}`
    );
    if (all.length) console.log(formatEventsTable(filterAndSortEvents(all, { sortBy: 'time' })));
  } else if (!hasFlag('watch')) {
    // final envelope when not streaming-only
    console.log(
      JSON.stringify(
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
    );
  }
  process.exit(0);
}

// ── diff ───────────────────────────────────────────────────────────────────
if (cmd === 'diff') {
  const paths = await resolveFromPaths();
  if (!paths.length) {
    console.error(
      'no tracker logs — run: bun live-tracker.ts watch --market-id <id>'
    );
    process.exit(1);
  }
  const events = await loadTrackerEventsFromPaths(paths);
  emitEvents(events, parseDiffQuery());
  process.exit(0);
}

// ── analyze ────────────────────────────────────────────────────────────────
if (cmd === 'analyze') {
  const paths = await resolveFromPaths();
  const events = await loadTrackerEventsFromPaths(paths);
  const summary = summarizeEventTypes(events);
  if (hasFlag('summary') || !hasFlag('detail')) {
    if (json) {
      console.log(
        JSON.stringify(
          {
            files: paths.length,
            totalEvents: events.length,
            byType: summary,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `live-tracker analyze · files=${paths.length} events=${events.length}`
      );
      const wType = Math.max(
        12,
        ...summary.map(s => s.eventType.length),
        'Event type'.length
      );
      console.log('Event type'.padEnd(wType) + '  Count');
      console.log('-'.repeat(wType) + '  -----');
      for (const s of summary) {
        console.log(s.eventType.padEnd(wType) + '  ' + String(s.count));
      }
      if (!summary.length) console.log('(no events in logs)');
    }
  } else {
    emitEvents(events, parseDiffQuery());
  }
  process.exit(0);
}

usage(1);
