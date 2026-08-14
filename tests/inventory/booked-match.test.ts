// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  bookedEntryMatchesSport,
  matchBookedOddsEventId,
} from '../../src/inventory/booked-match.ts';

describe('booked-match sport scope', () => {
  test('does not match same names across sports', () => {
    const catalog = [
      {
        oddsEventId: 'tt1',
        name: 'Smith - Jones',
        sportName: 'Table tennis',
      },
      {
        oddsEventId: 'ten1',
        name: 'Smith - Jones',
        sportName: 'Tennis',
      },
    ];
    expect(
      matchBookedOddsEventId('Smith', 'Jones', catalog, { sport: 'table_tennis' })
    ).toBe('tt1');
    expect(
      matchBookedOddsEventId('Smith', 'Jones', catalog, { sport: 'tennis' })
    ).toBe('ten1');
  });

  test('bookedEntryMatchesSport maps inventory ids to Statscore names', () => {
    expect(
      bookedEntryMatchesSport(
        { oddsEventId: '1', name: 'A - B', sportName: 'Ice Hockey' },
        'ice_hockey'
      )
    ).toBe(true);
    expect(
      bookedEntryMatchesSport(
        { oddsEventId: '1', name: 'A - B', sportName: 'Soccer' },
        'table_tennis'
      )
    ).toBe(false);
  });

  test('league boost prefers matching competition tokens', () => {
    const catalog = [
      {
        oddsEventId: 'a',
        name: 'Home FC - Away FC',
        sportName: 'Soccer',
        competition: 'Other Cup',
      },
      {
        oddsEventId: 'b',
        name: 'Home FC - Away FC',
        sportName: 'Soccer',
        competition: 'Premier League',
      },
    ];
    expect(
      matchBookedOddsEventId('Home FC', 'Away FC', catalog, {
        sport: 'soccer',
        league: 'Premier League',
      })
    ).toBe('b');
  });

  test('doubles slash names match catalog pair format', () => {
    const catalog = [
      {
        oddsEventId: 'd1',
        name: 'Siniakova/Zhang - Errani/Melichar-Martinez',
        sportName: 'Tennis',
      },
    ];
    expect(
      matchBookedOddsEventId(
        'Siniakova / S. Zhang',
        'Errani / Melichar-Martinez',
        catalog,
        { sport: 'tennis', league: 'WTA Doubles' }
      )
    ).toBe('d1');
  });

  test('same-pair order swap is not ambiguous (home-first wins)', () => {
    const catalog = [
      {
        oddsEventId: 'ab',
        name: 'Martin Vizek - Daniel Tuma',
        sportName: 'Table tennis',
      },
      {
        oddsEventId: 'ba',
        name: 'Daniel Tuma - Martin Vizek',
        sportName: 'Table tennis',
      },
    ];
    expect(
      matchBookedOddsEventId('Vizek M', 'Tuma D', catalog, {
        sport: 'table_tennis',
        league: 'Masters. Czech',
      })
    ).toBe('ab');
  });

  test('many City/United club hits stay ambiguous', () => {
    const catalog = [
      {
        oddsEventId: '1',
        name: 'Stoke City U21 - Leeds United U21',
        sportName: 'Soccer',
      },
      {
        oddsEventId: '2',
        name: 'Bradford City - Peterborough United',
        sportName: 'Soccer',
      },
      {
        oddsEventId: '3',
        name: 'Sheffield United - Birmingham City',
        sportName: 'Soccer',
      },
    ];
    expect(
      matchBookedOddsEventId('Deportivo Rose City', 'Miami United', catalog, {
        sport: 'soccer',
      })
    ).toBeNull();
  });
});
