/**
 * White-label skins (desks). Skins offer live products; they do not own the sports matrix.
 *
 * fantasy402 is the mapper/probe adapter for skin `buckeye` (also an alias).
 */

import { type LiveProductId, isLiveProductId, normalizeLiveProductName } from './live-products.ts';

export const SKIN_IDS = ['buckeye', 'ace', 'metallic', 'sts', '1bv', 'lvaction', 'magnum'] as const;
export type SkinId = (typeof SKIN_IDS)[number];

/** How we discover / map a skin's live offerings. */
export type SkinMapper = { kind: 'fantasy402'; note: string } | { kind: 'unmapped'; note: string };

/**
 * Passive fingerprints for host-discover weighted scoring (not Ultra stack markers).
 * Matched against extracted paths / assets / DNS — see partner/host-weighted-score.ts.
 */
export type SkinFingerprints = {
  /** Path prefixes or distinctive segments (e.g. `/sites/`, CustomerLoginRedir). */
  endpoints: readonly string[];
  /** Asset / bundle tokens (e.g. `require.js`, `manifest.webmanifest`). */
  assets: readonly string[];
  infra?: {
    /** Nameserver substrings (e.g. `aiden.ns.cloudflare.com`, `cloudns.net`). */
    nsTokens?: readonly string[];
    /** CDN / edge family tokens (e.g. `cloudflare`, `cloudns`). */
    cdnTokens?: readonly string[];
  };
};

export type SkinRecord = {
  id: SkinId;
  displayName: string;
  description: string;
  /**
   * Active desks must declare ≥1 host (HOST_TO_SKIN / PARTNER_DOMAIN / discover).
   * Inactive = placeholder until hosts + offerings are proven.
   */
  active: boolean;
  /** Live products this skin can sell to outs. */
  offeredLiveProducts: readonly LiveProductId[];
  /** Hostnames that resolve to this skin (no scheme, lowercase). */
  hosts: readonly string[];
  /** Legacy provider / env / brand tokens that resolve to this skin. */
  aliases: readonly string[];
  /** Probe / adapter used to map offerings. */
  mapper: SkinMapper;
  /** Host-discover fingerprint profile (weighted evidence model; may be empty). */
  fingerprints: SkinFingerprints;
};

export const SKINS = [
  {
    id: 'buckeye',
    displayName: 'Buckeye',
    description:
      'Buckeye skin — P-Live + EZ Live. Mapped via Fantasy402 Ultra session / stream-list.',
    active: true,
    offeredLiveProducts: ['plive', 'ezlive'] as const satisfies readonly LiveProductId[],
    hosts: [
      'betwest.com',
      'www.betwest.com',
      'fantasy402.com',
      'www.fantasy402.com',
      // Deep probe 2026-08-09: sites/<host>/signin + RequireJS + getUltraLiveURL→401; CF NS twin of fantasy402
      'hulkwager.com',
      'www.hulkwager.com',
    ],
    aliases: ['fantasy402', 'fantasy-402', 'buckeye'] as const,
    mapper: {
      kind: 'fantasy402',
      note: 'Use Fantasy402 adapter (getUltraLiveURL, stream-list-v2, Pandora) to map offerings',
    },
    fingerprints: {
      // Note: bare `/login` is too generic (matches Login.aspx etc.) — omit.
      endpoints: ['/sites/', '/js/require.js'] as const,
      assets: ['require.js', 'signin.css', 'form-signin', 'jquery-1.11'] as const,
      infra: {
        // fantasy402 + hulkwager share aiden/tricia CF NS pair (not generic "cloudflare")
        nsTokens: ['aiden.ns.cloudflare.com', 'tricia.ns.cloudflare.com'] as const,
      },
    },
  },
  {
    id: 'ace',
    displayName: 'ACE',
    description: 'ACE skin — EZ Live, Ultra Live, Mag Live.',
    active: true,
    offeredLiveProducts: [
      'ezlive',
      'ultralive',
      'maglive',
    ] as const satisfies readonly LiveProductId[],
    hosts: ['parlay21.com', 'www.parlay21.com', 'lonestarwagering.com', 'www.lonestarwagering.com'],
    aliases: ['ace'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Live-product coverage not proven yet; offerings declared only',
    },
    // Live probe 2026-08-09: ASP.NET Login.aspx + sportsbookvip.com shell (parlay21 / lonestar).
    // Login.aspx is collision-weighted — alone stays < 0.4; sportsbookvip clears review.
    fingerprints: {
      endpoints: ['/Login.aspx'] as const,
      assets: ['sportsbookvip.com', 'mm2019.js', 'sportsbookvip'] as const,
    },
  },
  {
    id: 'metallic',
    displayName: 'Metallic',
    description: 'Metallic skin — hosts declared; live products TBD.',
    active: true,
    offeredLiveProducts: [] as const satisfies readonly LiveProductId[],
    hosts: [
      'paradisewager.com',
      'www.paradisewager.com',
      'orange777.com',
      'www.orange777.com',
      // Deep probe 2026-08-09: CustomerLoginRedir + main.html/PWA; CloudNS twin of paradise/orange
      'sunwager.com',
      'www.sunwager.com',
      // Cert/A twin of sunwager (shared TLS SAN)
      'gator747.com',
      'www.gator747.com',
    ],
    aliases: ['metallic'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Hosts declared; live-product coverage not proven yet',
    },
    fingerprints: {
      endpoints: ['/main.html', '/player-api/identity/CustomerLoginRedir', '/v2/'] as const,
      assets: [
        'manifest.webmanifest',
        'flash/banner.html',
        'jquery/3.5',
        'jquery.validate',
      ] as const,
      infra: {
        nsTokens: ['cloudns.net'] as const,
        cdnTokens: ['cloudns'] as const,
      },
    },
  },
  {
    id: 'sts',
    displayName: 'STS',
    description: 'STS skin — hosts declared; live products TBD.',
    active: true,
    offeredLiveProducts: [] as const satisfies readonly LiveProductId[],
    hosts: ['wagerattack.ag', 'www.wagerattack.ag', 'gomobilewager.com', 'www.gomobilewager.com'],
    aliases: ['sts'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Hosts + fingerprints 2026-08-09 (gomobile NewLogin shell); products_unknown_as_of=2026-08-09',
    },
    // Live probe: gomobilewager NewLogin.aspx + frontend/css/login.css (wagerattack public page is sparse).
    fingerprints: {
      endpoints: ['/NewLogin.aspx', '/frontend/css/login.css'] as const,
      assets: ['frontend/vendors/bootstrap', 'frontend/css/login.css'] as const,
    },
  },
  {
    id: '1bv',
    displayName: '1BV',
    description: '1BV skin — hosts declared; live products TBD.',
    active: true,
    offeredLiveProducts: [] as const satisfies readonly LiveProductId[],
    hosts: ['anybet365.com', 'www.anybet365.com', 'betvegas23.com', 'www.betvegas23.com'],
    aliases: ['1bv'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Hosts + fingerprints 2026-08-09 (anybet365 skin.betting / cdntools); products_unknown_as_of=2026-08-09; betvegas23 also sportsbookvip but HOST_TO_SKIN owns it',
    },
    // Prefer anybet365-distinctive tokens — do not claim sportsbookvip (ACE collision).
    fingerprints: {
      endpoints: ['/frontend/__rules/skin.betting/', 'skin.betting'] as const,
      assets: ['cdntools.info', 'animacion3.aspx'] as const,
    },
  },
  {
    id: 'lvaction',
    displayName: 'LV Action',
    description: 'LV Action skin — hosts declared; live products TBD.',
    active: true,
    offeredLiveProducts: [] as const satisfies readonly LiveProductId[],
    hosts: ['lvaction.com', 'www.lvaction.com', 'classic.lvaction.com', 'archive.lvaction.com'],
    aliases: ['lvaction', 'lv-action'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Hosts + fingerprints 2026-08-09 (templates/53 + classic App_Themes); products_unknown_as_of=2026-08-09',
    },
    // Live probe: modern shell /templates/53/ + classic ASP.NET App_Themes/Responsive.
    fingerprints: {
      endpoints: ['/templates/53/', '/sportsbook.php', 'multisitesLogin', '/App_Themes/Responsive/'] as const,
      assets: ['jquery.matchHeight', 'jquery.bxslider', 'jquery.slicknav'] as const,
    },
  },
  {
    id: 'magnum',
    displayName: 'Magnum',
    description: 'Magnum skin — hosts declared; live products TBD.',
    active: true,
    offeredLiveProducts: [] as const satisfies readonly LiveProductId[],
    hosts: ['probooknyc.com', 'www.probooknyc.com', '50centjuice.com', 'www.50centjuice.com'],
    aliases: ['magnum'] as const,
    mapper: {
      kind: 'unmapped',
      note: 'Hosts declared; live-product coverage not proven yet',
    },
    fingerprints: { endpoints: [] as const, assets: [] as const },
  },
] as const satisfies readonly SkinRecord[];

/** Active skins only (must have hosts[] — see assertActiveSkinsHaveHosts). */
export function listActiveSkins(): readonly (typeof SKINS)[number][] {
  return SKINS.filter(s => s.active);
}

/**
 * Invariant: every active skin declares ≥1 host.
 * Throws with skin ids that violate — call from tests / doctor gates.
 */
export function assertActiveSkinsHaveHosts(): void {
  // Widen off the `as const` tuple so empty-hosts placeholders stay type-checkable.
  const bad = (SKINS as readonly SkinRecord[])
    .filter(s => s.active && s.hosts.length === 0)
    .map(s => s.id);
  if (bad.length > 0) {
    throw new Error(
      `Active skins missing hosts[]: [${bad.join(', ')}] — populate hosts or set active:false`
    );
  }
}

// Fail fast at module load so bad SKINS never ship silently.
assertActiveSkinsHaveHosts();

const byId = new Map<SkinId, SkinRecord>(SKINS.map(s => [s.id, s]));

const aliasToSkin = new Map<string, SkinId>();
for (const s of SKINS) {
  aliasToSkin.set(s.id, s.id);
  for (const a of s.aliases) {
    aliasToSkin.set(a.toLowerCase(), s.id);
  }
}

/** hostname (lowercase, no port) → SkinId */
export const HOST_TO_SKIN: Readonly<Record<string, SkinId>> = (() => {
  const out: Record<string, SkinId> = {};
  for (const s of SKINS) {
    for (const host of s.hosts) {
      out[host.toLowerCase()] = s.id;
    }
  }
  return out;
})();

export function isSkinId(value: string): value is SkinId {
  return byId.has(value.trim().toLowerCase() as SkinId);
}

export function getSkin(id: string): SkinRecord | undefined {
  const resolved = resolveSkinId(id);
  return resolved ? byId.get(resolved) : undefined;
}

/** Resolve legacy provider tokens (`fantasy402`) → canonical SkinId. */
export function resolveSkinId(raw: string): SkinId | undefined {
  return aliasToSkin.get(raw.trim().toLowerCase());
}

/** Normalize host from URL or bare hostname → SkinId. */
export function getSkinByHost(hostOrUrl: string): SkinId | undefined {
  const host = normalizeHost(hostOrUrl);
  if (!host) return undefined;
  if (HOST_TO_SKIN[host]) return HOST_TO_SKIN[host];
  // strip leading www. if exact miss
  if (host.startsWith('www.')) return HOST_TO_SKIN[host.slice(4)];
  return HOST_TO_SKIN[`www.${host}`];
}

export function normalizeHost(hostOrUrl: string): string {
  const raw = hostOrUrl.trim().toLowerCase();
  if (!raw) return '';
  try {
    if (raw.includes('://')) return new URL(raw).hostname.replace(/\.$/, '');
  } catch {
    /* bare host */
  }
  return raw
    .replace(/^\s*https?:\/\//, '')
    .split('/')[0]!
    .split(':')[0]!
    .replace(/\.$/, '');
}

/** Strip leading www. after normalizeHost. */
export function apexHost(hostOrUrl: string): string {
  const host = normalizeHost(hostOrUrl);
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** Absolute https URL for a hostname (no hard-coded desk). */
export function urlForHost(hostOrUrl: string): string {
  const host = apexHost(hostOrUrl);
  if (!host) throw new Error('urlForHost: empty host');
  return `https://${host}`;
}

/** Distinct apex hosts declared on a skin (www. collapsed). */
export function listSkinApexHosts(skinId: SkinId): string[] {
  const skin = getSkin(skinId);
  if (!skin) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skin.hosts) {
    const apex = apexHost(raw);
    if (!apex || seen.has(apex)) continue;
    seen.add(apex);
    out.push(apex);
  }
  return out;
}

/**
 * Default desk URL for a skin — from SKINS[].hosts only.
 * Prefers an apex whose label matches a skin alias (legacy brand host), else first apex.
 */
export function defaultUrlForSkin(skinId: SkinId): string | undefined {
  const skin = getSkin(skinId);
  if (!skin) return undefined;
  const apexes = listSkinApexHosts(skinId);
  if (apexes.length === 0) return undefined;
  const aliases = new Set(skin.aliases.map(a => a.toLowerCase()));
  for (const apex of apexes) {
    const label = apex.split('.')[0]?.toLowerCase();
    if (label && aliases.has(label)) return urlForHost(apex);
  }
  return urlForHost(apexes[0]!);
}

/** First skin with the given mapper kind that has at least one host. */
export function defaultUrlForMapperKind(kind: SkinMapper['kind']): string | undefined {
  for (const skin of SKINS) {
    if (skin.mapper.kind !== kind) continue;
    const url = defaultUrlForSkin(skin.id);
    if (url) return url;
  }
  return undefined;
}

/** Desk URL for the Ultra (fantasy402 mapper) family — never a string literal lock. */
export function defaultUrlForUltraMapper(): string | undefined {
  return defaultUrlForMapperKind('fantasy402');
}

export function requireDefaultUrlForUltraMapper(): string {
  const url = defaultUrlForUltraMapper();
  if (!url) {
    throw new Error(
      'No Ultra-mapped skin has hosts[] — declare SKINS[].hosts before using a default domain'
    );
  }
  return url;
}

/** Brand-neutral desk URL env — resolved against SKINS hosts / SkinId mapping. */
export const PARTNER_DOMAIN_ENV = 'PARTNER_DOMAIN';

/**
 * Retired bare-book desk URL env keys — never read.
 * Use PARTNER_DOMAIN or per-out/partner `{PREFIX}DOMAIN` instead.
 */
export const RETIRED_BARE_BOOK_DOMAIN_ENVS = ['FANTASY402_DOMAIN'] as const;

export function isRetiredBareBookDomainEnv(key: string): boolean {
  return (RETIRED_BARE_BOOK_DOMAIN_ENVS as readonly string[]).includes(key);
}

/**
 * Desk URL from env (brand-neutral).
 *   PARTNER_DOMAIN → SKINS Ultra-mapper default (hosts → SkinId)
 * Bare-book DOMAIN env keys in RETIRED_BARE_BOOK_DOMAIN_ENVS are ignored.
 */
export function resolveDeskDomainFromEnv(
  envMap: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): string {
  return envMap[PARTNER_DOMAIN_ENV]?.trim() || requireDefaultUrlForUltraMapper();
}

export function skinOffersLiveProduct(skin: string, product: string): boolean {
  const s = getSkin(skin);
  if (!s) return false;
  const productId = normalizeLiveProductName(product);
  if (!isLiveProductId(productId)) return false;
  return s.offeredLiveProducts.includes(productId);
}

export function listSkins(): readonly (typeof SKINS)[number][] {
  return SKINS;
}

/** Catalog-style allowedProviders list (PLive, EZLive, UltraLive, MagLive). */
export function skinOfferedCatalogNames(skin: string): string[] {
  const s = getSkin(skin);
  if (!s) return [];
  const catalog: Record<LiveProductId, string> = {
    plive: 'PLive',
    ezlive: 'EZLive',
    ultralive: 'UltraLive',
    maglive: 'MagLive',
  };
  return s.offeredLiveProducts.map(id => catalog[id]);
}

/** @deprecated use normalizeLiveProductName — capacity wire names are live products */
export function normalizeSkinName(raw: string | number): string {
  return normalizeLiveProductName(raw);
}
