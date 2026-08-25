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
import { auditDocsStyle } from '../src/lib/docs-style.ts';
import { validateDocsCode } from '../src/lib/docs-validate.ts';

const ROOT = join(import.meta.dir, '..');
const docs = await auditAllDocs(ROOT);

// Smart structure gate (not a dumb bullet count): a section that is an
// unstructured bullet wall (>= 6 flat bullets, no ### subsections, no
// tables) fails — the run-on prose pattern §55-57 used to be.
let bad = 0;
for (const d of docs) {
  const style = auditDocsStyle(await Bun.file(join(ROOT, d.path)).text(), d.path);
  for (const s of style) {
    console.log('FAIL ' + d.path + ' [' + s.section + '] — ' + s.detail);
    bad += 1;
  }
  const problems: string[] = [];
  if (!d.renderOk) problems.push('RENDER FAIL: ' + (d.renderError ?? ''));
  if (d.duplicateSlugs.length) problems.push('DUPLICATE SLUGS: ' + d.duplicateSlugs.slice(0, 3).join(', '));
  console.log((problems.length ? 'FAIL ' : 'ok   ') + d.path.padEnd(28) + d.headings + ' headings · ' + d.bytes + ' B' + (problems.length ? ' — ' + problems.join('; ') : ''));
  if (problems.length) bad += 1;
}

// Code-block validation — STRICT (fails the gate): every JS-family block
// must parse via Bun.Transpiler. Pseudo-code elision (… chars) and bare
// fragments (top-level return/catch/throw, body-less classes, bare object
// statements) are NOT allowed in js/ts fences — rewrite as comments or
// complete statements. docs:check catches stale blocks automatically.
const codeBlocks = await validateDocsCode(docs);
const codeFailures = codeBlocks.filter((v) => !v.ok && ["js", "jsx", "ts", "tsx", "typescript"].includes(v.language.toLowerCase()));
for (const f of codeFailures) {
  console.log('docs:check FAIL (code-block) ' + f.file + ':' + f.line + ' [' + f.language + '] — ' + (f.error ?? ''));
  bad += 1;
}

// Stale contract-count scan: every verify:contracts N/N reference must
// equal the CURRENT gate count, EXCEPT AGENT-PITFALLS body lines (a
// historical timeline — its HEADER must carry the current count).
const vc = await Bun.file(join(ROOT, 'tools/verify-contracts.ts')).text();
const gatesCount = (vc.match(/^\s*\['[^']+'/gm) ?? []).length;
const current = gatesCount + '/' + gatesCount;
for (const d of docs) {
  const md = await Bun.file(join(ROOT, d.path)).text();
  const refs = md.match(/verify:contracts (\d+)\/(\d+)/g) ?? [];
  for (const ref of refs) {
    if (ref === 'verify:contracts ' + current) continue;
    if (d.path.includes('AGENT-PITFALLS')) {
      const lineNo = md.slice(0, md.indexOf(ref)).split('\n').length;
      if (lineNo <= 40) { console.log('docs:check FAIL ' + d.path + ' header stale: ' + ref + ' (current ' + current + ')'); bad += 1; }
      continue;
    }
    console.log('docs:check FAIL ' + d.path + ' stale count: ' + ref + ' (current ' + current + ')');
    bad += 1;
  }
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