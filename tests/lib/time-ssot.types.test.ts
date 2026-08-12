/**
 * Type-level contracts for dual-stamp time SSOT.
 * Runtime no-ops — verified by `bun run typecheck` / `tsc --noEmit`.
 *
 * @see https://bun.com/docs/test/writing-tests#type-testing
 * @see https://bun.com/reference/bun/test/expectTypeOf
 * @see docs/TIME.md
 */
// @see https://bun.com/docs/test/writing-tests#type-testing
import { expectTypeOf } from 'bun:test';
import type { LiveTrackerEvent } from '../../src/inventory/live-tracker.ts';
import { withDualTime } from '../../src/inventory/live-tracker.ts';
import type { AnalyzeWeightedFieldKey, AnalyzeWeightedRow } from '../../src/settlement/analyze-table.ts';
import type {
  ClockedInstant,
  DualInstant,
  EpochMs,
  IsoUtc,
  TimeSourceClock,
} from '../../src/lib/time-ssot.ts';
import {
  ageMs,
  bookTickClocks,
  compareTime,
  dualTime,
  epochFromUnit,
  hoursToMs,
  isStale,
  minutesToMs,
  normalizeStartTs,
  nowEpochMs,
  nowIsoUtc,
  requireEpochMs,
  requireIsoUtc,
  secondsToMs,
  sortKeyEpochMs,
  stampInstant,
  stampNow,
  startTsInWatchWindow,
  toEpochMs,
  toIsoUtc,
  watchWindowMs,
} from '../../src/lib/time-ssot.ts';

// ── Brand aliases (nominal only by convention; runtime is number/string) ──

expectTypeOf<EpochMs>().toEqualTypeOf<number>();
expectTypeOf<IsoUtc>().toEqualTypeOf<string>();
expectTypeOf<TimeSourceClock>().toEqualTypeOf<'recv' | 'exchange' | 'wall' | 'derived'>();

// ── Dual / clocked shapes ──

expectTypeOf<DualInstant>().toEqualTypeOf<{ time: IsoUtc; timeMs: EpochMs }>();
expectTypeOf<DualInstant>().toMatchObjectType<{ time: string; timeMs: number }>();

expectTypeOf<ClockedInstant>().toMatchObjectType<{
  time: string;
  timeMs: number;
  sourceClock: TimeSourceClock;
}>();
expectTypeOf<ClockedInstant>().toExtend<DualInstant>();

// ── Parse / dual-write ──

expectTypeOf(toEpochMs).toBeFunction();
expectTypeOf(toEpochMs).parameters.toEqualTypeOf<[unknown]>();
expectTypeOf(toEpochMs).returns.toEqualTypeOf<EpochMs | null>();

expectTypeOf(toIsoUtc).returns.toEqualTypeOf<IsoUtc | null>();
expectTypeOf(dualTime).returns.toEqualTypeOf<DualInstant | null>();
expectTypeOf(normalizeStartTs).returns.toEqualTypeOf<DualInstant | null>();

expectTypeOf(requireEpochMs).returns.toEqualTypeOf<EpochMs>();
expectTypeOf(requireIsoUtc).returns.toEqualTypeOf<IsoUtc>();

expectTypeOf(stampInstant).toBeFunction();
expectTypeOf(stampInstant).returns.toEqualTypeOf<ClockedInstant | null>();
expectTypeOf(stampNow).returns.toEqualTypeOf<ClockedInstant>();
expectTypeOf(nowEpochMs).returns.toEqualTypeOf<EpochMs>();
expectTypeOf(nowIsoUtc).returns.toEqualTypeOf<IsoUtc>();

// ── Duration / age ──

expectTypeOf(secondsToMs).returns.toEqualTypeOf<EpochMs>();
expectTypeOf(minutesToMs).returns.toEqualTypeOf<EpochMs>();
expectTypeOf(hoursToMs).returns.toEqualTypeOf<EpochMs>();
expectTypeOf(ageMs).returns.toEqualTypeOf<EpochMs | null>();
expectTypeOf(isStale).returns.toEqualTypeOf<boolean>();
expectTypeOf(compareTime).returns.toEqualTypeOf<number>();
expectTypeOf(sortKeyEpochMs).returns.toEqualTypeOf<EpochMs>();

expectTypeOf(epochFromUnit).parameters.toEqualTypeOf<[number, 'ms' | 's']>();
expectTypeOf(epochFromUnit).returns.toEqualTypeOf<EpochMs | null>();

// ── Book dual-clock ──

expectTypeOf(bookTickClocks).toBeFunction();
expectTypeOf(bookTickClocks).returns.toEqualTypeOf<{
  ts: EpochMs;
  recvTs: EpochMs;
  sourceClock: 'exchange' | 'recv';
}>();
// REST path: exchange optional — still returns full dual-clock shape
expectTypeOf(bookTickClocks({ recvTsMs: 0 })).toMatchObjectType<{
  ts: number;
  recvTs: number;
  sourceClock: 'exchange' | 'recv';
}>();

// ── Watch window ──

expectTypeOf(watchWindowMs).returns.toEqualTypeOf<{
  nowMs: EpochMs;
  windowStartMs: EpochMs;
  windowEndMs: EpochMs;
}>();
expectTypeOf(startTsInWatchWindow).returns.toEqualTypeOf<boolean>();

// ── Live-tracker dual fields ──

expectTypeOf<LiveTrackerEvent['time']>().toEqualTypeOf<IsoUtc | string>();
expectTypeOf<LiveTrackerEvent['timeMs']>().toEqualTypeOf<EpochMs | null | undefined>();
expectTypeOf<LiveTrackerEvent['eventId']>().toEqualTypeOf<number | string>();
expectTypeOf<LiveTrackerEvent['detail']>().toBeString();
// timeMs is optional on the wire type (backfilled on load)
expectTypeOf<LiveTrackerEvent>().toHaveProperty('timeMs');

expectTypeOf(withDualTime).toBeFunction();
expectTypeOf(
  withDualTime({ time: '2026-08-10T00:00:00.000Z' }),
).toMatchObjectType<{ time: string; timeMs: number | null }>();

// ── Analyze flat row includes dual time keys ──

expectTypeOf<'time'>().toExtend<AnalyzeWeightedFieldKey>();
expectTypeOf<'timeMs'>().toExtend<AnalyzeWeightedFieldKey>();
expectTypeOf<AnalyzeWeightedRow['time']>().toEqualTypeOf<string | number | boolean | null>();
expectTypeOf<AnalyzeWeightedRow['timeMs']>().toEqualTypeOf<string | number | boolean | null>();
