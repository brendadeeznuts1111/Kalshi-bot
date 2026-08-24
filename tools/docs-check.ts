#!/usr/bin/env bun
/**
 * `bun run docs:check` — verify the repo's own docs render through
 * Bun.markdown with unique native heading ids (the "docs managed by
 * Bun.markdown" contract, AGENT-PITFALLS §38).
 *
 * Exit 1 when any doc fails to render OR has duplicate heading slugs.
 * Writes .data/docs-state.json (per-doc hash/headings/render) so a
 * dashboard channel can report doc health offline.
 */
import { join } from 'node:path';
import { auditAllDocs } from '../src/lib/docs-audit.ts';

const ROOT = join(import.meta.dir, '..');
const docs = await auditAllDocs(ROOT);

let bad = 0;
for (const d of docs) {
  const problems: string[] = [];
  if (!d.renderOk) problems.push('RENDER FAIL: ' + (d.renderError ?? ''));
  if (d.duplicateSlugs.length) problems.push('DUPLICATE SLUGS: ' + d.duplicateSlugs.slice(0, 3).join(', '));
  console.log((problems.length ? 'FAIL ' : 'ok   ') + d.path.padEnd(28) + d.headings + ' headings · ' + d.bytes + ' B' + (problems.length ? ' — ' + problems.join('; ') : ''));
  if (problems.length) bad += 1;
}

const state = {
  lastChecked: new Date().toISOString(),
  docs: docs.map((d) => ({ path: d.path, hash: d.hash, headings: d.headings, renderOk: d.renderOk, duplicateSlugs: d.duplicateSlugs })),
  total: docs.length,
  failing: bad,
};
await Bun.write(join(ROOT, '.data/docs-state.json'), JSON.stringify(state, null, 2) + '\n');
console.log('docs:check — ' + (docs.length - bad) + '/' + docs.length + ' docs render cleanly' + (bad ? ' · ' + bad + ' FAILING' : ''));
process.exit(bad === 0 ? 0 : 1);