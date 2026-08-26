#!/usr/bin/env bun
/**
 * `bun run assets:check` — content-hashed asset gate (the docs/content
 * check model extended to images referenced from markdown).
 *
 * For every markdown file (content/posts + docs): extract image refs
 * (render() image callback + HTML <img> regex, probe-verified §46), verify
 * local files EXIST, hash them, and diff against .data/assets-state.json.
 * Exit 1 on: missing referenced image, or hash drift (content changed).
 * --update re-baselines the state (like docs:check/content:verify).
 */
import { join } from 'node:path';
import { auditMarkdownAssets, hashFileBytes } from '../src/lib/assets-audit.ts';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dir, '..');
const STATE_PATH = join(ROOT, '.data/assets-state.json');
const { values: uv } = parseArgs({ args: Bun.argv.slice(2), options: { update: { type: 'boolean' } }, strict: false, allowPositionals: true });
const update = uv.update === true;

// all markdown sources: content/posts/*.md + docs/*.md
const globs = ['content/posts/*.md', 'docs/*.md'];
const files: string[] = [];
for (const g of globs) {
  for (const f of new Bun.Glob('*.md').scanSync({ cwd: join(ROOT, g.split('/')[0] === 'content' ? 'content/posts' : 'docs'), onlyFiles: true })) {
    files.push(g.startsWith('content') ? 'content/posts/' + f : 'docs/' + f);
  }
}

let state: Record<string, string> = {};
try { state = await Bun.file(STATE_PATH).json(); } catch { /* first run */ }

const current: Record<string, string> = {};
let missing = 0;
let drifted = 0;
let total = 0;
const problems: string[] = [];

for (const rel of files) {
  const abs = join(ROOT, rel);
  const md = await Bun.file(abs).text();
  const { refs } = await auditMarkdownAssets(abs, md);
  for (const ref of refs) {
    if (ref.resolved === undefined) continue; // remote
    const audit = ref.audit!;
    total += 1;
    const key = ref.resolved;
    current[key] = audit.hash;
    if (!audit.exists) { missing += 1; problems.push('MISSING ' + rel + ' -> ' + ref.src); continue; }
    if (state[key] !== undefined && state[key] !== audit.hash) { drifted += 1; problems.push('DRIFT ' + rel + ' -> ' + ref.src); }
  }
}

for (const p of problems) console.log('FAIL  ' + p);
if (update) {
  await Bun.write(STATE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log('assets:check --update: state written (' + Object.keys(current).length + ' assets)');
  process.exit(0);
}

console.log('assets:check — ' + total + ' referenced asset(s): ' + (total - missing - drifted) + ' ok' + (missing ? ' · ' + missing + ' MISSING' : '') + (drifted ? ' · ' + drifted + ' DRIFTED' : ''));
process.exit(missing + drifted === 0 ? 0 : 1);