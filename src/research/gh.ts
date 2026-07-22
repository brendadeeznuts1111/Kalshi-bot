// @see https://bun.com/docs/runtime/shell#getting-started
// @see https://bun.com/docs/runtime/utils#bun-sleep
import { $ } from "bun";
import { DEFAULT_GH_RETRIES } from "./constants.ts";
import {
  assertGitHubRateBudget,
  GitHubRateLimitError,
  isGitHubRateLimitError,
  shouldWaitForRateLimitReset,
  tripGitHubRateLimit,
} from "./github-errors.ts";
import {
  computeWaitMs,
  readGitHubRateLimit,
  resolveGhRateLimitResource,
  type GitHubRateLimitResource,
  type GitHubRateLimitSnapshot,
} from "./github-rate-limit.ts";

/** All GitHub access via gh CLI — subprocess SSOT. See docs/BUN_SHELL.md. */

export {
  GitHubRateLimitError,
  GitHubCacheMissError,
  GitHubDegradedCacheError,
  isGitHubRateLimitError,
  isGitHubCacheMissError,
  isGitHubApiAbortError,
  serializeGitHubApiError,
  formatRateLimitAbortMessage,
  formatRateLimitRemediation,
  beginGitHubResearchErrorContext,
  finishGitHubResearchErrorContext,
  resetGitHubRateLimitCircuit,
} from "./github-errors.ts";

export { buildGitHubErrorEnrichment } from "./github-error-enrichment.ts";
export { resolveGhRateLimitResource } from "./github-rate-limit.ts";

export function isRateLimited(stderr: string): boolean {
  return /rate limit|403|429|secondary rate limit/i.test(stderr);
}

async function pauseUntilRateLimitReset(
  resetSec: number,
  resource: GitHubRateLimitResource,
): Promise<void> {
  const capped = computeWaitMs(resetSec, Date.now(), resource);
  console.error(
    `[gh] ${resource} rate limit — waiting ${Math.ceil(capped / 1000)}s (GITHUB_RATE_LIMIT_WAIT=1)`,
  );
  await Bun.sleep(capped);
}

function rateLimitError(
  args: string[],
  resetSec: number | null,
  resource: GitHubRateLimitResource,
): GitHubRateLimitError {
  const resetMs = resetSec ? resetSec * 1000 : null;
  return new GitHubRateLimitError(
    `gh ${args.join(" ")} hit GitHub ${resource} rate limit${resetMs ? ` — reset ${new Date(resetMs).toISOString()}` : ""}`,
    { resetAtMs: resetMs, source: `gh ${args[0] ?? "api"} (${resource})` },
  );
}

async function ensureResourceBudget(
  resource: GitHubRateLimitResource,
  minRemaining: number,
): Promise<void> {
  const snap = await readGitHubRateLimit(resource);
  if (!snap) return;

  if (snap.remaining >= minRemaining) return;

  if (shouldWaitForRateLimitReset()) {
    await pauseUntilRateLimitReset(snap.reset, resource);
    return;
  }

  tripGitHubRateLimit(snap.reset, `${resource}/preflight`, {
    remaining: snap.remaining,
    limit: snap.limit,
    resource,
  });
  throw rateLimitError(["api", "rate_limit"], snap.reset, resource);
}

/** Preflight discover + REST — checks core and search buckets (not code_search; see ensureInspectRateBudget). */
export async function ensureGhRateBudget(minRemaining = 3): Promise<void> {
  assertGitHubRateBudget("preflight");
  await ensureResourceBudget("core", minRemaining);
  await ensureResourceBudget("search", minRemaining);
}

export function parseGhStdout<T>(stdout: Buffer | Uint8Array | string): T {
  const text = (typeof stdout === "string" ? stdout : stdout.toString()).trim();
  if (!text) return [] as T;
  return JSON.parse(text) as T;
}

function tripFromSnapshot(
  snap: GitHubRateLimitSnapshot | null,
  source: string,
  fallbackResource: GitHubRateLimitResource,
): void {
  tripGitHubRateLimit(snap?.reset ?? null, source, {
    remaining: snap?.remaining ?? null,
    limit: snap?.limit ?? null,
    resource: snap?.resource ?? fallbackResource,
  });
}

export async function ghJson<T>(args: string[], retries = DEFAULT_GH_RETRIES): Promise<T> {
  assertGitHubRateBudget(`gh ${args.join(" ")}`);
  const resource = resolveGhRateLimitResource(args);
  const maxAttempts = shouldWaitForRateLimitReset() ? retries : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();

    if (exitCode === 0) {
      return parseGhStdout<T>(stdout);
    }

    const errText = stderr.toString();
    if (!isRateLimited(errText)) {
      throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${errText}`);
    }

    const snap = await readGitHubRateLimit(resource);
    tripFromSnapshot(snap, `gh ${args[0] ?? "api"}`, resource);

    if (shouldWaitForRateLimitReset() && attempt < maxAttempts - 1 && snap) {
      await pauseUntilRateLimitReset(snap.reset, resource);
      continue;
    }

    throw rateLimitError(args, snap?.reset ?? null, resource);
  }

  throw rateLimitError(args, null, resource);
}

export async function ghText(args: string[]): Promise<string> {
  assertGitHubRateBudget(`gh ${args.join(" ")}`);
  const resource = resolveGhRateLimitResource(args);
  const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();
  if (exitCode !== 0) {
    const errText = stderr.toString();
    if (isRateLimited(errText)) {
      const snap = await readGitHubRateLimit(resource);
      tripFromSnapshot(snap, `gh ${args[0] ?? "api"}`, resource);
      throw rateLimitError(args, snap?.reset ?? null, resource);
    }
    throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${errText}`);
  }
  return stdout.toString().trim();
}
