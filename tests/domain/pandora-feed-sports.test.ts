// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  FEED_SPORT,
  feedSportIdsForSport,
  feedSportName,
  getPandoraFeedSport,
  listMappedFeedSports,
  listPandoraFeedSports,
  sportIdFromFeedSportId,
} from '../../src/domain/pandora-feed-sports.ts';
import {
  listLiveProductSportBindings,
  resolveSport,
} from '../../src/domain/index.ts';

describe('pandora feed sport SSOT', () => {
  test('core board ids map to canonical SportId', () => {
    expect(sportIdFromFeedSportId(1)).toBe('baseball');
    expect(sportIdFromFeedSportId(2)).toBe('basketball');
    expect(sportIdFromFeedSportId(3)).toBe('american_football');
    expect(sportIdFromFeedSportId(5)).toBe('soccer');
    expect(sportIdFromFeedSportId(8)).toBe('tennis');
    expect(sportIdFromFeedSportId(93)).toBe('table_tennis');
    expect(sportIdFromFeedSportId(FEED_SPORT.tennis)).toBe('tennis');
    expect(sportIdFromFeedSportId(FEED_SPORT.table_tennis)).toBe(
      'table_tennis'
    );
    expect(sportIdFromFeedSportId(FEED_SPORT.american_football)).toBe(
      'american_football'
    );
  });

  test('legacy wrong widget ids are NOT feed ids', () => {
    // Historical bug: domain stored api=1 soccer, api=2 tennis
    // Feed: 1=baseball, 2=basketball
    expect(feedSportName(1)).toBe('Baseball');
    expect(feedSportName(2)).toBe('Basketball');
    expect(getPandoraFeedSport(8)?.name).toBe('Tennis');
  });

  test('resolveSport prefers feedSportId plane', () => {
    const tennis = resolveSport({ liveProduct: 'plive', feedSportId: 8 });
    expect(tennis?.sportId).toBe('tennis');
    expect(tennis?.via).toBe('feedSportId');
    expect(tennis?.binding.feedSportId).toBe(8);
    expect(tennis?.binding.widgetSportId).toBe(2);

    const bb = resolveSport({ liveProduct: 'plive', feedSportId: 2 });
    expect(bb?.sportId).toBe('basketball');
    expect(bb?.binding.feedSportId).toBe(2);

    const soccer = resolveSport({ liveProduct: 'plive', feedSportId: 5 });
    expect(soccer?.sportId).toBe('soccer');
  });

  test('resolveSport feedSportId does not confuse widget 2 with tennis feed', () => {
    // widget 2 = tennis shell; feed 2 = basketball
    const byWidget = resolveSport({ liveProduct: 'plive', widgetSportId: 2 });
    expect(byWidget?.sportId).toBe('tennis');
    const byFeed = resolveSport({ liveProduct: 'plive', feedSportId: 2 });
    expect(byFeed?.sportId).toBe('basketball');
  });

  test('apiSportId 93 still resolves table tennis (ticket plane)', () => {
    const tt = resolveSport({ liveProduct: 'plive', apiSportId: 93 });
    expect(tt?.sportId).toBe('table_tennis');
    expect(tt?.via).toBe('apiSportId');
  });

  test('legacy apiSportId=8 falls through to feed catalog as tennis', () => {
    // Callers that passed feed id as apiSportId still work
    const hit = resolveSport({ liveProduct: 'plive', apiSportId: 8 });
    expect(hit?.sportId).toBe('tennis');
  });

  test('bindings carry feedSportId for primary sports', () => {
    const rows = listLiveProductSportBindings('plive');
    expect(rows.find(r => r.sportId === 'tennis')?.feedSportId).toBe(8);
    expect(rows.find(r => r.sportId === 'soccer')?.feedSportId).toBe(5);
    expect(rows.find(r => r.sportId === 'basketball')?.feedSportId).toBe(2);
    expect(rows.find(r => r.sportId === 'table_tennis')?.feedSportId).toBe(93);
    // Wrong legacy values gone
    expect(rows.find(r => r.sportId === 'soccer')?.apiSportId).toBeNull();
    expect(rows.find(r => r.sportId === 'tennis')?.apiSportId).toBeNull();
  });

  test('feedSportIdsForSport includes core + variants', () => {
    const bb = feedSportIdsForSport('basketball');
    expect(bb).toContain(2);
    expect(bb).toContain(102); // college
    expect(listMappedFeedSports().length).toBeGreaterThan(20);
  });

  test('catalog covers full live.sports capture set (85)', () => {
    // Live capture 2026-08-10 had 85 ids; catalog should list all of them
    expect(listPandoraFeedSports().length).toBeGreaterThanOrEqual(85);
    // esports variants + event shells
    expect(sportIdFromFeedSportId(132)).toBe('sports_channels');
    expect(sportIdFromFeedSportId(214)).toBe('soccer'); // WC2026 shell
    expect(sportIdFromFeedSportId(102)).toBe('basketball'); // college
    expect(feedSportName(3)).toBe('Football'); // American football on feed
  });
});
