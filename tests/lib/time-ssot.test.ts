// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  dualTime,
  hoursToMs,
  minutesToMs,
  secondsToMs,
  toEpochMs,
  toIsoUtc,
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

  test('dualTime', () => {
    const d = dualTime('2026-08-10T10:00:02.000Z');
    expect(d).not.toBeNull();
    expect(d!.time).toBe('2026-08-10T10:00:02.000Z');
    expect(d!.timeMs).toBe(Date.parse(d!.time));
  });

  test('duration helpers', () => {
    expect(secondsToMs(30)).toBe(30_000);
    expect(minutesToMs(5)).toBe(300_000);
    expect(hoursToMs(1)).toBe(3_600_000);
  });

  test('invalid → null', () => {
    expect(toEpochMs('not-a-date')).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(dualTime('')).toBeNull();
  });
});
