// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  EXAMPLE_DARIN_PLACHY_ODDS_LINE,
  EXAMPLE_DARIN_PLACHY_TICKET_LEG,
  PANDORA_PERIOD_CODES,
  canonicalizePeriodId,
  describeOddsLine,
  describeTicketLeg,
  isPandoraPeriodCode,
  marketLabel,
  oddsLineFromCoefficient,
  oddsLineFromTicketLeg,
  periodLabel,
  periodLabelForFeedSport,
  ticketLegFromOddsLine,
  ticketLegFromWire,
} from '../../src/domain/odds-selection.ts';

describe('event planes: inventory / odds / ticket', () => {
  test('marketLabel and periodLabel', () => {
    expect(marketLabel('3')).toBe('moneyline');
    expect(marketLabel('4')).toBe('draw_no_bet');
    expect(marketLabel('5')).toBe('total');
    expect(marketLabel('6')).toBe('spread');
    expect(marketLabel('30')).toBe('outright_futures');
    expect(marketLabel('99')).toBe('market:99');
    expect(periodLabel('m')).toBe('match');
    expect(periodLabel('h1')).toBe('half 1');
    expect(periodLabel('s1')).toBe('set 1');
    expect(periodLabel('q3')).toBe('quarter 3');
    expect(periodLabel('i7')).toBe('inning 7');
    expect(periodLabel('sgp')).toBe('same game parlay');
    expect(periodLabel('p')).toBe('player props');
    expect(periodLabel('L_h1')).toBe('half 1');
    expect(marketLabel('16')).toBe('set_correct_score');
  });

  test('period codes + pseudo canonicalize', () => {
    expect(PANDORA_PERIOD_CODES[0]).toBe('m');
    expect(isPandoraPeriodCode('h2')).toBe(true);
    expect(isPandoraPeriodCode('sgp')).toBe(false);
    expect(canonicalizePeriodId('sgp')).toBe('m');
    expect(canonicalizePeriodId('bb')).toBe('m');
    expect(canonicalizePeriodId('h1')).toBe('h1');
    expect(canonicalizePeriodId('s3')).toBe('s3');
  });

  test('periodLabelForFeedSport uses sport-specific unit (not always set)', () => {
    // Generic periodLabel always says "set N" for sN
    expect(periodLabel('s1')).toBe('set 1');
    // Baseball feed 1: innings
    expect(periodLabelForFeedSport(1, 's1')).toBe('1st Inning');
    expect(periodLabelForFeedSport(1, 'm')).toBe('Game');
    // Basketball feed 2: quarters
    expect(periodLabelForFeedSport(2, 's1')).toBe('1st Quarter');
    // Tennis feed 8: sets
    expect(periodLabelForFeedSport(8, 's1')).toBe('1st Set');
    // Table tennis feed 93: games
    expect(periodLabelForFeedSport(93, 's1')).toBe('1st Game');
    // Soccer feed 5: halves
    expect(periodLabelForFeedSport(5, 'h1')).toBe('1st Half');
    // Unknown feed falls back to generic
    expect(periodLabelForFeedSport(99999, 's1')).toBe('set 1');
  });

  test('odds line is separate from ticket leg (Darin/Plachy)', () => {
    expect(describeOddsLine(EXAMPLE_DARIN_PLACHY_ODDS_LINE)).toBe(
      'odds event=196878741 period=match market=moneyline selection=2'
    );
    expect(describeTicketLeg(EXAMPLE_DARIN_PLACHY_TICKET_LEG)).toBe(
      'ticket event=196878741 period=match market=moneyline key=2'
    );
    expect(EXAMPLE_DARIN_PLACHY_ODDS_LINE).not.toEqual(EXAMPLE_DARIN_PLACHY_TICKET_LEG);
  });

  test('oddsLineFromCoefficient and ticketLegFromWire', () => {
    expect(
      oddsLineFromCoefficient({
        eventId: 196878741,
        period: 'm',
        marketType: '3',
        selection: '2',
      })
    ).toEqual(EXAMPLE_DARIN_PLACHY_ODDS_LINE);

    expect(
      ticketLegFromWire({
        eventId: 196878741,
        periodId: 'm',
        marketId: '3',
        key: '2',
      })
    ).toEqual(EXAMPLE_DARIN_PLACHY_TICKET_LEG);
  });

  test('explicit bridges convert without merging types', () => {
    const leg = ticketLegFromOddsLine(EXAMPLE_DARIN_PLACHY_ODDS_LINE);
    expect(leg).toEqual(EXAMPLE_DARIN_PLACHY_TICKET_LEG);
    expect(oddsLineFromTicketLeg(leg)).toEqual(EXAMPLE_DARIN_PLACHY_ODDS_LINE);
  });

  test('incomplete wire returns undefined', () => {
    expect(
      ticketLegFromWire({
        eventId: 1,
        periodId: 'm',
        marketId: '3',
        key: null,
      })
    ).toBeUndefined();
    expect(
      oddsLineFromCoefficient({
        eventId: 1,
        period: 'm',
        marketType: '',
        selection: '2',
      })
    ).toBeUndefined();
  });
});
