#!/usr/bin/env bun
/**
 * blog:paste-coverage — extract code blocks from a plain-text rendering of the
 * Bun 1.4 blog post (the pasted body) and check each against the demo catalog
 * (the same DEMOS used by blog:coverage): which pasted code samples are covered
 * by an existing demo route/function in this repo, and which are not.
 *
 * Usage: bun tools/blog-paste-coverage.ts <paste-file>
 */
import { readFileSync } from 'node:fs';
import { matchDemo, DEMOS } from './blog-coverage-map.ts';

const PASTE_PATH = Bun.argv[2] ?? '/tmp/blog-paste.txt';
const text = readFileSync(PASTE_PATH, 'utf8');
const lines = text.split('\n');

// ---- extract code blocks from plain text --------------------------------
// A code block is a run of >=2 leading spaces; a standalone code-like single
// line (commands, one-liners) is also captured. Prose/table/list/heading
// lines are skipped.
const isCodeLike = (l: string): boolean => {
  const t = l.trim();
  if (!t) return false;
  if (t.startsWith('|')) return false;      // table row
  if (t.startsWith('- ')) return false;     // list item
  if (t.startsWith('#')) return false;      // heading
  if (t.startsWith('*') || t.startsWith('**')) return false;
  if (/^[A-Z][a-z]+[#:]/ .test(t)) return false; // prose sentence
  if (t === '↻ replay' || t === 'Expand' || t === '✓') return false;
  return true;
};
const isProse = (l: string): boolean => {
  const t = l.trim();
  if (!t) return false;
  // sentences ending with . and long words = prose
  if (t.length > 60 && /[a-z]{4,}/.test(t) && /[.?!]$/.test(t) && !t.includes('(') && !t.includes('{')) return true;
  return false;
};

const blocks: string[] = [];
let cur: string[] = [];
const flush = () => {
  if (cur.length) { blocks.push(cur.join('\n')); cur = []; }
};
const ONE_LINER = /^(bun |await |import |const |return |using |curl |process\.|export |job\.|proc\.|async |function |grep |ls |uname |ldd |chmod |NODE_|BUN_|npm |brew |docker |powershell |\[|#|\/\/|HTTP\/|Content-|\d|terminal:|data\(|hash:|fetch\(|scheduled|controller)/;
const isBlocker = (t: string): boolean => {
  if (!t) return true;
  if (t === '↻ replay' || t === 'Expand' || t === '✓' || t === '❯') return true;
  if (t.startsWith('|')) return true;    // table row
  if (t.startsWith('- ')) return true;   // list item
  if (t.startsWith('#')) return true;    // heading
  if (isProse(t)) return true;
  return false;
};
for (const raw of lines) {
  const t = raw.trim();
  const starts = t && isCodeLike(raw) && !isBlocker(t) && ONE_LINER.test(t);
  const continues = cur.length > 0 && t && isCodeLike(raw) && !isBlocker(t);
  if (starts || continues) {
    cur.push(t);
  } else {
    flush();
  }
}
flush();
// drop tiny single-line noise fragments that are clearly demo captions
const filtered = blocks.filter((b) => b.split('\n').length > 1 || /^(bun |await |import |const |return |using |curl |process\.|export |async |function |job\.|proc\.|grep |NODE_|BUN_)/.test(b));
blocks.length = 0;
blocks.push(...filtered);

// ---- classify kind ------------------------------------------------------
type Kind = 'ts' | 'js' | 'json' | 'shell' | 'output' | 'other';
function classify(b: string): Kind {
  const head = b.split('\n').slice(0, 3).join(' ');
  if (/^(curl|powershell|npm|brew|docker|bun |bunx|git |grep |ls |uname |ldd |chmod |NODE_|BUN_|❯|\$ )/.test(b.trim())) return 'shell';
  if (/^import |^const |^await |^export |^using |^return |^async |^function |Bun\.|new URL|process\.|fetch\(/.test(head)) return 'ts';
  if (/^<script|document\.|window\./.test(head)) return 'js';
  if (b.trim().startsWith('{') && /"[a-zA-Z]+"\s*:/.test(b)) return 'json';
  if (/^#|^\||^\*\*|^##|^Generated|^Quick|^Total |^Peak |^Duration/.test(b.trim())) return 'output';
  return 'other';
}

// ---- report -------------------------------------------------------------
const seen = new Set<string>();
let covered = 0;
let uncovered = 0;
const rows: Array<{ n: number; kind: Kind; firstLine: string; demo: string; covered: boolean }> = [];
for (const b of blocks) {
  const key = b.split('\n')[0]!.slice(0, 60);
  const d = matchDemo(b);
  const coveredFlag = !!d;
  if (coveredFlag) covered++; else uncovered++;
  rows.push({ n: rows.length, kind: classify(b), firstLine: key, demo: d ? d.route + ' (' + d.file + ')' : '', covered: coveredFlag });
}

console.log('=== Bun 1.4 paste → demo coverage ===');
console.log('code blocks extracted from paste:', blocks.length);
console.log('covered by an existing demo route/function:', covered);
console.log('uncovered:', uncovered, '· ' + (blocks.length ? Math.round((covered / blocks.length) * 100) : 0) + '%');
console.log();
console.log('--- uncovered ---');
for (const r of rows) {
  if (!r.covered) console.log('  [' + r.kind + '] ' + r.firstLine.slice(0, 70));
}
console.log();
console.log('--- sample covered ---');
let c = 0;
for (const r of rows) {
  if (r.covered && c < 8) { console.log('  [' + r.kind + '] ' + r.firstLine.slice(0, 48) + ' -> ' + r.demo.slice(0, 50)); c++; }
}
