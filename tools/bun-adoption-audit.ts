/**
 * `bun run bun:adoption-audit` — report how much of Bun v1.4's stable
 * networking stack the repo uses (dir routes, fetch compress, h2 client).
 * Coverage report: ok = used, n/a = not applicable, GAP = feature exists
 * and applies but is unused (an adoption opportunity). Exits 1 when any
 * GAP exists (with --check; default just reports).
 *
 * @see docs/AGENT-PITFALLS.md (sections 19, 24-25)
 */
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { runAdoptionAudit } from '../src/lib/adoption-audit.ts';
import { statusLine } from '../src/lib/ansi-width.ts';

assertBunAtLeast('1.4.0', 'bun:adoption-audit');

const ROOT = join(import.meta.dir, '..');
const check = process.argv.includes('--check');
const checks = runAdoptionAudit(ROOT);
let gaps = 0;
for (const c of checks) {
  const mark = c.status === 'ok' ? 'ok' : c.status === 'gap' ? 'GAP' : 'n/a';
  if (c.status === 'gap') gaps++;
  console.log(statusLine(mark, c.name, c.detail));
}
console.log('adoption-audit: ' + (gaps === 0 ? 'no gaps - all applicable networking features adopted' : gaps + ' gap(s) - adoption opportunities') + ' · ' + checks.length + ' checks');
process.exit(check && gaps > 0 ? 1 : 0);