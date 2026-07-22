// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import type { InspectionSignals, RepoCandidate, ResearchConfig } from "./types.ts";
import { decodeBase64 } from "./io.ts";
import { isGitHubRateLimitError } from "./gh.ts";
import { githubApiJson } from "./github-api.ts";
import { mapPool } from "./pool.ts";
import {
  deriveCodeSignals,
  detectReadmeSections,
  detectStrategyTags,
  detectTestsAndCi,
  deriveAuthFreshness,
  isSdkOnlyRepo,
  primaryLanguage,
} from "./detect.ts";
import { withCache, loadInspectCache, loadLatestInspectCache } from "./cache.ts";
import {
  canReusePriorInspectSnapshot,
  persistInspectCache,
  recordInspectPersist,
} from "./inspect-utils.ts";
import { isGitHubApiAbortError, isGitHubRateLimitTripped, throwCacheMissIfTripped } from "./github-errors.ts";
import { recordCacheStat } from "./github-cache-stats.ts";
import { DEFAULT_CODE_SEARCH_CONCURRENCY } from "./constants.ts";

type GhCodeHit = { path: string };
type GhCommit = { commit: { author: { date: string } } };
type GhContentEntry = { name: string; type: "file" | "dir" };

export async function inspectRepo(
  repo: RepoCandidate,
  config: ResearchConfig,
): Promise<InspectionSignals> {
  const cached = loadInspectCache(repo.fullName, repo.pushedAt);
  if (cached) {
    recordCacheStat("inspectExact");
    return cached;
  }

  if (isGitHubRateLimitTripped()) {
    const stale = loadLatestInspectCache(repo.fullName);
    if (stale) {
      recordCacheStat("inspectDegraded");
      console.error(
        `[inspect] degraded — cross-dimension inspect snapshot for ${repo.fullName} (inspect_cache, any prior dimension)`,
      );
      return stale;
    }
    throwCacheMissIfTripped("inspect", repo.fullName);
  }

  const prior = loadLatestInspectCache(repo.fullName);
  if (prior?.lastDefaultBranchCommitAt) {
    const lastCommit = await fetchLatestCommit(repo);
    if (canReusePriorInspectSnapshot(prior, lastCommit)) {
      recordCacheStat("inspectContentReuse");
      recordInspectPersist(persistInspectCache(repo.fullName, repo.pushedAt, prior));
      return prior;
    }
  }

  const signals = await fetchInspectionSignals(repo, config);
  recordInspectPersist(persistInspectCache(repo.fullName, repo.pushedAt, signals));
  return signals;
}

async function fetchInspectionSignals(
  repo: RepoCandidate,
  config: ResearchConfig,
): Promise<InspectionSignals> {
  const scope = `repo:${repo.fullName}`;

  const [readme, authHits, orderHits, languages, lastCommit, rootEntries] = await Promise.all([
    fetchReadme(repo),
    searchCode(repo, config.keywords.authCodeSearch, scope),
    searchCode(repo, config.keywords.orderCodeSearch, scope),
    fetchLanguages(repo),
    fetchLatestCommit(repo),
    fetchRootEntries(repo),
  ]);

  const code = deriveCodeSignals(readme, authHits, orderHits, config);
  const { hasTests, hasCi } = detectTestsAndCi(rootEntries, code.combinedText);
  const strategyTags = detectStrategyTags(code.combinedText, config);
  const sections = detectReadmeSections(readme);

  return {
    readmeLength: readme.length,
    ...sections,
    authHits,
    orderHits,
    usesOfficialSdk: code.usesOfficialSdk,
    hasAuthInCode: code.hasAuthInCode,
    hasV2Api: code.hasV2Api,
    hasRsaPss: code.hasRsaPss,
    hasLiveOrderPath: code.hasLiveOrderPath,
    hasDryRunDefault: code.hasDryRunDefault,
    hasAuthFreshness: deriveAuthFreshness(
      lastCommit,
      code.hasAuthInCode,
      code.hasV2Api,
      code.hasRsaPss,
    ),
    hasCentsPriceBounds: code.hasCentsPriceBounds,
    hasFeeAware: code.hasFeeAware,
    feeAwareKeywordHits: code.feeAwareKeywordHits,
    hasTests,
    hasCi,
    languages,
    primaryLanguage: primaryLanguage(languages),
    lastDefaultBranchCommitAt: lastCommit,
    strategyTags,
    isSdkOnly: isSdkOnlyRepo(strategyTags, code.usesOfficialSdk, code.hasLiveOrderPath, readme),
    riskKeywordHits: code.riskKeywordHits,
  };
}

async function fetchReadme(repo: RepoCandidate): Promise<string> {
  return withCache(repo.fullName, repo.pushedAt, "readme", async () => {
    try {
      const data = await githubApiJson<{ content?: string; encoding?: string }>(
        `repos/${repo.fullName}/readme`,
      );
      if (!data.content) return "";
      return data.encoding === "base64" ? decodeBase64(data.content) : data.content;
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return "";
    }
  });
}

async function searchCode(repo: RepoCandidate, queries: string[], scope: string) {
  return mapPool(
    queries,
    DEFAULT_CODE_SEARCH_CONCURRENCY,
    async (term) => {
      return withCache(repo.fullName, repo.pushedAt, `code_${term}`, async () => {
        try {
          const q = `${term} ${scope}`;
          const body = await githubApiJson<{ total_count?: number; items?: GhCodeHit[] }>(
            `search/code?q=${encodeURIComponent(q)}&per_page=5`,
            { resource: "code_search" },
          );
          const rows = body.items ?? [];
          return {
            query: term,
            totalCount: body.total_count ?? rows.length,
            paths: rows.map((r) => r.path).filter(Boolean),
          };
        } catch (err) {
          if (isGitHubRateLimitError(err)) throw err;
          return { query: term, totalCount: 0, paths: [] as string[] };
        }
      });
    },
    { failFast: isGitHubApiAbortError },
  );
}

async function fetchLanguages(repo: RepoCandidate): Promise<Record<string, number>> {
  return withCache(repo.fullName, repo.pushedAt, "languages", async () => {
    try {
      return await githubApiJson<Record<string, number>>(`repos/${repo.fullName}/languages`);
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return {};
    }
  });
}

async function fetchLatestCommit(repo: RepoCandidate): Promise<string | null> {
  return withCache(repo.fullName, repo.pushedAt, "latest_commit", async () => {
    try {
      const rows = await githubApiJson<GhCommit[]>(
        `repos/${repo.fullName}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=1`,
      );
      return rows[0]?.commit.author.date ?? null;
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return null;
    }
  });
}

async function fetchRootEntries(repo: RepoCandidate): Promise<GhContentEntry[]> {
  return withCache(repo.fullName, repo.pushedAt, "root_contents", async () => {
    try {
      return await githubApiJson<GhContentEntry[]>(`repos/${repo.fullName}/contents`);
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return [];
    }
  });
}
