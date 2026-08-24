#!/usr/bin/env bun
/**
 * `bun run design:watch` — live rebuild of every frontend module in the
 * design pipeline (CLI --watch, the same flags as design:build per module).
 *
 * Spawns one bun build --watch process per module (design-system, hq-app),
 * each writing its own minified bundle + metafile JSON + markdown report.
 * Ctrl-C on the terminal kills the whole foreground process group, so both
 * watchers stop together; the script waits on both children.
 *
 * Shift-left feedback: after each rebuild burst (debounced 400ms), prints a
 * one-line budget status read from the fresh metafiles, so size regressions
 * surface the moment a file is saved — no need to run design:check.
 */
import { join } from 'node:path';
import { DESIGN_MODULES, DESIGN_MODULE_NAMES, summarizeBudgets } from '../src/lib/design-budget.ts';

const root = join(import.meta.dir, '..');
const BUN = Bun.which('bun') ?? 'bun';

let reportTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleReport = (): void => {
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(async () => {
    const line = await summarizeBudgets(root);
    process.stdout.write('\n✓ design:watch budgets · ' + line + '\n');
  }, 400);
};

const children = DESIGN_MODULE_NAMES.map((module) => {
  const spec = DESIGN_MODULES[module];
  const proc = Bun.spawn([
    BUN,
    'build', join(root, spec.entry),
    // --outfile (not --outdir): the CLI defaults the output name to the entry
    // basename (app.js for hq-app), which would litter dist/ with a duplicate.
    '--outfile=' + join(root, 'dist', spec.out),
    '--target=browser',
    '--minify',
    '--metafile=' + join(root, 'dist', module + '.meta.json'),
    '--metafile-md=' + join(root, 'dist', module + '.meta.md'),
    '--watch',
  ], { cwd: root, stdout: 'pipe', stderr: 'inherit' });
  (async () => {
    for await (const chunk of proc.stdout) {
      const text = new TextDecoder().decode(chunk);
      process.stdout.write(text);
      if (text.includes('Bundled') || /\.js\s+[\d.]+\s*KB/.test(text)) scheduleReport();
    }
  })();
  return proc;
});

console.log('design:watch — watching ' + DESIGN_MODULE_NAMES.join(', ') + ' (Ctrl-C to stop)');
await Promise.all(children.map((c) => c.exited));
