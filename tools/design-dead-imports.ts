#!/usr/bin/env bun
/**
 * `bun run design:dead-imports` — dead-import scan over the frontend module
 * graph (design-system + hq-app), reporting imported bindings with zero
 * body occurrences. Best-effort heuristic — warnings, not a hard gate.
 *
 *   bun run design:dead-imports          # report only (exit 0)
 *   bun run design:dead-imports -- --fail # exit 1 on any finding
 */
import { join } from 'node:path';
import { DESIGN_MODULE_NAMES, metaJsonPath } from '../src/lib/design-budget.ts';
import { scanDeadImports } from '../src/lib/design-deadcode.ts';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dir, '..');
const { values: dv } = parseArgs({ args: Bun.argv.slice(2), options: { fail: { type: 'boolean' } }, strict: false, allowPositionals: true });
const fail = dv.fail === true;

const files = new Set<string>();
for (const module of DESIGN_MODULE_NAMES) {
  const jsonText = await Bun.file(metaJsonPath(module, ROOT)).text().catch(() => '');
  if (!jsonText) continue;
  try {
    const inputs = (JSON.parse(jsonText) as { inputs?: Record<string, unknown> }).inputs ?? {};
    for (const path of Object.keys(inputs)) {
      if (path.startsWith('node_modules') || path.startsWith('bun')) continue;
      files.add(join(ROOT, path));
    }
  } catch {
    // skip unparsable metafile
  }
}

const dead = await scanDeadImports([...files]);
if (dead.length) {
  console.error('design:dead-imports ' + dead.length + ' potential dead import(s):');
  for (const d of dead) {
    console.error('  ' + d.file.replace(ROOT + '/', '') + ' imports ' + d.name + ' from ' + d.specifier);
  }
  if (fail) process.exit(1);
} else {
  console.log('design:dead-imports ok — ' + files.size + ' graph module(s), no dead imports');
}
