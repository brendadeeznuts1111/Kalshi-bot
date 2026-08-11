// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  americanToDecimal,
  classifyMarketClass,
  defaultVoidPrior,
  expectedValueWithVoid,
  resolveSettlementWeighting,
  tennisMatchMlWouldHaveAction,
  weightLiveTrackerMove,
  weightingSportKey,
} from '../../src/settlement/index.ts';

describe('settlement weighting', () => {
  test('weightingSportKey maps aliases', () => {
    expect(weightingSportKey('tennis')).toBe('tennis');
    expect(weightingSportKey('table-tennis')).toBe('table_tennis');
    expect(weightingSportKey('american_football')).toBe('football');
    expect(weightingSportKey('soccer')).toBe('soccer');
    expect(weightingSportKey('unknown')).toBeNull();
  });

  test('classifyMarketClass maps Pandora ids', () => {
    expect(classifyMarketClass('3', 'm')).toBe('match_ml');
    expect(classifyMarketClass('3', 's1')).toBe('period_ml');
    expect(classifyMarketClass('18', 'm')).toBe('game_market');
    expect(classifyMarketClass('16', 's2')).toBe('set_market');
    expect(classifyMarketClass('5', 'm')).toBe('total');
    expect(classifyMarketClass('6', 'h1')).toBe('period_prop');
  });

  test('tennis live match ML prefers unit markets + high void risk', () => {
    const w = resolveSettlementWeighting({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      matchState: { matchCompleted: false },
    });
    expect(w.actionThreshold).toBe('match_completed');
    expect(w.voidRisk).toBe('high');
    expect(w.preferCompletedUnitMarkets).toBe(true);
    expect(w.tennisRetirement?.wouldHaveAction).toBe(false);
    expect(w.settlementIdenticalPliveEzlive).toBe(true);
  });

  test('tennis prematch ML action after first set', () => {
    const before = resolveSettlementWeighting({
      sportId: 'tennis',
      phase: 'prematch',
      marketType: '3',
      period: 'm',
      matchState: { firstSetCompleted: false },
    });
    expect(before.tennisRetirement?.wouldHaveAction).toBe(false);
    expect(before.voidRisk).toBe('high');

    const after = resolveSettlementWeighting({
      sportId: 'tennis',
      phase: 'prematch',
      marketType: '3',
      period: 'm',
      matchState: { firstSetCompleted: true },
    });
    expect(after.tennisRetirement?.wouldHaveAction).toBe(true);
    expect(after.voidRisk).toBe('low');
  });

  test('tennis completed set market low void on survival', () => {
    const w = resolveSettlementWeighting({
      sportId: 'tennis',
      phase: 'live',
      marketType: '16',
      period: 's1',
      matchState: { periodCompleted: true },
    });
    expect(w.marketClass).toBe('set_market');
    expect(w.voidRisk).toBe('low');
  });

  test('tennisMatchMlWouldHaveAction matrix', () => {
    expect(tennisMatchMlWouldHaveAction('prematch', { firstSetCompleted: false })).toBe(false);
    expect(tennisMatchMlWouldHaveAction('prematch', { firstSetCompleted: true })).toBe(true);
    expect(tennisMatchMlWouldHaveAction('live', { matchCompleted: false })).toBe(false);
    expect(tennisMatchMlWouldHaveAction('live', { matchCompleted: true })).toBe(true);
    expect(tennisMatchMlWouldHaveAction('live', {})).toBeNull();
  });

  test('basketball OT flags', () => {
    const game = resolveSettlementWeighting({
      sportId: 'basketball',
      phase: 'live',
      marketType: '5',
      period: 'm',
    });
    expect(game.otFlags.gameIncludesOt).toBe(true);

    const q4 = resolveSettlementWeighting({
      sportId: 'basketball',
      phase: 'live',
      marketType: '5',
      period: 'q4',
    });
    expect(q4.otFlags.periodExcludesOt).toBe(true);
  });
});

describe('void EV', () => {
  test('void branch changes EV vs two-way', () => {
    const r = expectedValueWithVoid({
      pWin: 0.55,
      pVoid: 0.15,
      stake: 100,
      decimalOdds: 1.9,
    });
    // two-way treats non-win as lose
    expect(r.twoWayEv).toBeCloseTo(0.55 * 190 - 100, 5);
    // three-way refunds void mass → better for ticket holder than two-way
    expect(r.ev).toBeGreaterThan(r.twoWayEv);
    // voidDelta = twoWayEv - threeWayEv (negative when voids help holder)
    expect(r.voidDelta).toBeLessThan(0);
    expect(r.pLose).toBeCloseTo(0.3, 5);
  });

  test('americanToDecimal', () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1 + 100 / 110, 5);
    expect(americanToDecimal(150)).toBe(2.5);
  });

  test('defaultVoidPrior ladder', () => {
    expect(defaultVoidPrior('high')).toBe(0.15);
    expect(defaultVoidPrior('medium')).toBe(0.05);
    expect(defaultVoidPrior('low')).toBe(0.01);
    expect(defaultVoidPrior('unknown')).toBe(0);
  });

  test('weightLiveTrackerMove live tennis ML sizing note', () => {
    const r = weightLiveTrackerMove({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      decimalOdds: 1.85,
      pWin: 0.6,
    });
    expect(r.weighting.preferCompletedUnitMarkets).toBe(true);
    expect(r.sizingNote).toContain('void');
    expect(r.voidEv).not.toBeNull();
    expect(r.pVoidPrior).toBe(0.15);
  });
});
