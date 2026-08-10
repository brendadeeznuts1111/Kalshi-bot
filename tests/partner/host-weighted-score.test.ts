// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  CATEGORY_CAPS,
  buildHostObservations,
  decisionForScore,
  scoreFromEvidence,
  scoreHostAgainstSkins,
  type WeightedEvidenceItem,
} from '../../src/partner/host-weighted-score.ts';

describe('host-weighted-score', () => {
  test('category caps then sum then final 1.0', () => {
    const evidence: WeightedEvidenceItem[] = [
      { category: 'endpoint', weight: 0.8, detail: 'a', skinId: 'buckeye' },
      { category: 'endpoint', weight: 0.6, detail: 'b', skinId: 'buckeye' },
      { category: 'asset', weight: 0.4, detail: 'c', skinId: 'buckeye' },
      { category: 'infrastructure', weight: 0.3, detail: 'd', skinId: 'buckeye' },
      { category: 'meta', weight: 0.1, detail: 'e', skinId: 'buckeye' },
    ];
    const { score, categories } = scoreFromEvidence(evidence);
    expect(categories.find(c => c.category === 'endpoint')?.capped).toBe(CATEGORY_CAPS.endpoint);
    expect(categories.find(c => c.category === 'endpoint')?.raw).toBe(1.4);
    // 0.8 + 0.4 + 0.3 + 0.1 = 1.6 → 1.0
    expect(score).toBe(1);
  });

  test('definitive locks to 1.0', () => {
    const { score, definitive } = scoreFromEvidence([
      { category: 'definitive', weight: 1, detail: 'map', skinId: 'metallic' },
      { category: 'meta', weight: 0.1, detail: 'x', skinId: 'metallic' },
    ]);
    expect(definitive).toBe(true);
    expect(score).toBe(1);
  });

  test('decision thresholds', () => {
    expect(decisionForScore(0.95)).toBe('map_immediately');
    expect(decisionForScore(0.85)).toBe('review_required');
    expect(decisionForScore(0.5)).toBe('gather_more');
    expect(decisionForScore(0.2)).toBe('weak');
    expect(decisionForScore(1, { fromHostMap: true })).toBe('already_mapped');
  });

  test('hulkwager-like stack → buckeye (unmapped host)', () => {
    const obs = buildHostObservations({
      host: 'unknown-hulk.example',
      title: 'Login',
      headers: { server: 'cloudflare', 'cf-ray': 'abc' },
      body: `<html><title>Login</title>
        <link href="/sites/unknown-hulk.example/css/signin.css"/>
        <script src="/js/require.js"></script>
        <form action="/login"></form>
        <div class="form-signin"></div>
        </html>`,
      storedUrls: [
        'https://unknown-hulk.example/js/require.js',
        'https://unknown-hulk.example/login',
        'https://unknown-hulk.example/sites/unknown-hulk.example/css/signin.css',
      ],
      dnsNs: ['aiden.ns.cloudflare.com', 'tricia.ns.cloudflare.com'],
    });
    const { best, all } = scoreHostAgainstSkins(obs);
    expect(best?.skinId).toBe('buckeye');
    expect(best!.score).toBeGreaterThanOrEqual(0.7);
    expect(['review_required', 'map_immediately']).toContain(best!.decision);
    const metallic = all.find(s => s.skinId === 'metallic');
    expect((metallic?.score ?? 0) < best!.score).toBe(true);
  });

  test('sunwager-like stack → metallic (unmapped host)', () => {
    const obs = buildHostObservations({
      host: 'unknown-sun.example',
      title: 'Webapp',
      headers: {},
      body: `<html>
        <link rel="manifest" href="/manifest.webmanifest"/>
        <a href="/main.html">main</a>
        <form action="/player-api/identity/CustomerLoginRedir?RedirToHome=1"></form>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.5.0/jquery.min.js"></script>
        </html>`,
      storedUrls: [
        'https://unknown-sun.example/main.html',
        'https://unknown-sun.example/manifest.webmanifest',
        'https://unknown-sun.example/player-api/identity/CustomerLoginRedir?RedirToHome=1',
        'https://unknown-sun.example/flash/banner.html',
        'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.5.0/jquery.min.js',
      ],
      dnsNs: ['dns3.cloudns.net', 'dns4.cloudns.net'],
    });
    const { best } = scoreHostAgainstSkins(obs);
    expect(best?.skinId).toBe('metallic');
    expect(best!.score).toBeGreaterThanOrEqual(0.7);
    expect(['review_required', 'map_immediately']).toContain(best!.decision);
  });
});
