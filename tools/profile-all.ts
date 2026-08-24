#!/usr/bin/env bun
/**
 * `bun run profile:all` — run every profiler Bun ships, Markdown out.
 *
 *   --cpu-prof-md   -> CPU.<ts>.md  (our workloads: serve, research, design build)
 *   --heap-prof-md  -> Heap.<ts>.md
 *   --metafile-md   -> dist/*.meta.md (via design:build)
 *   bun ./README.md -> Markdown rendered to ANSI terminal
 *
 * Profiles are streamed/rendered for the terminal — no DevTools needed.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(import.meta.dir, '..');
const out = join(root, 'artifacts/profiles');
mkdirSync(out, { recursive: true });
const BUN = Bun.which('bun') ?? 'bun';

const run = async (label: string, args: string[]): Promise<number> => {
  console.error('profile:all ' + label + ' …');
  const p = Bun.spawn([BUN, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  const code = await p.exited;
  console.error('profile:all ' + label + (code === 0 ? ' ok' : ' FAILED (' + code + ')'));
  return code;
};

const cwdProfiles = ['--cpu-prof-md', '--heap-prof-md'];
const jobs: Array<[string, string[]]> = [
  ['cpu(serve)', ['--cpu-prof-md', 'src/research/serve.ts']],
  ['heap(design build)', ['--heap-prof-md', 'scripts/build-design-system.ts']],
  ['metafile(design)', ['run', 'design:build']],
  ['markdown-to-terminal', [root + '/docs/COLORS.md']],
];
let failed = 0;
for (const [label, args] of jobs) {
  const code = await run(label, args);
  if (code !== 0) failed += 1;
}
// CPU/Heap profiles land in CWD (no =path form) — list them.
console.error('profile:all done' + (failed ? ' with ' + failed + ' failure(s)' : '') + ' — CPU/Heap reports: ls -t CPU.*.md Heap.*.md');
process.exit(failed ? 1 : 0);
