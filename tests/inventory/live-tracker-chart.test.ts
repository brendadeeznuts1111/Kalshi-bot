// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import type { LiveTrackerEvent } from '../../src/inventory/live-tracker.ts';
import {
  buildPriceSeries,
  parseEventMarketPairs,
  renderPriceChartSvg,
} from '../../src/inventory/live-tracker-chart.ts';

function pe(
  over: Partial<LiveTrackerEvent> &
    Pick<LiveTrackerEvent, 'time' | 'eventType' | 'detail'>
): LiveTrackerEvent {
  return {
    time: over.time,
    eventType: over.eventType,
    eventId: over.eventId ?? 197510101,
    period: over.period ?? 'm',
    marketType: over.marketType ?? '3',
    selection: over.selection,
    detail: over.detail,
    from: over.from,
    to: over.to,
  };
}

describe('live-tracker-chart', () => {
  test('parseEventMarketPairs zips sequential event/market flags', () => {
    const pairs = parseEventMarketPairs([
      'bun',
      'tools/live-tracker-cli.ts',
      'chart',
      '--event',
      '197510101',
      '--market',
      '3',
      '--event',
      '197510101',
      '--market',
      '4',
      '--overlay',
      '--out',
      'compare.svg',
    ]);
    expect(pairs).toEqual([
      { eventId: '197510101', marketType: '3', period: 'm' },
      { eventId: '197510101', marketType: '4', period: 'm' },
    ]);
  });

  test('buildPriceSeries steps PRICE_CHANGE to points', () => {
    const events = [
      pe({
        time: '2026-08-10T10:00:01.000Z',
        eventType: 'MARKET_ADDED',
        detail: 'm/3 offered',
      }),
      pe({
        time: '2026-08-10T10:00:02.000Z',
        eventType: 'PRICE_CHANGE',
        selection: '1',
        from: 1.9,
        to: 1.95,
        detail: 'price',
      }),
      pe({
        time: '2026-08-10T10:00:03.000Z',
        eventType: 'PRICE_CHANGE',
        selection: '1',
        from: 1.95,
        to: 2.0,
        detail: 'price',
      }),
      pe({
        time: '2026-08-10T10:00:04.000Z',
        eventType: 'PRICE_CHANGE',
        marketType: '4',
        selection: '1',
        from: 1.5,
        to: 1.55,
        detail: 'other mkt',
      }),
    ];
    const s3 = buildPriceSeries(events, {
      eventId: 197510101,
      marketType: '3',
    });
    expect(s3.points).toHaveLength(2);
    expect(s3.points[0]!.price).toBe(1.95);
    expect(s3.points[1]!.price).toBe(2.0);
    expect(s3.selection).toBe('1');

    const s4 = buildPriceSeries(events, {
      eventId: 197510101,
      marketType: '4',
    });
    expect(s4.points).toHaveLength(1);
    expect(s4.points[0]!.price).toBe(1.55);
  });

  test('renderPriceChartSvg overlays series', () => {
    const events = [
      pe({
        time: '2026-08-10T10:00:02.000Z',
        eventType: 'PRICE_CHANGE',
        marketType: '3',
        selection: '1',
        to: 1.9,
        detail: 'p',
      }),
      pe({
        time: '2026-08-10T10:00:03.000Z',
        eventType: 'PRICE_CHANGE',
        marketType: '4',
        selection: '1',
        to: 2.1,
        detail: 'p',
      }),
    ];
    const series = [
      buildPriceSeries(events, { eventId: 197510101, marketType: '3' }),
      buildPriceSeries(events, { eventId: 197510101, marketType: '4' }),
    ];
    const svg = renderPriceChartSvg(series, { overlay: true });
    expect(svg).toContain('<svg');
    expect(svg).toContain('path d=');
    expect(svg).toContain('live-tracker chart');
  });
});
