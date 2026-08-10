// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  BOOK_IDS,
  FINGERPRINT_PENDING_SKINS,
  ULTRA_DESK_API_PATHS,
  assertFingerprintCoverage,
  bookOffersLiveProduct,
  buildBookMatrixRows,
  buildSkinMatrixRows,
  formatBooksMatrixText,
  formatSkinMatrixMarkdownTable,
  getBookByHost,
  listBookIdsForSkin,
  DESK_DOMAIN_ENV,
  PARTNER_DOMAIN_ENV,
  RETIRED_BARE_BOOK_DOMAIN_ENVS,
  assertActiveSkinsHaveHosts,
  defaultUrlForSkin,
  listActiveSkins,
  requireDefaultUrlForUltraMapper,
  resolveBookId,
  resolveDeskDomainFromEnv,
  skinIdForBook,
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

  test('BookId is desk brand under skin (not SkinId)', () => {
    expect(resolveBookId('fantasy402')).toBe(resolveBookId('fantasy402'));
    expect(String(resolveBookId('fantasy402'))).toBe('fantasy402');
    expect(resolveSkinId('fantasy402')).toBe('buckeye');
    expect(skinIdForBook('fantasy402')).toBe('buckeye');
    expect(String(getBookByHost('https://www.fantasy402.com/login'))).toBe('fantasy402');
    expect(String(getBookByHost('classic.lvaction.com'))).toBe('classic.lvaction.com');
    expect(listBookIdsForSkin('buckeye').map(String).sort()).toEqual(
      ['betwest', 'fantasy402', 'hulkwager'].sort()
    );
    expect(bookOffersLiveProduct('fantasy402', 'ezlive')).toBe(true);
    expect(bookOffersLiveProduct('parlay21', 'maglive')).toBe(true);
    expect(bookOffersLiveProduct('buckeye', 'ezlive')).toBe(false); // SkinId ≠ BookId
    const buckeye = buildSkinMatrixRows().find(r => r.skinId === 'buckeye')!;
    expect(buckeye.bookIds).toEqual(listBookIdsForSkin('buckeye'));
  });

  test('book matrix rows cover every BOOK_ID with skin linkage', () => {
    const rows = buildBookMatrixRows();
    expect(rows.map(r => r.bookId).sort()).toEqual([...BOOK_IDS].sort());
    expect(rows.some(r => r.bookId === 'fantasy402' && r.skinId === 'buckeye')).toBe(true);
    for (const row of rows) {
      expect(skinIdForBook(row.bookId)).toBe(row.skinId);
    }
    const text = formatBooksMatrixText(rows);
    expect(text).toContain('Book matrix (BOOKS SSOT)');
    expect(text).toContain('fantasy402');
    expect(text).toContain('buckeye');
    expect(text).toMatch(/books=\d+/);
    expect(text).toMatch(/skinsCovered=\d+/);
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

  test('resolveDeskDomainFromEnv uses DESK_DOMAIN (legacy PARTNER_DOMAIN) then SKINS default', () => {
    const fallback = requireDefaultUrlForUltraMapper();
    const retired = Object.fromEntries(
      RETIRED_BARE_BOOK_DOMAIN_ENVS.map(k => [k, 'https://ignored.example'])
    );
    expect(resolveDeskDomainFromEnv({})).toBe(fallback);
    expect(resolveDeskDomainFromEnv(retired)).toBe(fallback);
    expect(
      resolveDeskDomainFromEnv({
        ...retired,
        [PARTNER_DOMAIN_ENV]: 'https://legacy.example',
      })
    ).toBe('https://legacy.example');
    expect(
      resolveDeskDomainFromEnv({
        ...retired,
        [PARTNER_DOMAIN_ENV]: 'https://legacy.example',
        [DESK_DOMAIN_ENV]: 'https://preferred.example',
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
      inventoryBucket: 'football',
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

  test('skin matrix rows cover every SKIN_ID with apex hosts', () => {
    const rows = buildSkinMatrixRows();
    expect(rows.map(r => r.skinId).sort()).toEqual(SKINS.map(s => s.id).sort());
    const ace = rows.find(r => r.skinId === 'ace');
    expect(ace?.hasFingerprints).toBe(true);
    expect(ace?.apexHosts).toContain('parlay21.com');
    expect(ace?.catalogLiveProducts).toEqual(['EZLive', 'UltraLive', 'MagLive']);
    expect(ace?.gaps).toContain('mapper_unmapped');
    expect(ace?.gaps).not.toContain('missing_fingerprints');
  });

  test('fingerprint coverage gate: pending allowlist or fingerprints', () => {
    expect(() => assertFingerprintCoverage()).not.toThrow();
    expect([...FINGERPRINT_PENDING_SKINS]).toEqual([]);
    const rows = buildSkinMatrixRows();
    for (const row of rows.filter(r => r.active)) {
      expect(row.hasFingerprints).toBe(true);
      expect(row.fingerprintPending).toBe(false);
      expect(row.gaps).not.toContain('missing_fingerprints');
    }
  });

  test('README skin table matches formatSkinMatrixMarkdownTable', async () => {
    const readme = await Bun.file('src/domain/README.md').text();
    const table = formatSkinMatrixMarkdownTable();
    // Header + every skin row must appear (hosts/products may wrap differently in prose).
    expect(readme).toContain('| Skin         | Active | Live products');
    expect(readme).toContain('| Books');
    for (const row of buildSkinMatrixRows()) {
      expect(readme).toContain(`| **${row.skinId}**`);
    }
    expect(table).toContain('| **buckeye**');
    expect(table).toContain('| **sts**');
    expect(table).toContain('fantasy402');
  });

  test('ULTRA_DESK_API_PATHS are desk-relative (no host lock)', () => {
    expect(ULTRA_DESK_API_PATHS.ultraLive.startsWith('/')).toBe(true);
    expect(ULTRA_DESK_API_PATHS.ultraLive).not.toContain('://');
    expect(ULTRA_DESK_API_PATHS.sportsLeagues).toContain('Get_SportsLeagues');
  });

  test('metallic products stay empty with dated unknown note', () => {
    const metallic = SKINS.find(s => s.id === 'metallic')!;
    expect(metallic.offeredLiveProducts).toEqual([]);
    expect(metallic.mapper.note).toContain('products_unknown_as_of=2026-08-09');
    const row = buildSkinMatrixRows().find(r => r.skinId === 'metallic')!;
    expect(row.gaps).toContain('missing_live_products');
    expect(row.hasFingerprints).toBe(true);
  });

  test('ace mapper stays unmapped; action92 not in HOST_TO_SKIN', () => {
    const ace = SKINS.find(s => s.id === 'ace')!;
    expect(ace.mapper.kind).toBe('unmapped');
    expect(ace.mapper.note).toContain('Ultra adapter unproven');
    expect(ace.mapper.note).toContain('action92');
    expect(getSkinByHost('action92.com')).toBeUndefined();
    expect(getSkinByHost('www.action92.com')).toBeUndefined();
    expect(HOST_TO_SKIN['action92.com']).toBeUndefined();
  });
});
