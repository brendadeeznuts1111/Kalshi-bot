#!/usr/bin/env bun
/**
 * bun run reference-cross-check - docs side: locate the pinned bun-types
 * bundle, read its docs/ + bun.d.ts, and extract structured claims (178).
 * Offline. The bundle dir name is 1.4.0-<hash> (bun-types PACKAGE hash, not
 * the runtime revision) - same detection as tools/bun-shape.ts (168).
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

export async function getAllMdx(bundleRoot: string): Promise<string[]> {
  const files: string[] = [];
  for await (const f of new Glob('docs/**/*.mdx').scan({ cwd: bundleRoot, absolute: true })) files.push(f);
  return files.sort();
}

export async function readFile(path: string): Promise<string> {
  return await Bun.file(path).text();
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

export {};