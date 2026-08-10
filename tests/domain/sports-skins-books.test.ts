// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  PARTNER_DOMAIN_ENV,
  assertActiveSkinsHaveHosts,
  defaultUrlForSkin,
  listActiveSkins,
  requireDefaultUrlForUltraMapper,
  resolveDeskDomainFromEnv,
} from '../../src/domain/index.ts';
import {
  HOST_TO_SKIN,
  SKINS,
  fantasySportByApiId,
  getSkinByHost,
  listLiveProductSportBindings,
  liveProductsWithBindings,
  normalizeLiveProductName,
  normalizeSkinName,
  resolveSkinId,
  resolveSport,
  skinOfferedCatalogNames,
  skinOffersLiveProduct,
} from '../../src/partner/index.ts';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import { seedFantasySportMappings } from '../../src/partner/registry.ts';

describe('domain sports / skins / live products', () => {
  test('skin ids are white-labels (buckeye, ace, …)', () => {
    expect(SKINS.map(s => s.id).sort()).toEqual([
      '1bv',
      'ace',
      'buckeye',
      'lvaction',
      'magnum',
      'metallic',
      'sts',
    ]);
  });

  test('active skins always have hosts[]', () => {
    expect(() => assertActiveSkinsHaveHosts()).not.toThrow();
    for (const skin of listActiveSkins()) {
      expect(skin.hosts.length).toBeGreaterThan(0);
    }
    expect(
      listActiveSkins()
        .map(s => s.id)
        .sort()
    ).toEqual(['1bv', 'ace', 'buckeye', 'lvaction', 'magnum', 'metallic', 'sts']);
  });

  test('fantasy402 resolves to skin buckeye; skin→live products', () => {
    expect(resolveSkinId('fantasy402')).toBe('buckeye');
    expect(resolveSkinId('FANTASY402')).toBe('buckeye');
    expect(skinOffersLiveProduct('buckeye', 'plive')).toBe(true);
    expect(skinOffersLiveProduct('buckeye', 'ezlive')).toBe(true);
    expect(skinOffersLiveProduct('buckeye', 'EZLive')).toBe(true);
    expect(skinOffersLiveProduct('buckeye', 'maglive')).toBe(false);
    expect(skinOffersLiveProduct('ace', 'maglive')).toBe(true);
    expect(skinOffersLiveProduct('ace', 'ultralive')).toBe(true);
    expect(skinOffersLiveProduct('ace', 'plive')).toBe(false);
    expect(skinOffersLiveProduct('metallic', 'ezlive')).toBe(false);
    expect(skinOfferedCatalogNames('buckeye')).toEqual(['PLive', 'EZLive']);
    expect(skinOfferedCatalogNames('ace')).toEqual(['EZLive', 'UltraLive', 'MagLive']);
  });

  test('HOST_TO_SKIN + getSkinByHost mirrors SKINS[].hosts', () => {
    for (const skin of SKINS) {
      for (const host of skin.hosts) {
        expect(HOST_TO_SKIN[host.toLowerCase()]).toBe(skin.id);
        expect(getSkinByHost(host)).toBe(skin.id);
        expect(getSkinByHost(`https://${host}/login`)).toBe(skin.id);
      }
    }
    expect(getSkinByHost('unknown.example')).toBeUndefined();
    const buckeye = SKINS.find(s => s.id === 'buckeye');
    expect(buckeye?.mapper.kind).toBe('fantasy402');
  });

  test('requireDefaultUrlForUltraMapper equals defaultUrlForSkin of Ultra-mapped skin', () => {
    const ultra = SKINS.find(s => s.mapper.kind === 'fantasy402' && s.hosts.length > 0);
    expect(ultra).toBeDefined();
    const expected = defaultUrlForSkin(ultra!.id);
    if (!expected) throw new Error('expected Ultra-mapped skin URL');
    expect(requireDefaultUrlForUltraMapper()).toBe(expected);
  });

  test('resolveDeskDomainFromEnv uses PARTNER_DOMAIN then SKINS default', () => {
    const fallback = requireDefaultUrlForUltraMapper();
    expect(resolveDeskDomainFromEnv({})).toBe(fallback);
    expect(resolveDeskDomainFromEnv({ FANTASY402_DOMAIN: 'https://ignored.example' })).toBe(
      fallback
    );
    expect(
      resolveDeskDomainFromEnv({
        [PARTNER_DOMAIN_ENV]: 'https://preferred.example',
        FANTASY402_DOMAIN: 'https://ignored.example',
      })
    ).toBe('https://preferred.example');
  });

  test('normalizeLiveProductName maps ultra→ultralive; keeps numeric wire', () => {
    expect(normalizeLiveProductName('ultra')).toBe('ultralive');
    expect(normalizeLiveProductName('UltraLive')).toBe('ultralive');
    expect(normalizeLiveProductName('mag')).toBe('maglive');
    expect(normalizeLiveProductName('2')).toBe('2');
    expect(normalizeSkinName(2)).toBe('2');
    expect(normalizeLiveProductName('dark')).toBe('dark');
  });

  test('resolveSport by api / widget / stream bucket on live product plive', () => {
    const byApi = resolveSport({ liveProduct: 'plive', apiSportId: 93 });
    expect(byApi?.sportId).toBe('table_tennis');
    expect(byApi?.binding.widgetSportId).toBe(220);

    const byWidget = resolveSport({ liveProduct: 'plive', widgetSportId: 220 });
    expect(byWidget?.sportId).toBe('table_tennis');

    const byBucket = resolveSport({
      liveProduct: 'ezlive',
      streamBucket: 'football',
    });
    expect(byBucket?.sportId).toBe('soccer');
  });

  test('maglive/ultralive have no coverage bindings; plive does', () => {
    expect(listLiveProductSportBindings('maglive')).toEqual([]);
    expect(listLiveProductSportBindings('ultralive')).toEqual([]);
    expect(listLiveProductSportBindings('plive').length).toBeGreaterThanOrEqual(30);
    expect(liveProductsWithBindings().sort()).toEqual(['ezlive', 'plive']);
    expect(resolveSport({ liveProduct: 'maglive', apiSportId: 93 })).toBeUndefined();
  });

  test('shim fantasySportByApiId(93) still returns table tennis', () => {
    const m = fantasySportByApiId(93);
    expect(m?.canonical).toBe('table_tennis');
    expect(m?.widgetSportId).toBe(220);
    expect(m?.primary).toBe(true);
  });

  test('seed dual-writes plive, ezlive, and legacy fantasy402', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const n = seedFantasySportMappings(db);
    expect(n).toBeGreaterThanOrEqual(90);
    const providers = db
      .query(`SELECT DISTINCT provider AS p FROM provider_sport_mappings ORDER BY provider`)
      .all() as Array<{ p: string }>;
    // Live-product keys are primary; fantasy402 is legacy dual-write only.
    expect(providers.map(r => r.p)).toEqual(['ezlive', 'fantasy402', 'plive']);
  });

  test('seed can omit legacy fantasy402 dual-write', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    seedFantasySportMappings(db, { includeLegacyFantasy402: false });
    const providers = db
      .query(`SELECT DISTINCT provider AS p FROM provider_sport_mappings ORDER BY provider`)
      .all() as Array<{ p: string }>;
    expect(providers.map(r => r.p)).toEqual(['ezlive', 'plive']);
  });
});
