#!/usr/bin/env bun
/**
 * Auto research loop: simplify backlog + tests.
 *
 *   bun run research:simplify
 *   bun run research:simplify -- --roots=src/inventory,tools/live-tracker-cli.ts
 *   bun run research:simplify -- --skip-tests
 *   bun run research:simplify -- --loop --interval=120
 *   bun run research:simplify -- --json
 *
 * Does **not** auto-rewrite production code by default. It ranks deletions /
 * inlines / test gaps. Apply simplifications in a normal PR after the report.
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import {
  formatSimplifyReport,
  runSimplifyLoopOnce,
  writeSimplifyReport,
} from '../src/research/simplify-loop.ts';



function usage(): never {
  console.error(`research:simplify — complexity scan + focused tests

  bun run research:simplify
  bun run research:simplify -- --roots=src/inventory,tools/live-tracker-cli.ts
  bun run research:simplify -- --skip-tests --json
  bun run research:simplify -- --loop --interval=120

Writes research/reports/simplify-loop/latest.{md,json}
`);
  process.exit(1);
}

if (hasFlag('help') || hasFlag('h')) usage();

const roots = (argValue('roots') ?? 'src/inventory,tools/live-tracker-cli.ts')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const skipTests = hasFlag('skip-tests');
const loop = hasFlag('loop');
const intervalSec = Math.max(30, Number(argValue('interval') ?? '120') || 120);
const asJson = hasFlag('json');

async function once(): Promise<number> {
  const report = await runSimplifyLoopOnce({ roots, skipTests });
  const paths = await writeSimplifyReport(report);
  if (asJson) {
    console.log(JSON.stringify({ ...report, wrote: paths }, null, 2));
  } else {
    console.log(formatSimplifyReport(report));
    console.error(`\nwrote ${paths.md}`);
  }
  const actions = report.findings.filter(f => f.severity === 'action').length;
  const testFail = report.test.ran && report.test.ok === false;
  return testFail ? 1 : actions > 40 ? 0 : 0;
}

const code = await once();
if (loop) {
  console.error(`# loop every ${intervalSec}s (Ctrl-C to stop)`);
  for (;;) {
    await Bun.sleep(intervalSec * 1000);
    await once();
  }
}
process.exit(code);
