// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchConfig } from "./types.ts";
import { ghJson } from "./gh.ts";
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

type GhSearchRepo = {
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

export async function loadConfig(): Promise<ResearchConfig> {
  const [queries, weights, keywords] = await Promise.all([
    Bun.file(joinPath(RESEARCH_ROOT, "queries.json")).json(),
    Bun.file(joinPath(RESEARCH_ROOT, "weights.json")).json(),
    Bun.file(joinPath(RESEARCH_ROOT, "keywords.json")).json(),
  ]);
  return { queries, weights, keywords } as ResearchConfig;
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

export async function discoverCandidates(config: ResearchConfig) {
  const seen = new Map<string, ReturnType<typeof toCandidate>>();
  const preferredLicenses = config.weights.license.preferredLicenses;

  for (const query of config.queries.queries) {
    const rows = await ghJson<GhSearchRepo[]>([
      "search",
      "repos",
      query,
      "--json",
      "fullName,description,stargazersCount,forksCount,pushedAt,isArchived,url,defaultBranch,license",
      "--limit",
      String(DEFAULT_GH_SEARCH_LIMIT),
    ]);

    for (const row of rows) {
      if (!isGitHubRepoUrl(row.url)) continue;
      const ref = parseGitHubRepoRef(row.url);
      if (!ref) continue;
      if (!seen.has(ref.fullName)) {
        seen.set(ref.fullName, toCandidate(row, preferredLicenses, ref));
      }
      if (seen.size >= config.queries.candidateCap) break;
    }
    if (seen.size >= config.queries.candidateCap) break;
  }

  return [...seen.values()];
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
