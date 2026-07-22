// @see https://bun.com/docs/runtime/networking/dns
// @see https://bun.com/docs/runtime/networking/fetch
import { dns } from "bun";
import { $ } from "bun";

export const GITHUB_API_HOST = "api.github.com";
export const GITHUB_API_ORIGIN = "https://api.github.com";

let networkWarmed = false;

/** One-time DNS + TLS warmup before a burst of GitHub API traffic. */
export function warmGitHubApiNetwork(): void {
  if (networkWarmed) return;
  networkWarmed = true;
  try {
    dns.prefetch(GITHUB_API_HOST);
  } catch {
    /* optional — dns.prefetch is experimental */
  }
  try {
    fetch.preconnect(GITHUB_API_ORIGIN);
  } catch {
    /* optional — preconnect is not available on all platforms */
  }
}

/** Reset for tests. */
export function resetGitHubNetworkWarmup(): void {
  networkWarmed = false;
}

export async function resolveGitHubToken(): Promise<string> {
  const fromEnv = Bun.env.GH_TOKEN?.trim() || Bun.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const { exitCode, stdout } = await $`gh auth token`.nothrow().quiet();
  if (exitCode === 0) {
    const token = stdout.toString().trim();
    if (token) return token;
  }

  throw new Error(
    "GitHub token not found. Set GH_TOKEN / GITHUB_TOKEN or run `gh auth login`.",
  );
}
