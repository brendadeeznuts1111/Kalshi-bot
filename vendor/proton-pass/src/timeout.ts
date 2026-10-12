/**
 * Bun-native command timeout — Bun.spawn + AbortSignal / kill.
 * Zero node:child_process.
 */
// @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn

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
    label?: string
  ) {
    super(`Command timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}`);
  }
}

export async function spawnWithTimeout(
  cmd: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<SpawnResult> {
  const { timeoutMs = 30_000, cwd, env } = opts;
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });

  let timedOut = false;
  let killed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killed = true;
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  }, timeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]).finally(() => clearTimeout(timer));

  return {
    code: timedOut ? null : (code ?? null),
    stdout,
    stderr,
    killed,
    timedOut,
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
