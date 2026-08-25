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
import { attributeCodeHits, fetchGlobalCodeHits } from "./global-code-search.ts";

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
  // Global-attribution code search (§127): ONE unscoped query per keyword,
  // hits attributed to this repo by repository.full_name. Cost = keywords
  // (21), not keywords x repos (was 294 for sports-nba / 1029 price-data).
  const [readme, global, languages, lastCommit, rootEntries] = await Promise.all([
    fetchReadme(repo),
    fetchGlobalCodeHits([...config.keywords.authCodeSearch, ...config.keywords.orderCodeSearch]),
    fetchLanguages(repo),
    fetchLatestCommit(repo),
    fetchRootEntries(repo),
  ]);
  const authHits = attributeCodeHits(global, config.keywords.authCodeSearch, repo.fullName);
  const orderHits = attributeCodeHits(global, config.keywords.orderCodeSearch, repo.fullName);

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
