#!/usr/bin/env bun
/**
 * `bun run content:verify` — hash-drift detection for the content tree.
 *
 * Re-hashes every manifest-referenced file and compares against the last
 * known hashes in .data/content-state.json. Mismatches mean content changed
 * since the last check — the ETags/feeds served from those files are stale
 * and a rebuild is warranted.
 *
 *   bun run content:verify              # report mismatches (exit 1 on drift)
 *   bun run content:verify -- --update  # record current hashes (baseline)
 *   bun run content:verify -- --rebuild # --update + append changelog entry
 *
 * Integrated with content:watch: on file change the watcher re-verifies and
 * refreshes the signal cache via /api/signals/actions/… (dynamic updates,
 * AGENT-PITFALLS §26).
 */
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { hashContent } from '../src/lib/content-pipeline.ts';
import { parseArgs } from 'node:util';

const root = join(import.meta.dir, '..');
const { values: cv } = parseArgs({ args: Bun.argv.slice(2), options: { update: { type: 'boolean' }, rebuild: { type: 'boolean' } }, strict: false, allowPositionals: true });
const update = cv.update === true || cv.rebuild === true;

const manifestPath = join(root, '.data/manifest.json');
const statePath = join(root, '.data/content-state.json');
const files: string[] = JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? [];

let state: Record<string, string> = {};
if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf8'));

let drifted = 0;
let added = 0;
const changed: string[] = [];
const current: Record<string, string> = {};

for (const f of files) {
  const abs = join(root, f);
  if (!existsSync(abs)) {
    console.log('missing ' + f);
    drifted += 1;
    changed.push(f);
    continue;
  }
  const h = hashContent(await Bun.file(abs).bytes());
  current[f] = h;
  if (state[f] === undefined) {
    added += 1;
  } else if (state[f] !== h) {
    drifted += 1;
    changed.push(f);
  }
}

console.log('content:verify — ' + files.length + ' manifest file(s): ' + drifted + ' drifted, ' + added + ' new, ' + (files.length - drifted - added) + ' unchanged');
for (const f of changed) console.log('  DRIFT ' + f);
if (drifted === 0 && !update) console.log('content:verify ok — hashes match state (ETags fresh)');

if (update || drifted > 0) {
  await Bun.write(statePath, JSON.stringify(current, null, 2) + '\n');
  console.log(update ? 'state updated -> ' + statePath : 'state rewritten (baseline)');
}
if (drifted > 0 && !update) process.exit(1);
