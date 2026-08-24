#!/usr/bin/env bun
/**
 * `bun run design:audit-deps` — dependency health for the design bundles.
 *
 * Two layers:
 *   1. ZERO-NPM-DEP CONTRACT (fails): the design-system + hq-app bundles
 *      must not contain any node_modules module in their metafile graphs.
 *      The repo is Bun-native by design; an npm dependency creeping into
 *      the frontend graph is a contract violation, not just bloat.
 *   2. `bun audit` (reports): known-vulnerability scan of repo deps —
 *      pass-through output; exit 1 only with --fail.
 *
 *   bun run design:audit-deps
 *   bun run design:audit-deps -- --fail   # fail on bun audit findings too
 */
import { join } from 'node:path';
import {
  DESIGN_MODULE_NAMES,
  metaJsonPath,
  npmModulesInBundle,
} from '../src/lib/design-budget.ts';

const ROOT = join(import.meta.dir, '..');
const failOnAudit = Bun.argv.includes('--fail');

let violations = 0;
for (const module of DESIGN_MODULE_NAMES) {
  const jsonText = await Bun.file(metaJsonPath(module, ROOT)).text().catch(() => '');
  if (!jsonText) {
    console.error(module + ': metafile missing — run bun run design:build');
    violations += 1;
    continue;
  }
  let npm: string[] = [];
  try {
    npm = npmModulesInBundle(JSON.parse(jsonText) as unknown);
  } catch {
    npm = [];
  }
  if (npm.length) {
    violations += 1;
    console.error('design:audit-deps FAIL ' + module + ' bundles npm modules: ' + npm.join(', '));
  } else {
    console.log('design:audit-deps ' + module + ': zero npm modules in graph ✓');
  }
}

console.log('design:audit-deps running bun audit (repo deps)...');
const audit = Bun.spawn([Bun.which('bun') ?? 'bun', 'audit'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
const out = await new Response(audit.stdout).text();
const err = await new Response(audit.stderr).text();
await audit.exited;
if (out.trim()) console.log(out.trim());
if (err.trim()) console.error(err.trim());
const auditFindings = audit.exitCode !== 0;
if (auditFindings && failOnAudit) violations += 1;
if (auditFindings) console.warn('design:audit-deps: bun audit found issues (pass --fail to gate on them)');

if (violations) {
  console.error('design:audit-deps: ' + violations + ' violation(s)');
  process.exit(1);
}
console.log('design:audit-deps: ok');
