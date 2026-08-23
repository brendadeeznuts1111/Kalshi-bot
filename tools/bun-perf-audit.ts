/**
 * `bun run bun:perf-audit` — verify the repo keeps the Bun v1.4 toolchain
 * wins (global store, parallel tests, metafile analysis, CI audit/dedupe).
 * Thin CLI over src/lib/perf-audit.ts.
 *
 * Exits 1 when any check is 'warn' (a regression of an adopted win);
 * 'n/a' checks (e.g. no Bun.build usage) do not fail.
 *
 * @see docs/AGENT-PITFALLS.md (sections 23-24)
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { runPerfAudit, perfAuditPasses } from '../src/lib/perf-audit.ts';
import { statusLine } from '../src/lib/ansi-width.ts';

assertBunAtLeast('1.4.0', 'bun:perf-audit');

const ROOT = join(import.meta.dir, '..');
const GLOBAL_BUNFIG = join(homedir(), '.bunfig.toml');
const checks = runPerfAudit(ROOT, GLOBAL_BUNFIG);
let problems = 0;
for (const c of checks) {
  const mark = c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'WARN' : 'n/a';
  if (c.status === 'warn') problems++;
  console.log(statusLine(mark, c.name, c.detail));
}
console.log('perf-audit: ' + (problems === 0 ? 'ok - all toolchain wins in place' : problems + ' warning(s)') + ' · ' + checks.length + ' checks');
process.exit(perfAuditPasses(checks) ? 0 : 1);