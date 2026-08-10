// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  formatOddsWatchSummary,
  summarizeOddsWatch,
  type OddsWatchUpdate,
} from '../../src/inventory/event-lookup.ts';

describe('summarizeOddsWatch suspensions', () => {
  test('pairs market_off → market_on with duration', () => {
    const history: OddsWatchUpdate[] = [
      {
        at: '2026-08-10T12:00:00.000Z',
        eventId: 1,
        lineCount: 10,
        offeredMarketCount: 5,
        transitions: [],
        book: null,
        eventState: null,
        eventTransitions: [],
      },
      {
        at: '2026-08-10T12:00:01.000Z',
        eventId: 1,
        lineCount: 8,
        offeredMarketCount: 4,
        transitions: [
          { kind: 'market_off', period: 'm', marketType: '5' },
          { kind: 'market_off', period: 'm', marketType: '6' },
        ],
        book: null,
        eventState: null,
        eventTransitions: [],
      },
      {
        at: '2026-08-10T12:00:04.100Z',
        eventId: 1,
        lineCount: 10,
        offeredMarketCount: 5,
        transitions: [
          { kind: 'market_on', period: 'm', marketType: '5' },
          { kind: 'price_change', period: 'm', marketType: '3', selection: '1', from: 1.5, to: 1.55 },
        ],
        book: null,
        eventState: null,
        eventTransitions: [],
      },
    ];
    const s = summarizeOddsWatch(history, {
      lastLines: [
        { eventId: 1, period: 'm', marketType: '3', selection: '1', decimal: 1.54, american: -185 },
        { eventId: 1, period: 'm', marketType: '3', selection: '2', decimal: 2.32, american: 132 },
      ],
    });
    expect(s.suspensionCount).toBe(1);
    expect(s.openSuspensions).toBe(1); // m/6 still open
    expect(s.suspensions.find(x => x.marketType === '5')?.durationMs).toBe(3100);
    expect(s.medianSuspensionMs).toBe(3100);
    expect(s.transitionCounts.market_off).toBe(2);
    expect(s.vig.length).toBeGreaterThanOrEqual(1);
    const text = formatOddsWatchSummary(s);
    expect(text).toContain('Suspension');
    expect(text).toContain('Vig');
    expect(text).toContain('| m/5 |');
  });
});
