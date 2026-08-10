// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  EXAMPLE_DARIN_PLACHY_ODDS_LINE,
  EXAMPLE_DARIN_PLACHY_TICKET_LEG,
  describeOddsLine,
  describeTicketLeg,
  marketLabel,
  oddsLineFromCoefficient,
  oddsLineFromTicketLeg,
  periodLabel,
  ticketLegFromOddsLine,
  ticketLegFromWire,
} from '../../src/domain/odds-selection.ts';

describe('event planes: inventory / odds / ticket', () => {
  test('marketLabel and periodLabel', () => {
    expect(marketLabel('3')).toBe('moneyline');
    expect(marketLabel('5')).toBe('total');
    expect(marketLabel('6')).toBe('spread');
    expect(marketLabel('99')).toBe('market:99');
    expect(periodLabel('m')).toBe('match');
    expect(periodLabel('h1')).toBe('half 1');
    expect(periodLabel('s1')).toBe('set 1');
    expect(marketLabel('16')).toBe('set_correct_score');
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
