#!/usr/bin/env bun
/**
 * `bun run design:browser-safety` — standalone run of the browser-safety
 * lint (also wired into design:check): no file in the frontend module
 * graph may reference Bun at runtime except kernel.ts's guarded
 * HAS_BUN_COLOR branch.
 *
 *   bun run design:browser-safety
 */
import { join } from 'node:path';
import { DESIGN_MODULE_NAMES, metaJsonPath } from '../src/lib/design-budget.ts';
import { checkBrowserSafety } from '../src/lib/design-browser-safety.ts';

const ROOT = join(import.meta.dir, '..');

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

const violations = await checkBrowserSafety([...files]);
if (violations.length) {
  console.error('design:browser-safety FAIL — ' + violations.length + ' unguarded Bun reference(s):');
  for (const v of violations) console.error('  ' + v.file.replace(ROOT + '/', '') + ': ' + v.detail);
  process.exit(1);
}
console.log('design:browser-safety ok — ' + files.size + ' graph module(s), all Bun references guarded/exempt');
