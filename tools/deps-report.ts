#!/usr/bin/env bun
/**
 * `bun run deps:report` — the dependency-health flow: runs every offline
 * gate (dedupe --check, prune --dry-run, audit) plus `bun pm diff` for each
 * npm runtime dep, and writes a markdown report to
 * research/outputs/deps-report.md (cron-able, like bun:release-watch).
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const root = join(import.meta.dir, '..');
const BUN = Bun.which('bun') ?? 'bun';

const run = async (args: string[]): Promise<{ ok: boolean; out: string }> => {
  // Native shape (S228): Bun.$ tagged template (async pipe capture).
  const p = await Bun.$`bun ${args}`.cwd(root).nothrow();
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() };
};

const pkg = (await Bun.file(join(root, 'package.json')).json()) as { dependencies: Record<string, string> };
const lines: string[] = ['# Dependency health — ' + new Date().toISOString(), '', 'Bun ' + Bun.version + ' · isolated linker (global virtual store).', ''];

const [dedupe, prune, audit] = await Promise.all([run(['dedupe', '--check']), run(['prune', '--dry-run']), run(['audit'])]);
lines.push('| Gate | Status | Detail |', '|---|---|---|');
lines.push('| dedupe --check | ' + (dedupe.ok ? 'ok' : 'FAIL') + ' | ' + (dedupe.out.split('\n').at(-1) ?? '') + ' |');
lines.push('| prune --dry-run | ' + (prune.ok ? 'ok' : 'FAIL') + ' | ' + (prune.out.split('\n').at(-1) ?? '') + ' |');
lines.push('| bun audit | ' + (audit.ok ? 'ok' : 'FAIL') + ' | ' + (audit.out.split('\n').at(-1) ?? '') + ' |');
lines.push('');

lines.push('## bun pm diff (locked vs latest)', '');
let failed = 0;
for (const [name, version] of Object.entries(pkg.dependencies)) {
  if (/^(file|link|git|github|workspace):/.test(version)) {
    lines.push('- ' + name + ': ' + version + ' (no registry diff)');
    continue;
  }
  const d = await run(['pm', 'diff', name]);
  if (!d.ok) { failed += 1; lines.push('- ' + name + ': diff FAILED'); continue; }
  const summary = d.out.split('\n').slice(0, 3).join(' · ');
  lines.push('- ' + name + ': ' + summary);
}
lines.push('', failed ? '⚠ ' + failed + ' diff(s) failed' : 'All diffs clean.');

mkdirSync(join(root, 'research/outputs'), { recursive: true });
const outPath = join(root, 'research/outputs/deps-report.md');
await Bun.write(outPath, lines.join('\n') + '\n');
console.log('wrote ' + outPath + (failed ? ' · ' + failed + ' failure(s)' : ''));
process.exit(failed ? 1 : 0);
