/**
 * github-budget.ts — LIVE GitHub research budget for the dashboard.
 *
 * Reads the authenticated /rate_limit wire (one fetch) and reports the
 * token source + per-bucket remaining for the github channel signals.
 * Cached 5 minutes in-process (like deps-health 60s / kalshi-auth 5min) so
 * the 30s signal cache never hammers api.github.com; the rate-limit
 * endpoint itself counts against core, so the TTL is the budget guard.
 *
 * Degrades to null WITHOUT network when no token resolves (env or gh CLI),
 * so tests and token-less machines stay offline and the channel just
 * reports the gap.
 */
import {
  readGitHubRateLimitWire,
  snapshotFromWire,
  type GitHubRateLimitSnapshot,
  type GitHubRateLimitWire,
} from "../research/github-rate-limit.ts";
import { resolveGitHubToken } from "../research/github-network.ts";

export type GithubTokenSource = "env-gh-token" | "env-github-token" | "gh-cli" | "none";

export type GithubBudgetSnapshot = {
  tokenSource: GithubTokenSource;
  checkedAt: string;
  core: GitHubRateLimitSnapshot | null;
  search: GitHubRateLimitSnapshot | null;
  codeSearch: GitHubRateLimitSnapshot | null;
};

const TTL_MS = 5 * 60_000;
let cache: { at: number; value: GithubBudgetSnapshot | null } | null = null;

/** Which source would resolveGitHubToken use right now (no secret leaked). */
export function githubTokenSource(): GithubTokenSource {
  if (Bun.env.GH_TOKEN?.trim()) return "env-gh-token";
  if (Bun.env.GITHUB_TOKEN?.trim()) return "env-github-token";
  return "none";
}

/** Map a /rate_limit wire into the three buckets the research pipeline uses. */
export function budgetFromWire(wire: GitHubRateLimitWire): GithubBudgetSnapshot {
  const bucket = (name: "core" | "search" | "code_search"): GitHubRateLimitSnapshot | null => {
    try {
      return snapshotFromWire(wire, name);
    } catch {
      return null;
    }
  };
  return {
    tokenSource: githubTokenSource(),
    checkedAt: new Date().toISOString(),
    core: bucket("core"),
    search: bucket("search"),
    codeSearch: bucket("code_search"),
  };
}

/** Reset the TTL cache (dashboard actions / tests). */
export function resetGithubBudgetCache(): void {
  cache = null;
}

/** Live snapshot, TTL-cached. null when the token cannot be resolved. */
export async function collectGithubBudget(): Promise<GithubBudgetSnapshot | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;

  const source = githubTokenSource();
  let value: GithubBudgetSnapshot | null = null;
  if (source !== "none") {
    const wire = await readGitHubRateLimitWire();
    value = wire ? budgetFromWire(wire) : null;
  } else {
    // gh CLI fallback exists in resolveGitHubToken; probe it when env is
    // empty (gh auth token is a cheap subprocess, not a rate-limit call).
    try {
      await resolveGitHubToken();
      const wire = await readGitHubRateLimitWire();
      value = wire ? { ...budgetFromWire(wire), tokenSource: "gh-cli" } : null;
    } catch {
      value = null;
    }
  }
  cache = { at: now, value };
  return value;
}
