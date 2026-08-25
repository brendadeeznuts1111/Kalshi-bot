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

// ── code_search window pacing ──────────────────────────────────────────
// Platform limit: 10 calls/min. Fire-and-forget over the whole keyword set
// trips the circuit on call ~11 and serializes 61s waits per call after
// that (§127 lesson). A deliberate token bucket keeps us at 9/min so the
// batch completes in ~4 min instead of grinding per-call.
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 9;
let windowStart = 0;
let callsThisWindow = 0;

/** Reset the pacer (tests). */
export function resetGlobalCodeSearchCache(): void {
  cache.clear();
  windowStart = 0;
  callsThisWindow = 0;
}

/** Budget ONE code_search call; sleeps across the window boundary.
 *  GLOBAL_CODE_SEARCH_NO_PACE=1 disables sleeping (tests with mocked API). */
async function paceCall(): Promise<void> {
  if (Bun.env.GLOBAL_CODE_SEARCH_NO_PACE === "1") return;
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    callsThisWindow = 0;
  }
  if (callsThisWindow >= MAX_CALLS_PER_WINDOW) {
    const waitMs = Math.max(2_000, WINDOW_MS - (now - windowStart) + 2_000);
    console.error(`[global-code-search] pacing — waiting ${Math.round(waitMs / 1000)}s for the code_search window (${MAX_CALLS_PER_WINDOW}/min)`);
    await Bun.sleep(waitMs);
    windowStart = Date.now();
    callsThisWindow = 0;
  }
  callsThisWindow++;
}

const cache = new Map<string, GlobalCodeSearchRow>();

/**
 * One keyword, unscoped, paginated to MAX_PAGES pages.
 * Each page is ONE code_search call — the PACER in fetchGlobalCodeHits
 * budgets them: code_search resets every minute at 10/min, and firing all
 * queries at once trips the circuit and serializes 61s waits per call.
 */
async function fetchOneGlobal(query: string): Promise<GlobalCodeSearchRow> {
  const rows: GlobalCodeHit[] = [];
  let totalCount = 0;
  const pages = await pagedFetch(query, MAX_PAGES);
  for (let i = 0; i < pages.length; i++) {
    const body = pages[i]!;
    totalCount = body.total_count ?? rows.length;
    for (const it of body.items ?? []) {
      const repo = it.repository?.full_name;
      if (repo && it.path) rows.push({ path: it.path, repo });
    }
  }
  return { query, totalCount, hits: rows };
}

/**
 * Fetch pages for one query as INDIVIDUAL call promises so the caller can
 * pace them across 10/min windows. Stops early when a page is partial or
 * total_count is covered.
 */
async function pagedFetch(
  query: string,
  maxPages: number,
): Promise<Array<{ total_count?: number; items?: CodeSearchItemWire[] }>> {
  const out: Array<{ total_count?: number; items?: CodeSearchItemWire[] }> = [];
  let totalCount = 0;
  for (let page = 1; page <= maxPages; page++) {
    await paceCall();
    const body = await githubApiJson<{ total_count?: number; items?: CodeSearchItemWire[] }>(
      `search/code?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`,
      { resource: "code_search" },
    );
    out.push(body);
    totalCount = body.total_count ?? 0;
    const items = body.items ?? [];
    if (items.length < PER_PAGE || totalCount <= page * PER_PAGE) break;
  }
  return out;
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
