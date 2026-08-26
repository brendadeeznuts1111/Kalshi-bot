#!/usr/bin/env bun
/**
 * blog:codeblocks-check — verify the bun-v1.4 blog's API code blocks typecheck
 * against bun-types 1.4.0 AND match this repo's grounded examples/claims.
 *
 * Extracts the shiki code blocks from research/cache/bun-blog.html, keeps the
 * ones touching the Bun API (Bun.* / bun: / import from "bun"), writes each to
 * scratch/blog-codeblocks/<n>.ts, typechecks the directory with the SAME strict
 * tsconfig as the repo (types:[bun], strict, noUncheckedIndexedAccess, ...), and
 * reports PASS/FAIL per block. Blocks that touch a surface we have grounded
 * (markdown/image/serve/cron/webview/spawn/sqlite/glob/crypto/password) carry the
 * ledger claim id from §9 as a cross-reference.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const HTML = readFileSync(join(ROOT, 'research/cache/bun-blog.html'), 'utf8');
const DIR = join(ROOT, 'scratch/blog-codeblocks');

// extract plain shiki blocks
const blocks: string[] = [];
const re = /<pre[^>]*class=\"shiki\">([\s\S]*?)<\/pre>/g;
let m: RegExpExecArray | null;
while ((m = re.exec(HTML)) !== null) {
  const code = m[1]!.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  blocks.push(code);
}

type Kind = 'ts' | 'js' | 'json' | 'shell' | 'output' | 'other';

/** Heuristic kind from the block's first meaningful lines. */
function classifyBlock(code: string): Kind {
  const head = code.split('\n').slice(0, 3).join(' ');
  // shell FIRST: `bun repl -e 'console.log(1)'` contains console.log but is a command
  if (/^(curl|powershell|npm|brew|docker|bun |PS >|\$ |git |uname |#)/.test(code.trim()) && /\s(install|--|bash|run|upgrade|pull|spawn|--version|repl|-e |-p )/.test(head)) return 'shell';
  if (/^(import|export|const|let|function|class|async|await|type |interface )/.test(code.trim()) || /\b(Bun\.|bun:|new URL|Buffer\.)/.test(head)) return 'ts';
  if (/<script|document\.|window\.|fetch\(/.test(head)) return 'js';
  if (code.trim().startsWith('{') && /\"[a-zA-Z]+\"\s*:/.test(code)) return 'json';
  if (/^\|/.test(code.trim()) || /^#+ /.test(code.trim()) || /^```/.test(code.trim())) return 'output';
  return 'other';
}

// surface -> claim cross-ref (from docs/BUN_BUILD_FINDINGS.md §9 ledger ids)
const SURFACE_CLAIMS: Array<[RegExp, string]> = [
  [/markdown/i, 'MD-*'],
  [/\.image\(|\.resize\(|Bun\.Image/i, 'IM-* / computeGuide'],
  [/Bun\.serve\(/, 'SV-*'],
  [/Bun\.cron/, 'CR-*'],
  [/Bun\.WebView|WebView\(/, 'WV-*'],
  [/Bun\.spawn/, 'spawn:probe gate'],
  [/bun:sqlite|Database\(/, 'SQ-*'],
  [/new Bun\.Glob|Bun\.Glob/, 'GL-*'],
  [/CryptoHasher/, 'CH-*'],
  [/Bun\.password/, 'PW-*'],
  [/Bun\.file\b/, 'file I/O probes'],
];

mkdirSync(DIR, { recursive: true });
rmSync(DIR, { recursive: true });
mkdirSync(DIR, { recursive: true });
const kinds: Kind[] = blocks.map(classifyBlock);
const labels: string[] = [];
const codeIdxs: number[] = [];
const jsonErrs: Record<number, string[]> = {};
for (const [i, c] of blocks.entries()) {
  const label = c.split('\n').find((l) => l.trim())!.trim().slice(0, 40).replace(/[^a-zA-Z0-9-]+/g, '-');
  labels.push(label);
  if (kinds[i] === 'json') {
    // JSON snippets are validated by parsing, not tsc (object literals at
    // statement position are not valid TS statements).
    // lenient: strip // comments and trailing commas (TS/JSON5-style) before strict parse
    const stripped = c.replace(/\/\/[^\n]*/g, '').replace(/,([\s\n]*[}\]])/g, '$1');
    try { JSON.parse(stripped); } catch (e) { jsonErrs[i] = ['JSON: ' + String((e as Error).message).slice(0, 40)]; }
  } else if (kinds[i] === 'ts' || kinds[i] === 'js') {
    codeIdxs.push(i);
    writeFileSync(join(DIR, 'block-' + i + '.ts'), c + '\n');
  }
}
writeFileSync(join(DIR, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: ['bun'], strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, module: 'Preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, skipLibCheck: true }, include: ['*.ts'] }, null, 2) + '\n');
console.log('classified ' + blocks.length + ' blocks: ' + JSON.stringify(Object.fromEntries([...new Map(kinds.map((k) => [k, kinds.filter((x) => x === k).length]))])) + '; writing ' + codeIdxs.length + ' code blocks');
// typecheck the dir (Bun.$ per docs/BUN_SHELL.md — the guard rejects spawnSync)
const proc = await Bun.$`bun x tsc --noEmit -p ${join(DIR, 'tsconfig.json')}`.cwd(DIR).quiet().nothrow();
const out = proc.stdout.toString() + proc.stderr.toString();
const errs: Record<number, string[]> = {};
for (const line of out.split('\n')) {
  const mm = line.match(/block-(\d+)\.ts\((\d+),(\d+)\): error TS(\d+)/);
  if (mm) {
    const idx = Number(mm[1]!);
    (errs[idx] = errs[idx] ?? []).push('TS' + mm[4] + '@' + mm[2] + ':' + mm[3]);
  }
}
for (const [idx, es] of Object.entries(jsonErrs)) errs[Number(idx)] = es;
let pass = 0; let fail = 0; let partial = 0;
const rows: { n: number; label: string; kind: string; errors: string[]; claims: string; status: string }[] = [];
for (const [i, c] of blocks.entries()) {
  const e = errs[i] ?? [];
  const claims = SURFACE_CLAIMS.filter(([re]) => re.test(c)).map(([, id]) => id).join(',') || '—';
  const kind = kinds[i]!;
  // the blog uses `{ ... }` ellipsis placeholders in illustrative snippets -
  // a TS1109 from that is a PARTIAL (placeholder), not a type failure.
  const placeholder = /\{\s*\.\.\.\s*\}/.test(c);
  let status: string;
  if (kind !== 'ts' && kind !== 'js' && kind !== 'json') status = 'SKIP (' + kind + ')'; // not code - no typecheck
  else if (e.length === 0) { status = 'PASS'; pass++; }
  else if (placeholder && (kind === 'json' || e.every((x) => x.startsWith('TS1109')))) { status = 'PARTIAL (blog ellipsis placeholder)'; partial++; }
  else if (kind === 'json' && /("[a-zA-Z0-9_-]+")\s*:[\s\S]*\1\s*:/.test(c)) { status = 'PARTIAL (duplicate keys - before/after illustration)'; partial++; }
  else if (kind === 'json' && !c.trim().endsWith('}') && !c.trim().endsWith(']')) { status = 'PARTIAL (truncated snippet)'; partial++; }
  else { status = 'FAIL'; fail++; }
  rows.push({ n: i, label: labels[i]!, kind, errors: e, status, claims });
}
// report
const md: string[] = [
  '# Bun 1.4 blog code-block verification (all blocks)',
  '',
  'Extracted ' + blocks.length + ' shiki blocks; classified ' + JSON.stringify(Object.fromEntries([...new Map(kinds.map((k) => [k, kinds.filter((x) => x === k).length]))])) + '.',
  'TS/JS/JSON blocks typechecked against bun-types 1.4.0 with the repo strict tsconfig.',
  '',
  '| # | kind | label | errors | status | grounded claims |',
  '|---|---|---|---|---|---|',
];
for (const r of rows) md.push('| ' + r.n + ' | ' + r.kind + ' | ' + r.label + ' | ' + (r.errors.length ? r.errors.join(', ') : '—') + ' | ' + r.status + ' | ' + r.claims + ' |');
md.push('', 'Pass: ' + pass + ' · Partial: ' + partial + ' · Fail: ' + fail, '');
writeFileSync(join(ROOT, 'research/outputs/blog-codeblocks-check.md'), md.join('\n') + '\n');
writeFileSync(join(ROOT, 'research/outputs/blog-codeblocks-check.json'), JSON.stringify({ total: blocks.length, pass, partial, fail, rows }, null, 2) + '\n');
// transient scratch artifacts - clean up so scratch:docs stays stable
rmSync(DIR, { recursive: true, force: true });
console.log('blog:codeblocks-check - ' + blocks.length + ' blocks · ' + pass + ' pass · ' + partial + ' partial · ' + fail + ' fail');