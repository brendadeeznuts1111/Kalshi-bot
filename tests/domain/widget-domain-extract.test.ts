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
  parseWagerTypesRoom,
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
    });
    expect(sports).toHaveLength(2);
    expect(sports[0]!.name).toBe('Baseball');
    expect(mapLiveSportNameToSportId('Table Tennis')).toBe('table_tennis');
    expect(mapLiveSportNameToSportId('Am. Football')).toBe('american_football');

    const leagues = parseLiveLeaguesRoom({
      '4': { n: 'NFL', s: 3, sn: 'NFL', o: -3 },
      '99': { n: 'Setka Cup', s: 46, platformSport: '220' },
    });
    expect(leagues.find(l => l.name === 'NFL')?.sportId).toBe('3');
    expect(leagues.find(l => l.name === 'Setka Cup')?.platformSport).toBe('220');

    const wagers = parseWagerTypesRoom({
      '4': { n: 'Draw No Bet', sn: 'DNB', mcId: 1, tp: 4 },
    });
    expect(wagers[0]!.shortName).toBe('DNB');
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
