#!/usr/bin/env bun
/**
 * `bun run deps:diff` — bun pm diff for every runtime dependency: what
 * changed between the locked version and the latest published (files,
 * new install scripts, new child_process/fs/net/vm imports). Minified
 * files are un-minified before diffing; formatting-only changes skipped.
 */
import { join } from 'node:path';
const root = join(import.meta.dir, '..');
const pkg = (await Bun.file(join(root, 'package.json')).json()) as { dependencies: Record<string, string> };
let failed = 0;
for (const [name, version] of Object.entries(pkg.dependencies)) {
  // bun pm diff needs two published versions — file:/link:/git: specs
  // have no registry diff.
  if (/^(file|link|git|github|workspace):/.test(version)) {
    console.log('=== ' + name + ' === (skipped: ' + version + ' — no registry diff)');
    continue;
  }
  // Native shape (S228): Bun.$ tagged template with cwd + nothrow (async pipe capture).
  const proc = await Bun.$`bun pm diff ${name}`.cwd(root).nothrow();
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();
  if (proc.exitCode !== 0) {
    failed += 1;
    console.error('deps:diff ' + name + ' FAILED (' + proc.exitCode + '): ' + err.slice(0, 120));
    continue;
  }
  console.log('=== ' + name + ' ===');
  console.log(out.trim());
}
console.log('deps:diff done' + (failed ? ' with ' + failed + ' failure(s)' : ''));
process.exit(failed ? 1 : 0);
