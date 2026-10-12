// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
// @updated Bun.write · fixed v0.4.0 · 2022-12-23 · https://bun.com/blog/bun-v0.4.0
// @updated Bun.write · fixed v0.6.10 · 2023-06-26 · https://bun.com/blog/bun-v0.6.10
// @updated Bun.write · fixed v0.7.2 · 2023-08-03 · https://bun.com/blog/bun-v0.7.2
// @updated Bun.write · fixed v1.0.7 · 2023-10-20 · https://bun.com/blog/bun-v1.0.7
// @updated Bun.write · changed v1.0.16 · 2023-12-10 · https://bun.com/blog/bun-v1.0.16
// @updated Bun.write · fixed v1.0.21 · 2024-01-02 · https://bun.com/blog/bun-v1.0.21
// @updated Bun.write · fixed v1.0.23 · 2024-01-16 · https://bun.com/blog/bun-v1.0.23
// @updated Bun.write · fixed v1.0.24 · 2024-01-20 · https://bun.com/blog/bun-v1.0.24
// @updated Bun.write · changed v1.1.0 · 2024-04-01 · https://bun.com/blog/bun-v1.1
// @updated Bun.write · fixed v1.1.6 · 2024-04-28 · https://bun.com/blog/bun-v1.1.6
// @updated Bun.write · fixed v1.1.21 · 2024-07-27 · https://bun.com/blog/bun-v1.1.21
// @updated Bun.write · changed v1.1.37 · 2024-11-26 · https://bun.com/blog/bun-v1.1.37
// @updated Bun.write · changed v1.2.8 · 2025-03-31 · https://bun.com/blog/bun-v1.2.8
// @updated Bun.write · fixed v1.2.8 · 2025-03-31 · https://bun.com/blog/bun-v1.2.8
// @updated Bun.write · fixed v1.2.20 · 2025-08-10 · https://bun.com/blog/bun-v1.2.20
// @updated Bun.write · fixed v1.3.0 · 2025-10-10 · https://bun.com/blog/bun-v1.3
// @updated Bun.write · fixed v1.3.5 · 2025-12-17 · https://bun.com/blog/bun-v1.3.5
// @updated Bun.write · fixed v1.3.6 · 2026-01-13 · https://bun.com/blog/bun-v1.3.6
// @updated Bun.write · fixed v1.3.12 · 2026-04-09 · https://bun.com/blog/bun-v1.3.12
// @verified Bun.write · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/environment-variables#manually-specifying-env-files — --env-file
// @updated --env-file · changed v1.0.12 · 2023-11-16 · https://bun.com/blog/bun-v1.0.12
// @verified --env-file · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/environment-variables#manually-specifying-env-files
// @see https://bun.com/docs/bundler/executables — --force
// @updated --force · fixed v1.3.7 · 2026-01-27 · https://bun.com/blog/bun-v1.3.7
// @updated --force · fixed v1.3.14 · 2026-05-13 · https://bun.com/blog/bun-v1.3.14
// @verified --force · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/bundler/executables
// @see https://bun.com/docs/runtime/utils#bun-env — Bun.env
// @updated Bun.env · fixed v1.0.3 · 2023-09-22 · https://bun.com/blog/bun-v1.0.3
// @updated Bun.env · changed v1.1.0 · 2024-04-01 · https://bun.com/blog/bun-v1.1
// @updated Bun.env · fixed v1.2.8 · 2025-03-31 · https://bun.com/blog/bun-v1.2.8
// @updated Bun.env · fixed v1.3.0 · 2025-10-10 · https://bun.com/blog/bun-v1.3
// @verified Bun.env · Bun v1.3.14 · 2026-08-06 · https://bun.com/docs/runtime/environment-variables
/**
 * pass-cli inject / run wrappers — vault plane boundary only.
 * Never logs secret values.
 *
 * @see https://protonpass.github.io/pass-cli/commands/contents/inject/
 * @see https://protonpass.github.io/pass-cli/commands/contents/run/
 */
// @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn — Bun.spawn
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file — Bun.file
import { createLogger } from './logger.ts';
import { spawnWithTimeout } from './timeout.ts';
import { templateToRunEnv } from './env-file.ts';
import { ensureAgentSession, type AgentSessionConfig, type AgentSessionResult } from './session.ts';

const log = createLogger({ prefix: 'inject' });

export type InjectOptions = {
  passCli: string;
  agent: AgentSessionConfig;
  inFile: string;
  outFile: string;
  /** Default true — pass-cli --force */
  force?: boolean;
  /** Default 0600 */
  fileMode?: string;
  reason?: string;
  timeoutMs?: number;
};

export type InjectResult = {
  ok: boolean;
  outFile: string;
  agent: AgentSessionResult;
  code: number | null;
  detail: string;
};

export async function injectEnvFile(opts: InjectOptions): Promise<InjectResult> {
  const agent = await ensureAgentSession(opts.passCli, opts.agent);
  if (!agent.ok) {
    return {
      ok: false,
      outFile: opts.outFile,
      agent,
      code: 1,
      detail: agent.detail,
    };
  }

  if (!(await Bun.file(opts.inFile).exists())) {
    return {
      ok: false,
      outFile: opts.outFile,
      agent,
      code: 1,
      detail: `template not found: ${opts.inFile}`,
    };
  }

  const force = opts.force !== false;
  const mode = opts.fileMode ?? '0600';
  const args = [
    'inject',
    '--in-file',
    opts.inFile,
    '--out-file',
    opts.outFile,
    ...(force ? ['--force'] : []),
    '--file-mode',
    mode,
  ];

  log.info('pass_cli_inject', { inFile: opts.inFile, outFile: opts.outFile });
  const r = await spawnWithTimeout(opts.passCli, args, {
    timeoutMs: opts.timeoutMs ?? 120_000,
    env: {
      ...Bun.env,
      PROTON_PASS_KEY_PROVIDER: 'fs',
      PROTON_PASS_SESSION_DIR: agent.sessionDir,
      ...(opts.reason
        ? { PROTON_PASS_AGENT_REASON: opts.reason }
        : { PROTON_PASS_AGENT_REASON: `inject ${opts.inFile}` }),
    },
  });

  if (r.timedOut || r.code !== 0) {
    log.error('inject_failed', { code: r.code, timedOut: r.timedOut });
    return {
      ok: false,
      outFile: opts.outFile,
      agent,
      code: r.code,
      detail: r.stderr.trim().slice(0, 200) || r.stdout.trim().slice(0, 200) || 'inject failed',
    };
  }

  // Belt: enforce mode even if pass-cli skipped
  try {
    await Bun.spawn(['chmod', mode, opts.outFile]).exited;
  } catch {
    /* ignore */
  }

  log.info('inject_ok', { outFile: opts.outFile });
  return {
    ok: true,
    outFile: opts.outFile,
    agent,
    code: 0,
    detail: `wrote ${opts.outFile}`,
  };
}

export type RunOptions = {
  passCli: string;
  agent: AgentSessionConfig;
  envFile: string;
  /** Command argv after `--` */
  command: string[];
  reason?: string;
  timeoutMs?: number;
  /**
   * When env file still has `{{ pass://… }}` inject templates, materialize a
   * bare pass:// temp file for official `pass-cli run` (caller does not clean
   * unless materialize=true — we always unlink temp after spawn).
   */
  materializeTemplates?: boolean;
  /** Forward pass-cli `--no-masking` when true. */
  noMasking?: boolean;
};

export type RunResult = {
  ok: boolean;
  agent: AgentSessionResult;
  code: number | null;
  detail: string;
  /** Temp path used when templates were materialized (already deleted). */
  materializedPath?: string;
};

/**
 * Official `pass-cli run --env-file` — resolves bare pass:// into child env.
 * Inherits stdout/stderr to the parent terminal.
 * Optionally strips `{{ pass:// }}` inject braces into a temp run env.
 */
export async function runWithEnvFile(opts: RunOptions): Promise<RunResult> {
  const agent = await ensureAgentSession(opts.passCli, opts.agent);
  if (!agent.ok) {
    return { ok: false, agent, code: 1, detail: agent.detail };
  }
  if (opts.command.length === 0) {
    return { ok: false, agent, code: 2, detail: 'missing command after --' };
  }
  if (!(await Bun.file(opts.envFile).exists())) {
    return { ok: false, agent, code: 1, detail: `env-file not found: ${opts.envFile}` };
  }

  let envFile = opts.envFile;
  let materializedPath: string | undefined;
  const materialize = opts.materializeTemplates !== false;
  if (materialize) {
    const text = await Bun.file(opts.envFile).text();
    if (text.includes('{{') && text.includes('pass://')) {
      const dir = Bun.env.TMPDIR ?? '/tmp';
      const path = `${dir.replace(/\/$/, '')}/pp-run-${process.pid}-${Date.now()}.env`;
      await Bun.write(path, templateToRunEnv(text));
      try {
        await Bun.spawn(['chmod', '600', path]).exited;
      } catch {
        /* ignore */
      }
      envFile = path;
      materializedPath = path;
      log.info('run_env_materialized', { from: opts.envFile });
    }
  }

  const args = [
    'run',
    ...(opts.noMasking ? ['--no-masking'] : []),
    '--env-file',
    envFile,
    '--',
    ...opts.command,
  ];

  log.info('pass_cli_run', { envFile, cmd: opts.command[0], noMasking: Boolean(opts.noMasking) });
  try {
    const proc = Bun.spawn([opts.passCli, ...args], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
      env: {
        ...Bun.env,
        PROTON_PASS_KEY_PROVIDER: 'fs',
        PROTON_PASS_SESSION_DIR: agent.sessionDir,
        PROTON_PASS_AGENT_REASON: opts.reason ?? `run ${opts.command[0]}`,
      },
    });
    const code = await proc.exited;
    return {
      ok: code === 0,
      agent,
      code,
      detail: code === 0 ? 'ok' : `exit ${code}`,
      materializedPath,
    };
  } finally {
    if (materializedPath) {
      try {
        await Bun.file(materializedPath).unlink();
      } catch {
        /* ignore */
      }
    }
  }
}
