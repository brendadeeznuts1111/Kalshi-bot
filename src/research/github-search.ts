// @see https://bun.com/docs/runtime/networking/fetch
// @see https://docs.github.com/en/rest/search/search
import { loadSearchCache, saveSearchCache, searchQueryKey } from "./cache.ts";
import { GITHUB_API_ORIGIN, resolveGitHubToken } from "./github-network.ts";
import {
  GitHubCacheMissError,
  GitHubRateLimitError,
  currentRateLimitResetMs,
  isGitHubRateLimitTripped,
  shouldWaitForRateLimitReset,
  tripGitHubRateLimit,
} from "./github-errors.ts";
import { recordCacheStat } from "./github-cache-stats.ts";
import { computeWaitMs } from "./github-rate-limit.ts";

const GITHUB_API_VERSION = "2022-11-28";

type GitHubSearchItemWire = {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  archived: boolean;
  html_url: string;
  default_branch?: string;
  license?: { key?: string; name?: string; spdx_id?: string | null } | null;
};

export type GhSearchRepo = {
  fullName: string;
  description: string | null;
  stargazersCount: number;
  forksCount: number;
  pushedAt: string;
  isArchived: boolean;
  url: string;
  defaultBranch?: string;
  license?: { spdxId?: string | null; name?: string | null; key?: string } | null;
};

export type GitHubSearchResult = {
  items: GhSearchRepo[];
  /** True when results came from cache (304 or stale fallback). */
  fromEtagCache: boolean;
  /** True when served from stale cache because rate limit blocked live API. */
  degraded?: boolean;
};

export function mapGitHubSearchItem(item: GitHubSearchItemWire): GhSearchRepo {
  return {
    fullName: item.full_name,
    description: item.description,
    stargazersCount: item.stargazers_count,
    forksCount: item.forks_count,
    pushedAt: item.pushed_at,
    isArchived: item.archived,
    url: item.html_url,
    defaultBranch: item.default_branch,
    license: item.license
      ? {
          spdxId: item.license.spdx_id ?? null,
          name: item.license.name ?? null,
          key: item.license.key,
        }
      : null,
  };
}

function parseRateLimitHeaders(headers: Headers): {
  reset: number | null;
  remaining: number | null;
  limit: number | null;
} {
  const resetRaw = headers.get("x-ratelimit-reset");
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const limitRaw = headers.get("x-ratelimit-limit");
  const reset = resetRaw ? Number(resetRaw) : null;
  const remaining = remainingRaw ? Number(remainingRaw) : null;
  const limit = limitRaw ? Number(limitRaw) : null;
  return {
    reset: reset !== null && Number.isFinite(reset) ? reset : null,
    remaining: remaining !== null && Number.isFinite(remaining) ? remaining : null,
    limit: limit !== null && Number.isFinite(limit) ? limit : null,
  };
}

async function pauseUntilReset(resetSec: number): Promise<void> {
  const capped = computeWaitMs(resetSec, Date.now(), "search");
  console.error(`[github] search rate limit — waiting ${Math.ceil(capped / 1000)}s (GITHUB_RATE_LIMIT_WAIT=1)`);
  await Bun.sleep(capped);
}

function searchRateLimitError(query: string, resetSec: number | null): GitHubCacheMissError {
  const resetMs = resetSec ? resetSec * 1000 : null;
  return new GitHubCacheMissError(
    `GitHub search rate limit for query: ${query}${resetMs ? ` — reset ${new Date(resetMs).toISOString()}` : ""}`,
    {
      resetAtMs: resetMs,
      source: "search/repositories",
      cacheKind: "search",
      cacheKey: query,
    },
  );
}

function staleSearchCache(query: string, cached: NonNullable<ReturnType<typeof loadSearchCache>>): GitHubSearchResult {
  recordCacheStat("searchDegraded");
  console.error(`[github] rate limit — using stale search cache for: ${query}`);
  return { items: cached.payload, fromEtagCache: true, degraded: true };
}

/** Cache-only search — zero network. Returns null when search_cache has no row. */
export function searchGitHubReposFromCache(query: string): GitHubSearchResult | null {
  const cached = loadSearchCache(searchQueryKey(query));
  if (!cached) return null;
  return { items: cached.payload, fromEtagCache: true };
}

export async function searchGitHubRepos(
  query: string,
  perPage: number,
): Promise<GitHubSearchResult> {
  const key = searchQueryKey(query);
  const cached = loadSearchCache(key);

  if (isGitHubRateLimitTripped()) {
    if (cached) return staleSearchCache(query, cached);
    throw new GitHubCacheMissError(
      `GitHub rate limit active — no cached search results for: ${query}`,
      {
        resetAtMs: currentRateLimitResetMs(),
        source: "search/repositories",
        cacheKind: "search",
        cacheKey: query,
      },
    );
  }

  const token = await resolveGitHubToken();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    Authorization: `Bearer ${token}`,
    "User-Agent": "kalshi-bot-research",
  };
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }

  const url = `${GITHUB_API_ORIGIN}/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}`;

  const res = await fetch(url, { headers });

  if (res.status === 304) {
    if (cached) {
      recordCacheStat("searchEtag");
      return { items: cached.payload, fromEtagCache: true };
    }
    throw new GitHubCacheMissError(
      `GitHub returned 304 Not Modified but no search cache exists for: ${query}`,
      { source: "search/repositories", cacheKind: "search", cacheKey: query },
    );
  }

  if (res.status === 403 || res.status === 429) {
    const { reset, remaining, limit } = parseRateLimitHeaders(res.headers);
    tripGitHubRateLimit(reset, "search/repositories", {
      remaining,
      limit,
      resource: "search",
    });

    if (shouldWaitForRateLimitReset() && typeof reset === "number") {
      await pauseUntilReset(reset);
      return searchGitHubRepos(query, perPage);
    }

    if (cached) return staleSearchCache(query, cached);

    throw searchRateLimitError(query, reset);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub search failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const body = (await res.json()) as { items?: GitHubSearchItemWire[] };
  const items = (body.items ?? []).map(mapGitHubSearchItem);
  saveSearchCache(key, query, res.headers.get("etag"), items);
  return { items, fromEtagCache: false };
}
