// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchConfig } from "./types.ts";
import { searchGitHubRepos, type GhSearchRepo } from "./github-search.ts";
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

export function gateCutoffIsoDate(maxAgeMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - maxAgeMonths);
  return d.toISOString().slice(0, 10);
}

export type DiscoverResult = {
  candidates: ReturnType<typeof toCandidate>[];
  querySet: ResolvedDimensionQueries;
  searchCache: {
    etagHits: number;
    degradedHits: number;
  };
};

export async function discoverCandidates(
  config: ResearchConfig,
  dimensionId?: string,
  gate?: DiscoverGate,
): Promise<DiscoverResult> {
  const seen = new Map<string, ReturnType<typeof toCandidate>>();
  const preferredLicenses = config.weights.license.preferredLicenses;
  const querySet = resolveDimensionQueries(config.dimensions, dimensionId ?? config.dimensions.defaultDimension);
  const searchGate: DiscoverGate = gate ?? config.weights.gate;
  let etagHits = 0;
  let degradedHits = 0;

  for (const query of querySet.queries) {
    const searchQuery = buildRepoSearchQuery(query, searchGate);
    const { items: rows, fromEtagCache, degraded } = await searchGitHubRepos(
      searchQuery,
      DEFAULT_GH_SEARCH_LIMIT,
    );
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

  if (etagHits > 0) {
    console.error(
      `Search ETag cache: ${etagHits}/${querySet.queries.length} queries returned 304 (zero search quota)`,
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
