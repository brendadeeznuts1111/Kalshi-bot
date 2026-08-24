#!/usr/bin/env bun
/**
 * `bun run design:check` — design-system compliance gate for the LIVE hq
 * surfaces (hq-app/index.html, styles.css, app.js, color-vars.css) plus the
 * renderHq() template. Exits 1 on any hardcoded color/radius not in TOKENS.
 * Wired into `bun run check` and the pre-commit hook (conditional on
 * hq-app / design-system changes).
 */
import { join } from 'node:path';
import { designAgent } from '../src/agent/design-agent.ts';
import { renderHq } from '../src/research/hq-view.ts';

const ROOT = join(import.meta.dir, '..');
const hqAppDir = join(ROOT, 'src/research/hq-app');

const surfaces = [
  renderHq(),
  ...(await Promise.all([
    Bun.file(join(hqAppDir, 'index.html')).text().catch(() => ''),
    Bun.file(join(hqAppDir, 'styles.css')).text().catch(() => ''),
    Bun.file(join(hqAppDir, 'app.js')).text().catch(() => ''),
    Bun.file(join(hqAppDir, 'color-vars.css')).text().catch(() => ''),
  ])),
];
const audit = designAgent.audit(...surfaces);
for (const issue of audit.issues) {
  console.error('design:check ' + issue.kind + ' ' + issue.value + ' — ' + issue.detail);
}

// Bundle-size regression gate: the design-system dist must stay under
// MAX_BUNDLE_BYTES. Data comes from the --metafile-md report (dist/
// design-system.meta.md), built on demand when missing (gitignored).
const MAX_BUNDLE_BYTES = 12 * 1024; // 12 KB - headroom over the 4.77 KB current bundle
const metaMdPath = join(ROOT, 'dist/design-system.meta.md');
let metaMd = await Bun.file(metaMdPath).text().catch(() => '');
if (!metaMd) {
  const build = Bun.spawn([Bun.which('bun') ?? 'bun', 'scripts/build-design-system.ts'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  await build.exited;
  metaMd = await Bun.file(metaMdPath).text().catch(() => '');
}
const sizeMatch = metaMd.match(/Total output size\s*\|\s*([\d.]+)\s*([KM]?B)/);
if (sizeMatch) {
  const num = Number(sizeMatch[1]);
  const unit = sizeMatch[2];
  const bytes = unit === 'KB' ? num * 1024 : unit === 'MB' ? num * 1024 * 1024 : num;
  if (bytes > MAX_BUNDLE_BYTES) {
    console.error('design:check FAIL bundle size ' + bytes + 'B exceeds ' + MAX_BUNDLE_BYTES + 'B (' + sizeMatch[0] + ') - find bloat via dist/design-system.meta.md');
    process.exit(1);
  }
  console.log('design:check bundle: ' + sizeMatch[0] + ' (< ' + MAX_BUNDLE_BYTES + 'B)');
} else {
  console.log('design:check bundle: meta.md missing/unparsable - run design:build');
}
console.log('design:check: ' + (audit.ok ? 'ok' : 'FAIL') + ' · ' + audit.issues.length + ' issue(s) · ' + surfaces.length + ' surfaces (v' + audit.version + ')');
process.exit(audit.ok ? 0 : 1);
