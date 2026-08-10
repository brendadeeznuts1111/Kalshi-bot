// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { formatEventLookup } from '../../src/inventory/event-lookup-format.ts';
import type { EventLookupResult } from '../../src/inventory/event-lookup.ts';

describe('event-lookup-format', () => {
  test('formatEventLookup renders plane and matchup', () => {
    const r = {
      eventId: '1',
      periodId: null,
      pliveUrl: 'https://x/#!/event/1',
      pliveUrlBare: 'https://x/#!/event/1',
      plane: 'unknown',
      sportHint: 'tennis',
      streamList: { hit: false, event: null },
      skinEvents: null,
      bookedCatalog: null,
      pandora: {
        probed: false,
        seconds: 0,
        subscribed: false,
        lineCount: 0,
        periods: [],
        lines: [],
        periodMissing: false,
        book: null,
        eventState: null,
        eventDataBoard: null,
      },
      notes: ['hello'],
    } as EventLookupResult;
    const text = formatEventLookup(r);
    expect(text).toContain('Event 1');
    expect(text).toContain('tennis');
    expect(text).toContain('hello');
    expect(text).toContain('pandora skipped');
  });
});
