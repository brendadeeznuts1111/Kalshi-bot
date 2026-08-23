/**
 * `bun run bun:breaking-audit` — audit THIS repo against Bun v1.4 breaking
 * changes (docs/AGENT-PITFALLS.md section 16). Thin CLI over
 * src/lib/breaking-audit.ts (importable: runBreakingAudit /
 * breakingAuditPasses), so the same checks run in the pre-commit hook
 * without a separate process.
 *
 * Exits 0 when nothing needs action, 1 when a finding needs attention.
 *
 * @see docs/AGENT-PITFALLS.md (sections 16-17)
 */
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { runBreakingAudit, breakingAuditPasses } from '../src/lib/breaking-audit.ts';
import { statusLine } from '../src/lib/ansi-width.ts';

assertBunAtLeast('1.4.0', 'bun:breaking-audit');

const ROOT = join(import.meta.dir, '..');
const findings = runBreakingAudit(ROOT);
let problems = 0;
for (const f of findings) {
  const mark = f.status === 'ok' ? 'ok' : f.status === 'warn' ? 'WARN' : 'FAIL';
  if (f.status !== 'ok') problems++;
  console.log(statusLine(mark, f.check, f.detail));
}
console.log('breaking-audit: ' + (problems === 0 ? 'ok - no v1.4 breakage in this repo' : problems + ' finding(s) need attention') + ' · ' + findings.length + ' checks');
process.exit(breakingAuditPasses(findings) ? 0 : 1);