#!/usr/bin/env bun
/**
 * scratch:sweep - archive dead probe files from scratch/.
 *
 * Candidates: top-level probe/log files flagged ORPHANED by scratch:docs
 * (basename not referenced by any committed code/docs) AND untouched for
 * > STALE_DAYS (default 45). Default is --dry-run (list only); --apply
 * moves them into scratch/.stale/<YYYY-MM-DD>/ and regenerates the README
 * index. Age is checked at sweep time only - the README stays byte-stable.
 */
import { readdirSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { isOrphaned, classify, generate } from './scratch-docs.ts';

const ROOT = join(import.meta.dir, '..');
const SCRATCH = join(ROOT, 'scratch');
const STALE_DAYS = Number(process.env.SCRATCH_STALE_DAYS ?? 45);
const apply = process.argv.includes('--apply');

const now = Date.now();
const candidates: string[] = [];
for (const n of readdirSync(SCRATCH).sort()) {
  if (n === 'README.md' || n === '.stale') continue;
  const pth = join(SCRATCH, n);
  const st = statSync(pth);
  if (!st.isFile()) continue;
  const kind = classify(n);
  if (kind !== 'probe' && kind !== 'log') continue;
  if (!isOrphaned(n)) continue;
  const ageDays = (now - st.mtimeMs) / 86400000;
  if (ageDays > STALE_DAYS) candidates.push(n);
}

if (candidates.length === 0) {
  console.log('scratch:sweep — no stale orphaned probe/log files (' + STALE_DAYS + 'd threshold)');
  process.exit(0);
}
console.log('scratch:sweep ' + (apply ? 'APPLY' : 'DRY-RUN') + ' — ' + candidates.length + ' candidate(s) >' + STALE_DAYS + 'd:');
for (const n of candidates) console.log('  - ' + n);
if (!apply) {
  console.log('  (re-run with --apply to archive)');
  process.exit(0);
}
const stamp = new Date().toISOString().slice(0, 10);
const dest = join(SCRATCH, '.stale', stamp);
mkdirSync(dest, { recursive: true });
for (const n of candidates) renameSync(join(SCRATCH, n), join(dest, n));
const { writeFileSync } = await import('node:fs');
writeFileSync(join(SCRATCH, 'README.md'), generate());
console.log('scratch:sweep — archived ' + candidates.length + ' file(s) to scratch/.stale/' + stamp + '/ and regenerated README');