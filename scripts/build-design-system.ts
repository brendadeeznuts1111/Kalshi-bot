#!/usr/bin/env bun
/**
 * `bun run design:build` — single-file bundle of the design-system public
 * API (TOKENS + color kernel) via Bun.build. Output: dist/design-system.mjs
 * Reusable from other projects without importing this repo's source.
 */
import { join } from 'node:path';
const root = join(import.meta.dir, '..');
// Filename parity: design:watch (CLI --outdir) produces the same (bun.com/blog/bun-v1.4): minify for the shipped
// dist (client pattern) + metafile:true so the bundle is analyzable
// (--metafile-md equivalent; perf-audit verifies this flag). target:bun
// is the server pattern; single entry, so no code splitting needed.
const out = await Bun.build({
  entrypoints: [join(root, 'src/institutions/design-system.ts')],
  outdir: join(root, 'dist'),
  naming: 'design-system.js', // same filename as design:watch (CLI --outdir)
  target: 'bun',
  minify: true,
  metafile: true,
});
if (!out.success) {
  for (const log of out.logs) console.error(String(log));
  process.exit(1);
}
if (out.metafile) {
  await Bun.write(join(root, 'dist/design-system.meta.json'), JSON.stringify(out.metafile, null, 2));
}
// Markdown bundle report (--metafile-md, LLM-friendly) via the CLI - the API
// has no md emitter; the CLI re-build is ~4ms for this 8-module bundle.
const mdProc = Bun.spawn([
  Bun.which('bun') ?? 'bun',
  'build', join(root, 'src/institutions/design-system.ts'),
  '--outdir=' + join(root, 'dist'), '--target=bun', '--minify',
  '--metafile-md=' + join(root, 'dist/design-system.meta.md'),
], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
await mdProc.exited;
if (mdProc.exitCode !== 0) {
  console.error('metafile-md report failed:', await new Response(mdProc.stderr).text());
  process.exit(1);
}
console.log('design:build ->', out.outputs.map((o) => o.path).join(', ') + ' + meta.json + meta.md');
