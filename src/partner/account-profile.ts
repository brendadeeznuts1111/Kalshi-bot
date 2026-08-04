/**
 * Partner account profile — env-backed for the Fantasy dummy desk.
 * Do not commit secrets; load via process env / Proton inject later.
 */
import type { PartnerAccountStatus, PartnerId } from "./types.ts";
import type { FantasyUltraCredentials } from "./fantasy-ultra/types.ts";
import { FANTASY_ULTRA_DEFAULTS } from "./fantasy-ultra/types.ts";

export type PartnerAccountProfile = {
  id: string;
  partner: PartnerId;
  url: string;
  status: PartnerAccountStatus;
  meta: {
    customerID: string;
    agentID: string;
    password: string;
    token: string;
    skin: number;
    currency: string;
  };
};

/**
 * Load Fantasy402 profile from env.
 *
 * Required:
 *   FANTASY402_BEARER_TOKEN
 *   FANTASY402_CUSTOMER_ID
 *   FANTASY402_AGENT_ID
 *   FANTASY402_PASSWORD
 * Optional:
 *   FANTASY402_DOMAIN (default https://fantasy402.com)
 *   FANTASY402_SKIN (default 2)
 *   FANTASY402_CURRENCY (default USD)
 *   FANTASY402_ACCOUNT_ID (default fantasy402-dummy)
 */
export function loadFantasy402ProfileFromEnv(
  envMap: Record<string, string | undefined> = process.env,
): PartnerAccountProfile | null {
  const token = envMap.FANTASY402_BEARER_TOKEN?.trim();
  const customerID = envMap.FANTASY402_CUSTOMER_ID?.trim();
  const agentID = envMap.FANTASY402_AGENT_ID?.trim();
  const password = envMap.FANTASY402_PASSWORD?.trim();
  if (!token || !customerID || !agentID || !password) return null;

  const domain =
    envMap.FANTASY402_DOMAIN?.trim() || FANTASY_ULTRA_DEFAULTS.domain;
  const skinRaw = envMap.FANTASY402_SKIN?.trim();
  const skin = skinRaw ? Number(skinRaw) : FANTASY_ULTRA_DEFAULTS.skin;
  const currency =
    envMap.FANTASY402_CURRENCY?.trim() || FANTASY_ULTRA_DEFAULTS.currency;

  return {
    id: envMap.FANTASY402_ACCOUNT_ID?.trim() || "fantasy402-dummy",
    partner: "fantasy402",
    url: domain,
    status: "active",
    meta: {
      customerID,
      agentID,
      password,
      token: token.replace(/^Bearer\s+/i, ""),
      skin: Number.isFinite(skin) ? skin : FANTASY_ULTRA_DEFAULTS.skin,
      currency,
    },
  };
}

export function credentialsFromFantasyProfile(
  profile: PartnerAccountProfile,
): FantasyUltraCredentials {
  return {
    customerID: profile.meta.customerID,
    agentID: profile.meta.agentID,
    password: profile.meta.password,
    bearerToken: profile.meta.token,
    domain: profile.url,
    skin: profile.meta.skin,
    currency: profile.meta.currency,
  };
}

/** Registry stub — env profile only for now (no SQLite accounts table yet). */
export function listPartnerAccountsFromEnv(): PartnerAccountProfile[] {
  const f = loadFantasy402ProfileFromEnv();
  return f ? [f] : [];
}

export function requireFantasy402ProfileFromEnv(): PartnerAccountProfile {
  const p = loadFantasy402ProfileFromEnv();
  if (!p) {
    throw new Error(
      "Missing Fantasy402 env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD",
    );
  }
  return p;
}
