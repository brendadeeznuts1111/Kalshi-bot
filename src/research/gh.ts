// @see https://bun.com/docs/runtime/shell#getting-started
// @see https://bun.com/docs/runtime/shell#error-handling
// @see https://bun.com/docs/runtime/shell#reading-output
// @see https://bun.com/docs/runtime/utils#bun-sleep
import { $ } from "bun";
import { DEFAULT_GH_RETRIES } from "./constants.ts";
import {
  assertGitHubRateBudget,
  GitHubRateLimitError,
  isGitHubRateLimitError,
  shouldWaitForRateLimitReset,
  throwCacheMissIfTripped,
  tripGitHubRateLimit,
} from "./github-errors.ts";

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

type GhRateLimitCore = { remaining?: number; reset?: number; limit?: number };

export function isRateLimited(stderr: string): boolean {
  return /rate limit|403|429|secondary rate limit/i.test(stderr);
}

async function readCoreRateLimit(): Promise<GhRateLimitCore | null> {
  const { exitCode, stdout } = await $`gh api rate_limit`.nothrow().quiet();
  if (exitCode !== 0) return null;
  try {
    const data = JSON.parse(stdout.toString()) as { resources?: { core?: GhRateLimitCore } };
    return data.resources?.core ?? null;
  } catch {
    return null;
  }
}

async function pauseUntilReset(resetSec: number): Promise<void> {
  const waitMs = Math.max(2000, resetSec * 1000 - Date.now() + 2000);
  const capped = Math.min(waitMs, 3_600_000);
  console.error(`[gh] rate limit — waiting ${Math.ceil(capped / 1000)}s (GITHUB_RATE_LIMIT_WAIT=1)`);
  await Bun.sleep(capped);
}

function rateLimitError(args: string[], resetSec: number | null): GitHubRateLimitError {
  const resetMs = resetSec ? resetSec * 1000 : null;
  return new GitHubRateLimitError(
    `gh ${args.join(" ")} hit GitHub rate limit${resetMs ? ` — reset ${new Date(resetMs).toISOString()}` : ""}`,
    { resetAtMs: resetMs, source: `gh ${args[0] ?? "api"}` },
  );
}

/** Preflight: abort the run when quota is already exhausted. Never waits unless GITHUB_RATE_LIMIT_WAIT=1. */
export async function ensureGhRateBudget(minRemaining = 3): Promise<void> {
  assertGitHubRateBudget("preflight");

  const core = await readCoreRateLimit();
  if (!core) return;

  const remaining = core.remaining ?? 0;
  const reset = core.reset;
  if (remaining >= minRemaining) return;

  if (typeof reset === "number" && shouldWaitForRateLimitReset()) {
    await pauseUntilReset(reset);
    return;
  }

  tripGitHubRateLimit(typeof reset === "number" ? reset : null, "preflight", {
    remaining,
    limit: core.limit ?? null,
    resource: "core",
  });
  throw rateLimitError(["api", "rate_limit"], typeof reset === "number" ? reset : null);
}

export function parseGhStdout<T>(stdout: Buffer | Uint8Array | string): T {
  const text = (typeof stdout === "string" ? stdout : stdout.toString()).trim();
  if (!text) return [] as T;
  return JSON.parse(text) as T;
}

export async function ghJson<T>(args: string[], retries = DEFAULT_GH_RETRIES): Promise<T> {
  assertGitHubRateBudget(`gh ${args.join(" ")}`);

  for (let attempt = 0; attempt < retries; attempt++) {
    const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();

    if (exitCode === 0) {
      return parseGhStdout<T>(stdout);
    }

    const errText = stderr.toString();
    if (!isRateLimited(errText)) {
      throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${errText}`);
    }

    const core = await readCoreRateLimit();
    const reset = core?.reset ?? null;
    tripGitHubRateLimit(reset, `gh ${args[0] ?? "api"}`, {
      remaining: core?.remaining ?? null,
      limit: core?.limit ?? null,
      resource: "core",
    });

    if (shouldWaitForRateLimitReset() && attempt < retries - 1 && typeof reset === "number") {
      await pauseUntilReset(reset);
      continue;
    }

    throw rateLimitError(args, reset);
  }

  throw rateLimitError(args, null);
}

export async function ghText(args: string[]): Promise<string> {
  assertGitHubRateBudget(`gh ${args.join(" ")}`);
  const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();
  if (exitCode !== 0) {
    const errText = stderr.toString();
    if (isRateLimited(errText)) {
      const core = await readCoreRateLimit();
      tripGitHubRateLimit(core?.reset ?? null, `gh ${args[0] ?? "api"}`, {
        remaining: core?.remaining ?? null,
        limit: core?.limit ?? null,
        resource: "core",
      });
      throw rateLimitError(args, core?.reset ?? null);
    }
    throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${errText}`);
  }
  return stdout.toString().trim();
}
