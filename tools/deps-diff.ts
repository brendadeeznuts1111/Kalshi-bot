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
  const proc = Bun.spawn([Bun.which('bun') ?? 'bun', 'pm', 'diff', name], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;
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
