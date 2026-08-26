#!/usr/bin/env bun
/**
 * bun run reference-cross-check - docs side: locate the pinned bun-types
 * bundle, read its docs/ + bun.d.ts, and extract structured claims (178).
 * Offline. The bundle dir name is 1.4.0-<hash> (bun-types PACKAGE hash, not
 * the runtime revision) - same detection as tools/bun-shape.ts (168).
 *
 * Byte-cap-safe reading (byte-cap audit, 2026-08-26): these reads run
 * IN-PROCESS (bun CLI, no agent read cap), and the ledger REQUIRES full
 * reads - ledger fragments and interface blocks span all of bun.d.ts
 * (340KB; e.g. the jsx 'fragment?: string' anchor is at line ~3165, the
 * BuildConfig interface at ~2899). A head-slice would silently miss deep
 * anchors and flip claims to DOC-CHANGED. The guards below warn on true
 * giants; readHead()/getAllMdx(size filter) exist for head-scan and
 * many-doc use cases per the byte-cap guide.
 */
import { Glob } from 'bun';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PINNED = '1.4.0';

export function locateBundleRoot(ROOT: string): string {
  const cacheRoot = join(ROOT, 'node_modules/.bun-cache/links');
  const dir = readdirSync(cacheRoot)
    .filter((d) => d.startsWith('bun-types@' + PINNED + '-'))
    .sort()[0];
  if (!dir) throw new Error('no bundled bun-types@' + PINNED + ' under ' + cacheRoot + ' (run bun install)');
  return join(cacheRoot, dir, 'node_modules/bun-types');
}

export function locateCachePackage(ROOT: string, prefix: string): string {
  const cacheRoot = join(ROOT, 'node_modules/.bun-cache/links');
  const dir = readdirSync(cacheRoot)
    .filter((d) => d.startsWith(prefix))
    .sort()[0];
  if (!dir) throw new Error('no cached package ' + prefix + ' under ' + cacheRoot);
  return join(cacheRoot, dir, 'node_modules');
}

const MAX_MDX_SCAN_BYTES = 200 * 1024;
const MAX_FULL_READ_WARN_BYTES = 512 * 1024;

export async function getAllMdx(bundleRoot: string): Promise<string[]> {
  const files: string[] = [];
  for await (const f of new Glob('docs/**/*.mdx').scan({ cwd: bundleRoot, absolute: true })) {
    const stat = await Bun.file(f).stat();
    if (stat.size > MAX_MDX_SCAN_BYTES) {
      console.warn('reference-cross-check: skipping ' + f + ' (' + stat.size + ' bytes > ' + MAX_MDX_SCAN_BYTES + ')');
      continue;
    }
    files.push(f);
  }
  return files.sort();
}

/** Full read (needed for interface/fragment extraction spanning the file); warns on true giants. */
export async function readFile(path: string): Promise<string> {
  const stat = await Bun.file(path).stat();
  if (stat.size > MAX_FULL_READ_WARN_BYTES) {
    console.warn('reference-cross-check: full read of ' + path + ' (' + stat.size + ' bytes) - expected for bun.d.ts; verify intent if this is not it');
  }
  return await Bun.file(path).text();
}

/** Head-scan helper: first N bytes only (top-anchored fragments). Not for interface extraction. */
export async function readHead(path: string, bytes = 8192): Promise<string> {
  return await Bun.file(path).slice(0, bytes).text();
}

/** Field names of the first top-level `interface NAME { ... }` block (fields at 4-space indent). */
export function interfaceFields(content: string, name: string): string[] {
  const re = new RegExp('interface\\s+' + name + '(?:<|\\s|\\{)');
  const m = re.exec(content);
  if (!m) return [];
  const start = m.index;
  const open = content.indexOf('{', start);
  let depth = 0;
  let close = open;
  for (; close < content.length; close++) {
    const c = content[close];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const block = content.slice(open, close);
  const names: string[] = [];
  for (const m of block.matchAll(/^\s{2,8}([a-zA-Z_$][a-zA-Z0-9_$]*)\??:/gm)) names.push(m[1]!);
  return names;
}

/** First `interface X { ... }` whose body contains ALL needles; returns its name + field names. */
export function interfaceFieldsContaining(content: string, needles: string[]): { name: string; fields: string[] } | null {
  const re = /interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const open = content.indexOf('{', m.index);
    let depth = 0;
    let close = open;
    for (; close < content.length; close++) {
      const c = content[close];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const block = content.slice(open, close);
    if (needles.every((n) => block.includes(n))) {
      const fields: string[] = [];
      for (const fm of block.matchAll(/^\s{2,8}([a-zA-Z_$][a-zA-Z0-9_$]*)\??:/gm)) fields.push(fm[1]!);
      return { name: m[1]!, fields };
    }
    re.lastIndex = close;
  }
  return null;
}

/** Member names of the first `class NAME ... {` block (members at exactly 4-space indent). */
export function classMembers(content: string, name: string): string[] {
  const re = new RegExp('(?:export\\s+)?class\\s+' + name + '(?:\\s|\\<|implements|extends|\{)');
  const m = re.exec(content);
  if (!m) return [];
  const open = content.indexOf('{', m.index);
  let depth = 0;
  let close = open;
  for (; close < content.length; close++) {
    const ch = content[close];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  const block = content.slice(open, close);
  const names: string[] = [];
  for (const line of block.split('\n')) {
    const mm = line.match(/^\s{4}(?:static\s+|get\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\??:|<|\(|\s*=\s*[a-zA-Z_$])/);
    if (mm && mm[1] !== 'constructor' && !names.includes(mm[1]!)) names.push(mm[1]!);
  }
  return names;
}

export {};