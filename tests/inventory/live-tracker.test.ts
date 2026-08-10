// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  eventsFromWatchUpdate,
  filterAndSortEvents,
  formatEventsTable,
  offerTransitionToEvent,
  parseEventType,
  parseTrackerJsonl,
  summarizeEventTypes,
} from '../../src/inventory/live-tracker.ts';
import type { OddsWatchUpdate } from '../../src/inventory/event-lookup.ts';

describe('live-tracker', () => {
  test('maps offer transitions to public event types', () => {
    const e = offerTransitionToEvent(
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
      offerTransitionToEvent(
        { kind: 'market_on', period: 'm', marketType: '3' },
        { at: '2026-08-10T00:00:02.000Z', eventId: 1, file: 'b.jsonl' }
      ),
      offerTransitionToEvent(
        { kind: 'price_change', period: 'm', marketType: '5', selection: '2.5', from: 1.9, to: 1.95 },
        { at: '2026-08-10T00:00:01.000Z', eventId: 1, file: 'a.jsonl' }
      ),
      offerTransitionToEvent(
        { kind: 'market_on', period: 's1', marketType: '3' },
        { at: '2026-08-10T00:00:03.000Z', eventId: 1, file: 'a.jsonl' }
      ),
    ];
    const added = filterAndSortEvents(events, {
      eventType: 'MARKET_ADDED',
      sortBy: 'time',
      limit: 5,
    });
    expect(added).toHaveLength(2);
    expect(added[0]!.time).toBe('2026-08-10T00:00:02.000Z');

    const desc = filterAndSortEvents(events, { sortBy: 'time', desc: true });
    expect(desc[0]!.time).toBe('2026-08-10T00:00:03.000Z');

    const table = formatEventsTable(added, ['File', 'Event', 'Detail']);
    expect(table).toContain('File');
    expect(table).toContain('MARKET_ADDED');
    expect(table).toContain('b.jsonl');
  });

  test('eventsFromWatchUpdate + summarize', () => {
    const u: OddsWatchUpdate = {
      at: '2026-08-10T12:00:00.000Z',
      eventId: 99,
      lineCount: 4,
      offeredMarketCount: 2,
      transitions: [
        { kind: 'market_off', period: 'm', marketType: '6' },
        { kind: 'price_change', period: 'm', marketType: '3', selection: '1', from: 2, to: 2.1 },
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
    const sum = summarizeEventTypes(ev);
    expect(sum.find(s => s.eventType === 'PRICE_CHANGE')?.count).toBe(1);
  });

  test('parseTrackerJsonl accepts log records', () => {
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
    const ev = parseTrackerJsonl(text, 'log.jsonl');
    expect(ev).toHaveLength(2);
    expect(ev[0]!.file).toBe('log.jsonl');
  });
});
