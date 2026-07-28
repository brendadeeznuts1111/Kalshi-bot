/**
 * Bun-native command timeout — Promise.race + proc.kill().
 * Zero dependencies.
 */

import { spawn } from "node:child_process";

export type SpawnResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  timedOut: boolean;
};

export class TimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    label?: string,
  ) {
    super(`Command timed out after ${timeoutMs}ms${label ? ` (${label})` : ""}`);
  }
}

export async function spawnWithTimeout(
  cmd: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<SpawnResult> {
  const { timeoutMs = 30_000, cwd, env } = opts;

  const proc = spawn(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let killed = false;

  proc.stdout?.on("data", (d) => {
    stdout += d;
  });
  proc.stderr?.on("data", (d) => {
    stderr += d;
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    proc.on("exit", (code) => resolve(code));
    proc.on("error", () => resolve(null));
  });

  let timer: Timer | null = null;

  const result = await Promise.race([
    exitPromise.then((code) => ({ code, timedOut: false })),
    new Promise<{ code: null; timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 2_000);
        resolve({ code: null, timedOut: true });
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  return {
    code: result.code,
    stdout,
    stderr,
    killed,
    timedOut: result.timedOut,
  };
}

/** Wrap any promise with a timeout that throws TimeoutError. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(label ? new TimeoutError(timeoutMs, label) : new TimeoutError(timeoutMs));
      }, timeoutMs);
    }),
  ]);
}
