/**
 * Host → skin discovery (suggest only — never mutates HOST_TO_SKIN).
 *
 * Desk plane (`src/domain/`) — not seat-partner.
 * Confidence = capped-category weighted evidence vs SKINS[].fingerprints
 * (endpoints · assets · infrastructure · meta). HOST_TO_SKIN is definitive (1.0).
 * Suggested adapter follows SKINS[].mapper only (not Ultra stack scoring).
 */

import { $ } from "bun";
import {
  SKIN_IDS,
  SKINS,
  apexHost,
  getSkin,
  getSkinByHost,
  listActiveSkins,
  normalizeHost,
  urlForHost,
  type SkinId,
} from './skins.ts';
import {
  buildHostObservations,
  decisionForScore,
  scoreHostAgainstSkins,
  type CategoryContribution,
  type EvidenceCategory,
  type HostDiscoverDecision,
  type SkinWeightedScore,
  type WeightedEvidenceItem,
} from './host-weighted-score.ts';

/**
 * Desk mapper adapter token for discovery reports.
 * Same string union as partner `MapperAdapterId` (fantasy-ultra | kalshi | unmapped).
 */
export type DeskAdapterId = 'fantasy-ultra' | 'kalshi' | 'unmapped';

export type HostDiscoverTarget = {
  url: string;
  label: string;
  skinId: SkinId;
  host: string;
};

export type SuggestedSkinId = SkinId | 'unknown';

export type HostDiscoverEvidence = {
  kind: EvidenceCategory | 'har' | 'body' | 'header' | 'title' | 'asset_host' | 'tls_san' | 'dns';
  detail: string;
  weight: number;
  skinId?: SkinId;
};

/** Capped-category weight breakdown (`--weigh`). */
export type HostDiscoverWeigh = {
  model: 'capped-category-v1';
  /** Winning skin score (= report.confidence). */
  score: number;
  decision: HostDiscoverDecision;
  definitive: boolean;
  /** Category raw/capped for the winning skin. */
  categories: CategoryContribution[];
  /** All skins with score > 0, highest first. */
  skinScores: Array<{ skinId: SkinId; score: number; decision: HostDiscoverDecision }>;
  evidence: WeightedEvidenceItem[];
  note: string | null;
};

export type HostDiscoverReport = {
  url: string;
  host: string;
  finalUrl: string | null;
  status: number | null;
  suggestedSkinId: SuggestedSkinId;
  suggestedAdapterId: DeskAdapterId;
  /** Weighted evidence score in [0, 1]. */
  confidence: number;
  /** Decision threshold label for confidence. */
  decision: HostDiscoverDecision;
  evidence: HostDiscoverEvidence[];
  nextQuestions: string[];
  headers: Record<string, string>;
  title: string | null;
  assetHosts: string[];
  certSANs: string[];
  dns: {
    cname: string[];
    ns: string[];
    txt: string[];
    mx: string[];
  };
  /** True when suggestion came solely from HOST_TO_SKIN. */
  fromHostMap: boolean;
  /** Absolute + resolved URLs collected from HTML/assets/HAR. */
  storedUrls: string[];
  /** Where URL inventory was written (if persisted). */
  urlStorePath: string | null;
  /** Optional HAR path used for this report. */
  harPath: string | null;
  /** Weight / score breakdown (always populated; emphasize with CLI `--weigh`). */
  weigh: HostDiscoverWeigh;
};

export type FingerprintRule = {
  id: string;
  /** Match against lowercase haystack (body + headers + assets joined). */
  pattern: RegExp;
  weight: number;
  suggestSkin?: SuggestedSkinId;
  detail: string;
};

/**
 * Every apex host on **active** SKINS (www. aliases collapsed).
 * Used by `--all` / `--compare` — inactive placeholders with empty hosts[] are skipped.
 */
export function listMappedDiscoverHosts(): HostDiscoverTarget[] {
  const seen = new Set<string>();
  const out: HostDiscoverTarget[] = [];
  for (const skin of listActiveSkins()) {
    for (const raw of skin.hosts) {
      const apex = apexHost(raw);
      if (!apex || seen.has(apex)) continue;
      seen.add(apex);
      out.push({
        url: urlForHost(apex),
        host: apex,
        skinId: skin.id,
        label: `${skin.id}:${apex}`,
      });
    }
  }
  return out;
}

/** @deprecated Prefer listMappedDiscoverHosts() — kept for callers that expect a const list. */
export const HOST_DISCOVER_BASELINES: readonly HostDiscoverTarget[] = listMappedDiscoverHosts();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Adapter for a mapped/suggested skin — from SKINS[].mapper only.
 * Desk-plane mirror of partner adapterBindingForSkin (no out-identity import).
 */
export function adapterIdForMappedSkin(skinId: SkinId, providerHint?: string): DeskAdapterId {
  const skin = getSkin(skinId);
  if (!skin) return 'unmapped';
  if (skin.mapper.kind === 'fantasy402') return 'fantasy-ultra';
  const hint = (providerHint ?? '').trim().toLowerCase();
  if (hint === 'kalshi') return 'kalshi';
  return 'unmapped';
}

/**
 * Brand / host-label / alias tokens derived from SKINS.
 * Suggests SkinId only — never Ultra/adapter stack markers.
 */
export function listSkinBrandFingerprintRules(): FingerprintRule[] {
  const rules: FingerprintRule[] = [];
  const seen = new Set<string>();
  for (const skin of SKINS) {
    const tokens = new Set<string>();
    tokens.add(skin.id);
    for (const a of skin.aliases) tokens.add(a.toLowerCase());
    for (const h of skin.hosts) {
      const apex = normalizeHost(h).replace(/^www\./, '');
      const label = apex.split('.')[0]?.toLowerCase();
      if (label && label.length >= 3) tokens.add(label);
    }
    for (const token of tokens) {
      const key = `${skin.id}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const wordish = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(token);
      rules.push({
        id: `brand-${skin.id}-${token.replace(/[^a-z0-9-]+/gi, '_')}`,
        pattern: wordish
          ? new RegExp(`\\b${escapeRe(token)}\\b`, 'i')
          : new RegExp(escapeRe(token), 'i'),
        weight: token === skin.id ? 3 : 2,
        suggestSkin: skin.id,
        detail: `Brand/host token ${token} → skin ${skin.id}`,
      });
    }
  }
  return rules;
}

/** Fingerprint rules for host→skin (SKINS brand tokens only). */
export function listPublicFingerprintRules(): FingerprintRule[] {
  return listSkinBrandFingerprintRules();
}

/** Snapshot for imports that expect a const array (derived from SKINS at load). */
export const HOST_FINGERPRINT_RULES: readonly FingerprintRule[] = listPublicFingerprintRules();

const ABS_URL_RE = /https?:\/\/[^\s"'<>)\\]+/g;

export type DiscoverHostOptions = {
  fetchImpl?: typeof fetch;
  /** Skip live TLS/DNS probes (tests / offline). */
  skipNetworkExtras?: boolean;
  /** Path to Chrome HAR (session capture) — URL inventory; same-apex URLs may score. */
  harPath?: string;
  /** Inline HAR JSON (tests). */
  harJson?: unknown;
  /** Persist URL inventory under docs/artifacts/host-discover/ (default true). */
  persistUrls?: boolean;
  /** Override artifact directory. */
  artifactDir?: string;
  /** Injected HTTP result for unit tests (skips fetch). */
  fixture?: {
    status: number;
    finalUrl: string;
    headers: Record<string, string>;
    body: string;
  };
};

function cleanAbsUrl(raw: string): string {
  return raw.replace(/[.,;]+$/, '').trim();
}

/** Extract absolute http(s) URLs from arbitrary text. */
export function extractAbsoluteUrls(text: string): string[] {
  const out = new Set<string>();
  const m = text.match(ABS_URL_RE) ?? [];
  for (const u of m) {
    const c = cleanAbsUrl(u);
    if (c.startsWith('http://') || c.startsWith('https://')) out.add(c);
  }
  return [...out].sort();
}

function resolveMaybeUrl(raw: string, base: string): string | null {
  const t = raw.trim();
  if (!t || t.startsWith('data:') || t.startsWith('javascript:')) return null;
  try {
    if (t.startsWith('//')) return `https:${t}`;
    return new URL(t, base).href;
  } catch {
    return null;
  }
}

/** Collect page src/href/action URLs resolved against base. */
export function collectHtmlUrls(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /(?:src|href|action)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const abs = resolveMaybeUrl(m[1]!, baseUrl);
    if (abs) out.add(abs);
  }
  for (const u of extractAbsoluteUrls(html)) out.add(u);
  return [...out].sort();
}

type HarEntryLite = {
  request?: { url?: string; postData?: { text?: string } };
  response?: { content?: { text?: string; encoding?: string } };
};

/** Pull request/response URLs + body absolute URLs from a Chrome HAR. */
export function extractUrlsFromHar(har: unknown): {
  urls: string[];
  haystack: string;
  entryCount: number;
} {
  const doc = har as { log?: { entries?: HarEntryLite[] }; entries?: HarEntryLite[] };
  const entries = doc.log?.entries ?? doc.entries ?? [];
  const urls = new Set<string>();
  const chunks: string[] = [];
  for (const e of entries) {
    const reqUrl = e.request?.url?.trim();
    if (reqUrl) {
      urls.add(reqUrl);
      chunks.push(reqUrl);
    }
    const post = e.request?.postData?.text;
    if (post) {
      chunks.push(post);
      for (const u of extractAbsoluteUrls(post)) urls.add(u);
    }
    let resp = e.response?.content?.text;
    if (resp && e.response?.content?.encoding === 'base64') {
      try {
        resp = Buffer.from(resp, 'base64').toString('utf8');
      } catch {
        /* keep raw */
      }
    }
    if (resp) {
      chunks.push(resp.slice(0, 500_000));
      for (const u of extractAbsoluteUrls(resp)) urls.add(u);
    }
  }
  return {
    urls: [...urls].sort(),
    haystack: chunks.join('\n'),
    entryCount: entries.length,
  };
}

export const DEFAULT_HOST_DISCOVER_ARTIFACT_DIR = 'docs/artifacts/host-discover';

/** Persist URL inventory next to other host-discover artifacts. */
export async function persistHostDiscoverUrls(input: {
  host: string;
  report: HostDiscoverReport;
  urls: readonly string[];
  artifactDir?: string;
}): Promise<string> {
  const dir = input.artifactDir ?? DEFAULT_HOST_DISCOVER_ARTIFACT_DIR;
  const safe = input.host.replace(/[^a-zA-Z0-9.-]+/g, '_');
  const path = `${dir}/${safe}-urls.json`;
  const payload = {
    fetchedAt: new Date().toISOString(),
    host: input.host,
    url: input.report.url,
    suggestedSkinId: input.report.suggestedSkinId,
    suggestedAdapterId: input.report.suggestedAdapterId,
    confidence: input.report.confidence,
    harPath: input.report.harPath,
    urlCount: input.urls.length,
    urls: [...input.urls].sort(),
  };
  await Bun.write(path, JSON.stringify(payload, null, 2));
  return path;
}

function ensureUrl(urlOrHost: string): string {
  const t = urlOrHost.trim();
  if (!t) throw new Error('url/host required');
  if (t.includes('://')) return t;
  return `https://${t}`;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m?.[1]?.trim() || null;
}

function extractAssetHosts(html: string): string[] {
  const hosts = new Set<string>();
  const re = /(?:src|href)=["'](https?:\/\/[^"']+|\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const raw = m[1]!.startsWith('//') ? `https:${m[1]}` : m[1]!;
      const h = new URL(raw).hostname.toLowerCase();
      if (h) hosts.add(h);
    } catch {
      /* ignore */
    }
  }
  return [...hosts].sort();
}

function toReportEvidence(items: readonly WeightedEvidenceItem[]): HostDiscoverEvidence[] {
  return items.map(e => ({
    kind: e.category,
    detail: e.detail,
    weight: e.weight,
    ...(e.skinId ? { skinId: e.skinId } : {}),
  }));
}

function buildWeighFromScores(input: {
  best: SkinWeightedScore | null;
  all: SkinWeightedScore[];
  fromHostMap: boolean;
  note: string | null;
}): HostDiscoverWeigh {
  const best = input.best;
  const score = best?.score ?? 0;
  return {
    model: 'capped-category-v1',
    score,
    decision: best?.decision ?? decisionForScore(score, { fromHostMap: input.fromHostMap }),
    definitive: best?.definitive ?? false,
    categories: best?.categories ?? [],
    skinScores: input.all
      .filter(s => s.score > 0)
      .map(s => ({ skinId: s.skinId, score: s.score, decision: s.decision })),
    evidence: best?.evidence ?? [],
    note: input.note,
  };
}

function extractDnsSansFromText(text: string): string[] {
  const sans: string[] = [];
  const dnsRe = /DNS:([^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = dnsRe.exec(text))) {
    sans.push(m[1]!.toLowerCase());
  }
  return sans;
}

/** Decode leaf cert SANs via `openssl s_client` → `openssl x509` (PEM alone has no DNS: lines). */
async function probeTlsSans(host: string): Promise<string[]> {
  try {
    const pemBundle = (
      await $`openssl s_client -connect ${host}:443 -servername ${host} -showcerts < ${Buffer.alloc(0)}`.nothrow().quiet()
    ).stdout.toString();
    const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pemBundle)?.[0];
    if (!pem) return [];

    const decode = async (args: string[]): Promise<string[]> => {
      const { stdout } = await $`openssl x509 ${args} < ${Buffer.from(pem)}`.nothrow().quiet();
      return extractDnsSansFromText(stdout.toString());
    };

    const fromExt = await decode(['-noout', '-ext', 'subjectAltName']);
    if (fromExt.length > 0) return [...new Set(fromExt)].sort();
    const fromText = await decode(['-noout', '-text']);
    return [...new Set(fromText)].sort();
  } catch {
    return [];
  }
}

/** True when url hostname is the apex or a subdomain of it. */
export function urlMatchesApex(url: string, apex: string): boolean {
  const a = apex.replace(/^www\./, '').toLowerCase();
  if (!a) return false;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h === a || h.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

async function probeDns(host: string): Promise<HostDiscoverReport['dns']> {
  const empty = {
    cname: [] as string[],
    ns: [] as string[],
    txt: [] as string[],
    mx: [] as string[],
  };
  try {
    const dig = async (type: string): Promise<string[]> => {
      const { stdout } = await $`dig +short ${type} ${host}`.nothrow().quiet();
      return stdout
        .toString()
        .split('\n')
        .map(l => l.trim().replace(/\.$/, ''))
        .filter(Boolean);
    };
    return {
      cname: await dig('CNAME'),
      ns: await dig('NS'),
      txt: await dig('TXT'),
      mx: await dig('MX'),
    };
  } catch {
    return empty;
  }
}

function buildNextQuestions(report: {
  suggestedSkinId: SuggestedSkinId;
  suggestedAdapterId: DeskAdapterId;
  fromHostMap: boolean;
  confidence: number;
  decision: HostDiscoverDecision;
}): string[] {
  const q: string[] = [];
  if (report.fromHostMap) {
    q.push('Host already in HOST_TO_SKIN — no mapping change needed');
    return q;
  }
  if (report.suggestedSkinId === 'unknown') {
    q.push(`Is this a new SkinId or an alias of ${SKIN_IDS.join('/')}?`);
    q.push('Which live products does this desk offer?');
  } else {
    q.push(
      `Confirm adding host to SKINS[${report.suggestedSkinId}].hosts before write-path accepts it`
    );
    q.push(
      `Adapter follows SKINS[${report.suggestedSkinId}].mapper → ${report.suggestedAdapterId}`
    );
  }
  switch (report.decision) {
    case 'map_immediately':
      q.push('Score ≥ 0.90 — strong enough to map after a quick human confirm');
      break;
    case 'review_required':
      q.push('Score 0.70–0.89 — capture HAR / TLS SANs before mapping');
      break;
    case 'gather_more':
      q.push('Score 0.40–0.69 — gather more evidence (DNS NS, deep JS, authenticated HTML)');
      break;
    case 'weak':
      q.push('Score < 0.40 — ignore for mapping; keep URL inventory for later');
      break;
    default:
      break;
  }
  q.push('Cross-check DNS/TLS SANs before treating lookalike hosts as the same desk');
  return q;
}

/**
 * Score a host from already-fetched HTML/headers (unit-test friendly).
 */
export function scoreHostDiscovery(input: {
  url: string;
  host: string;
  finalUrl: string | null;
  status: number | null;
  headers: Record<string, string>;
  body: string;
  certSANs?: string[];
  dns?: HostDiscoverReport['dns'];
  /**
   * @deprecated Do not pass HAR bodies here — third-party HAR text pollutes scoring.
   * Kept for tests that intentionally inject extra page text.
   */
  extraHaystack?: string;
  /** HAR present — URL inventory note only (not Ultra→skin scoring). */
  harMode?: boolean;
  /** Full URL inventory (page + HAR); written to report / artifacts. */
  storedUrls?: string[];
  /** URLs used for fingerprint matching (defaults to storedUrls; exclude foreign HAR). */
  scoreUrls?: string[];
  harPath?: string | null;
  urlStorePath?: string | null;
}): HostDiscoverReport {
  const emptyExtras = {
    storedUrls: input.storedUrls ?? [],
    urlStorePath: input.urlStorePath ?? null,
    harPath: input.harPath ?? null,
  };

  const title = extractTitle(input.body);
  const assetHosts = extractAssetHosts(input.body);
  const dns = input.dns ?? { cname: [], ns: [], txt: [], mx: [] };
  const certSANs = input.certSANs ?? [];
  const mapped = getSkinByHost(input.host) ?? getSkinByHost(input.url);

  const obs = buildHostObservations({
    host: input.host,
    // Page HTML only (+ optional test haystack). Never merge raw HAR bodies.
    body: [input.body, input.extraHaystack ?? ''].filter(Boolean).join('\n'),
    title,
    headers: input.headers,
    storedUrls: input.scoreUrls ?? input.storedUrls ?? [],
    dnsNs: dns.ns,
    certSANs,
    mappedSkinId: mapped,
  });

  const { best, all } = scoreHostAgainstSkins(obs);

  const fromHostMap = Boolean(mapped);
  const confidence = best?.score ?? 0;
  const decision = best?.decision ?? decisionForScore(confidence, { fromHostMap });
  // Weak scores stay unknown — do not suggest a skin on flimsy evidence.
  const suggestedSkinId: SuggestedSkinId =
    fromHostMap && mapped ? mapped : best && best.score >= 0.4 ? best.skinId : 'unknown';
  const suggestedAdapterId =
    suggestedSkinId === 'unknown' ? 'unmapped' : adapterIdForMappedSkin(suggestedSkinId);

  const evidence: HostDiscoverEvidence[] = toReportEvidence(best?.evidence ?? []);
  if (input.harMode) {
    evidence.push({
      kind: 'har',
      detail: `HAR URL inventory only (${input.harPath ?? 'inline'}) — not used for skin scoring`,
      weight: 0,
    });
  }

  const note = fromHostMap
    ? 'definitive HOST_TO_SKIN → score 1.0'
    : best
      ? `capped-category-v1 → ${best.skinId} @ ${confidence}`
      : 'no fingerprint matches';

  const sortedEvidence = evidence.sort((a, b) => b.weight - a.weight);

  return {
    url: input.url,
    host: input.host,
    finalUrl: input.finalUrl,
    status: input.status,
    suggestedSkinId,
    suggestedAdapterId,
    confidence,
    decision,
    evidence: sortedEvidence,
    nextQuestions: buildNextQuestions({
      suggestedSkinId,
      suggestedAdapterId,
      fromHostMap,
      confidence,
      decision,
    }),
    headers: input.headers,
    title,
    assetHosts,
    certSANs,
    dns,
    fromHostMap,
    weigh: buildWeighFromScores({ best, all, fromHostMap, note }),
    ...emptyExtras,
  };
}

/** Live discover (fetch + optional TLS/DNS + HAR + URL store). */
export async function discoverHost(
  urlOrHost: string,
  options: DiscoverHostOptions = {}
): Promise<HostDiscoverReport> {
  const url = ensureUrl(urlOrHost);
  const host = normalizeHost(url);
  const fetchImpl = options.fetchImpl ?? fetch;
  const persist = options.persistUrls !== false;

  let status: number | null = null;
  let finalUrl: string | null = null;
  let headers: Record<string, string> = {};
  let body = '';

  if (options.fixture) {
    status = options.fixture.status;
    finalUrl = options.fixture.finalUrl;
    headers = options.fixture.headers;
    body = options.fixture.body;
  } else {
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'FactoryWager-host-discover/1.0 (+https://factory-wager.com)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      status = res.status;
      finalUrl = res.url;
      headers = headerRecord(res.headers);
      body = await res.text();
    } catch {
      status = null;
      body = '';
    }
  }

  const pageBase = finalUrl ?? url;
  const stored = new Set<string>(collectHtmlUrls(body, pageBase));

  // Fetch same-origin / CDN .js/.css linked from the page for deeper URL mining
  if (!options.fixture || options.harPath || options.harJson) {
    const assetCandidates = [...stored].filter(
      u => /\.(js|css)(\?|$)/i.test(u) || u.includes('manifest.webmanifest')
    );
    for (const assetUrl of assetCandidates.slice(0, 20)) {
      try {
        const ar = await fetchImpl(assetUrl, {
          redirect: 'follow',
          headers: {
            'user-agent': 'FactoryWager-host-discover/1.0 (+https://factory-wager.com)',
          },
        });
        if (!ar.ok) continue;
        const text = await ar.text();
        for (const u of extractAbsoluteUrls(text)) stored.add(u);
        // resolve path-like from manifest
        if (assetUrl.includes('manifest')) {
          try {
            const man = JSON.parse(text) as {
              start_url?: string;
              icons?: Array<{ src?: string }>;
            };
            if (man.start_url) {
              const a = resolveMaybeUrl(man.start_url, pageBase);
              if (a) stored.add(a);
            }
            for (const ic of man.icons ?? []) {
              if (ic.src) {
                const a = resolveMaybeUrl(ic.src, pageBase);
                if (a) stored.add(a);
              }
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* skip asset */
      }
    }
  }

  const pageStoredUrls = [...stored];
  let harPath: string | null = options.harPath ?? null;
  let harUrls: string[] = [];
  if (options.harJson != null || options.harPath) {
    let harDoc: unknown = options.harJson;
    if (harDoc == null && options.harPath) {
      harDoc = await Bun.file(options.harPath).json();
    }
    const extracted = extractUrlsFromHar(harDoc);
    harUrls = extracted.urls;
    for (const u of harUrls) stored.add(u);
  }

  let certSANs: string[] = [];
  let dns: HostDiscoverReport['dns'] = {
    cname: [],
    ns: [],
    txt: [],
    mx: [],
  };
  if (!options.skipNetworkExtras && !options.fixture) {
    // TLS needs the leaf host (www may have its own cert); DNS NS lives on apex.
    const leafHost = normalizeHost(finalUrl ?? url) || host;
    const dnsHost = apexHost(leafHost) || leafHost;
    [certSANs, dns] = await Promise.all([probeTlsSans(leafHost), probeDns(dnsHost)]);
  }

  const storedUrls = [...stored].sort();
  const apex = apexHost(host) || host.replace(/^www\./, '');
  // Score page URLs + same-apex HAR URLs only — never foreign HAR bodies/hosts.
  const scoreUrls = [
    ...pageStoredUrls,
    ...harUrls.filter(u => urlMatchesApex(u, apex)),
  ].sort();
  const report = scoreHostDiscovery({
    url,
    host,
    finalUrl,
    status,
    headers,
    body,
    certSANs,
    dns,
    harMode: Boolean(harPath || options.harJson),
    storedUrls,
    scoreUrls,
    harPath,
  });

  if (status == null && !options.fixture) {
    report.evidence.unshift({
      kind: 'body',
      detail: 'HTTP fetch failed or returned no status',
      weight: 0,
    });
    report.nextQuestions.unshift('Check DNS / TLS / network access to host');
  }

  if (persist && storedUrls.length > 0) {
    try {
      report.urlStorePath = await persistHostDiscoverUrls({
        host,
        report,
        urls: storedUrls,
        artifactDir: options.artifactDir,
      });
    } catch (err) {
      report.evidence.push({
        kind: 'body',
        detail: `URL persist failed: ${String(err)}`,
        weight: 0,
      });
    }
  }

  return report;
}

export function formatHostDiscoverText(
  report: HostDiscoverReport,
  options?: { weigh?: boolean }
): string {
  const lines: string[] = [];
  lines.push(`host-discover  ${report.host}`);
  lines.push(`  url            ${report.url}`);
  if (report.finalUrl) lines.push(`  finalUrl       ${report.finalUrl}`);
  lines.push(`  status         ${report.status ?? 'n/a'}`);
  lines.push(`  suggestedSkin  ${report.suggestedSkinId}`);
  lines.push(`  suggestedAdapter ${report.suggestedAdapterId}`);
  lines.push(`  confidence     ${report.confidence}`);
  lines.push(`  decision       ${report.decision}`);
  lines.push(`  storedUrls     ${report.storedUrls.length}`);
  if (report.urlStorePath) lines.push(`  urlStore       ${report.urlStorePath}`);
  if (report.harPath) lines.push(`  har            ${report.harPath}`);
  lines.push(`  fromHostMap    ${report.fromHostMap}`);
  if (report.title) lines.push(`  title          ${report.title}`);
  if (options?.weigh && report.weigh) {
    const w = report.weigh;
    lines.push('  weigh:');
    lines.push(`    model         ${w.model}`);
    lines.push(`    score         ${w.score}  (${w.decision})`);
    if (w.note) lines.push(`    note          ${w.note}`);
    if (w.categories.length) {
      lines.push(
        `    categories    ${w.categories.map(c => `${c.category}=${c.capped}/${c.max} (raw ${c.raw})`).join(', ')}`
      );
    }
    if (w.skinScores.length) {
      lines.push(`    skinScores    ${w.skinScores.map(s => `${s.skinId}=${s.score}`).join(', ')}`);
    } else {
      lines.push('    skinScores    (none)');
    }
  }
  lines.push('  evidence:');
  for (const e of report.evidence.slice(0, 15)) {
    lines.push(`    [${e.weight}] ${e.kind}: ${e.detail}`);
  }
  if (report.assetHosts.length) {
    lines.push(`  assetHosts     ${report.assetHosts.slice(0, 8).join(', ')}`);
  }
  if (report.certSANs.length) {
    lines.push(`  certSANs       ${report.certSANs.join(', ')}`);
  }
  lines.push('  next:');
  for (const q of report.nextQuestions) {
    lines.push(`    · ${q}`);
  }
  lines.push('  (suggest only — confirm before editing SKINS[].hosts)');
  return lines.join('\n');
}
