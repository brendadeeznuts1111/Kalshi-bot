/**
 * Shared ripgrep helper for audit/report tooling.
 *
 * Why this exists (docs/AGENT-PITFALLS.md sections 17/24/27): FOUR separate
 * audit libs each implemented their own rg invocation, and THREE times the
 * self-exclusion glob was forgotten (breaking, deps, perf) - inflating
 * counts with self-matches. Centralizing makes exclusion + escaping
 * structural instead of remembered.
 *
 * Traps handled here (all probe-verified):
 *   - rg treats '{' and '(' as regex operators and ERRORS (exit 2 ->
 *     silently empty results); patterns must escape them. escapeForRg
 *     does that for the metacharacters rg treats specially.
 *   - rg exits 2 on a MISSING path argument even when another file
 *     matches - callers must pass existing dirs/files.
 *   - excludeSelf (default true) adds a --glob excluding the audit
 *     tooling source glob, so audit/probe code that legitimately names
 *     the APIs it checks never self-matches.
 */
import { spawnSync } from 'node:child_process';

export type RgOptions = {
  /** Add the audit-tooling --glob exclusion (default true). */
  excludeSelf?: boolean;
  /** Extra --glob exclusions. */
  exclude?: string[];
  /** Pass -c (count matches per file) instead of -l (list files). */
  count?: boolean;
};

/**
 * Escape rg regex metacharacters: { } ( ) [ ] | . * + ? ^ $.
 * Backslash first so later replacements cannot re-trigger.
 */
export function escapeForRg(pattern: string): string {
  const chars = ['\\', '{', '}', '(', ')', '[', ']', '|', '.', '*', '+', '?', '^', '$'];
  let out = pattern;
  for (const c of chars) {
    out = out.split(c).join('\\' + c);
  }
  return out;
}

/**
 * Run rg and return matching file paths (or count lines with count:true).
 * Returns [] on any non-zero exit (no match OR rg error - callers should
 * pass only existing paths; see trap note above).
 */
export function rgFiles(root: string, pattern: string, dirs: string[], options?: RgOptions): string[] {
  const args: string[] = [];
  if (options?.count) args.push('-c');
  else args.push('-l');
  if (options?.excludeSelf ?? true) args.push('--glob', '!**/*audit*.ts');
  for (const e of options?.exclude ?? []) args.push('--glob', '!' + e);
  args.push(pattern, ...dirs);
  const out = spawnSync('rg', args, { encoding: 'utf8' });
  if (out.status !== 0) return [];
  return out.stdout.split('\n').filter(Boolean).map((p) => p.replace(root + '/', ''));
}