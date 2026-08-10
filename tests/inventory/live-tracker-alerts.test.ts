// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import type { LiveTrackerEvent } from '../../src/inventory/live-tracker.ts';
import {
  eventsToLiveAlerts,
  liveAlertKey,
  planLiveTrackerAlerts,
} from '../../src/inventory/live-tracker-alerts.ts';

function ev(
  over: Partial<LiveTrackerEvent> &
    Pick<LiveTrackerEvent, 'eventType' | 'detail'>
): LiveTrackerEvent {
  return {
    time: over.time ?? '2026-08-10T12:00:00.000Z',
    eventType: over.eventType,
    eventId: over.eventId ?? 99,
    detail: over.detail,
    period: over.period,
    marketType: over.marketType,
    to: over.to,
  };
}

describe('live-tracker-alerts', () => {
  test('eventsToLiveAlerts maps removals and lines off', () => {
    const alerts = eventsToLiveAlerts([
      ev({
        eventType: 'MARKET_REMOVED',
        detail: 'market m/3 empty',
        period: 'm',
        marketType: '3',
      }),
      ev({ eventType: 'PRICE_CHANGE', detail: 'noise' }),
      ev({
        eventType: 'LINES_FLAG',
        detail: 'hasLines=false',
        to: 'false',
      }),
      ev({
        eventType: 'LINES_FLAG',
        detail: 'hasLines=true',
        to: 'true',
      }),
    ]);
    expect(alerts.map(a => a.kind).sort()).toEqual([
      'LINES_OFF',
      'MARKET_REMOVED',
    ]);
  });

  test('planLiveTrackerAlerts dedupes by key', () => {
    const events = [
      ev({
        eventType: 'MARKET_REMOVED',
        detail: 'm/5 off',
        period: 'm',
        marketType: '5',
      }),
    ];
    const first = planLiveTrackerAlerts(events, null);
    expect(first.shouldSend).toBe(true);
    expect(first.reason).toBe('first');

    const state = { keys: first.keys, sentAtMs: 1 };
    const again = planLiveTrackerAlerts(events, state);
    expect(again.shouldSend).toBe(false);

    const newer = planLiveTrackerAlerts(
      [
        ...events,
        ev({
          eventType: 'EVENT_REMOVED',
          detail: 'gone',
          eventId: 99,
        }),
      ],
      state
    );
    expect(newer.shouldSend).toBe(true);
    expect(newer.reason).toBe('new_keys');
    expect(newer.newKeys.length).toBe(1);
    expect(liveAlertKey(newer.alerts[0]!)).toBe(newer.newKeys[0]);
  });
});
