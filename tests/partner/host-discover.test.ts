// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { SKINS } from '../../src/domain/index.ts';
import {
  adapterIdForMappedSkin,
  discoverHost,
  extractUrlsFromHar,
  listMappedDiscoverHosts,
  listSkinBrandFingerprintRules,
  scoreHostDiscovery,
} from '../../src/partner/host-discover.ts';

describe('host-discover', () => {
  test('listMappedDiscoverHosts covers every SKINS apex host', () => {
    const mapped = listMappedDiscoverHosts();
    const hosts = new Set(mapped.map(m => m.host));
    for (const skin of SKINS) {
      for (const raw of skin.hosts) {
        const apex = raw.replace(/^www\./, '').toLowerCase();
        expect(hosts.has(apex)).toBe(true);
      }
    }
    expect(mapped.some(m => m.host.startsWith('www.'))).toBe(false);
    expect(new Set(mapped.map(m => m.host)).size).toBe(mapped.length);
  });

  test('brand rules are derived from SKINS aliases/hosts', () => {
    const rules = listSkinBrandFingerprintRules();
    for (const skin of SKINS) {
      if (skin.hosts.length === 0 && skin.aliases.length === 0) continue;
      expect(rules.some(r => r.suggestSkin === skin.id)).toBe(true);
    }
  });

  test('buckeye + metallic declare fingerprints', () => {
    const buckeye = SKINS.find(s => s.id === 'buckeye');
    const metallic = SKINS.find(s => s.id === 'metallic');
    expect(buckeye?.fingerprints?.endpoints.length).toBeGreaterThan(0);
    expect(metallic?.fingerprints?.endpoints).toContain(
      '/player-api/identity/CustomerLoginRedir'
    );
  });

  test('HOST_TO_SKIN hit → definitive score 1.0 + already_mapped', () => {
    const target = listMappedDiscoverHosts().find(
      h => adapterIdForMappedSkin(h.skinId) !== 'unmapped'
    );
    expect(target).toBeDefined();
    const report = scoreHostDiscovery({
      url: `${target!.url}/login`,
      host: `www.${target!.host}`,
      finalUrl: `${target!.url}/login`,
      status: 200,
      headers: {},
      body: '<html><title>Login</title></html>',
    });
    expect(report.fromHostMap).toBe(true);
    expect(report.suggestedSkinId).toBe(target!.skinId);
    expect(report.suggestedAdapterId).toBe(adapterIdForMappedSkin(target!.skinId));
    expect(report.confidence).toBe(1);
    expect(report.decision).toBe('already_mapped');
    expect(report.weigh.model).toBe('capped-category-v1');
    expect(report.weigh.definitive).toBe(true);
  });

  test('mapped host without mapper → unmapped adapter', () => {
    const target = listMappedDiscoverHosts().find(
      h => adapterIdForMappedSkin(h.skinId) === 'unmapped'
    );
    expect(target).toBeDefined();
    const report = scoreHostDiscovery({
      url: target!.url,
      host: target!.host,
      finalUrl: target!.url,
      status: 200,
      headers: {},
      body: '<html></html>',
    });
    expect(report.suggestedSkinId).toBe(target!.skinId);
    expect(report.suggestedAdapterId).toBe('unmapped');
    expect(report.fromHostMap).toBe(true);
    expect(report.confidence).toBe(1);
  });

  test('Ultra stack HTML alone does not select a skin', () => {
    const report = scoreHostDiscovery({
      url: 'https://unknown-desk.example',
      host: 'unknown-desk.example',
      finalUrl: 'https://unknown-desk.example',
      status: 200,
      headers: { server: 'nginx' },
      body: `
        <html><title>Live</title>
        const u = "/cloud/api/Provider/getUltraLiveURL";
        fetch("https://api-gs.player-us.xyz/stream-list-v2/?tv=usa");
        </html>
      `,
    });
    expect(report.fromHostMap).toBe(false);
    expect(report.suggestedSkinId).toBe('unknown');
    expect(report.suggestedAdapterId).toBe('unmapped');
    expect(report.confidence).toBeLessThan(0.4);
    expect(report.decision).toBe('weak');
  });

  test('weighted buckeye fingerprints on unknown host', () => {
    const report = scoreHostDiscovery({
      url: 'https://mirror-hulk.example',
      host: 'mirror-hulk.example',
      finalUrl: 'https://mirror-hulk.example/',
      status: 200,
      headers: { 'cf-ray': '1' },
      body: `<html><title>Login</title>
        <link href="/sites/mirror-hulk.example/css/signin.css"/>
        <script src="/js/require.js"></script>
        <form class="form-signin" action="/login"></form>
        </html>`,
      storedUrls: [
        'https://mirror-hulk.example/js/require.js',
        'https://mirror-hulk.example/login',
        'https://mirror-hulk.example/sites/mirror-hulk.example/css/signin.css',
      ],
      dns: {
        cname: [],
        ns: ['aiden.ns.cloudflare.com', 'tricia.ns.cloudflare.com'],
        txt: [],
        mx: [],
      },
    });
    expect(report.suggestedSkinId).toBe('buckeye');
    expect(report.confidence).toBeGreaterThanOrEqual(0.7);
    expect(['review_required', 'map_immediately']).toContain(report.decision);
    expect(report.weigh.skinScores[0]?.skinId).toBe('buckeye');
  });

  test('weighted metallic fingerprints on unknown host', () => {
    const report = scoreHostDiscovery({
      url: 'https://mirror-sun.example',
      host: 'mirror-sun.example',
      finalUrl: 'https://mirror-sun.example/',
      status: 200,
      headers: {},
      body: `<html><title>Install</title>
        <a href="/main.html">main</a>
        <form action="/player-api/identity/CustomerLoginRedir?RedirToHome=1"></form>
        <link rel="manifest" href="/manifest.webmanifest"/>
        </html>`,
      storedUrls: [
        'https://mirror-sun.example/main.html',
        'https://mirror-sun.example/manifest.webmanifest',
        'https://mirror-sun.example/player-api/identity/CustomerLoginRedir?RedirToHome=1',
        'https://mirror-sun.example/flash/banner.html',
      ],
      dns: {
        cname: [],
        ns: ['dns3.cloudns.net', 'dns8.cloudns.net'],
        txt: [],
        mx: [],
      },
    });
    expect(report.suggestedSkinId).toBe('metallic');
    expect(report.confidence).toBeGreaterThanOrEqual(0.7);
    expect(report.suggestedAdapterId).toBe('unmapped');
  });

  test('skin alias brand token alone stays unknown (weak / meta-only)', () => {
    const skin = SKINS.find(s => s.aliases.length > 0 && s.hosts.length > 0);
    expect(skin).toBeDefined();
    const alias = skin!.aliases.find(a => a !== skin!.id) ?? skin!.aliases[0]!;
    const report = scoreHostDiscovery({
      url: 'https://mirror.example',
      host: 'mirror.example',
      finalUrl: 'https://mirror.example',
      status: 200,
      headers: {},
      body: `<html>welcome to ${alias} sports</html>`,
    });
    expect(report.suggestedSkinId).toBe('unknown');
    expect(report.decision).toBe('weak');
    expect(report.weigh.skinScores.some(s => s.skinId === skin!.id && s.score > 0)).toBe(true);
  });

  test('Login.aspx alone does not suggest buckeye', () => {
    const report = scoreHostDiscovery({
      url: 'https://www.action92.com/',
      host: 'www.action92.com',
      finalUrl: 'https://www.action92.com/',
      status: 200,
      headers: { server: 'cloudflare' },
      body: `<html><title>Action92</title>
        <form action="https://backend.action92.com/Login.aspx"></form>
        ace ace ace
        </html>`,
      storedUrls: ['https://backend.action92.com/Login.aspx'],
      dns: {
        cname: [],
        ns: ['ben.ns.cloudflare.com', 'erin.ns.cloudflare.com'],
        txt: [],
        mx: [],
      },
    });
    expect(report.suggestedSkinId).toBe('unknown');
    expect(report.decision).toBe('weak');
    expect(report.weigh.skinScores.every(s => s.score < 0.4)).toBe(true);
  });

  test('generic login HTML → unknown / weak', () => {
    const report = scoreHostDiscovery({
      url: 'https://unknown-book.example',
      host: 'unknown-book.example',
      finalUrl: 'https://unknown-book.example/',
      status: 200,
      headers: { server: 'cloudflare' },
      body: '<html><title>Log In</title><body>Invalid username or password.</body></html>',
    });
    expect(report.suggestedSkinId).toBe('unknown');
    expect(report.suggestedAdapterId).toBe('unmapped');
    expect(report.decision).toBe('weak');
    expect(report.nextQuestions.some(q => /SKINS|new SkinId/i.test(q))).toBe(true);
  });

  test('discoverHost fixture path skips network', async () => {
    const target = listMappedDiscoverHosts()[0];
    expect(target).toBeDefined();
    const report = await discoverHost(target!.url, {
      skipNetworkExtras: true,
      persistUrls: false,
      fixture: {
        status: 200,
        finalUrl: `https://www.${target!.host}/`,
        headers: {},
        body: `<html><title>${target!.skinId}</title></html>`,
      },
    });
    expect(report.suggestedSkinId).toBe(target!.skinId);
    expect(report.fromHostMap).toBe(true);
    expect(report.decision).toBe('already_mapped');
  });

  test('HAR merges URLs only — does not invent Ultra skin', async () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              url: 'https://unknown-book.example/cloud/api/Provider/getUltraLiveURL',
            },
            response: {
              content: {
                text: JSON.stringify({
                  URL: { DESKTOP: 'https://plive.sportswidgets.pro/x' },
                }),
              },
            },
          },
        ],
      },
    };
    expect(extractUrlsFromHar(har).urls.length).toBeGreaterThanOrEqual(1);

    const report = await discoverHost('https://unknown-book.example', {
      skipNetworkExtras: true,
      persistUrls: false,
      harJson: har,
      fixture: {
        status: 200,
        finalUrl: 'https://unknown-book.example/',
        headers: {},
        body: '<html><title>Unknown Book</title><body>Invalid username or password.</body></html>',
      },
    });
    expect(report.suggestedSkinId).toBe('unknown');
    expect(report.decision).toBe('weak');
    expect(report.storedUrls.length).toBeGreaterThanOrEqual(1);
  });
});
