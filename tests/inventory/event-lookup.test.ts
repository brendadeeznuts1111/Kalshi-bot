// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { formatEventLookup } from '../../src/inventory/event-lookup-format.ts';
import {
  filterLinesByPeriod,
  inferSportHintFromLines,
  labelPeriodId,
  lookupEvent,
  parseEventRef,
  pliveEventUrl,
  summarizePeriods,
  type EventLookupResult,
} from '../../src/inventory/event-lookup.ts';
import {
  formatSportBoardSamples,
  type SportBoardSample,
} from '../../src/inventory/sports-inventory.ts';
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

  test('labelPeriodId is sport-aware', () => {
    expect(labelPeriodId('m')).toContain('match');
    expect(labelPeriodId('s1', 'tennis')).toBe('set 1');
    // TT is games, not sets (hint path)
    expect(labelPeriodId('s1', 'table_tennis')).toBe('game 1');
    expect(labelPeriodId('h1', 'soccer')).toBe('half 1');
    expect(labelPeriodId('q2', 'basketball')).toBe('quarter 2');
    expect(labelPeriodId('p1', 'ice_hockey')).toBe('period 1');
    // Baked feedSportId wins: baseball innings, TT games, basketball quarters
    expect(labelPeriodId('s1', null, 1)).toBe('1st Inning');
    expect(labelPeriodId('s1', 'tennis', 93)).toBe('1st Game'); // feed overrides wrong hint
    expect(labelPeriodId('s1', null, 2)).toBe('1st Quarter');
    expect(labelPeriodId('s1', null, 8)).toBe('1st Set');
    expect(labelPeriodId('s1', 'american_football')).toBe('quarter 1');
  });

  test('inferSportHintFromLines uses totals and periods', () => {
    const bb: CoefficientLine[] = [
      {
        eventId: 1,
        period: 'm',
        marketType: '5',
        selection: '159.5',
        line: 159.5,
        decimal: 1.9,
        american: -111,
      },
    ];
    expect(inferSportHintFromLines(bb)).toBe('basketball');
    const ten: CoefficientLine[] = [
      {
        eventId: 1,
        period: 's1',
        marketType: '3',
        selection: '1',
        decimal: 1.9,
        american: -111,
      },
      {
        eventId: 1,
        period: 's2',
        marketType: '3',
        selection: '1',
        decimal: 1.9,
        american: -111,
      },
    ];
    expect(inferSportHintFromLines(ten)).toBe('tennis');
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
    const periods = summarizePeriods('1', lines, 'tennis');
    expect(periods.map(p => p.periodId).sort()).toEqual(['m', 's1']);
    expect(periods.find(p => p.periodId === 's1')?.label).toBe('set 1');
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

  test('summarizePeriods uses feedSportId bake for TT games', () => {
    const lines: CoefficientLine[] = [
      {
        eventId: 1,
        period: 's1',
        marketType: '3',
        selection: '1',
        decimal: 1.9,
        american: -111,
      },
    ];
    const periods = summarizePeriods('1', lines, 'tennis', 93);
    expect(periods[0]!.label).toBe('1st Game');
  });


  test('formatEventLookup includes period table labels', () => {
    const r = {
      eventId: '99',
      periodId: 'm',
      pliveUrl: 'https://x/#!/event/99/m',
      pliveUrlBare: 'https://x/#!/event/99',
      plane: 'priced_only',
      sportHint: 'table_tennis',
      streamList: { hit: false, event: null },
      skinEvents: null,
      bookedCatalog: null,
      pandora: {
        probed: true,
        seconds: 1,
        subscribed: true,
        lineCount: 1,
        periods: [
          {
            periodId: 's1',
            label: '1st Game',
            lineCount: 1,
            marketTypes: ['3'],
            pliveUrl: 'https://x/#!/event/99/s1',
          },
        ],
        lines: [],
        periodMissing: false,
        book: null,
        eventState: {
          eventId: 99,
          state: 0,
          stateLabel: 'active',
          hasLines: true,
          isStarted: true,
          offTheBoard: false,
          sportId: '93',
          sportName: 'Table Tennis',
          canonicalSportId: 'table_tennis',
          leagueId: null,
          leagueName: null,
          countryId: null,
          countryName: null,
          home: 'P1',
          away: 'P2',
          path: ['93', '0', '1', '99'],
          startTimeSec: null,
          blockedReason: null,
        },
        eventDataBoard: null,
      },
      notes: [],
    } as unknown as EventLookupResult;
    const text = formatEventLookup(r);
    expect(text).toContain('1st Game');
    expect(text).toContain('table_tennis');
    expect(text).toContain('P1 vs P2');
  });
});
