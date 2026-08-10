// @see https://bun.com/docs/test/index#run-tests
/**
 * Guard: desk hosts and live-product infra URLs stay in domain SSOT modules.
 * Prevents re-locking fantasy402.com / plive.sportswidgets.pro across partner src.
 */
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import {
  PLIVE_STREAM_ENDPOINTS,
  SKINS,
  apexHost,
  defaultLiveWidgetUrl,
  listLiveProductInfraApexHosts,
} from '../../src/domain/index.ts';

const DESK_SSOT = new Set(['src/domain/skins.ts', 'src/domain/index.ts']);
const LIVE_SSOT = new Set([
  'src/domain/live-product-endpoints.ts',
  'src/domain/index.ts',
]);

function listDeskApexHosts(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const skin of SKINS) {
    for (const raw of skin.hosts) {
      const apex = apexHost(raw);
      if (!apex || seen.has(apex)) continue;
      seen.add(apex);
      out.push(apex);
    }
  }
  return out.sort();
}

describe('url literal scan', () => {
  test('defaultLiveWidgetUrl builds from PLIVE_STREAM_ENDPOINTS', () => {
    expect(defaultLiveWidgetUrl(220)).toBe(
      `${PLIVE_STREAM_ENDPOINTS.streamOrigin}${PLIVE_STREAM_ENDPOINTS.livePathPrefix}?#!/sport/220`
    );
  });

  test('desk host https:// literals stay in skins SSOT', async () => {
    const apexes = listDeskApexHosts();
    expect(apexes.length).toBeGreaterThan(5);
    const hits: string[] = [];
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan('.')) {
      if (DESK_SSOT.has(path)) continue;
      const text = await Bun.file(path).text();
      for (const apex of apexes) {
        if (text.includes(`https://${apex}`) || text.includes(`https://www.${apex}`)) {
          hits.push(`${path}: ${apex}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test('live-product infra https:// literals stay in endpoints SSOT', async () => {
    const infra = listLiveProductInfraApexHosts();
    expect(infra).toContain('plive.sportswidgets.pro');
    expect(infra).toContain('api-gs.player-us.xyz');
    const hits: string[] = [];
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan('.')) {
      if (LIVE_SSOT.has(path)) continue;
      const text = await Bun.file(path).text();
      for (const apex of infra) {
        // Allow comments that name the host without an https:// lock.
        if (text.includes(`https://${apex}`)) {
          hits.push(`${path}: ${apex}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
