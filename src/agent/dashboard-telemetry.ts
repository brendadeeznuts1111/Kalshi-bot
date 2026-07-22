// @see https://docs.github.com/en/rest/rate-limit/rate-limit
import { countInspectCacheRepos, hasAnySearchCache } from "../research/cache.ts";
import {
  parseRateLimitWire,
  type GitHubRateLimitResource,
  type GitHubRateLimitWire,
} from "../research/github-rate-limit.ts";

export type RateLimitFootprint = Partial<
  Record<GitHubRateLimitResource, { remaining: number; limit: number; reset: string | null }>
>;

export type CacheFallbackFootprint = {
  inspectCacheRepoCount: number;
  searchCacheAvailable: boolean;
  degradedHint: string | null;
};

export async function fetchGitHubRateLimitFootprint(): Promise<RateLimitFootprint | null> {
  const proc = Bun.spawn(["gh", "api", "rate_limit"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
  if (exitCode !== 0) return null;
  try {
    const wire = JSON.parse(stdout) as GitHubRateLimitWire;
    const parsed = parseRateLimitWire(wire);
    const out: RateLimitFootprint = {};
    for (const resource of ["core", "search", "code_search"] as const) {
      const snap = parsed[resource];
      if (!snap) continue;
      out[resource] = {
        remaining: snap.remaining,
        limit: snap.limit,
        reset: Number.isFinite(snap.reset) ? new Date(snap.reset * 1000).toISOString() : null,
      };
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function readCacheFallbackFootprint(): CacheFallbackFootprint {
  const inspectCacheRepoCount = countInspectCacheRepos();
  const searchCacheAvailable = hasAnySearchCache();
  let degradedHint: string | null = null;
  if (inspectCacheRepoCount > 0) {
    degradedHint = `Cross-dimension inspect cache: ${inspectCacheRepoCount} repo snapshot(s)`;
  } else if (searchCacheAvailable) {
    degradedHint = "Cross-dimension search cache available";
  }
  return { inspectCacheRepoCount, searchCacheAvailable, degradedHint };
}

export function formatRateLimitFootprintLine(rateLimit: RateLimitFootprint | null): string {
  if (!rateLimit) return "GitHub quota: unavailable";
  const parts: string[] = [];
  for (const resource of ["code_search", "search", "core"] as const) {
    const snap = rateLimit[resource];
    if (!snap) continue;
    parts.push(`${resource} ${snap.remaining}/${snap.limit}`);
  }
  return parts.length ? `GitHub quota: ${parts.join(" · ")}` : "GitHub quota: unavailable";
}
