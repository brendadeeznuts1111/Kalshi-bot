#!/usr/bin/env bun
/**
 * `bun run design:build` — multi-module frontend bundle build.
 *
 * Bundles every frontend module in the design pipeline into dist/ with a
 * Bun metafile (dist/<module>.meta.json) + LLM-friendly markdown report
 * (dist/<module>.meta.md, the `--metafile-md` equivalent):
 *
 *   - design-system (src/institutions/design-system.ts) — TOKENS + color
 *     kernel public API, reusable from other projects without importing
 *     this repo's source.
 *   - hq-app (src/research/hq-app/app.js) — the live HQ browser module
 *     graph (hash-routes.ts + surface-edge.ts). The runtime serves it via
 *     Bun HTML imports (Bun.serve bundles on demand); this artifact is the
 *     analysis copy that feeds the per-module bundle budgets in
 *     tools/design-check.ts.
 *
 * target:browser — both modules are consumed by the web frontend (client
 * pattern); hq-app is browser-only and the design-system's only external
 * import (bun, via browser-constants.ts) stays external either way.
 *
 * Per-module outputs keep the filenames stable for design:watch (CLI
 * --outdir + --metafile-md) and for the design:check gate.
 */
import { join } from 'node:path';
import { DESIGN_MODULES, DESIGN_MODULE_NAMES } from '../src/lib/design-budget.ts';

const root = join(import.meta.dir, '..');

let failed = false;

for (const module of DESIGN_MODULE_NAMES) {
  const spec = DESIGN_MODULES[module];
  const entry = join(root, spec.entry);

  // API build — emits the minified bundle + JSON metafile.
  const out = await Bun.build({
    entrypoints: [entry],
    outdir: join(root, 'dist'),
    naming: spec.out,
    target: 'browser',
    minify: true,
    splitting: true, // §13 chunking: hq-app dynamic imports become chunks
    // Object form (probe §155): writes BOTH the JSON + the LLM-friendly
    // markdown report in one build call — the CLI --metafile-md re-build
    // (and its subprocess) is gone. res.metafile stays populated in-memory.
    // bun-types 1.4.0 types metafile as boolean only — the object form
    // is runtime-verified (§155/§163), so cast. IMPORTANT: json/markdown
    // paths resolve against the OUTDIR (even absolute ones get prefixed) —
    // relative names land in dist/<module>.meta.{json,md} correctly.
    metafile: {
      json: module + '.meta.json',
      markdown: module + '.meta.md',
    } as any,
  });
  if (!out.success) {
    for (const log of out.logs) console.error(String(log));
    failed = true;
    continue;
  }
  console.log('design:build ' + module + ' ->', out.outputs.map((o) => o.path).join(', ') + ' + ' + module + '.meta.json + ' + module + '.meta.md');
}

if (failed) process.exit(1);
