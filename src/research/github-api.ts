// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
// @see https://bun.com/docs/runtime/utils#bun-sleep
// @see https://docs.github.com/en/rest
/**
 * GitHub REST via Bun.fetch — shared connection pool with discover search.
 * Auth token from env or `gh auth token`; rate-limit trips reuse github-errors.
 */
import { DEFAULT_GH_RETRIES } from "./constants.ts";
import { GITHUB_API_ORIGIN, resolveGitHubToken } from "./github-network.ts";
import {
  assertGitHubRateBudget,
  GitHubRateLimitError,
  shouldWaitForRateLimitReset,
  tripGitHubRateLimit,
} from "./github-errors.ts";
import {
  computeWaitMs,
  readGitHubRateLimit,
  type GitHubRateLimitResource,
  type GitHubRateLimitSnapshot,
} from "./github-rate-limit.ts";

const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "kalshi-bot-research";

export type GitHubApiOptions = {
  /** Rate-limit bucket — defaults from path (`/search/code` → code_search). */
  resource?: GitHubRateLimitResource;
  /** Optional If-None-Match for conditional GETs. */
  etag?: string | null;
  retries?: number;
};

export type GitHubApiResult<T> = {
  data: T;
  etag: string | null;
  status: number;
  /** True when server returned 304 and caller must use prior payload. */
  notModified: boolean;
};

function resolveResource(path: string, explicit?: GitHubRateLimitResource): GitHubRateLimitResource {
  if (explicit) return explicit;
  if (path.startsWith("search/code") || path.startsWith("/search/code")) return "code_search";
  if (path.startsWith("search/") || path.startsWith("/search/")) return "search";
  return "core";
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

async function pauseUntilReset(resetSec: number, resource: GitHubRateLimitResource): Promise<void> {
  const capped = computeWaitMs(resetSec, Date.now(), resource);
  console.error(
    `[github] ${resource} rate limit — waiting ${Math.ceil(capped / 1000)}s (GITHUB_RATE_LIMIT_WAIT=1)`,
  );
  await Bun.sleep(capped);
}

function rateLimitError(
  path: string,
  resetSec: number | null,
  resource: GitHubRateLimitResource,
): GitHubRateLimitError {
  const resetMs = resetSec ? resetSec * 1000 : null;
  return new GitHubRateLimitError(
    `GitHub ${path} hit ${resource} rate limit${resetMs ? ` — reset ${new Date(resetMs).toISOString()}` : ""}`,
    { resetAtMs: resetMs, source: `${path} (${resource})` },
  );
}

function tripFromSnapshot(
  snap: GitHubRateLimitSnapshot | null,
  source: string,
  fallbackResource: GitHubRateLimitResource,
  headerReset: number | null,
  headerRemaining: number | null,
  headerLimit: number | null,
): void {
  tripGitHubRateLimit(headerReset ?? snap?.reset ?? null, source, {
    remaining: headerRemaining ?? snap?.remaining ?? null,
    limit: headerLimit ?? snap?.limit ?? null,
    resource: snap?.resource ?? fallbackResource,
  });
}

function apiUrl(path: string): string {
  const trimmed = path.replace(/^\//, "");
  return `${GITHUB_API_ORIGIN}/${trimmed}`;
}

/**
 * GET a GitHub REST path (no leading host). Returns parsed JSON.
 * On 304 with etag, `notModified` is true and `data` is undefined as T — callers must use cache.
 */
export async function githubApiGet<T>(
  path: string,
  options: GitHubApiOptions = {},
): Promise<GitHubApiResult<T>> {
  const resource = resolveResource(path, options.resource);
  assertGitHubRateBudget(`GET ${path}`);
  const retries = options.retries ?? DEFAULT_GH_RETRIES;
  const maxAttempts = shouldWaitForRateLimitReset() ? retries : 1;
  const token = await resolveGitHubToken();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    };
    if (options.etag) headers["If-None-Match"] = options.etag;

    const res = await fetch(apiUrl(path), { headers });
    const { reset, remaining, limit } = parseRateLimitHeaders(res.headers);
    const etag = res.headers.get("etag");

    if (res.status === 304) {
      return { data: undefined as T, etag, status: 304, notModified: true };
    }

    if (res.status === 403 || res.status === 429) {
      const snap = await readGitHubRateLimit(resource);
      tripFromSnapshot(snap, path, resource, reset, remaining, limit);
      if (shouldWaitForRateLimitReset() && attempt < maxAttempts - 1 && typeof reset === "number") {
        await pauseUntilReset(reset, resource);
        continue;
      }
      throw rateLimitError(path, reset ?? snap?.reset ?? null, resource);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub GET ${path} failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as T;
    return { data, etag, status: res.status, notModified: false };
  }

  throw rateLimitError(path, null, resource);
}

/** Convenience: GET and return JSON body (throws on 304 — pass etag only when handling notModified). */
export async function githubApiJson<T>(path: string, options: GitHubApiOptions = {}): Promise<T> {
  const result = await githubApiGet<T>(path, options);
  if (result.notModified) {
    throw new Error(`GitHub GET ${path} returned 304 but caller did not handle notModified`);
  }
  return result.data;
}
