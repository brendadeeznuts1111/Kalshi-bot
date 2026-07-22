// @see https://bun.com/docs/runtime/shell#getting-started
// @see https://bun.com/docs/runtime/shell#error-handling
// @see https://bun.com/docs/runtime/shell#reading-output
// @see https://bun.com/docs/runtime/utils#bun-sleep
import { $ } from "bun";

/** All GitHub access via gh CLI — subprocess SSOT. See docs/BUN_SHELL.md. */

export function isRateLimited(stderr: string): boolean {
  return /rate limit|403|429|secondary rate limit/i.test(stderr);
}

export function parseGhStdout<T>(stdout: Buffer | Uint8Array | string): T {
  const text = (typeof stdout === "string" ? stdout : stdout.toString()).trim();
  if (!text) return [] as T;
  return JSON.parse(text) as T;
}

export async function ghJson<T>(args: string[], retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();

    if (exitCode === 0) {
      return parseGhStdout<T>(stdout);
    }

    const errText = stderr.toString();
    if (isRateLimited(errText) && attempt < retries - 1) {
      await Bun.sleep(2000 * (attempt + 1));
      continue;
    }

    throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${errText}`);
  }

  throw new Error(`gh ${args.join(" ")} exhausted retries`);
}

export async function ghText(args: string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();
  if (exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (${exitCode}): ${stderr.toString()}`);
  }
  return stdout.toString().trim();
}
