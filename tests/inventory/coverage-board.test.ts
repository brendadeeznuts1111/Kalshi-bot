// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  buildMarketMatrix,
  buildSportColumns,
  buildWagerFamilyRows,
  mergeMarketCell,
  pandoraLeaguesBySport,
} from '../../src/inventory/coverage-board.ts';
import type { WidgetDomainSnapshot } from '../../src/domain/widget-domain-extract.ts';

describe('coverage-board builders', () => {
  test('mergeMarketCell prefers primary', () => {
    expect(mergeMarketCell('yes', 'primary')).toBe('primary');
    expect(mergeMarketCell('secondary', 'yes')).toBe('secondary');
    expect(mergeMarketCell(undefined, 'yes')).toBe('yes');
    expect(mergeMarketCell('—', 'secondary')).toBe('secondary');
  });

  test('buildSportColumns attaches planes + period unit', () => {
    const cols = buildSportColumns({
      eventRows: [
        { sport: 'table_tennis', n: 100, linked: 5 },
        { sport: 'tennis', n: 40, linked: 8 },
        { sport: 'soccer', n: 20, linked: 1 },
      ],
      leagueRows: [
        { sport: 'table_tennis', n: 7, mapped: 7 },
        { sport: 'tennis', n: 50, mapped: 40 },
      ],
      pandoraLeagueBySport: { table_tennis: 7, tennis: 3171, soccer: 304 },
    });
    expect(cols[0]!.sport).toBe('table_tennis');
    expect(cols[0]!.feedSportId).toBe(93);
    expect(cols[0]!.apiSportId).toBe(93);
    expect(cols[0]!.widgetSportId).toBe(220);
    expect(cols[0]!.periodUnit).toBe('Game');
    expect(cols[0]!.periodS1).toBe('1st Game');
    expect(cols[0]!.pandoraLeagues).toBe(7);

    const tennis = cols.find(c => c.sport === 'tennis');
    expect(tennis?.feedSportId).toBe(8);
    expect(tennis?.apiSportId).toBe(8);
    expect(tennis?.periodUnit).toBe('Set');
    expect(tennis?.periodS1).toBe('1st Set');

    const soccer = cols.find(c => c.sport === 'soccer');
    expect(soccer?.feedSportId).toBe(5);
    expect(soccer?.periodUnit).toBe('Half');
  });

  test('buildMarketMatrix merges feed shells + known catalog', () => {
    const matrix = buildMarketMatrix({
      sportOrder: ['table_tennis', 'soccer', 'tennis', 'ice_hockey'],
      liveSports: [
        {
          id: '93',
          name: 'Table Tennis',
          sportIdCanonical: 'table_tennis',
          marketFlags: { '3': 'primary', '5': 'secondary' },
        },
        {
          id: '5',
          name: 'Soccer',
          sportIdCanonical: 'soccer',
          marketFlags: { '1': 'primary', '5': 'secondary', '6': true },
        },
        // shell without flags should not wipe core
        {
          id: '220',
          name: 'Top Soccer',
          sportIdCanonical: 'soccer',
          marketFlags: { '30': 'primary' },
        },
        {
          id: '4',
          name: 'Hockey',
          sportIdCanonical: 'ice_hockey',
          marketFlags: { '3': 'primary', '5': true },
        },
      ],
      wagerTypes: [
        { id: '1', name: '1X2', typeId: 1 },
        { id: '2', name: 'ML', typeId: 3 },
        { id: '3', name: 'Total', typeId: 5 },
        { id: '4', name: 'Also total', typeId: 5 },
      ],
    });

    expect(matrix.marketIds).toContain('3');
    expect(matrix.marketIds).toContain('16'); // known catalog even if no flags
    expect(matrix.cells['3']!['table_tennis']).toBe('primary');
    expect(matrix.cells['5']!['table_tennis']).toBe('secondary');
    expect(matrix.cells['1']!['soccer']).toBe('primary');
    expect(matrix.cells['30']!['soccer']).toBe('primary'); // merged from Top Soccer shell
    expect(matrix.cells['3']!['ice_hockey']).toBe('primary');
    expect(matrix.wagerTypeCounts['5']).toBe(2);
    expect(matrix.labels['3']).toBe('moneyline');
  });

  test('buildWagerFamilyRows ranks by count', () => {
    const rows = buildWagerFamilyRows(
      [
        { id: '1', name: 'A', typeId: 30 },
        { id: '2', name: 'B', typeId: 30 },
        { id: '3', name: 'C', typeId: 5 },
      ],
      10
    );
    expect(rows[0]!.typeId).toBe(30);
    expect(rows[0]!.count).toBe(2);
    expect(rows[0]!.knownLabel).toBe('outright_futures');
  });

  test('pandoraLeaguesBySport uses sportIdCanonical', () => {
    const snap = {
      liveLeagues: [
        { id: '1', name: 'Setka', sportId: '93', sportIdCanonical: 'table_tennis' },
        { id: '2', name: 'ATP', sportId: '8', sportIdCanonical: 'tennis' },
        { id: '3', name: 'Other', sportId: '8', sportIdCanonical: 'tennis' },
      ],
    } as WidgetDomainSnapshot;
    const m = pandoraLeaguesBySport(snap);
    expect(m.table_tennis).toBe(1);
    expect(m.tennis).toBe(2);
  });
});
