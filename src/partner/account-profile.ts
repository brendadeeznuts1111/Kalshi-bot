/**
 * Partner account profile — env-backed for the Fantasy dummy desk.
 * Do not commit secrets; load via process env / Proton inject later.
 *
 * Skin is the live interface (ezlive / dark / 2) — not a second credential set.
 * Same out credentials + chosen skin → getUltraLiveURL payload.
 *
 * Resolution uses per-out env_prefix with fallback chain:
 *   out (FANTASY402_SPEN_1_*) → partner (FANTASY402_SPEN_*) → book (FANTASY402_*)
 */
import type { PartnerAccountStatus, PartnerId } from "./types.ts";
import type { FantasyUltraCredentials } from "./fantasy-ultra/types.ts";
import { FANTASY_ULTRA_DEFAULTS } from "./fantasy-ultra/types.ts";
import { parseSkinWire } from "./skins.ts";
import {
  DEFAULT_REQUIRED_ENV_KEYS,
  parseOutId,
  resolvePartnerEnv,
  type PartnerEnvBundle,
  type PartnerEnvKey,
} from "./toml-config.ts";

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
    /** Default skin for this out (override per execution). */
    skin: string | number;
    currency: string;
  };
};

/** Proton Pass item title for an out (matches env-protonpass.template). */
export function fantasyVaultItemTitle(outId: string): string {
  const p = parseOutId(outId);
  if (!p) return "Fantasy402";
  return `Fantasy402 ${p.code} ${p.index}`;
}

/** Build profile from a resolved PartnerEnvBundle (no secret logging). */
export function profileFromEnvBundle(
  bundle: PartnerEnvBundle,
  options?: { accountId?: string },
): PartnerAccountProfile | null {
  const token = bundle.values.BEARER_TOKEN?.trim();
  const customerID = bundle.values.CUSTOMER_ID?.trim();
  const agentID = bundle.values.AGENT_ID?.trim();
  const password = bundle.values.PASSWORD?.trim();
  if (!token || !customerID || !agentID || !password) return null;

  return {
    id: options?.accountId?.trim() || "fantasy402-dummy",
    partner: "fantasy402",
    url: bundle.values.DOMAIN?.trim() || FANTASY_ULTRA_DEFAULTS.domain,
    status: "active",
    meta: {
      customerID,
      agentID,
      password,
      token: token.replace(/^Bearer\s+/i, ""),
      skin: parseSkinWire(
        bundle.values.SKIN,
        FANTASY_ULTRA_DEFAULTS.skin,
      ),
      currency:
        bundle.values.CURRENCY?.trim() || FANTASY_ULTRA_DEFAULTS.currency,
    },
  };
}

/**
 * Load Fantasy402 profile via out/partner/book env_prefix chain.
 *
 * @example
 *   loadFantasy402ProfileFromPrefix("FANTASY402_SPEN_1_", { accountId: "out-SPEN-1" })
 */
export function loadFantasy402ProfileFromPrefix(
  envPrefix: string,
  options?: {
    envMap?: Record<string, string | undefined>;
    accountId?: string;
    provider?: string;
  },
): PartnerAccountProfile | null {
  const bundle = resolvePartnerEnv(
    envPrefix,
    options?.envMap ?? process.env,
    undefined,
    { provider: options?.provider ?? "fantasy402" },
  );
  return profileFromEnvBundle(bundle, { accountId: options?.accountId });
}

/** Presence of required desk keys for a prefix (never echoes values). */
export function fantasyDeskEnvPresence(
  envPrefix: string,
  envMap: Record<string, string | undefined> = process.env,
  required: readonly PartnerEnvKey[] = DEFAULT_REQUIRED_ENV_KEYS,
): {
  envPrefix: string;
  ok: boolean;
  missing: PartnerEnvKey[];
  present: PartnerEnvKey[];
  sources: PartnerEnvBundle["source"];
} {
  const bundle = resolvePartnerEnv(envPrefix, envMap);
  const missing = required.filter((k) => !bundle.values[k]);
  const present = required.filter((k) => Boolean(bundle.values[k]));
  return {
    envPrefix: bundle.envPrefix,
    ok: missing.length === 0,
    missing,
    present,
    sources: bundle.source,
  };
}

/**
 * Load Fantasy402 profile from env (book fallback prefix FANTASY402_).
 *
 * Prefer `loadFantasy402ProfileFromPrefix` with the out's registry env_prefix.
 *
 * Required (any level of the fallback chain):
 *   *BEARER_TOKEN *CUSTOMER_ID *AGENT_ID *PASSWORD
 * Optional: *DOMAIN *SKIN *CURRENCY
 * Account id: FANTASY402_ACCOUNT_ID (default fantasy402-dummy)
 */
export function loadFantasy402ProfileFromEnv(
  envMap: Record<string, string | undefined> = process.env,
): PartnerAccountProfile | null {
  return loadFantasy402ProfileFromPrefix("FANTASY402_", {
    envMap,
    accountId: envMap.FANTASY402_ACCOUNT_ID?.trim() || "fantasy402-dummy",
  });
}

export function credentialsFromFantasyProfile(
  profile: PartnerAccountProfile,
  options?: { skin?: string | number },
): FantasyUltraCredentials {
  return {
    customerID: profile.meta.customerID,
    agentID: profile.meta.agentID,
    password: profile.meta.password,
    bearerToken: profile.meta.token,
    domain: profile.url,
    skin: options?.skin ?? profile.meta.skin,
    currency: profile.meta.currency,
  };
}

/** Clone profile with a chosen execution skin (same vault credentials). */
export function profileWithSkin(
  profile: PartnerAccountProfile,
  skin: string | number,
): PartnerAccountProfile {
  return {
    ...profile,
    meta: { ...profile.meta, skin: parseSkinWire(skin, profile.meta.skin) },
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
      "Missing Fantasy402 env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD " +
        "(or per-out FANTASY402_{CODE}_{N}_* via resolvePartnerEnv fallback)",
    );
  }
  return p;
}

export function requireFantasy402ProfileFromPrefix(
  envPrefix: string,
  options?: {
    envMap?: Record<string, string | undefined>;
    accountId?: string;
    provider?: string;
  },
): PartnerAccountProfile {
  const p = loadFantasy402ProfileFromPrefix(envPrefix, options);
  if (!p) {
    const presence = fantasyDeskEnvPresence(
      envPrefix,
      options?.envMap ?? process.env,
    );
    throw new Error(
      `Missing Fantasy402 secrets for prefix=${presence.envPrefix} missing=[${presence.missing.join(",")}] ` +
        `(fallback: out → partner → book). Inject via pass-cli / .env.protonpass — never paste into commits.`,
    );
  }
  return p;
}
