// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  decodeSetCorrectScoreLineId,
  describeCoefficientSelection,
  encodeSetCorrectScoreLineId,
  enumerateSetCorrectScoreLines,
  formatSetCorrectScoreLineId,
  pandoraMarketLabel,
  TABLE_TENNIS_FIRST_TO_SETS,
} from '../../src/partner/fantasy-ultra/market-decode.ts';
import {
  FEED_SPORT_TABLE_TENNIS,
  PANDORA_HOSTS,
  pandoraSocketUrl,
  resolvePandoraHostId,
} from '../../src/partner/fantasy-ultra/pandora-hosts.ts';
import { marketLabel, periodLabel } from '../../src/domain/odds-selection.ts';

describe('set correct score (market 16)', () => {
  test('encode/decode BO5 scorelines from research capture', () => {
    // lineId = (p1_sets << 16) | p2_sets
    expect(decodeSetCorrectScoreLineId(3)).toEqual({
      homeSets: 0,
      awaySets: 3,
      lineId: 3,
    });
    expect(decodeSetCorrectScoreLineId(65539)).toEqual({
      homeSets: 1,
      awaySets: 3,
      lineId: 65539,
    });
    expect(decodeSetCorrectScoreLineId(131075)).toEqual({
      homeSets: 2,
      awaySets: 3,
      lineId: 131075,
    });
    expect(decodeSetCorrectScoreLineId(196608)).toEqual({
      homeSets: 3,
      awaySets: 0,
      lineId: 196608,
    });
    expect(decodeSetCorrectScoreLineId(196609)).toEqual({
      homeSets: 3,
      awaySets: 1,
      lineId: 196609,
    });
    expect(decodeSetCorrectScoreLineId(196610)).toEqual({
      homeSets: 3,
      awaySets: 2,
      lineId: 196610,
    });

    expect(encodeSetCorrectScoreLineId(3, 1)).toBe(196609);
    expect(formatSetCorrectScoreLineId(196609)).toBe('3-1');
    expect(formatSetCorrectScoreLineId(3)).toBe('0-3');
  });

  test('enumerate first-to-3 (TT BO5) has 6 scorelines', () => {
    const lines = enumerateSetCorrectScoreLines(TABLE_TENNIS_FIRST_TO_SETS);
    expect(lines).toHaveLength(6);
    const labels = lines.map(l => l.label).sort();
    expect(labels).toEqual(['0-3', '1-3', '2-3', '3-0', '3-1', '3-2']);
  });

  test('describeCoefficientSelection', () => {
    expect(describeCoefficientSelection(16, '196609')).toBe('set_score 3-1');
    expect(
      describeCoefficientSelection(18, '5', { sideIndex: 0 })
    ).toBe('game 5 p1');
  });
});

describe('market labels + hosts', () => {
  test('TT/tennis market labels shared with domain marketLabel', () => {
    expect(pandoraMarketLabel(3)).toBe('moneyline');
    expect(pandoraMarketLabel(16)).toBe('set_correct_score');
    expect(pandoraMarketLabel(18)).toBe('game_winner');
    expect(marketLabel('16')).toBe('set_correct_score');
    expect(marketLabel('7')).toBe('total_points');
    expect(periodLabel('s1')).toBe('set 1');
  });

  test('spandora host resolution', () => {
    expect(FEED_SPORT_TABLE_TENNIS).toBe(93);
    expect(resolvePandoraHostId('spandora')).toBe('spandora');
    expect(resolvePandoraHostId('s')).toBe('spandora');
    expect(resolvePandoraHostId(undefined)).toBe('pandora');
    expect(pandoraSocketUrl('spandora')).toContain(PANDORA_HOSTS.spandora);
    expect(pandoraSocketUrl('spandora')).toContain('transport=websocket');
  });
});
