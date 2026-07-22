import type { InspectionSignals, RepoCandidate, ResearchConfig } from "./types.ts";
import { decodeBase64 } from "./io.ts";
import { ghJson, isGitHubRateLimitError } from "./gh.ts";
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
import { withCache, loadInspectCache, loadLatestInspectCache, saveInspectCache } from "./cache.ts";
import { isGitHubRateLimitTripped } from "./github-errors.ts";
import { recordCacheStat } from "./github-cache-stats.ts";

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
      console.error(`[inspect] degraded — using prior inspect snapshot for ${repo.fullName}`);
      return stale;
    }
  }

  const signals = await fetchInspectionSignals(repo, config);
  saveInspectCache(repo.fullName, repo.pushedAt, signals);
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
      const data = await ghJson<{ content?: string; encoding?: string }>([
        "api",
        `repos/${repo.fullName}/readme`,
      ]);
      if (!data.content) return "";
      return data.encoding === "base64" ? decodeBase64(data.content) : data.content;
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return "";
    }
  });
}

async function searchCode(repo: RepoCandidate, queries: string[], scope: string) {
  return mapPool(queries, 2, async (term) => {
    return withCache(repo.fullName, repo.pushedAt, `code_${term}`, async () => {
      try {
        const rows = await ghJson<GhCodeHit[]>([
          "search",
          "code",
          `${term} ${scope}`,
          "--json",
          "path",
          "--limit",
          "5",
        ]);
        return { query: term, totalCount: rows.length, paths: rows.map((r) => r.path) };
      } catch (err) {
        if (isGitHubRateLimitError(err)) throw err;
        return { query: term, totalCount: 0, paths: [] as string[] };
      }
    });
  });
}

async function fetchLanguages(repo: RepoCandidate): Promise<Record<string, number>> {
  return withCache(repo.fullName, repo.pushedAt, "languages", async () => {
    try {
      return await ghJson<Record<string, number>>(["api", `repos/${repo.fullName}/languages`]);
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return {};
    }
  });
}

async function fetchLatestCommit(repo: RepoCandidate): Promise<string | null> {
  return withCache(repo.fullName, repo.pushedAt, "latest_commit", async () => {
    try {
      const rows = await ghJson<GhCommit[]>([
        "api",
        `repos/${repo.fullName}/commits?sha=${repo.defaultBranch}&per_page=1`,
      ]);
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
      return await ghJson<GhContentEntry[]>(["api", `repos/${repo.fullName}/contents`]);
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return [];
    }
  });
}
