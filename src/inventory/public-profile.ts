/**
 * Dummy Fantasy402 profile for public/catalog-only inventory paths
 * (enrich-only, dry-run without seat credentials).
 */
import { requireDefaultUrlForUltraMapper } from '../domain/index.ts';
import type { PartnerAccountProfile } from '../partner/account-profile.ts';

export function publicFantasyProfile(
  over: Partial<PartnerAccountProfile> = {}
): PartnerAccountProfile {
  return {
    id: 'fantasy402-public',
    partner: 'fantasy402',
    url: requireDefaultUrlForUltraMapper(),
    status: 'active',
    defaultLiveProduct: 2,
    meta: {
      customerID: 'public',
      agentID: 'public',
      password: 'public',
      token: 'public',
      currency: 'USD',
    },
    ...over,
  };
}
