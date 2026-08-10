/**
 * Weighted evidence model for host → skin discovery.
 *
 * Categories are capped, then summed, then capped at 1.0.
 * Definitive (HOST_TO_SKIN / explicit skinId) locks score to 1.0.
 * Ultra stack markers are intentionally excluded — adapter path owns those.
 *
 * @see docs/PARTNER-FANTASY-ULTRA.md (Unknown host discovery)
 */

import { SKINS, getSkinByHost, type SkinFingerprints, type SkinId } from '../domain/index.ts';

export type EvidenceCategory = 'definitive' | 'endpoint' | 'asset' | 'infrastructure' | 'meta';

/** Max contribution per category (before final 1.0 cap). */
export const CATEGORY_CAPS: Readonly<Record<EvidenceCategory, number>> = {
  definitive: 1.0,
  endpoint: 0.8,
  asset: 0.6,
  infrastructure: 0.5,
  meta: 0.3,
};

export type HostDiscoverDecision =
  'map_immediately' | 'review_required' | 'gather_more' | 'weak' | 'already_mapped';

export function decisionForScore(
  score: number,
  opts?: { fromHostMap?: boolean }
): HostDiscoverDecision {
  if (opts?.fromHostMap) return 'already_mapped';
  if (score >= 0.9) return 'map_immediately';
  if (score >= 0.7) return 'review_required';
  if (score >= 0.4) return 'gather_more';
  return 'weak';
}

export type WeightedEvidenceItem = {
  category: EvidenceCategory;
  weight: number;
  detail: string;
  /** Skin this item supports (omitted for neutral observations). */
  skinId?: SkinId;
};

export type CategoryContribution = {
  category: EvidenceCategory;
  raw: number;
  capped: number;
  max: number;
};

export type SkinWeightedScore = {
  skinId: SkinId;
  score: number;
  decision: HostDiscoverDecision;
  definitive: boolean;
  categories: CategoryContribution[];
  evidence: WeightedEvidenceItem[];
};

export type HostObservations = {
  host: string;
  paths: string[];
  assetUrls: string[];
  title: string | null;
  bodyText: string;
  headers: Record<string, string>;
  dnsNs: string[];
  certSANs: string[];
  /** True when HOST_TO_SKIN already maps this host. */
  mappedSkinId?: SkinId;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort();
}

/** Pathname from absolute or relative URL-ish string. */
export function pathFromUrlish(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('//')) {
      const href = t.startsWith('//') ? `https:${t}` : t;
      return new URL(href).pathname || '/';
    }
  } catch {
    /* fall through */
  }
  if (t.startsWith('/')) {
    const q = t.indexOf('?');
    return q >= 0 ? t.slice(0, q) : t;
  }
  return null;
}

/** Extract paths from HTML attrs + absolute URLs already collected. */
export function extractPathsFromHtml(html: string, storedUrls: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const u of storedUrls) {
    const p = pathFromUrlish(u);
    if (p && p !== '/') paths.add(p);
  }
  const re = /(?:src|href|action)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const p = pathFromUrlish(m[1]!);
    if (p && p !== '/') paths.add(p);
  }
  // Bare path literals in scripts (e.g. "/player-api/…")
  const bare = /["'`](\/(?:[a-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-f]{2})+)["'`]/gi;
  while ((m = bare.exec(html))) {
    const p = pathFromUrlish(m[1]!);
    if (p && p.length > 2 && p !== '/') paths.add(p);
  }
  return [...paths].sort();
}

export function buildHostObservations(input: {
  host: string;
  body: string;
  title: string | null;
  headers: Record<string, string>;
  storedUrls?: readonly string[];
  dnsNs?: readonly string[];
  certSANs?: readonly string[];
  mappedSkinId?: SkinId;
}): HostObservations {
  const stored = input.storedUrls ?? [];
  return {
    host: input.host,
    paths: extractPathsFromHtml(input.body, stored),
    assetUrls: uniqueSorted(stored),
    title: input.title,
    bodyText: input.body,
    headers: input.headers,
    dnsNs: [...(input.dnsNs ?? [])],
    certSANs: [...(input.certSANs ?? [])],
    mappedSkinId: input.mappedSkinId,
  };
}

function haystackLower(obs: HostObservations): string {
  return [
    obs.bodyText,
    obs.title ?? '',
    obs.paths.join('\n'),
    obs.assetUrls.join('\n'),
    Object.entries(obs.headers)
      .map(([k, v]) => `${k}:${v}`)
      .join('\n'),
    obs.dnsNs.join('\n'),
    obs.certSANs.join('\n'),
  ]
    .join('\n')
    .toLowerCase();
}

function matchEndpoint(
  paths: readonly string[],
  haystack: string,
  endpoint: string
): { weight: number; detail: string } | null {
  const ep = endpoint.toLowerCase();
  if (!ep) return null;
  for (const path of paths) {
    const p = path.toLowerCase();
    if (p === ep || p.endsWith(ep) || (ep.endsWith('/') && p.startsWith(ep))) {
      return { weight: 0.8, detail: `endpoint exact ${endpoint} ← ${path}` };
    }
    if (p.includes(ep) || (ep.length >= 6 && p.includes(ep.replace(/^\//, '')))) {
      return { weight: 0.6, detail: `endpoint partial ${endpoint} ← ${path}` };
    }
  }
  // Also allow path token in HTML/JS without being collected as path
  if (ep.length >= 6 && haystack.includes(ep)) {
    return { weight: 0.6, detail: `endpoint in body/assets ${endpoint}` };
  }
  return null;
}

function matchAsset(
  assetUrls: readonly string[],
  haystack: string,
  token: string
): { weight: number; detail: string } | null {
  const t = token.toLowerCase();
  if (!t) return null;
  for (const url of assetUrls) {
    const u = url.toLowerCase();
    if (u.includes(t)) {
      return { weight: 0.5, detail: `asset ${token} ← ${url}` };
    }
  }
  if (haystack.includes(t)) {
    // Similar / body-only (e.g. form-signin class)
    return { weight: 0.3, detail: `asset-like token ${token} in page` };
  }
  return null;
}

function detectCdnTokens(obs: HostObservations): string[] {
  const found = new Set<string>();
  const nsBlob = obs.dnsNs.join(' ').toLowerCase();
  const hdr = JSON.stringify(obs.headers).toLowerCase();
  if (nsBlob.includes('cloudflare') || 'cf-ray' in obs.headers || hdr.includes('cloudflare')) {
    found.add('cloudflare');
  }
  if (nsBlob.includes('cloudns')) found.add('cloudns');
  if (nsBlob.includes('fastly') || hdr.includes('fastly')) found.add('fastly');
  return [...found];
}

function matchInfra(
  obs: HostObservations,
  fp: SkinFingerprints | undefined,
  skinId: SkinId
): WeightedEvidenceItem[] {
  const out: WeightedEvidenceItem[] = [];
  const nsBlob = obs.dnsNs.join(' ').toLowerCase();
  for (const token of fp?.infra?.nsTokens ?? []) {
    const t = token.toLowerCase();
    if (t && nsBlob.includes(t)) {
      out.push({
        category: 'infrastructure',
        weight: 0.4,
        detail: `NS token ${token}`,
        skinId,
      });
    }
  }
  const cdnSeen = detectCdnTokens(obs);
  for (const token of fp?.infra?.cdnTokens ?? []) {
    const t = token.toLowerCase();
    if (t && cdnSeen.includes(t)) {
      out.push({
        category: 'infrastructure',
        weight: 0.3,
        detail: `CDN family ${token}`,
        skinId,
      });
    }
  }
  // TLS SAN overlaps a host already mapped to this skin
  for (const san of obs.certSANs) {
    const mapped = getSkinByHost(san);
    if (mapped === skinId) {
      out.push({
        category: 'infrastructure',
        weight: 0.4,
        detail: `TLS SAN ${san} → HOST_TO_SKIN ${skinId}`,
        skinId,
      });
    }
  }
  return out;
}

function matchMeta(
  obs: HostObservations,
  skinId: SkinId,
  aliases: readonly string[]
): WeightedEvidenceItem[] {
  const out: WeightedEvidenceItem[] = [];
  const title = (obs.title ?? '').toLowerCase();
  const body = obs.bodyText.toLowerCase();
  const tokens = new Set<string>([skinId, ...aliases.map(a => a.toLowerCase())]);
  for (const token of tokens) {
    // Short tokens (ace, sts, 1bv) collide in HTML noise — title-only, length ≥ 4 for body.
    if (token.length < 3) continue;
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (title && re.test(title)) {
      out.push({
        category: 'meta',
        weight: 0.15,
        detail: `title brand token ${token}`,
        skinId,
      });
    } else if (token.length >= 4 && re.test(body)) {
      out.push({
        category: 'meta',
        weight: 0.1,
        detail: `body brand token ${token}`,
        skinId,
      });
    }
  }
  return out;
}

/** Cap category sums then sum; definitive locks to 1.0. */
export function scoreFromEvidence(evidence: readonly WeightedEvidenceItem[]): {
  score: number;
  definitive: boolean;
  categories: CategoryContribution[];
} {
  const definitive = evidence.some(e => e.category === 'definitive');
  if (definitive) {
    return {
      score: 1,
      definitive: true,
      categories: [
        {
          category: 'definitive',
          raw: 1,
          capped: 1,
          max: CATEGORY_CAPS.definitive,
        },
      ],
    };
  }

  const rawByCat = new Map<EvidenceCategory, number>();
  for (const e of evidence) {
    if (e.category === 'definitive') continue;
    rawByCat.set(e.category, (rawByCat.get(e.category) ?? 0) + e.weight);
  }

  const categories: CategoryContribution[] = [];
  let total = 0;
  for (const category of ['endpoint', 'asset', 'infrastructure', 'meta'] as const) {
    const raw = rawByCat.get(category) ?? 0;
    if (raw <= 0) continue;
    const max = CATEGORY_CAPS[category];
    const capped = Math.min(raw, max);
    categories.push({ category, raw: round2(raw), capped: round2(capped), max });
    total += capped;
  }
  return {
    score: round2(Math.min(1, total)),
    definitive: false,
    categories,
  };
}

/** Score one skin against observations. */
export function scoreSkinObservations(obs: HostObservations, skinId: SkinId): SkinWeightedScore {
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) {
    return {
      skinId,
      score: 0,
      decision: 'weak',
      definitive: false,
      categories: [],
      evidence: [],
    };
  }

  if (obs.mappedSkinId === skinId) {
    const evidence: WeightedEvidenceItem[] = [
      {
        category: 'definitive',
        weight: 1,
        detail: `HOST_TO_SKIN[${obs.host}] = ${skinId}`,
        skinId,
      },
    ];
    return {
      skinId,
      score: 1,
      decision: 'already_mapped',
      definitive: true,
      categories: [
        {
          category: 'definitive',
          raw: 1,
          capped: 1,
          max: CATEGORY_CAPS.definitive,
        },
      ],
      evidence,
    };
  }

  const fp = skin.fingerprints;
  const haystack = haystackLower(obs);
  const evidence: WeightedEvidenceItem[] = [];

  for (const ep of fp?.endpoints ?? []) {
    const hit = matchEndpoint(obs.paths, haystack, ep);
    if (hit) {
      evidence.push({
        category: 'endpoint',
        weight: hit.weight,
        detail: hit.detail,
        skinId,
      });
    }
  }
  for (const asset of fp?.assets ?? []) {
    const hit = matchAsset(obs.assetUrls, haystack, asset);
    if (hit) {
      evidence.push({
        category: 'asset',
        weight: hit.weight,
        detail: hit.detail,
        skinId,
      });
    }
  }
  evidence.push(...matchInfra(obs, fp, skinId));
  evidence.push(...matchMeta(obs, skinId, skin.aliases));

  const { score, definitive, categories } = scoreFromEvidence(evidence);
  return {
    skinId,
    score,
    decision: decisionForScore(score),
    definitive,
    categories,
    evidence,
  };
}

/** Score all skins; highest score wins (ties → lexicographic skinId). */
export function scoreHostAgainstSkins(obs: HostObservations): {
  best: SkinWeightedScore | null;
  all: SkinWeightedScore[];
} {
  if (obs.mappedSkinId) {
    const mapped = scoreSkinObservations(obs, obs.mappedSkinId);
    return { best: mapped, all: [mapped] };
  }

  const all = SKINS.map(s => scoreSkinObservations(obs, s.id)).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.skinId.localeCompare(b.skinId);
  });
  const best = all.find(s => s.score > 0) ?? null;
  return { best, all };
}
