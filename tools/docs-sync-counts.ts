#!/usr/bin/env bun
/**
 * bun run docs:sync-counts - AUTO-update the AGENT-PITFALLS header
 * verify:contracts N/N from the actual gates array (no manual bumps).
 * Structural derivation via src/lib/gate-count.ts (TS compiler API),
 * shared with docs:check - formatting changes cannot drift the count.
 * §167.
 */
import { join } from 'node:path';
import { countGates } from '../src/lib/gate-count.ts';
const ROOT = join(import.meta.dir, '..');
const count = countGates();
const pit = await Bun.file(join(ROOT, 'docs/AGENT-PITFALLS.md')).text();
const current = count + '/' + count;
const m = 'verify:contracts ';
const i0 = pit.indexOf(m);
if (i0 < 0) {
  console.error('docs:sync-counts: no verify:contracts marker in AGENT-PITFALLS.md');
  process.exit(1);
}
let i = i0 + m.length;
while (i < pit.length && pit.charCodeAt(i) >= 48 && pit.charCodeAt(i) <= 57) i += 1;
i += 1;
while (i < pit.length && pit.charCodeAt(i) >= 48 && pit.charCodeAt(i) <= 57) i += 1;
const next = pit.slice(0, i0) + m + current + pit.slice(i);
if (next !== pit) {
  await Bun.write(join(ROOT, 'docs/AGENT-PITFALLS.md'), next);
  console.log('header count synced to', current);
} else {
  console.log('header count already current', current);
}
process.exit(0);
