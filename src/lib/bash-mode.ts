/**
 * bash-mode.ts — the code-mode execution tier gate (docs/CODE_MODE.md).
 *
 * Plan mode = read-only tier: only classified read-only commands run; full-tier
 * commands are BLOCKED with an explicit result. Code mode = full tier (the repo's
 * normal behavior; authorized-execution runtime gates are independent of this).
 *
 * Tier rules (v2, structured):
 *   - env prefixes (VAR=x cmd) and wrapper verbs (sudo/time/env/command) are
 *     stripped, then the remaining verb is classified;
 *   - any output redirect (`>`, `>>`, `2>`, `&>`) makes the line FULL (it writes);
 *   - pipelines and && chains are read-only only when EVERY segment is read-only;
 *   - `bun test` is FULL (test code can write files); `bun x tsc` stays read-only;
 *   - verbs that execute arbitrary code or can write (node, python3, sh, curl,
 *     tar, xargs, npm, bun run/build/install, sudo) are FULL by absence from the
 *     read-only set - the set is STRICT by construction.
 *
 * Uses Bun.$ (per docs/BUN_SHELL.md - the guard rejects raw spawnSync).
 */
export type AgentMode = 'plan' | 'code';
export type BashTier = 'read-only' | 'full';

/** Strict read-only verb set: only verbs that read the tree or print to stdout. */
const READ_ONLY_VERBS = new Set([
  'rg', 'rgv', 'grep', 'zgrep', 'rgrep', 'egrep', 'fgrep', 'cat', 'head', 'tail', 'wc', 'ls', 'find', 'sed', 'awk', 'cut', 'sort', 'uniq', 'pwd', 'echo', 'true', 'false', 'tsc', 'diff', 'which', 'file', 'basename', 'dirname', 'stat', 'du', 'df', 'printenv', 'jq', 'yq', 'column', 'expand', 'unexpand', 'fmt', 'nl', 'od', 'paste', 'pr', 'seq', 'shuf', 'tac', 'tr', 'tsort', 'yes', 'comm', 'join', 'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'cksum', 'strings', 'xxd', 'hexdump', 'zcat', 'bzcat', 'xzcat', 'man', 'apropos', 'whatis', 'git', 'bun', 'time', 'env', 'command', 'builtin', 'type', 'help', 'history', 'jobs', 'dirs', 'alias', 'unalias', 'readonly', 'set', 'shopt', 'ulimit', 'umask', 'cd', 'pushd', 'popd', 'export', 'unset', 'local', 'declare', 'typeset'
]);

/** git subcommands that only read. */
const GIT_READONLY = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'check-ignore', 'remote', 'tag', 'describe', 'merge-base', 'cherry', 'name-rev', 'symbolic-ref']);

/** bun subcommands that only read (x tsc = typecheck; x <other> can fetch+run). */
const BUN_READONLY = new Set(['--version', '-v', '--revision', 'inspect']);

/** Strip env prefixes (VAR=x ...) and wrapper verbs. */
function stripPrefixes(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) && t.includes('=') && !t.startsWith('=')) { i++; continue; }
    if (t === 'sudo' || t === 'time' || t === 'env' || t === 'command' || t === 'builtin' || t === 'nohup' || t === 'nice' || t === 'stdbuf') { i++; continue; }
    break;
  }
  return tokens.slice(i);
}

/** Classify a command line into a bash tier. */
export function classifyBashTier(command: string): BashTier {
  const trimmed = command.trim();
  if (!trimmed) return 'read-only';
  if (/(^|\s)[12]?>|>>|&>/.test(trimmed)) return 'full'; // any output redirect writes
  if (trimmed.includes('|')) {
    const segs = trimmed.split(/\|\s*/);
    return segs.every((s) => classifyBashTier(s) === 'read-only') ? 'read-only' : 'full';
  }
  if (trimmed.includes('&&')) {
    const segs = trimmed.split(/\s*&&\s*/);
    return segs.every((s) => classifyBashTier(s) === 'read-only') ? 'read-only' : 'full';
  }
  const tokens = stripPrefixes(trimmed.split(/\s+/));
  const verb = tokens[0] ?? '';
  if (verb === 'git') {
    const sub = tokens[1] ?? '';
    return GIT_READONLY.has(sub) ? 'read-only' : 'full';
  }
  if (verb === 'bun') {
    const sub = tokens[1] ?? '';
    if (sub === 'test' || sub === 'run' || sub === 'build' || sub === 'install' || sub === 'add' || sub === 'remove' || sub === 'update' || sub === 'upgrade' || sub === 'link' || sub === 'unlink' || sub === 'pm') return 'full';
    if (sub === 'x') {
      const what = tokens[2] ?? '';
      return what === 'tsc' ? 'read-only' : 'full';
    }
    return BUN_READONLY.has(sub) ? 'read-only' : 'full';
  }
  return READ_ONLY_VERBS.has(verb) ? 'read-only' : 'full';
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