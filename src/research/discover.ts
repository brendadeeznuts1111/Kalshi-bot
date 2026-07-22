// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchConfig } from "./types.ts";
import {
  searchGitHubRepos,
  searchGitHubReposFromCache,
  type GhSearchRepo,
} from "./github-search.ts";
import {
  DEFAULT_GH_SEARCH_LIMIT,
  isUnlicensedSpdx,
  LICENSE_APACHE_2_0,
  LICENSE_BSD_2_CLAUSE,
  LICENSE_BSD_3_CLAUSE,
  LICENSE_ISC,
  LICENSE_MIT,
} from "./constants.ts";
import {
  githubRepoWebUrl,
  isGitHubRepoUrl,
  parseGitHubRepoRef,
} from "./patterns.ts";
import { RESEARCH_ROOT, joinPath } from "./paths.ts";
import {
  loadDimensionsFile,
  resolveDimensionQueries,
  type ResolvedDimensionQueries,
} from "./dimensions.ts";
import { inferDiscoverGateFromSearchQueries } from "./discover-gate.ts";
import { isGitHubRateLimitTripped } from "./github-errors.ts";

export {
  inferDiscoverGateFromSearchQueries,
  parseSearchQueryPopularity,
} from "./discover-gate.ts";

export type { GhSearchRepo } from "./github-search.ts";

export async function loadConfig(): Promise<ResearchConfig> {
  const [dimensions, weights, keywords] = await Promise.all([
    loadDimensionsFile(),
    Bun.file(joinPath(RESEARCH_ROOT, "weights.json")).json(),
    Bun.file(joinPath(RESEARCH_ROOT, "keywords.json")).json(),
  ]);
  return { dimensions, weights, keywords } as ResearchConfig;
}

export function normalizeLicense(raw: GhSearchRepo["license"]): string {
  const normalized = (raw?.spdxId ?? raw?.key ?? raw?.name ?? "").toLowerCase();
  if (normalized.includes("mit")) return LICENSE_MIT;
  if (normalized.includes("apache")) return LICENSE_APACHE_2_0;
  if (normalized.includes("bsd-3")) return LICENSE_BSD_3_CLAUSE;
  if (normalized.includes("bsd-2")) return LICENSE_BSD_2_CLAUSE;
  if (normalized === LICENSE_ISC) return LICENSE_ISC;
  return normalized;
}

export function parseLicense(
  raw: GhSearchRepo["license"],
  preferredLicenses: string[],
): {
  spdxId: string | null;
  name: string | null;
  preferred: boolean;
  unlicensed: boolean;
} {
  const spdxId = (raw?.spdxId ?? raw?.key ?? null) || null;
  // gh search often returns license.key (e.g. "mit") without spdxId — normalizeLicense handles both.
  const name = raw?.name || null;
  const normalized = normalizeLicense(raw);
  const unlicensed = isUnlicensedSpdx(normalized);
  return { spdxId, name, preferred: preferredLicenses.includes(normalized), unlicensed };
}

export type DiscoverGate = {
  minStars: number;
  minForks: number;
  maxAgeMonths: number;
};

/** Append GitHub search qualifiers so the API returns fewer gate rejects. */
export function buildRepoSearchQuery(query: string, gate: DiscoverGate): string {
  const q = query.trim();
  if (!q) return q;
  const parts: string[] = [q];

  if (!/\bstars:/i.test(q) && !/\bforks:/i.test(q)) {
    if (gate.minStars > 0) {
      parts.push(`stars:>=${gate.minStars}`);
    } else if (gate.minForks > 0) {
      parts.push(`forks:>=${gate.minForks}`);
    }
  }

  if (!/\bpushed:/i.test(q)) {
    parts.push(`pushed:>=${gateCutoffIsoDate(gate.maxAgeMonths)}`);
  }

  return parts.join(" ");
}

/**
 * Strip stars:/forks:/pushed: qualifiers for cache coverage matching across
 * discover-gate eras (e.g. stars:>=1 vs broad 0/0).
 */
export function stripRepoSearchQualifiers(query: string): string {
  return query
    .replace(/\bstars:>=?\d+/gi, "")
    .replace(/\bforks:>=?\d+/gi, "")
    .replace(/\bpushed:>=\d{4}-\d{2}-\d{2}/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Minimum bare phrase length for weak coverage (blocks 3-letter needles like "nba"). */
export const MIN_BARE_PHRASE_LEN = 4;

/** Infer discover popularity from cache rows whose stripped form matches dimension bares. */
export function inferDiscoverGateFromCachedQueries(
  bareQueries: string[],
  cachedQueries: string[],
  apply: DiscoverGate,
): DiscoverGate | null {
  const bareSet = new Set(
    bareQueries.map((q) => stripRepoSearchQualifiers(q)).filter(Boolean),
  );
  if (bareSet.size === 0) return null;
  const matched: string[] = [];
  for (const cq of cachedQueries) {
    const n = stripRepoSearchQualifiers(cq);
    if (n && bareSet.has(n)) matched.push(cq);
  }
  return inferDiscoverGateFromSearchQueries(matched, apply);
}

/** Phrases used for weak bare coverage (with/without quote chars). */
export function bareQueryPhrases(bareQuery: string): string[] {
  const withQuotes = stripRepoSearchQualifiers(bareQuery);
  const noQuotes = stripRepoSearchQualifiers(bareQuery.replace(/["']/g, " "));
  return [...new Set([withQuotes, noQuotes].filter((p) => p.length >= MIN_BARE_PHRASE_LEN))];
}

function phraseBoundaryMatch(haystack: string, phrase: string): boolean {
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(phrase, from);
    if (idx < 0) return false;
    const beforeOk = idx === 0 || /\s/.test(haystack[idx - 1]!);
    const afterOk =
      idx + phrase.length === haystack.length ||
      /\s/.test(haystack[idx + phrase.length]!);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

/** True when bare phrase appears as a whitespace-bounded token sequence in stripped queries. */
export function hasBarePhraseInStrippedQueries(
  bareQuery: string,
  strippedQueries: Iterable<string>,
): boolean {
  const phrases = bareQueryPhrases(bareQuery);
  if (phrases.length === 0) return false;
  for (const s of strippedQueries) {
    for (const phrase of phrases) {
      if (phraseBoundaryMatch(s, phrase)) return true;
    }
  }
  return false;
}

/**
 * UTC month-floored cutoff for `pushed:>=YYYY-MM-01`.
 * Floors "now" to the 1st of the month before subtracting maxAgeMonths so
 * search_cache keys stay stable within a calendar month (no daily hash churn).
 */
export function gateCutoffIsoDate(maxAgeMonths: number, nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() - maxAgeMonths;
  const year = Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12; // 0-11
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
}

export type DiscoverResult = {
  candidates: ReturnType<typeof toCandidate>[];
  querySet: ResolvedDimensionQueries;
  searchCache: {
    etagHits: number;
    degradedHits: number;
  };
};

export type DiscoverOptions = {
  /** Use search_cache only — never call GitHub. */
  offline?: boolean;
};

export async function discoverCandidates(
  config: ResearchConfig,
  dimensionId?: string,
  gate?: DiscoverGate,
  options?: DiscoverOptions,
): Promise<DiscoverResult> {
  const seen = new Map<string, ReturnType<typeof toCandidate>>();
  const preferredLicenses = config.weights.license.preferredLicenses;
  const querySet = resolveDimensionQueries(config.dimensions, dimensionId ?? config.dimensions.defaultDimension);
  const searchGate: DiscoverGate = gate ?? config.weights.gate;
  let etagHits = 0;
  let degradedHits = 0;
  let offlineCacheHits = 0;
  const offline = options?.offline === true;

  for (const query of querySet.queries) {
    if (!offline && isGitHubRateLimitTripped()) break;

    const searchQuery = buildRepoSearchQuery(query, searchGate);
    let rows: GhSearchRepo[];
    let fromEtagCache = false;
    let degraded = false;

    if (offline) {
      const cached = searchGitHubReposFromCache(searchQuery);
      if (!cached) continue;
      offlineCacheHits++;
      rows = cached.items;
      fromEtagCache = true;
    } else {
      const result = await searchGitHubRepos(searchQuery, DEFAULT_GH_SEARCH_LIMIT);
      rows = result.items;
      fromEtagCache = result.fromEtagCache;
      degraded = result.degraded === true;
    }

    if (degraded) degradedHits++;
    else if (fromEtagCache) etagHits++;

    for (const row of rows) {
      if (!isGitHubRepoUrl(row.url)) continue;
      const ref = parseGitHubRepoRef(row.url);
      if (!ref) continue;
      if (!seen.has(ref.fullName)) {
        seen.set(ref.fullName, toCandidate(row, preferredLicenses, ref));
      }
      if (seen.size >= querySet.candidateCap) break;
    }
    if (seen.size >= querySet.candidateCap) break;
  }

  if (offline && offlineCacheHits === 0) {
    throw new Error(
      `Offline discover: no search_cache for dimension=${querySet.dimension}. ` +
        `Warm with a live run (omit --offline) or seed search_cache fixtures.`,
    );
  }

  if (etagHits > 0) {
    console.error(
      offline
        ? `Search offline cache: ${offlineCacheHits}/${querySet.queries.length} queries from search_cache`
        : `Search ETag cache: ${etagHits}/${querySet.queries.length} queries returned 304 (zero search quota)`,
    );
  }
  if (degradedHits > 0) {
    console.error(
      `Search degraded cache: ${degradedHits}/${querySet.queries.length} queries used stale results under rate limit`,
    );
  }

  return { candidates: [...seen.values()], querySet, searchCache: { etagHits, degradedHits } };
}

function toCandidate(
  row: GhSearchRepo,
  preferredLicenses: string[],
  ref: NonNullable<ReturnType<typeof parseGitHubRepoRef>>,
) {
  return {
    fullName: ref.fullName,
    owner: ref.owner,
    name: ref.repo,
    htmlUrl: githubRepoWebUrl(ref.owner, ref.repo),
    description: row.description,
    stars: row.stargazersCount,
    forks: row.forksCount,
    pushedAt: row.pushedAt,
    archived: row.isArchived,
    topics: [] as string[],
    defaultBranch: row.defaultBranch ?? "main",
    license: parseLicense(row.license, preferredLicenses),
  };
}
