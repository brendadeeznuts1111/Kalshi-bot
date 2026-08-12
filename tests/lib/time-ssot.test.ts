// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  ageMs,
  compareTime,
  dualTime,
  epochFromUnit,
  formatDurationMs,
  hoursToMs,
  isStale,
  minutesToMs,
  secondsToMs,
  sortKeyEpochMs,
  stampInstant,
  toEpochMs,
  toIsoUtc,
  TOXICITY_DUE_OFFSET_MS,
} from '../../src/lib/time-ssot.ts';

describe('time-ssot', () => {
  test('ISO round-trip', () => {
    const iso = '2026-08-10T10:00:02.000Z';
    const ms = toEpochMs(iso);
    expect(ms).toBe(Date.parse(iso));
    expect(toIsoUtc(ms)).toBe(iso);
  });

  test('seconds vs ms heuristic', () => {
    const sec = 1_723_284_002;
    const ms = sec * 1000;
    expect(toEpochMs(sec)).toBe(ms);
    expect(toEpochMs(ms)).toBe(ms);
  });

  test('epochFromUnit explicit', () => {
    expect(epochFromUnit(1_700_000_000, 's')).toBe(1_700_000_000_000);
    expect(epochFromUnit(1_700_000_000_000, 'ms')).toBe(1_700_000_000_000);
  });

  test('dualTime + stampInstant', () => {
    const d = dualTime('2026-08-10T10:00:02.000Z');
    expect(d).not.toBeNull();
    expect(d!.time).toBe('2026-08-10T10:00:02.000Z');
    expect(d!.timeMs).toBe(Date.parse(d!.time));
    const s = stampInstant(d!.timeMs, 'recv');
    expect(s?.sourceClock).toBe('recv');
    expect(s?.timeMs).toBe(d!.timeMs);
  });

  test('duration helpers', () => {
    expect(secondsToMs(30)).toBe(30_000);
    expect(minutesToMs(5)).toBe(300_000);
    expect(hoursToMs(1)).toBe(3_600_000);
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(TOXICITY_DUE_OFFSET_MS)).toBe('1.0m');
  });

  test('age / stale / compare', () => {
    const t0 = Date.parse('2026-08-10T10:00:00.000Z');
    const t1 = t0 + 5_000;
    expect(ageMs(t0, t1)).toBe(5_000);
    expect(isStale(t0, 4_000, t1)).toBe(true);
    expect(isStale(t0, 10_000, t1)).toBe(false);
    expect(compareTime(t0, t1)).toBe(-1);
    expect(sortKeyEpochMs({ time: '2026-08-10T10:00:02.000Z' })).toBe(
      Date.parse('2026-08-10T10:00:02.000Z'),
    );
  });

  test('invalid → null', () => {
    expect(toEpochMs('not-a-date')).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(dualTime('')).toBeNull();
  });
});
