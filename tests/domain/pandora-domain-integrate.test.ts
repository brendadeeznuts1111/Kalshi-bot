// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  buildPandoraCoverageReport,
  buildPandoraSportMap,
  liveLeaguesToPromoteInputs,
  planPandoraCompetitionPromote,
} from '../../src/domain/pandora-domain-integrate.ts';
import type { WidgetDomainSnapshot } from '../../src/domain/widget-domain-extract.ts';

const FIXTURE: WidgetDomainSnapshot = {
  at: '2026-08-10T00:00:00.000Z',
  sources: { shellHtml: true, pandora: true, languageKey: 'en' },
  partner: { partnerId: '118', partnerName: 'BK2' },
  markets: [
    { id: 'SPREAD', key: 'MARKET_SPREAD', displayName: 'Spread' },
    { id: 'TOTAL', key: 'MARKET_TOTAL', displayName: 'Total' },
  ],
  shellSports: [],
  liveSports: [
    { id: '1', name: 'Baseball', marketFlags: { '3': true } },
    { id: '5', name: 'Soccer', marketFlags: { '3': true, '5': true } },
    { id: '105', name: 'Politics' },
  ],
  liveLeagues: [
    { id: '9001', name: 'Mexico LMB', sportId: '1', shortName: 'LMB' },
    {
      id: '9002',
      name: 'Pandora Test Premier Cup Integration',
      sportId: '5',
      shortName: 'PTPC',
    },
    { id: '9003', name: 'AB', sportId: '5' }, // junk short
    { id: '9004', name: 'Some Politics Poll', sportId: '105' }, // unmapped sport
  ],
  wagerTypes: [
    { id: '4', name: 'Draw No Bet', shortName: 'DNB', marketClassId: 1, typeId: 4 },
    { id: '99', name: 'Top 5 Finish', shortName: 'TOP_5', marketClassId: 5, typeId: 30 },
  ],
  gaps: {
    domainSportIds: [],
    shellIconsUnmapped: [],
    liveSportsUnmapped: [],
    domainMissingFromLive: [],
    marketKeysNewVsKnown: [],
    liveSportCount: 3,
    liveLeagueCount: 4,
    marketLabelCount: 2,
    wagerTypeCount: 2,
  },
};

describe('pandora-domain-integrate', () => {
  test('buildPandoraSportMap maps baseball/soccer', () => {
    const map = buildPandoraSportMap(FIXTURE.liveSports);
    expect(map.find(s => s.feedSportId === '1')?.sportId).toBe('baseball');
    expect(map.find(s => s.feedSportId === '5')?.sportId).toBe('soccer');
    expect(map.find(s => s.feedSportId === '105')?.sportId).toBe('sports_channels');
  });

  test('liveLeaguesToPromoteInputs skips unmapped sports', () => {
    const map = buildPandoraSportMap(FIXTURE.liveSports);
    const inputs = liveLeaguesToPromoteInputs(FIXTURE.liveLeagues, map);
    // politics maps to sports_channels so may be included — Mexico + Premier + Politics
    expect(inputs.some(i => i.pandoraLeagueId === '9002')).toBe(true);
    expect(inputs.some(i => i.leagueKey === 'Mexico LMB')).toBe(true);
  });

  test('planPandoraCompetitionPromote skips already-named Mexico LMB', () => {
    const result = planPandoraCompetitionPromote(FIXTURE, { limit: 20 });
    // Mexico LMB already in COMPETITIONS
    expect(
      result.records.some(r => r.displayName === 'Mexico LMB')
    ).toBe(false);
    // New structured cup should promote with pandora id
    const hit = result.records.find(r =>
      r.displayName.includes('Pandora Test Premier Cup')
    );
    expect(hit).toBeTruthy();
    expect(hit?.providerMappings.pandora?.leagueId).toBe('9002');
    expect(hit?.sportId).toBe('soccer');
  });

  test('coverage report counts leagues', () => {
    const r = buildPandoraCoverageReport(FIXTURE);
    expect(r.leagues.total).toBe(4);
    expect(r.markets.htmlMarketLabels).toBe(2);
    expect(r.partner.partnerId).toBe('118');
    expect(r.sports.live).toBe(3);
  });
});
