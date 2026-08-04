export type {
  FantasySessionAdapter,
  PartnerAccountStatus,
  PartnerExecutionResult,
  PartnerId,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerOrder,
  PartnerOrderAdapter,
  PartnerSportLeague,
} from "./types.ts";

export {
  credentialsFromFantasyProfile,
  listPartnerAccountsFromEnv,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
  type PartnerAccountProfile,
} from "./account-profile.ts";

export { FantasyUltraAdapter } from "./fantasy-ultra/adapter.ts";
export { CookieJar } from "./fantasy-ultra/cookie-jar.ts";
export {
  inspectStreamListCapabilities,
  originFromLiveUrl,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStreamList,
  parseUltraLiveUrlResponse,
  type StreamListCapabilities,
} from "./fantasy-ultra/parse.ts";
export {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./fantasy-ultra/types.ts";

import type { PartnerAccountProfile } from "./account-profile.ts";
import { credentialsFromFantasyProfile } from "./account-profile.ts";
import { FantasyUltraAdapter } from "./fantasy-ultra/adapter.ts";
import type { FantasySessionAdapter, PartnerOrderAdapter } from "./types.ts";

/** Instantiate adapter for a registry profile. */
export function getPartnerAdapter(
  account: PartnerAccountProfile,
  options: { fetchImpl?: typeof fetch; warmSession?: boolean } = {},
): PartnerOrderAdapter {
  if (account.partner === "fantasy402") {
    return new FantasyUltraAdapter({
      credentials: credentialsFromFantasyProfile(account),
      fetchImpl: options.fetchImpl,
      warmSession: options.warmSession,
    });
  }
  throw new Error(`No adapter for partner=${account.partner}`);
}

/** Typed Fantasy session adapter (renew / sports / warm). */
export function getFantasySessionAdapter(
  account: PartnerAccountProfile,
  options: { fetchImpl?: typeof fetch; warmSession?: boolean } = {},
): FantasySessionAdapter {
  if (account.partner !== "fantasy402") {
    throw new Error(`Not a fantasy402 account: ${account.partner}`);
  }
  return new FantasyUltraAdapter({
    credentials: credentialsFromFantasyProfile(account),
    fetchImpl: options.fetchImpl,
    warmSession: options.warmSession,
  });
}
