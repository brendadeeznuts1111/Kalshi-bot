#!/usr/bin/env bun
/**
 * `bun run imports:graph` — the repo's import graph via Bun.Transpiler.scan
 * (native; loader:"tsx" so type-only imports/exports are IGNORED, §52).
 *
 * Scans every .ts/.tsx under src/, lists imports/exports per file, and
 * reports:
 *   - total files/imports/exports
 *   - duplicate-specifier files (same module imported more than once —
 *     usually harmless but a lint smell)
 *   - internal vs external import counts
 *
 * Exit 0 always (informational); --check exits 1 on duplicate specifiers.
 */
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const flags = Bun.argv.slice(2);
const check = flags.includes('--check');
const t = new Bun.Transpiler({ loader: 'tsx' });

const files: string[] = [];
for (const f of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: join(ROOT, 'src'), onlyFiles: true })) {
  if (f.endsWith('.d.ts')) continue;
  files.push(f);
}

let totalImports = 0;
let totalExports = 0;
let internal = 0;
let external = 0;
const dupFiles: Array<{ file: string; specifier: string; count: number }> = [];

for (const f of files) {
  const src = await Bun.file(join(ROOT, 'src', f)).text();
  let s: { exports: string[]; imports: Array<{ kind: string; path: string }> };
  try {
    s = t.scan(src);
  } catch {
    console.log('PARSE-FAIL ' + f);
    continue;
  }
  totalImports += s.imports.length;
  totalExports += s.exports.length;
  const counts = new Map<string, number>();
  for (const i of s.imports) {
    if (i.path.startsWith('.') || i.path.startsWith('/')) internal += 1;
    else external += 1;
    counts.set(i.path, (counts.get(i.path) ?? 0) + 1);
  }
  for (const [spec, n] of counts) {
    if (n > 1) dupFiles.push({ file: f, specifier: spec, count: n });
  }
}

console.log('imports:graph — ' + files.length + ' files · ' + totalImports + ' imports (' + internal + ' internal / ' + external + ' external) · ' + totalExports + ' exports');
if (dupFiles.length) {
  console.log('duplicate specifiers (' + dupFiles.length + '):');
  for (const d of dupFiles) console.log('  ' + d.file + ' -> ' + d.specifier + ' x' + d.count);
} else {
  console.log('no duplicate specifiers');
}
process.exit(check && dupFiles.length ? 1 : 0);