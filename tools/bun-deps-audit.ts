/**
 * `bun run bun:deps-audit` — report on Bun-native adoption vs replaced npm
 * packages (the v1.4 'dependency killer' table; docs/AGENT-PITFALLS.md).
 *
 * Two halves:
 *   1. REPLACED PACKAGES: any of the npm packages Bun natively replaces, in
 *      package.json deps OR source imports, is a violation (exit 1). This
 *      is the dependency-killer scan; the guard bans them too (this tool
 *      reports the adoption picture instead of just failing).
 *   2. NATIVE USAGE: counts how often the Bun replacements actually appear
 *      in src/tools (positive coverage), so the report shows both sides:
 *      what we eliminated and what we adopted.
 *
 * Flags:
 *   --check   exit 1 if any replaced package is found (gate-able).
 *
 * @see docs/AGENT-PITFALLS.md (verify, then act)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rgFiles, escapeForRg } from '../src/lib/rg.ts';
import { assertBunAtLeast } from '../src/research/bun-native.ts';

assertBunAtLeast('1.4.0', 'bun:deps-audit');

const ROOT = join(import.meta.dir, '..');

/** npm package -> Bun-native replacement (the v1.4 dependency-killer table). */
export const REPLACEMENTS: Record<string, string> = {
  express: 'Bun.serve',
  'serve-static': 'Bun.serve routes { dir }',
  sirv: 'Bun.serve routes { dir }',
  json5: 'Bun.JSON5.parse/stringify',
  ndjson: 'Bun.JSONL.parse/parseChunk',
  'jsonc-parser': 'Bun.JSONC.parse',
  'fast-xml-parser': 'Bun.XML.parse',
  xml2js: 'Bun.XML.parse',
  '@iarna/toml': 'Bun.TOML.parse/stringify',
  tar: 'Bun.Archive',
  'path-to-regexp': 'URLPattern',
  'string-width': 'Bun.stringWidth',
  'slice-ansi': 'Bun.sliceAnsi',
  'wrap-ansi': 'Bun.wrapAnsi',
  'cli-truncate': 'Bun.sliceAnsi',
  compression: 'CompressionStream',
  pako: 'CompressionStream/DecompressionStream',
  concurrently: 'bun run --parallel',
  'npm-run-all': 'bun run --parallel',
  marked: 'Bun.markdown',
  'node-cron': 'Bun.cron()',
  puppeteer: 'Bun.WebView',
  sharp: 'Bun.Image',
  'node-pty': 'Bun.Terminal',
  'strip-ansi': 'Bun.stripANSI()',
  'escape-html': 'Bun.escapeHTML()',
  'cli-table': 'Bun.inspect.table()',
  'cli-table3': 'Bun.inspect.table()',
};

/** Native Bun APIs that replace the npm packages (positive adoption view). */
const NATIVE_APIS = [
  'Bun.serve', 'Bun.JSON5', 'Bun.JSONL', 'Bun.JSONC', 'Bun.XML', 'Bun.TOML',
  'Bun.Archive', 'URLPattern', 'Bun.stringWidth', 'Bun.sliceAnsi', 'Bun.wrapAnsi',
  'Bun.markdown', 'Bun.cron', 'Bun.WebView', 'Bun.Image', 'Bun.Terminal',
  'Bun.escapeHTML', 'Bun.inspect.table', 'CompressionStream', 'Bun.dns',
  'Bun.redis', 'Bun.sql', 'Bun.spawn', 'Bun.file', 'Bun.write', 'Bun.connect',
  'Bun.serve routes { dir }',
].map((a) => a.replace('Bun.serve routes { dir }', 'dir: joinPath\|{ dir:'));

function grepCount(pattern: string, dirs: string[]): number {
  // Shared rgFiles with count:true (audit self-exclusion structural -
  // the audit's own source mentions native APIs in its table text).
  const lines = rgFiles('', pattern, dirs, { count: true });
  return lines.reduce((sum, line) => {
    const m = line.match(/:(\d+)$/);
    return sum + (m ? Number(m[1]) : 0);
  }, 0);
}

function main(): number {
  const check = process.argv.includes('--check');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const src = [join(ROOT, 'src'), join(ROOT, 'tools')];

  console.log('bun:deps-audit — Bun-native adoption vs replaced npm packages');
  console.log('');

  // 1. Replaced packages: in deps OR imported in source.
  const violations: Array<{ pkg: string; where: string }> = [];
  for (const [pkgName, replacement] of Object.entries(REPLACEMENTS)) {
    if (pkgName in allDeps) violations.push({ pkg: pkgName, where: 'package.json dependency' });
    const importHits = rgFiles(ROOT, '(from|require\()["\' ]' + pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), src);
    if (importHits.length > 0) {
      violations.push({ pkg: pkgName, where: 'import in: ' + importHits.join(', ') });
    }
  }
  const depNames = Object.keys(allDeps).sort();
  console.log('dependencies (' + depNames.length + '): ' + (depNames.join(', ') || '(none)'));
  if (violations.length === 0) {
    console.log('replaced packages: NONE found in deps or imports — clean');
  } else {
    for (const v of violations) console.log('VIOLATION: ' + v.pkg + ' -> ' + v.where + ' (use ' + REPLACEMENTS[v.pkg] + ')');
  }

  // 2. Native usage counts (positive adoption coverage).
  console.log('');
  console.log('native API usage in src+tools:');
  const usage: Array<{ api: string; count: number }> = [];
  for (const api of NATIVE_APIS) {
    const count = grepCount(escapeForRg(api), src); // literal match, not regex ('.' would over-count)
    if (count > 0) usage.push({ api: api.replace('dir: joinPath\\|{ dir:', 'Bun.serve dir'), count });
  }
  usage.sort((a, b) => b.count - a.count);
  if (usage.length === 0) console.log('  (no native Bun APIs found in src/tools)');
  for (const u of usage) {
    // Defaulted columns: count right-aligned to 5, two-space sep, API name
    // left-padded to 28 so the counts column separates cleanly.
    console.log('  ' + String(u.count).padStart(5) + '  ' + u.api.padEnd(28));
  }

  if (check && violations.length > 0) {
    console.error('deps-audit: ' + violations.length + ' replaced package(s) in use — fix before merging');
    return 1;
  }
  console.log('deps-audit: ' + (violations.length === 0 ? 'ok' : violations.length + ' violation(s)') + ' · ' + usage.length + ' native APIs in use');
  return check && violations.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main());