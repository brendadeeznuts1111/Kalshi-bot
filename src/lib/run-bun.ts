/**
 * run-bun.ts — shared Bun subprocess runner (the repo's Bun.which('bun')
 * pattern consolidated).
 *
 * The Bun.which('bun') + Bun.spawn shape was duplicated 8+ times across
 * tools; this is the single source. runBunGate (signal-pipeline) delegates
 * here. Always resolves the bun binary natively (Bun.which), never shells
 * out to node:child_process.
 */
export type RunBunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  /** Replace the PATH used to resolve the bun binary (Bun.which semantics,
   * probe-verified §42: { PATH } REPLACES the env PATH — include system
   * dirs yourself; cwd resolves relative PATH entries). */
  path?: string;
};

export async function runBunCommand(
  args: string[],
  opts: RunBunOptions = {},
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; lastLine: string }> {
  const bun = (opts.path ? Bun.which('bun', { PATH: opts.path, ...(opts.cwd ? { cwd: opts.cwd } : {}) }) : Bun.which('bun')) ?? 'bun';
  const p = Bun.spawn([bun, ...args], { stdout: 'pipe', stderr: 'pipe', ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}), ...(opts.env ? { env: opts.env } : {}) });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  const exitCode = p.exitCode ?? 1;
  const lastLine = out.trim().split('\n').filter(Boolean).at(-1) ?? err.trim().split('\n').filter(Boolean).at(-1) ?? '';
  return { ok: exitCode === 0, exitCode, stdout: out, stderr: err, lastLine };
}