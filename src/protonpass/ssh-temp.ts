/**
 * SSH temp file handler — secure ephemeral file creation for PEM keys.
 * Bun-native: Bun.write + chmod, zero Node fs/promises dependency.
 */

import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempFile = {
  path: string;
  /** Atomically remove the file (best effort). */
  cleanup: () => Promise<void>;
};

/** Write data to a temp file with restricted permissions (0o600), return cleanup handle. */
export async function writeSecureTemp(content: string, opts?: {
  prefix?: string;
  suffix?: string;
  mode?: number;
}): Promise<TempFile> {
  const prefix = opts?.prefix ?? "kalshi-bot-";
  const suffix = opts?.suffix ?? ".tmp";
  const mode = opts?.mode ?? 0o600;

  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const path = join(tmpdir(), `${prefix}${randomPart}${suffix}`);

  await Bun.write(path, content);
  await chmod(path, mode);

  return {
    path,
    cleanup: async () => {
      try {
        await Bun.file(path).delete();
      } catch {
        // Best effort cleanup — file may already be gone
      }
    },
  };
}

/** Create a PEM key file from a pass-cli resolved string. Returns absolute path + cleanup. */
export async function writePemTemp(pemContent: string, opts?: { prefix?: string }): Promise<TempFile> {
  // Ensure PEM has proper newlines
  const normalized = pemContent
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!normalized.includes("BEGIN ")) {
    throw new Error("Provided content does not look like a PEM key (missing BEGIN marker)");
  }

  return writeSecureTemp(normalized + "\n", {
    prefix: opts?.prefix ?? "kalshi-key-",
    suffix: ".pem",
    mode: 0o600,
  });
}

/** Guard a function with automatic temp file cleanup (RAII-style). */
export async function withTempFile<T>(
  content: string,
  fn: (path: string) => Promise<T>,
  opts?: { prefix?: string; suffix?: string },
): Promise<T> {
  const temp = await writeSecureTemp(content, opts);
  try {
    return await fn(temp.path);
  } finally {
    await temp.cleanup();
  }
}
