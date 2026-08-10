// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  EXAMPLE_DARIN_PLACHY_SELECTION,
  describeSelection,
  marketLabel,
  periodLabel,
  selectionFromCoefficientLine,
  selectionFromTicketLeg,
} from '../../src/domain/odds-selection.ts';

describe('odds-selection', () => {
  test('marketLabel and periodLabel', () => {
    expect(marketLabel('3')).toBe('moneyline');
    expect(marketLabel('5')).toBe('total');
    expect(marketLabel('6')).toBe('spread');
    expect(marketLabel('99')).toBe('market:99');
    expect(periodLabel('m')).toBe('match');
    expect(periodLabel('h1')).toBe('h1');
  });

  test('Darin vs Plachy concrete selection', () => {
    expect(describeSelection(EXAMPLE_DARIN_PLACHY_SELECTION)).toBe(
      'event=196878741 period=match market=moneyline side=2'
    );
    const fromTicket = selectionFromTicketLeg({
      eventId: 196878741,
      periodId: 'm',
      marketId: '3',
      key: '2',
    });
    expect(fromTicket).toEqual(EXAMPLE_DARIN_PLACHY_SELECTION);
  });

  test('selectionFromCoefficientLine maps Pandora line coords', () => {
    const sel = selectionFromCoefficientLine({
      eventId: 196878741,
      period: 'm',
      marketType: '3',
      selection: '2',
    });
    expect(sel).toEqual(EXAMPLE_DARIN_PLACHY_SELECTION);
  });

  test('incomplete ticket leg returns undefined', () => {
    expect(
      selectionFromTicketLeg({
        eventId: 1,
        periodId: 'm',
        marketId: '3',
        key: null,
      })
    ).toBeUndefined();
  });
});
