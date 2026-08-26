#!/usr/bin/env bun
/**
 * ui:regen - regenerate the UI artifacts from their meta/variant sources.
 *
 * Runs the UI generators (colors.css + color docs, sports-source registry,
 * blog-assets mirror) and, with --watch, watches the meta/variant SOURCE files
 * and re-runs the affected regen on change. The dev server (bun --hot serve)
 * picks up the regenerated artifacts automatically (§199).
 *
 * Bun.watch does NOT exist on 1.4.0 (undefined) - the watcher uses node:fs.watch.
 */
import { watch, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runBunCommand } from '../src/lib/run-bun.ts';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dir, '..');

type Regen = { label: string; source: string; run: () => Promise<{ ok: boolean }> };

const regens: Regen[] = [
  { label: 'colors', source: 'src/institutions/design-tokens.ts', run: () => runBunCommand(['run', 'colors:artifacts'], { cwd: ROOT }) },
  { label: 'sports-sources', source: 'src/institutions/market-registry/registry.ts', run: () => runBunCommand(['run', 'sports:registry:bake'], { cwd: ROOT }) },
  { label: 'blog-mirror', source: '.data/blog-map.json', run: () => runBunCommand(['run', 'blog:assets'], { cwd: ROOT }) },
];

async function runOne(r: Regen): Promise<void> {
  const out = await r.run();
  console.log('ui:regen - ' + r.label + (out.ok ? ' ok' : ' FAIL'));
}

const { values: uv } = parseArgs({ args: Bun.argv.slice(2), options: { watch: { type: 'boolean' } }, strict: false, allowPositionals: true });
const watchMode = uv.watch === true;
for (const r of regens) await runOne(r);
if (!watchMode) {
  console.log('ui:regen - done. Add --watch to auto-regen on meta/variant changes.');
  process.exit(0);
}

console.log('ui:regen - watching ' + regens.length + ' meta/variant sources...');
let timer: ReturnType<typeof setTimeout> | null = null;
for (const r of regens) {
  const abs = join(ROOT, r.source);
  if (!existsSync(abs)) { console.log('ui:regen - source missing: ' + r.source); continue; }
  watch(abs, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      console.log('ui:regen - change in ' + r.source + ' -> regenerating ' + r.label);
      await runOne(r);
    }, 250);
  });
}
await new Promise(() => setInterval(() => {}, 60_000));