// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  buildDomainGaps,
  extractLanguageTexts,
  extractMarketLabelsFromTexts,
  extractShellSportsFromScript,
  extractWidgetDomain,
  findLanguagesScript,
  mapLiveSportNameToSportId,
  parseLiveLeaguesRoom,
  parseLiveSportsRoom,
  parseSportPeriodRoom,
  parseWagerTypesRoom,
  resolveLiveSportId,
  sportPeriodLabel,
  wagerTypeFamilyCounts,
} from '../../src/domain/widget-domain-extract.ts';

const FIXTURE_HTML = `<!doctype html><html><body>
<script>
angular.module('gsLive')
  .constant('PARTNER_ID', '118')
  .constant('PARTNER_NAME', 'BK2')
  .constant('LANGUAGES', [
    {
      key: 'en',
      name: 'English',
      texts: {"MARKET_SPREAD":"Spread","MARKET_TOTAL":"Total","MARKET_DRAW_NO_BET":"Draw No Bet","SEARCH":"Search"},
      rules: {"tabs":[{"subtabs":[
        {"icon":"soccer","title":"soccer"},
        {"icon":"table-tennis","title":"table tennis"},
        {"icon":"chess","title":"chess"}
      ]}]}
    }
  ]);
</script>
</body></html>`;

describe('widget-domain-extract HTML', () => {
  test('finds LANGUAGES script and extracts MARKET_* + icons', () => {
    const script = findLanguagesScript(FIXTURE_HTML);
    expect(script).toBeTruthy();
    const texts = extractLanguageTexts(script!, 'en');
    expect(texts?.MARKET_SPREAD).toBe('Spread');
    const markets = extractMarketLabelsFromTexts(texts!);
    expect(markets.map(m => m.id).sort()).toEqual([
      'DRAW_NO_BET',
      'SPREAD',
      'TOTAL',
    ]);
    const sports = extractShellSportsFromScript(script!);
    expect(sports.find(s => s.icon === 'soccer')?.sportId).toBe('soccer');
    expect(sports.find(s => s.icon === 'table-tennis')?.sportId).toBe(
      'table_tennis'
    );
    // chess is a soft map into sports_channels (other bucket)
    expect(sports.find(s => s.icon === 'chess')?.sportId).toBe('sports_channels');
  });
});

describe('widget-domain-extract Pandora rooms', () => {
  test('parses sports / leagues / wagerTypes shapes', () => {
    const sports = parseLiveSportsRoom({
      '1': { n: 'Baseball', o: -1, m: { '3': 'primary', '5': true } },
      '2': { n: 'Basketball', o: 0 },
      '3': { n: 'Football', o: 1 },
    });
    expect(sports).toHaveLength(3);
    expect(sports[0]!.name).toBe('Baseball');
    expect(sports.find(s => s.id === '3')?.sportIdCanonical).toBe(
      'american_football'
    );
    expect(mapLiveSportNameToSportId('Table Tennis')).toBe('table_tennis');
    expect(mapLiveSportNameToSportId('Am. Football')).toBe('american_football');
    // Feed name "Football" is American football, not soccer
    expect(mapLiveSportNameToSportId('Football')).toBe('american_football');
    expect(mapLiveSportNameToSportId('Soccer')).toBe('soccer');
    expect(resolveLiveSportId({ feedSportId: 3, name: 'Football' })).toBe(
      'american_football'
    );

    const leagues = parseLiveLeaguesRoom({
      '4': { n: 'NFL', s: 3, sn: 'NFL', o: -3 },
      '7': { n: 'College Basketball', s: 102, platformSport: '2' },
      '99': { n: 'Setka Cup', s: 46, platformSport: '220' },
    });
    expect(leagues.find(l => l.name === 'NFL')?.sportId).toBe('3');
    expect(leagues.find(l => l.name === 'NFL')?.sportIdCanonical).toBe(
      'american_football'
    );
    expect(leagues.find(l => l.name === 'College Basketball')?.sportIdCanonical).toBe(
      'basketball'
    );
    expect(leagues.find(l => l.name === 'Setka Cup')?.platformSport).toBe('220');

    const wagers = parseWagerTypesRoom({
      '4': { n: 'Draw No Bet', sn: 'DNB', mcId: 1, tp: 4 },
      '5': { n: 'Total', sn: 'TOTAL', mcId: 2, tp: 5 },
      '6': { n: 'Also Total', sn: 'T2', mcId: 2, tp: 5 },
    });
    expect(wagers.find(w => w.id === '4')?.shortName).toBe('DNB');
    const fam = wagerTypeFamilyCounts(wagers);
    expect(fam.find(f => f.typeId === 5)?.count).toBe(2);
  });

  test('parses sportPeriod room labels by feed sport', () => {
    const periods = parseSportPeriodRoom({
      en: {
        periods: {
          '5': { m: 'Match', h1: '1st Half', h2: '2nd Half' },
          '93': { m: 'Match', s1: 'Set 1', s2: 'Set 2', s3: 'Set 3' },
        },
        abbreviations: { Half: 'H' },
      },
    });
    expect(periods?.primary?.language).toBe('en');
    expect(sportPeriodLabel(periods, 5, 'h1')).toBe('1st Half');
    expect(sportPeriodLabel(periods, 93, 's2')).toBe('Set 2');
    expect(sportPeriodLabel(periods, 8, 'm')).toBeNull();
  });

  test('extractWidgetDomain merges html + injected rooms', async () => {
    const snap = await extractWidgetDomain({
      html: FIXTURE_HTML,
      fetchShell: false,
      pandoraRooms: {
        sports: { '1': { n: 'Baseball', m: { '3': true } } },
        leagues: { '10': { n: 'MLB', s: 1 } },
        wagerTypes: { '4': { n: 'Draw No Bet', sn: 'DNB' } },
      },
    });
    expect(snap.markets.length).toBe(3);
    expect(snap.liveSports[0]!.name).toBe('Baseball');
    expect(snap.liveLeagues[0]!.name).toBe('MLB');
    expect(snap.partner.partnerId).toBe('118');
    expect(snap.gaps.liveLeagueCount).toBe(1);
    expect(snap.gaps.marketLabelCount).toBe(3);
  });

  test('buildDomainGaps flags unmapped icons', () => {
    const gaps = buildDomainGaps({
      shellSports: [
        { icon: 'soccer', title: null, sportId: 'soccer' },
        { icon: 'chess', title: null, sportId: null },
      ],
      liveSports: [{ id: '1', name: 'Baseball' }],
      markets: [{ id: 'SPREAD', key: 'MARKET_SPREAD', displayName: 'Spread' }],
      wagerTypes: [],
      liveLeagues: [],
    });
    expect(gaps.shellIconsUnmapped).toContain('chess');
    expect(gaps.marketKeysNewVsKnown).toContain('MARKET_SPREAD');
  });
});
