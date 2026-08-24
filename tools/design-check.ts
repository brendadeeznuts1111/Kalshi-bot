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
console.log('design:check: ' + (audit.ok ? 'ok' : 'FAIL') + ' · ' + audit.issues.length + ' issue(s) · ' + surfaces.length + ' surfaces (v' + audit.version + ')');
process.exit(audit.ok ? 0 : 1);
