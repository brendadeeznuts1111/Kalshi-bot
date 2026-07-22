// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import { decodeBase64 } from "./io.ts";
import { isGitHubRateLimitError } from "./gh.ts";
import { githubApiJson } from "./github-api.ts";
import { withCache } from "./cache.ts";

export const MAX_REPO_FILE_BYTES = 80_000;

type GhFileContent = {
  type: string;
  encoding?: string;
  content?: string;
  size?: number;
};

export type RepoFileRef = {
  fullName: string;
  pushedAt: string;
  defaultBranch?: string;
};

/** Fetch a single text file from GitHub REST (cached per repo+pushed_at). */
export async function fetchRepoFileText(
  repo: RepoFileRef,
  filePath: string,
): Promise<string | null> {
  const normalized = filePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;

  return withCache(repo.fullName, repo.pushedAt, `file:${normalized}`, async () => {
    try {
      const ref = repo.defaultBranch?.trim();
      const pathArg = ref
        ? `repos/${repo.fullName}/contents/${normalized}?ref=${encodeURIComponent(ref)}`
        : `repos/${repo.fullName}/contents/${normalized}`;
      const data = await githubApiJson<GhFileContent>(pathArg);
      if (data.type !== "file") return null;
      if (typeof data.size === "number" && data.size > MAX_REPO_FILE_BYTES) return null;
      if (!data.content) return null;
      const text =
        data.encoding === "base64" ? decodeBase64(data.content.replace(/\n/g, "")) : data.content;
      if (text.length > MAX_REPO_FILE_BYTES) return null;
      return text;
    } catch (err) {
      if (isGitHubRateLimitError(err)) throw err;
      return null;
    }
  });
}
