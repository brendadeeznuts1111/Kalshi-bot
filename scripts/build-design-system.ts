#!/usr/bin/env bun
/**
 * `bun run design:build` — single-file bundle of the design-system public
 * API (TOKENS + color kernel) via Bun.build. Output: dist/design-system.mjs
 * Reusable from other projects without importing this repo's source.
 */
import { join } from 'node:path';
const root = join(import.meta.dir, '..');
const out = await Bun.build({
  entrypoints: [join(root, 'src/institutions/design-system.ts')],
  outdir: join(root, 'dist'),
  naming: 'design-system.mjs',
  target: 'bun',
  minify: false,
});
if (!out.success) {
  for (const log of out.logs) console.error(String(log));
  process.exit(1);
}
console.log('design:build ->', out.outputs.map((o) => o.path).join(', '));
