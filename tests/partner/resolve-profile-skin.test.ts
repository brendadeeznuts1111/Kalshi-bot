// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { defaultUrlForSkin } from '../../src/domain/index.ts';
import type { PartnerAccountProfile } from '../../src/partner/account-profile.ts';
import { resolveProfileAdapterId, resolveProfileSkinId } from '../../src/partner/index.ts';

function stub(partial: Partial<PartnerAccountProfile>): PartnerAccountProfile {
  return {
    id: 'out-X-1',
    partner: 'fantasy402',
    url: defaultUrlForSkin('buckeye')!,
    status: 'active',
    defaultLiveProduct: 2,
    meta: {
      customerID: 'c',
      agentID: 'a',
      password: 'p',
      token: 't',
      currency: 'USD',
    },
    ...partial,
  };
}

describe('resolveProfileSkinId', () => {
  test('host map wins; partner=fantasy402 does not forge SkinId alone', () => {
    const noUrl = stub({ url: 'https://unknown-desk.example', skinId: undefined });
    expect(resolveProfileSkinId(noUrl)).toBeUndefined();
    expect(resolveProfileAdapterId(noUrl)).toBe('unmapped');
  });

  test('canonical SkinId in partner field is accepted', () => {
    const p = stub({
      url: 'https://unknown-desk.example',
      partner: 'ace',
      skinId: undefined,
    });
    expect(resolveProfileSkinId(p)).toBe('ace');
  });

  test('explicit skinId wins over host', () => {
    const p = stub({
      url: defaultUrlForSkin('buckeye')!,
      skinId: 'metallic',
    });
    expect(resolveProfileSkinId(p)).toBe('metallic');
  });

  test('buckeye host → skin + fantasy-ultra adapter', () => {
    const p = stub({ url: defaultUrlForSkin('buckeye')!, skinId: undefined });
    expect(resolveProfileSkinId(p)).toBe('buckeye');
    expect(resolveProfileAdapterId(p)).toBe('fantasy-ultra');
  });
});
