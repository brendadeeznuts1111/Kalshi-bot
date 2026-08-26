/**
 * bash-mode.ts — the code-mode execution tier gate (docs/CODE_MODE.md).
 *
 * Plan mode = read-only tier: only classified read-only commands run; full-tier
 * commands are BLOCKED with an explicit result. Code mode = full tier (the repo's
 * normal behavior; authorized-execution runtime gates are independent of this).
 *
 * Uses Bun.$ (per docs/BUN_SHELL.md — the guard rejects raw spawnSync).
 */
export type AgentMode = 'plan' | 'code';
export type BashTier = 'read-only' | 'full';

/**
 * Commands whose leading verb is read-only. Compound lines are read-only only when
 * every && segment is read-only.
 */
const READ_ONLY_VERBS = /^(rg|rgv|grep|cat|head|tail|wc|ls|find|sed\s+-n|awk|cut|sort|uniq|pwd|echo|true|false|bun\s+x\s+tsc|tsc|bun\s+test|git\s+(status|diff|log|show|branch|rev-parse|ls-files|check-ignore|remote|tag))/;

/** Classify a command line into a bash tier. */
export function classifyBashTier(command: string): BashTier {
  const trimmed = command.trim();
  if (!trimmed) return 'read-only';
  if (/&&/.test(trimmed)) {
    const segments = trimmed.split(/\s*&&\s*/);
    return segments.every((s) => classifyBashTier(s) === 'read-only') ? 'read-only' : 'full';
  }
  return READ_ONLY_VERBS.test(trimmed) ? 'read-only' : 'full';
}
export interface BashModeResult {
  ok: boolean;
  blocked: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command under the given mode. Plan mode blocks full-tier commands; code mode
 * always executes (failures are reported via exitCode, not thrown).
 */
export async function runBashInMode(command: string, mode: AgentMode): Promise<BashModeResult> {
  const tier = classifyBashTier(command);
  if (mode === 'plan' && tier === 'full') {
    return { ok: false, blocked: true, exitCode: 1, stdout: '', stderr: '[plan mode] blocked: ' + command };
  }
  const proc = await Bun.$`bash -c ${command}`.quiet().nothrow();
  return {
    ok: proc.exitCode === 0,
    blocked: false,
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}
