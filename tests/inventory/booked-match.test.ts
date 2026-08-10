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
});
