// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  ageMs,
  bookTickClocks,
  compareTime,
  dualTime,
  epochFromUnit,
  formatDurationMs,
  hoursToMs,
  isStale,
  minutesToMs,
  normalizeStartTs,
  secondsToMs,
  sortKeyEpochMs,
  stampInstant,
  startTsInWatchWindow,
  toEpochMs,
  toIsoUtc,
  TOXICITY_DUE_OFFSET_MS,
  watchWindowMs,
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

  test('bookTickClocks prefer exchange when present', () => {
    const recv = 1_700_000_000_000;
    const ex = recv + 50;
    expect(bookTickClocks({ recvTsMs: recv })).toEqual({
      ts: recv,
      recvTs: recv,
      sourceClock: 'recv',
    });
    expect(bookTickClocks({ exchangeTsMs: ex, recvTsMs: recv })).toEqual({
      ts: ex,
      recvTs: recv,
      sourceClock: 'exchange',
    });
  });

  test('watch window + startTs', () => {
    const now = Date.parse('2026-08-10T12:00:00.000Z');
    const w = watchWindowMs({ nowMs: now, leadMinutes: 5, pastGraceHours: 6 });
    expect(w.windowEndMs - now).toBe(5 * 60_000);
    expect(now - w.windowStartMs).toBe(6 * 3_600_000);
    const inside = '2026-08-10T12:03:00.000Z';
    expect(
      startTsInWatchWindow(inside, {
        nowMs: now,
        leadMinutes: 5,
        pastGraceHours: 6,
      }),
    ).toBe(true);
    expect(normalizeStartTs(inside)?.timeMs).toBe(Date.parse(inside));
  });
});
