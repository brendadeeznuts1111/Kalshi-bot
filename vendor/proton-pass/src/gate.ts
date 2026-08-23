/**
 * Injectable startup gate — hosts supply checks; package runs them.
 */
import { createLogger } from './logger.ts';

const log = createLogger({ prefix: 'gate' });

export type GateCheck = {
  name: string;
  test: () => boolean | Promise<boolean>;
  required: boolean;
  hint: string;
};

export type GateResult = {
  passed: boolean;
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'skip';
    hint?: string;
  }>;
  blockers: string[];
};

export async function runStartupGate(checks: GateCheck[]): Promise<GateResult> {
  const results: GateResult['checks'] = [];
  const blockers: string[] = [];

  log.info('Running startup gate', { checks: checks.length });

  for (const check of checks) {
    try {
      const ok = await Promise.resolve(check.test());
      if (ok) {
        results.push({ name: check.name, status: 'pass' });
      } else if (check.required) {
        results.push({ name: check.name, status: 'fail', hint: check.hint });
        blockers.push(`${check.name}: ${check.hint}`);
      } else {
        results.push({ name: check.name, status: 'skip', hint: check.hint });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: check.name, status: 'fail', hint: msg });
      if (check.required) blockers.push(`${check.name}: ${msg}`);
    }
  }

  const passed = blockers.length === 0;
  if (passed) {
    log.info('Startup gate passed', {
      ok: results.filter(r => r.status === 'pass').length,
    });
  } else {
    log.error('Startup gate failed', { blockers: blockers.length });
  }

  return { passed, checks: results, blockers };
}

export async function assertGate(checks: GateCheck[]): Promise<void> {
  const result = await runStartupGate(checks);
  if (!result.passed) process.exit(1);
}

/**
 * Optional presence of env keys by prefix (e.g. FANTASY402_).
 * Never reads/logs values — only key names.
 */
export function envPrefixPresence(
  prefix: string,
  requiredSuffixes: readonly string[],
  envMap: Record<string, string | undefined> = process.env
): { ok: boolean; present: string[]; missing: string[] } {
  const p = prefix.endsWith('_') ? prefix : `${prefix}_`;
  const present: string[] = [];
  const missing: string[] = [];
  for (const suf of requiredSuffixes) {
    const key = `${p}${suf}`;
    // Also allow bare book-level key without double underscore issues
    const bare = `${prefix.replace(/_$/, '')}_${suf}`;
    const hit =
      Boolean(envMap[key]?.trim()) ||
      Boolean(envMap[bare]?.trim()) ||
      // fallback: any env key ending with _SUFFIX under prefix family
      Object.keys(envMap).some(
        k => k.startsWith(p) && k.endsWith(`_${suf}`) && Boolean(envMap[k]?.trim())
      );
    if (hit) present.push(suf);
    else missing.push(suf);
  }
  return { ok: missing.length === 0, present, missing };
}
