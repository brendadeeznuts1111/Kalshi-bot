// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { defaultUrlForSkin } from '../../src/domain/index.ts';
import {
  adapterBindingForSkin,
  parseOutIdentity,
  stampOutMeta,
} from '../../src/partner/out-identity.ts';
import { buildSkinsMeta } from '../../src/partner/out-capacity.ts';

const BUCKEYE_URL = defaultUrlForSkin('buckeye')!;
const ACE_URL = defaultUrlForSkin('ace')!;

describe('out-identity boundary', () => {
  test('buckeye host → fantasy-ultra adapter + capacity ⊆ offered', () => {
    const identity = parseOutIdentity({
      id: 'out-SPEN-1',
      partnerId: 'partner-spen',
      url: BUCKEYE_URL,
      provider: 'fantasy402',
      maxStake: 500,
      maxWin: 2500,
      skin: null,
      metaJson: buildSkinsMeta({
        skins: [
          { name: 'ezlive', perBetMax: 500, maxWin: 2500, active: true },
          { name: 'dark', perBetMax: 1000, maxWin: 5000, active: true },
        ],
      }),
    });
    expect(identity?.skinId).toBe('buckeye');
    expect(String(identity?.bookId)).toBe('fantasy402');
    expect(identity?.adapter.adapterId).toBe('fantasy-ultra');
    expect(identity?.adapter.mapperKind).toBe('fantasy402');
    expect(identity?.adapter.bookEnvToken).toBe('FANTASY402');
    expect(identity?.capacity.map(c => c.liveProduct).sort()).toEqual(['dark', 'ezlive']);
    const stamped = stampOutMeta(identity!);
    expect(stamped).toContain('"bookId":"fantasy402"');
  });

  test('dual-read legacy skins only (no liveProducts key)', () => {
    const identity = parseOutIdentity({
      id: 'out-X-1',
      partnerId: 'partner-x',
      url: BUCKEYE_URL,
      maxStake: 100,
      maxWin: 500,
      skin: null,
      metaJson: JSON.stringify({
        skins: [{ name: 'plive', perBetMax: 100, maxWin: 500, active: true }],
      }),
    });
    expect(identity?.capacity[0]?.liveProduct).toBe('plive');
    const stamped = stampOutMeta(identity!);
    expect(stamped).toContain('"liveProducts"');
    expect(stamped).toContain('"skins"');
    expect(stamped).toContain('"defaultLiveProduct"');
  });

  test('maglive on buckeye rejected', () => {
    expect(() =>
      parseOutIdentity({
        id: 'out-X-1',
        partnerId: 'partner-x',
        url: BUCKEYE_URL,
        maxStake: 100,
        maxWin: 500,
        skin: null,
        metaJson: buildSkinsMeta({
          skins: [{ name: 'maglive', perBetMax: 100, maxWin: 500, active: true }],
        }),
      })
    ).toThrow(/not offered by skin=buckeye/);
  });

  test('ace host → unmapped adapter; ultralive ok', () => {
    const identity = parseOutIdentity({
      id: 'out-ACE-1',
      partnerId: 'partner-ace',
      url: ACE_URL,
      maxStake: 100,
      maxWin: 500,
      skin: null,
      metaJson: buildSkinsMeta({
        skins: [{ name: 'ultralive', perBetMax: 100, maxWin: 500, active: true }],
      }),
    });
    expect(identity?.skinId).toBe('ace');
    expect(String(identity?.bookId)).toBe('parlay21');
    expect(identity?.adapter.adapterId).toBe('unmapped');
    expect(identity?.adapter.mapperKind).toBe('unmapped');
  });

  test('adapterBindingForSkin maps fantasy402 mapper → fantasy-ultra', () => {
    expect(adapterBindingForSkin('buckeye').adapterId).toBe('fantasy-ultra');
    expect(adapterBindingForSkin('ace').adapterId).toBe('unmapped');
  });

  test('unknown host throws', () => {
    expect(() =>
      parseOutIdentity({
        id: 'out-X-1',
        partnerId: 'partner-x',
        url: 'https://unknown.example',
        maxStake: 100,
        maxWin: 500,
        skin: null,
        metaJson: '{}',
      })
    ).toThrow(/Unknown account host/);
  });
});
