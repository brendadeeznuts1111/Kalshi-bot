/**
 * perf-audit core: verify the repo keeps the Bun v1.4 toolchain wins
 * (docs/AGENT-PITFALLS.md section 23 + release-notes summary paste):
 *   1. globalStore + isolated linker (machine config; project defers)
 *   2. test script uses --parallel --timings (measured 5.5x faster)
 *   3. Bun.build metafile analysis available where builds exist
 *   4. CI runs bun audit + bun dedupe --check (read-only, frozen-safe)
 *
 * Importable so the CLI, pre-commit, and tests share it.
 * Status: ok | warn | n/a (n/a = not applicable to this repo).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rgFiles } from './rg.ts';

export type PerfCheck = { name: string; status: 'ok' | 'warn' | 'n/a'; detail: string };

function readOr(root: string, rel: string): string {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function runPerfAudit(root: string, globalBunfigPath?: string): PerfCheck[] {
  const checks: PerfCheck[] = [];
  const globalBunfig = globalBunfigPath && existsSync(globalBunfigPath)
    ? readFileSync(globalBunfigPath, 'utf8')
    : '';
  const projectBunfig = readOr(root, 'bunfig.toml');
  const globalStore = /globalStore\s*=\s*true/.test(globalBunfig) || /globalStore\s*=\s*true/.test(projectBunfig);
  const isolated = /linker\s*=\s*["']isolated["']/.test(globalBunfig) || /linker\s*=\s*["']isolated["']/.test(projectBunfig);
  checks.push({
    name: 'global virtual store (globalStore + isolated linker)',
    status: globalStore && isolated ? 'ok' : 'warn',
    detail: globalStore && isolated
      ? 'globalStore=true + linker=isolated in config (7x warm installs)'
      : 'globalStore=' + globalStore + ' isolated=' + isolated + ' - enable both',
  });

  const pkg = JSON.parse(readOr(root, 'package.json') || '{}') as { scripts?: Record<string, string> };
  const testScript = pkg.scripts?.test ?? '';
  const hasParallel = /--parallel/.test(testScript);
  const hasTimings = /--timings/.test(testScript);
  checks.push({
    name: 'bun test --parallel --timings (5.5x faster, measured)',
    status: hasParallel && hasTimings ? 'ok' : 'warn',
    detail: hasParallel && hasTimings
      ? 'test script: ' + testScript
      : 'test script missing --parallel/--timings: ' + (testScript || '(none)'),
  });

  const buildFiles = rgFiles(root, 'Bun.build', [join(root, 'src'), join(root, 'tools')]);
  const usesBuild = buildFiles.length > 0;
  checks.push({
    name: 'Bun.build metafile analysis (--metafile-md / metafile:true)',
    status: usesBuild ? 'warn' : 'n/a',
    detail: usesBuild
      ? 'Bun.build used - consider metafile:true'
      : 'no Bun.build usage in src/tools (not applicable)',
  });

  const workflowsDir = join(root, '.github/workflows');
  const workflowFiles = existsSync(workflowsDir) ? readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')) : [];
  const workflowText = workflowFiles.map((f) => readOr(root, '.github/workflows/' + f)).join('\n');
  const hasAudit = /bun audit/.test(workflowText);
  const hasDedupe = /bun dedupe/.test(workflowText);
  checks.push({
    name: 'CI security audit + dedupe check',
    status: hasAudit && hasDedupe ? 'ok' : 'warn',
    detail: hasAudit && hasDedupe
      ? 'workflows run bun audit + bun dedupe --check'
      : 'audit=' + hasAudit + ' dedupe=' + hasDedupe + ' in workflows',
  });

  return checks;
}

export function perfAuditPasses(checks: PerfCheck[]): boolean {
  return checks.every((c) => c.status !== 'warn');
}