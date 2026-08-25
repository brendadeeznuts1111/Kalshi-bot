/**
 * global-code-search.ts — ONE unscoped code_search query per keyword, hits
 * attributed to repos locally by repository.full_name (§127).
 *
 * WHY: the old model ran repo-scoped queries (q="<keyword> repo:A/B") for
 * every keyword x every repo — the same literal keywords re-queried N times
 * (14x for sports-nba, ~73x for price-data) against a 10/min platform limit.
 * Code search hits carry repository.full_name, so a single global query per
 * keyword serves every repo in every dimension: cost = keywords, not
 * keywords x repos. Verified wire shape on 1.4.0 (probe: item.repository
 * .full_name present; KALSHI_ACCESS_KEY -> 398 global hits, so paginate).
 *
 * Cache: in-process Map keyed by query (cross-dimension reuse within one
 * run). Per-repo attributed results still persist through the inspect cache
 * (cache.ts) so already-inspected repos skip everything.
 */
import { githubApiJson } from "./github-api.ts";
import { isGitHubRateLimitError } from "./gh.ts";

export type GlobalCodeHit = { path: string; repo: string };

export type GlobalCodeSearchRow = {
  query: string;
  totalCount: number;
  hits: GlobalCodeHit[];
};

type CodeSearchItemWire = {
  path?: string;
  repository?: { full_name?: string };
};

const PER_PAGE = 100;
/** Cap pages per keyword (rare: a keyword with >400 global hits). */
const MAX_PAGES = 4;
const DEFAULT_CODE_SEARCH_CONCURRENCY = 8;

const cache = new Map<string, GlobalCodeSearchRow>();

/** Reset the in-process global query cache (tests). */
export function resetGlobalCodeSearchCache(): void {
  cache.clear();
}

/** One keyword, unscoped, paginated to MAX_PAGES pages. */
async function fetchOneGlobal(query: string): Promise<GlobalCodeSearchRow> {
  const rows: GlobalCodeHit[] = [];
  let totalCount = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await githubApiJson<{ total_count?: number; items?: CodeSearchItemWire[] }>(
      `search/code?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`
      , { resource: "code_search" },
    );
    totalCount = body.total_count ?? rows.length;
    for (const it of body.items ?? []) {
      const repo = it.repository?.full_name;
      if (repo && it.path) rows.push({ path: it.path, repo });
    }
    if (!body.items?.length || body.items.length < PER_PAGE || totalCount <= page * PER_PAGE) break;
  }
  return { query, totalCount, hits: rows };
}

/**
 * Fetch every keyword ONCE (global, unscoped). In-process cached; the first
 * call for a query does the network, every later call (any repo, any
 * dimension, this run) is a Map hit.
 */
export async function fetchGlobalCodeHits(queries: string[]): Promise<Map<string, GlobalCodeSearchRow>> {
  const out = new Map<string, GlobalCodeSearchRow>();
  const todo = [...new Set(queries)].filter((q) => !cache.has(q));
  const results = await Promise.all(
    todo.map(async (q) => {
      try {
        return await fetchOneGlobal(q);
      } catch (err) {
        if (isGitHubRateLimitError(err)) throw err;
        return { query: q, totalCount: 0, hits: [] as GlobalCodeHit[] };
      }
    }),
  );
  for (const row of results) cache.set(row.query, row);
  for (const q of queries) {
    const row = cache.get(q);
    if (row) out.set(q, row);
  }
  return out;
}

/**
 * Attribute the global hits for a repo to the per-repo CodeSearchHit shape
 * the detectors consume ({ query, totalCount, paths }).
 */
export function attributeCodeHits(
  global: Map<string, GlobalCodeSearchRow>,
  queries: string[],
  fullName: string,
): Array<{ query: string; totalCount: number; paths: string[] }> {
  return queries.map((q) => {
    const row = global.get(q);
    const hits = row?.hits.filter((h) => h.repo === fullName) ?? [];
    return { query: q, totalCount: hits.length, paths: hits.map((h) => h.path) };
  });
}

/** Total code_search calls for a dimension: ONE per keyword (not x repos). */
export function estimateGlobalCodeSearchCalls(queries: string[]): number {
  return new Set(queries).size;
}
