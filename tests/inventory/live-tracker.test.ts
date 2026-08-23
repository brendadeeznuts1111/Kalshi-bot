// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { $ } from "bun";
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeEventStats,
  diffEventLists,
  eventsFromWatchUpdate,
  filterAndSortEvents,
  formatEventsCsv,
  formatEventsTable,
  loadTrackerEventsFromPaths,
  parseEventType,
  stampTrackerLogRecord,
  type LiveTrackerEvent,
} from '../../src/inventory/live-tracker.ts';
import { compareTime } from '../../src/lib/time-ssot.ts';
import type { OddsWatchUpdate } from '../../src/inventory/pandora-listen.ts';
import type { OfferTransition } from '../../src/partner/fantasy-ultra/coefficients.ts';

function mkEvents(
  transitions: OfferTransition[],
  ctx: { at: string; eventId: number; file?: string }
): LiveTrackerEvent[] {
  const u: OddsWatchUpdate = {
    at: ctx.at,
    eventId: ctx.eventId,
    lineCount: 0,
    offeredMarketCount: 0,
    transitions,
    book: null,
    eventState: null,
    eventTransitions: [],
  };
  return eventsFromWatchUpdate(u, { file: ctx.file });
}

function mkEvent(
  t: OfferTransition,
  ctx: { at: string; eventId: number; file?: string }
): LiveTrackerEvent {
  return mkEvents([t], ctx)[0]!;
}

describe('live-tracker', () => {
  test('maps offer transitions to public event types', () => {
    const e = mkEvent(
      { kind: 'market_on', period: 'm', marketType: '3' },
      { at: '2026-08-10T00:00:00.000Z', eventId: 197510101 }
    );
    expect(e.eventType).toBe('MARKET_ADDED');
    expect(e.detail).toContain('m/3');
    expect(parseEventType('market_on')).toBe('MARKET_ADDED');
    expect(parseEventType('MARKET_REMOVED')).toBe('MARKET_REMOVED');
  });

  test('filter sort limit columns', () => {
    const events = [
      mkEvent(
        { kind: 'market_on', period: 'm', marketType: '3' },
        { at: '2026-08-10T00:00:02.000Z', eventId: 1, file: 'b.jsonl' }
      ),
      mkEvent(
        {
          kind: 'price_change',
          period: 'm',
          marketType: '5',
          selection: '2.5',
          from: 1.9,
          to: 1.95,
        },
        { at: '2026-08-10T00:00:01.000Z', eventId: 1, file: 'a.jsonl' }
      ),
      mkEvent(
        { kind: 'market_on', period: 's1', marketType: '3' },
        { at: '2026-08-10T00:00:03.000Z', eventId: 1, file: 'a.jsonl' }
      ),
    ];
    const added = filterAndSortEvents(events, {
      eventTypes: ['MARKET_ADDED'],
      sortBy: ['time'],
      limit: 5,
    });
    expect(added).toHaveLength(2);
    expect(added[0]!.time).toBe('2026-08-10T00:00:02.000Z');

    const desc = filterAndSortEvents(events, {
      sortBy: ['time'],
      desc: true,
    });
    expect(desc[0]!.time).toBe('2026-08-10T00:00:03.000Z');

    const table = formatEventsTable(added, ['File', 'Event', 'Detail']);
    expect(table).toContain('File');
    expect(table).toContain('MARKET_ADDED');
    expect(table).toContain('b.jsonl');

    const tail = filterAndSortEvents(events, { tail: 2 });
    expect(tail).toHaveLength(2);
    // Tail is last-N by time ascending — interior sort key via time-ssot.
    expect(compareTime(tail[0]!.time, tail[1]!.time)).toBeLessThanOrEqual(0);
    if (tail[0]!.timeMs != null && tail[1]!.timeMs != null) {
      expect(tail[0]!.timeMs).toBeLessThanOrEqual(tail[1]!.timeMs);
    }

    const multi = filterAndSortEvents(events, {
      eventTypes: ['MARKET_ADDED', 'PRICE_CHANGE'],
      offset: 1,
      limit: 2,
      sortBy: ['time'],
    });
    expect(multi.length).toBeLessThanOrEqual(2);
  });

  test('stampTrackerLogRecord dual-stamps envelope + events', () => {
    const stamped = stampTrackerLogRecord({
      at: '2026-08-10T10:00:02.000Z',
      eventId: 1,
      lineCount: 1,
      offeredMarketCount: 1,
      events: [
        {
          time: '2026-08-10T10:00:02.000Z',
          eventType: 'PRICE_CHANGE',
          eventId: 1,
          detail: 'price',
        },
      ],
    });
    expect(stamped.atMs).toBe(Date.parse('2026-08-10T10:00:02.000Z'));
    expect(stamped.events[0]!.timeMs).toBe(stamped.atMs);
  });

  test('eventsFromWatchUpdate dual-stamps timeMs', () => {
    const u: OddsWatchUpdate = {
      at: '2026-08-10T12:00:00.000Z',
      eventId: 99,
      lineCount: 4,
      offeredMarketCount: 2,
      transitions: [
        { kind: 'market_off', period: 'm', marketType: '6' },
        {
          kind: 'price_change',
          period: 'm',
          marketType: '3',
          selection: '1',
          from: 2,
          to: 2.1,
        },
      ],
      book: null,
      eventState: null,
      eventTransitions: [],
    };
    const events = eventsFromWatchUpdate(u);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.timeMs).toBe(Date.parse('2026-08-10T12:00:00.000Z'));
      expect(e.time).toBe('2026-08-10T12:00:00.000Z');
    }
  });

  test('eventsFromWatchUpdate + summarize via stats', () => {
    const u: OddsWatchUpdate = {
      at: '2026-08-10T12:00:00.000Z',
      eventId: 99,
      lineCount: 4,
      offeredMarketCount: 2,
      transitions: [
        { kind: 'market_off', period: 'm', marketType: '6' },
        {
          kind: 'price_change',
          period: 'm',
          marketType: '3',
          selection: '1',
          from: 2,
          to: 2.1,
        },
      ],
      book: null,
      eventState: null,
      eventTransitions: [],
    };
    const ev = eventsFromWatchUpdate(u);
    expect(ev.map(e => e.eventType).sort()).toEqual([
      'MARKET_REMOVED',
      'PRICE_CHANGE',
    ]);
    const sum = computeEventStats(ev).byType;
    expect(sum.find(s => s.eventType === 'PRICE_CHANGE')?.count).toBe(1);
  });

  test('loadTrackerEventsFromPaths accepts log records', async () => {
    const path = `/tmp/live-tracker-test-${Date.now()}.jsonl`;
    const text = [
      JSON.stringify({
        at: 't1',
        eventId: 1,
        lineCount: 0,
        offeredMarketCount: 0,
        events: [
          {
            time: 't1',
            eventType: 'MARKET_ADDED',
            eventId: 1,
            detail: 'x',
          },
        ],
      }),
      JSON.stringify({
        time: 't2',
        eventType: 'PRICE_CHANGE',
        eventId: 1,
        detail: 'y',
      }),
    ].join('\n');
    await Bun.write(path, text);
    const ev = await loadTrackerEventsFromPaths([path]);
    expect(ev).toHaveLength(2);
    expect(ev[0]!.file).toBe(path);
    await Bun.$`rm -f ${path}`.quiet();
  });

  test('diffEventLists / stats / csv / multi sort keys', () => {
    const a = [
      mkEvent(
        { kind: 'market_on', period: 'm', marketType: '3' },
        { at: '2026-08-10T00:00:01.000Z', eventId: 1 }
      ),
    ];
    const b = [
      ...a,
      mkEvent(
        { kind: 'market_on', period: 's1', marketType: '3' },
        { at: '2026-08-10T00:00:02.000Z', eventId: 1 }
      ),
    ];
    const d = diffEventLists(a, b, { oldFile: 'old.json', newFile: 'new.json' });
    expect(
      d.some(e => e.eventType === 'MARKET_ADDED' && e.detail.includes('s1'))
    ).toBe(true);
    const multiSort = filterAndSortEvents(b, { sortBy: ['time', 'event'] });
    expect(multiSort).toHaveLength(2);
    const stats = computeEventStats(b);
    expect(stats.total).toBe(2);
    expect(stats.spanMs).toBe(1000);
    expect(stats.byType.some(s => s.eventType === 'MARKET_ADDED')).toBe(true);
    const csv = formatEventsCsv(b, ['Event', 'Detail']);
    expect(csv.split('\n')[0]).toBe('Event,Detail');
    expect(csv).toContain('MARKET_ADDED');
  });

  test('diff CLI keeps file operands after a boolean flag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'live-tracker-cli-'));
    const oldPath = join(dir, 'old.jsonl');
    const newPath = join(dir, 'new.jsonl');
    await Bun.write(oldPath, '');
    await Bun.write(
      newPath,
      JSON.stringify({
        time: '2026-08-10T00:00:00.000Z',
        eventType: 'MARKET_ADDED',
        eventId: 1,
        detail: 'new market',
      })
    );

    try {
      const { exitCode, stdout, stderr } = await $`bun tools/live-tracker-cli.ts diff --desc ${oldPath} ${newPath} --format=json`.nothrow().quiet();

      expect(exitCode, stderr.toString()).toBe(0);
      const output = JSON.parse(stdout.toString()) as {
        count: number;
        events: Array<Record<string, string>>;
      };
      expect(output.count).toBe(1);
      expect(output.events[0]?.Detail).toContain('[+] new market');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
