export type {
  PartnerAccountStatus,
  PartnerExecutionResult,
  PartnerId,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerOrder,
  PartnerOrderAdapter,
} from "./types.ts";

export {
  credentialsFromFantasyProfile,
  listPartnerAccountsFromEnv,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
  type PartnerAccountProfile,
} from "./account-profile.ts";

export { FantasyUltraAdapter } from "./fantasy-ultra/adapter.ts";
export {
  originFromLiveUrl,
  parseStreamList,
  parseUltraLiveUrlResponse,
} from "./fantasy-ultra/parse.ts";
export {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./fantasy-ultra/types.ts";

import type { PartnerAccountProfile } from "./account-profile.ts";
import { credentialsFromFantasyProfile } from "./account-profile.ts";
import { FantasyUltraAdapter } from "./fantasy-ultra/adapter.ts";
import type { PartnerOrderAdapter } from "./types.ts";

/** Instantiate adapter for a registry profile. */
export function getPartnerAdapter(
  account: PartnerAccountProfile,
  options: { fetchImpl?: typeof fetch } = {},
): PartnerOrderAdapter {
  if (account.partner === "fantasy402") {
    return new FantasyUltraAdapter({
      credentials: credentialsFromFantasyProfile(account),
      fetchImpl: options.fetchImpl,
    });
  }
  throw new Error(`No adapter for partner=${account.partner}`);
}
