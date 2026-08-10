// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  filterLinesByPeriod,
  formatEventLookup,
  lookupEvent,
  parseEventRef,
  pliveEventUrl,
  summarizePeriods,
} from '../../src/inventory/event-lookup.ts';
import type { FetchFn } from '../../src/institutions/resilient-fetch.ts';
import type { CoefficientLine } from '../../src/partner/fantasy-ultra/coefficients.ts';

describe('event-lookup', () => {
  test('pliveEventUrl builds deep links with optional period', () => {
    expect(pliveEventUrl(197548901)).toContain('#!/event/197548901');
    expect(pliveEventUrl(197488581, 'm')).toContain('#!/event/197488581/m');
    expect(pliveEventUrl(197488581, 's1')).toContain('#!/event/197488581/s1');
  });

  test('parseEventRef accepts id, id/period, and plive URLs', () => {
    expect(parseEventRef('197488581')).toEqual({
      eventId: '197488581',
      periodId: null,
    });
    expect(parseEventRef('197488581/m')).toEqual({
      eventId: '197488581',
      periodId: 'm',
    });
    expect(
      parseEventRef(
        'https://plive.sportswidgets.pro/live/?#!/event/197488581/m'
      )
    ).toEqual({ eventId: '197488581', periodId: 'm' });
    expect(
      parseEventRef(
        'https://plive.sportswidgets.pro/live/?#!/event/197548901'
      )
    ).toEqual({ eventId: '197548901', periodId: null });
  });

  test('summarizePeriods and filterLinesByPeriod', () => {
    const lines: CoefficientLine[] = [
      {
        eventId: 1,
        period: 'm',
        marketType: '3',
        selection: '1',
        decimal: 1.9,
        american: -111,
      },
      {
        eventId: 1,
        period: 'm',
        marketType: '3',
        selection: '2',
        decimal: 1.9,
        american: -111,
      },
      {
        eventId: 1,
        period: 's1',
        marketType: '3',
        selection: '1',
        decimal: 2,
        american: 100,
      },
    ];
    const periods = summarizePeriods('1', lines);
    expect(periods.map(p => p.periodId).sort()).toEqual(['m', 's1']);
    expect(periods.find(p => p.periodId === 'm')?.pliveUrl).toContain('/m');
    expect(filterLinesByPeriod(lines, 's1')).toHaveLength(1);
    expect(filterLinesByPeriod(lines, null)).toHaveLength(3);
  });

  test('lookupEvent finds stream-list inventory id (mock)', async () => {
    const fetchImpl: FetchFn = async () =>
      new Response(
        JSON.stringify({
          sports: {
            basketball: {
              events: {
                '39898549': {
                  sport: 'Basketball',
                  league: 'Test League',
                  competitiors: { home: 'Home', away: 'Away' },
                  stream_id: 39898549,
                  feed_id: 0,
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const r = await lookupEvent({
      eventId: '39898549',
      fetchImpl,
      skipDb: true,
      skipCatalog: true,
      skipPandora: true,
    });
    expect(r.plane).toBe('inventory');
    expect(r.streamList.hit).toBe(true);
    expect(r.streamList.event?.home).toBe('Home');
    expect(formatEventLookup(r)).toContain('stream-list ✓');
  });

  test('lookupEvent marks unknown when nothing hits', async () => {
    const fetchImpl: FetchFn = async () =>
      new Response(JSON.stringify({ sports: {} }), { status: 200 });
    const r = await lookupEvent({
      eventId: '111111111',
      fetchImpl,
      skipDb: true,
      skipCatalog: true,
      skipPandora: true,
    });
    expect(r.plane).toBe('unknown');
    expect(r.streamList.hit).toBe(false);
  });
});
