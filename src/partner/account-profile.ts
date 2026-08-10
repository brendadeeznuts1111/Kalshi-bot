/**
 * Partner account profile — env-backed for the Fantasy dummy desk.
 * Do not commit secrets; load via process env / Proton inject later.
 *
 * defaultLiveProduct = live interface wire (ezlive / dark / 2) — not white-label.
 * skinId = white-label desk (buckeye / ace / …) when known.
 * partner: "fantasy402" is a surface adapter token (maps buckeye), not the SkinId.
 *
 * Resolution uses per-out env_prefix with fallback chain:
 *   out (FANTASY402_SPEN_1_*) → partner (FANTASY402_SPEN_*) → book (FANTASY402_*)
 */
import { getSkinByHost, resolveDeskDomainFromEnv, type SkinId } from '../domain/index.ts';
import type { MapperAdapterId } from './out-identity.ts';
import { adapterBindingForSkin, providerMirrorFromAdapter } from './out-identity.ts';
import type { PartnerAccountStatus, SurfaceAdapterId } from './types.ts';
import type { FantasyUltraCredentials } from './fantasy-ultra/types.ts';
import { FANTASY_ULTRA_DEFAULTS } from './fantasy-ultra/types.ts';
import { parseLiveProductWire } from './out-capacity.ts';
import {
  DEFAULT_REQUIRED_ENV_KEYS,
  parseOutId,
  resolvePartnerEnv,
  type PartnerEnvBundle,
  type PartnerEnvKey,
} from './toml-config.ts';

export type PartnerAccountProfile = {
  id: string;
  /**
   * Surface adapter token (`fantasy402` / `kalshi`) for env resolution mirror.
   * Prefer `adapterId` (mapper) + `skinId` (desk) for routing.
   */
  partner: SurfaceAdapterId;
  url: string;
  status: PartnerAccountStatus;
  /** White-label SkinId when resolved (host or alias). */
  skinId?: SkinId;
  /** Mapper selection key (fantasy-ultra | kalshi | unmapped). */
  adapterId?: MapperAdapterId;
  /** Default live-product / Ultra wire for this out. */
  defaultLiveProduct?: string | number;
  /** Secrets + currency only — never put live-product wire here. */
  meta: {
    customerID: string;
    agentID: string;
    password: string;
    token: string;
    currency: string;
  };
};

/** Proton Pass item title for an out (matches env-protonpass.template). */
export function fantasyVaultItemTitle(outId: string): string {
  const p = parseOutId(outId);
  if (!p) return 'Fantasy402';
  return `Fantasy402 ${p.code} ${p.index}`;
}

/** Build profile from a resolved PartnerEnvBundle (no secret logging). */
export function profileFromEnvBundle(
  bundle: PartnerEnvBundle,
  options?: { accountId?: string }
): PartnerAccountProfile | null {
  const token = bundle.values.BEARER_TOKEN?.trim();
  const customerID = bundle.values.CUSTOMER_ID?.trim();
  const agentID = bundle.values.AGENT_ID?.trim();
  const password = bundle.values.PASSWORD?.trim();
  if (!token || !customerID || !agentID || !password) return null;

  const url = bundle.values.DOMAIN?.trim() || resolveDeskDomainFromEnv();
  /** SkinId from host map only — never forge via fantasy402 alias. */
  const skinId = getSkinByHost(url);
  const defaultLiveProduct = parseLiveProductWire(
    bundle.values.LIVE_PRODUCT,
    FANTASY_ULTRA_DEFAULTS.liveProduct
  );
  const binding = skinId ? adapterBindingForSkin(skinId) : undefined;
  const adapterId = binding?.adapterId ?? 'unmapped';

  return {
    id: options?.accountId?.trim() || 'partner-dummy',
    partner: binding ? providerMirrorFromAdapter(binding) : 'unmapped',
    url,
    status: 'active',
    skinId,
    adapterId,
    defaultLiveProduct,
    meta: {
      customerID,
      agentID,
      password,
      token: token.replace(/^Bearer\s+/i, ''),
      currency: bundle.values.CURRENCY?.trim() || FANTASY_ULTRA_DEFAULTS.currency,
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
  }
): PartnerAccountProfile | null {
  const bundle = resolvePartnerEnv(envPrefix, options?.envMap ?? process.env, undefined, {
    provider: options?.provider ?? 'fantasy402',
  });
  return profileFromEnvBundle(bundle, { accountId: options?.accountId });
}

/** Presence of required desk keys for a prefix (never echoes values). */
export function fantasyDeskEnvPresence(
  envPrefix: string,
  envMap: Record<string, string | undefined> = process.env,
  required: readonly PartnerEnvKey[] = DEFAULT_REQUIRED_ENV_KEYS
): {
  envPrefix: string;
  ok: boolean;
  missing: PartnerEnvKey[];
  present: PartnerEnvKey[];
  sources: PartnerEnvBundle['source'];
} {
  const bundle = resolvePartnerEnv(envPrefix, envMap);
  const missing = required.filter(k => !bundle.values[k]);
  const present = required.filter(k => Boolean(bundle.values[k]));
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
 * Optional: DESK_DOMAIN or per-out/partner *DOMAIN → host → SkinId; *LIVE_PRODUCT *CURRENCY
 * Account id: FANTASY402_ACCOUNT_ID (default partner-dummy)
 */
export function loadFantasy402ProfileFromEnv(
  envMap: Record<string, string | undefined> = process.env
): PartnerAccountProfile | null {
  return loadFantasy402ProfileFromPrefix('FANTASY402_', {
    envMap,
    accountId: envMap.FANTASY402_ACCOUNT_ID?.trim() || 'partner-dummy',
  });
}

export function credentialsFromFantasyProfile(
  profile: PartnerAccountProfile,
  options?: { liveProduct?: string | number; skin?: string | number }
): FantasyUltraCredentials {
  const wire =
    options?.liveProduct ??
    options?.skin ??
    profile.defaultLiveProduct ??
    FANTASY_ULTRA_DEFAULTS.liveProduct;
  return {
    customerID: profile.meta.customerID,
    agentID: profile.meta.agentID,
    password: profile.meta.password,
    bearerToken: profile.meta.token,
    domain: profile.url,
    /** Ultra form field name remains `skin` on the wire. */
    skin: wire,
    currency: profile.meta.currency,
  };
}

/** Clone profile with a chosen execution live product (same vault credentials). */
export function profileWithLiveProduct(
  profile: PartnerAccountProfile,
  liveProduct: string | number
): PartnerAccountProfile {
  const wire = parseLiveProductWire(
    liveProduct,
    profile.defaultLiveProduct ?? FANTASY_ULTRA_DEFAULTS.liveProduct
  );
  return {
    ...profile,
    defaultLiveProduct: wire,
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
      'Missing Fantasy402 env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD ' +
        '(or per-out FANTASY402_{CODE}_{N}_* via resolvePartnerEnv fallback)'
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
  }
): PartnerAccountProfile {
  const p = loadFantasy402ProfileFromPrefix(envPrefix, options);
  if (!p) {
    const presence = fantasyDeskEnvPresence(envPrefix, options?.envMap ?? process.env);
    throw new Error(
      `Missing Fantasy402 secrets for prefix=${presence.envPrefix} missing=[${presence.missing.join(',')}] ` +
        `(fallback: out → partner → book). Inject via pass-cli / .env.protonpass — never paste into commits.`
    );
  }
  return p;
}
