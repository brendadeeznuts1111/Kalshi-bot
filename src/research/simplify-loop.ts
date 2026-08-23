/**
 * Auto research loop: scan for complexity / thin abstractions, run tests,
 * emit a ranked simplify backlog. Optional --apply for safe dead-export drops.
 *
 * Philosophy: fewer files, fewer re-exports, more direct tests — not new layers.
 */
import { $ } from "bun";
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_DIR, joinPath } from './paths.ts';

/** Resolved monorepo root (paths.ROOT keeps `..` segments). */
function resolveDots(p: string): string {
  const abs = p.startsWith('/');
  const parts = p.split('/').filter(s => s && s !== '.');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (abs ? '/' : '') + out.join('/');
}

const ROOT = resolveDots(joinPath(import.meta.dir, '../..'));

export type SimplifyFinding = {
  id: string;
  severity: 'info' | 'warn' | 'action';
  path: string;
  kind:
    | 'large_file'
    | 'export_heavy'
    | 'thin_alias'
    | 'unused_export'
    | 'duplicate_name'
    | 'test_gap';
  message: string;
  evidence?: string;
  /** Safe auto-apply hint when supported. */
  apply?: { kind: 'drop_export'; symbol: string; line: number };
};

export type SimplifyScanReport = {
  at: string;
  roots: string[];
  filesScanned: number;
  findings: SimplifyFinding[];
  test: {
    ran: boolean;
    ok: boolean | null;
    command: string;
    seconds: number | null;
    summary?: string;
  };
  stats: {
    totalLoc: number;
    avgLoc: number;
    maxLoc: number;
    maxLocFile: string | null;
  };
};

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'research/cache',
  'research/evidence',
  'research/outputs',
]);

export async function listTsFiles(
  roots: string[],
  options: { maxFiles?: number } = {}
): Promise<string[]> {
  const max = options.maxFiles ?? 500;
  const out: string[] = [];
  const rootPrefix = ROOT.replace(/\\/g, '/') + '/';

  function toRel(abs: string): string {
    const n = abs.replace(/\\/g, '/');
    return n.startsWith(rootPrefix) ? n.slice(rootPrefix.length) : n;
  }

  async function walk(absDir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) return;
      const abs = join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR.has(ent.name)) continue;
        await walk(abs);
      } else if (
        ent.isFile() &&
        ent.name.endsWith('.ts') &&
        !ent.name.endsWith('.d.ts')
      ) {
        out.push(toRel(abs));
      }
    }
  }

  for (const r of roots) {
    const abs = r.startsWith('/') ? r : joinPath(ROOT, r);
    const st = Bun.file(abs);
    // file root
    if (r.endsWith('.ts')) {
      if (await st.exists()) out.push(toRel(abs));
      continue;
    }
    await walk(abs);
  }
  return [...new Set(out)].sort();
}

function countExports(src: string): { total: number; functions: number; types: number } {
  const lines = src.split('\n');
  let total = 0;
  let functions = 0;
  let types = 0;
  for (const line of lines) {
    if (!/^export\s/.test(line)) continue;
    total++;
    if (/^export\s+(async\s+)?function\s/.test(line) || /^export\s+const\s+\w+\s*=/.test(line)) {
      functions++;
    }
    if (/^export\s+type\s|^export\s+interface\s/.test(line)) types++;
  }
  return { total, functions, types };
}

/**
 * Detect pure re-export aliases only:
 *   export const foo = bar;
 *   export function foo(a,b) { return bar(a,b); }  // same args, no transforms
 */
function findThinAliases(src: string, path: string): SimplifyFinding[] {
  const findings: SimplifyFinding[] = [];
  // export const x = y;
  const re2 = /export\s+const\s+(\w+)\s*=\s*(\w+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re2.exec(src))) {
    const [, alias, target] = m;
    if (alias && target && alias !== target) {
      findings.push({
        id: `thin-const:${path}:${alias}`,
        severity: 'action',
        path,
        kind: 'thin_alias',
        message: `const alias ${alias} = ${target} (inline at call sites)`,
        evidence: m[0],
      });
    }
  }
  // Single-statement return of another call with identical arg list
  const re =
    /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{\s*return\s+(\w+)\s*\(([^)]*)\)\s*;\s*\}/g;
  while ((m = re.exec(src))) {
    const [, alias, args, target, callArgs] = m;
    if (!alias || !target || alias === target) continue;
    const norm = (s: string) =>
      s
        .split(',')
        .map(a => a.trim().split(':')[0]?.trim().replace(/\?$/, '') ?? '')
        .filter(Boolean)
        .join(',');
    if (norm(args ?? '') === norm(callArgs ?? '') && !(callArgs ?? '').includes('.')) {
      findings.push({
        id: `thin:${path}:${alias}`,
        severity: 'action',
        path,
        kind: 'thin_alias',
        message: `thin alias ${alias} → ${target} (same args — inline)`,
        evidence: m[0].slice(0, 140),
      });
    }
  }
  return findings;
}

function exportedSymbols(src: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m =
      line.match(/^export\s+(?:async\s+)?function\s+(\w+)/) ||
      line.match(/^export\s+const\s+(\w+)/) ||
      line.match(/^export\s+type\s+(\w+)/) ||
      line.match(/^export\s+interface\s+(\w+)/) ||
      line.match(/^export\s+class\s+(\w+)/);
    if (m?.[1]) out.push({ name: m[1], line: i + 1 });
  }
  return out;
}

/** Rough unused export: symbol appears only in its defining file (not tests). */
async function findUnusedExports(
  path: string,
  src: string,
  allFiles: Map<string, string>
): Promise<SimplifyFinding[]> {
  const findings: SimplifyFinding[] = [];
  const symbols = exportedSymbols(src);
  for (const { name, line } of symbols) {
    if (name.startsWith('_')) continue;
    // types often only used as imports of type — still count import sites
    let refs = 0;
    for (const [p, text] of allFiles) {
      if (p === path) continue;
      // word-boundary-ish
      const re = new RegExp(`\\b${name}\\b`);
      if (re.test(text)) refs++;
    }
    if (refs === 0) {
      findings.push({
        id: `unused:${path}:${name}`,
        severity: 'action',
        path,
        kind: 'unused_export',
        message: `export ${name} has no external references (only defined here)`,
        evidence: `line ${line}`,
        apply: { kind: 'drop_export', symbol: name, line },
      });
    }
  }
  return findings;
}

function testPathFor(sourcePath: string): string | null {
  // src/inventory/foo.ts → tests/inventory/foo.test.ts
  if (!sourcePath.startsWith('src/')) return null;
  const rest = sourcePath.slice(4).replace(/\.ts$/, '.test.ts');
  return joinPath('tests', rest);
}

export async function scanSimplifyTargets(
  roots: string[],
  options: {
    largeLoc?: number;
    heavyExports?: number;
    checkUnused?: boolean;
  } = {}
): Promise<{ findings: SimplifyFinding[]; files: string[]; locByFile: Map<string, number> }> {
  const largeLoc = options.largeLoc ?? 400;
  const heavyExports = options.heavyExports ?? 15;
  const files = await listTsFiles(roots);
  const contents = new Map<string, string>();
  const locByFile = new Map<string, number>();
  const findings: SimplifyFinding[] = [];

  for (const rel of files) {
    const abs = joinPath(ROOT, rel);
    try {
      const text = await Bun.file(abs).text();
      contents.set(rel, text);
      locByFile.set(rel, text.split('\n').length);
    } catch {
      /* skip */
    }
  }

  for (const [path, src] of contents) {
    const loc = locByFile.get(path) ?? 0;
    const exp = countExports(src);
    if (loc >= largeLoc) {
      findings.push({
        id: `large:${path}`,
        severity: loc >= 800 ? 'action' : 'warn',
        path,
        kind: 'large_file',
        message: `${loc} lines — split only if cohesion is weak; prefer delete/inline first`,
        evidence: `exports=${exp.total} functions≈${exp.functions}`,
      });
    }
    if (exp.total >= heavyExports) {
      findings.push({
        id: `exports:${path}`,
        severity: 'warn',
        path,
        kind: 'export_heavy',
        message: `${exp.total} exports — narrow public surface`,
        evidence: `functions≈${exp.functions} types≈${exp.types}`,
      });
    }
    findings.push(...findThinAliases(src, path));

    // test gap for src modules
    if (path.startsWith('src/') && !path.includes('/generated/')) {
      const tp = testPathFor(path);
      if (tp) {
        const has = await Bun.file(joinPath(ROOT, tp)).exists();
        if (!has && loc >= 80) {
          findings.push({
            id: `testgap:${path}`,
            severity: 'warn',
            path,
            kind: 'test_gap',
            message: `no focused test at ${tp}`,
            evidence: `${loc} loc`,
          });
        }
      }
    }
  }

  if (options.checkUnused !== false) {
    // Reference corpus: all src + tools + tests (importers outside scan roots)
    const refs = new Map(contents);
    for (const extra of ['src', 'tools', 'tests']) {
      const more = await listTsFiles([extra], { maxFiles: 800 });
      for (const rel of more) {
        if (refs.has(rel)) continue;
        try {
          refs.set(rel, await Bun.file(joinPath(ROOT, rel)).text());
        } catch {
          /* skip */
        }
      }
    }
    for (const [path, src] of contents) {
      if (!path.startsWith('src/')) continue;
      const unused = await findUnusedExports(path, src, refs);
      for (const f of unused) {
        // Type-only exports with no importers are noise — demote
        const isType =
          f.message.includes('export type') ||
          /^export (type|interface) /.test(
            src.split('\n')[(f.apply?.line ?? 1) - 1] ?? ''
          ) ||
          (f.apply &&
            /^(export type|export interface)/.test(
              src.split('\n')[f.apply.line - 1] ?? ''
            ));
        if (isType) {
          findings.push({ ...f, severity: 'info' });
        } else {
          findings.push(f);
        }
      }
    }
  }

  // rank: action first, then warn, by path
  findings.sort((a, b) => {
    const s = { action: 0, warn: 1, info: 2 } as const;
    return s[a.severity] - s[b.severity] || a.path.localeCompare(b.path) || a.id.localeCompare(b.id);
  });

  return { findings, files, locByFile };
}

export async function runFocusedTests(
  paths: string[]
): Promise<{ ok: boolean; seconds: number; summary: string; command: string }> {
  // map src → tests
  const testArgs = new Set<string>();
  for (const p of paths) {
    if (p.startsWith('tests/') && p.endsWith('.test.ts')) testArgs.add(p);
    const tp = testPathFor(p);
    if (tp) {
      const exists = await Bun.file(joinPath(ROOT, tp)).exists();
      if (exists) testArgs.add(tp);
    }
    // inventory umbrella
    if (p.startsWith('src/inventory/')) {
      testArgs.add('tests/inventory');
    }
  }
  if (!testArgs.size) {
    testArgs.add('tests/inventory/live-tracker.test.ts');
    testArgs.add('tests/inventory/coverage-board.test.ts');
  }

  const command = `bun test ${[...testArgs].join(' ')}`;
  const start = performance.now();
  const { stdout: stdoutBuf, stderr: stderrBuf, exitCode } = await $`bun test ${[...testArgs]}`.cwd(ROOT).nothrow().quiet();
  const stdout = stdoutBuf.toString();
  const stderr = stderrBuf.toString();
  const code = exitCode;
  const seconds = (performance.now() - start) / 1000;
  const combined = stdout + stderr;
  const passLine = combined.match(/(\d+) pass/)?.[0] ?? '';
  const failLine = combined.match(/(\d+) fail/)?.[0] ?? '';
  return {
    ok: code === 0,
    seconds,
    summary: `${passLine} ${failLine}`.trim() || `exit ${code}`,
    command,
  };
}

export function formatSimplifyReport(r: SimplifyScanReport): string {
  const lines: string[] = [];
  lines.push(`# simplify-loop @ ${r.at}`);
  lines.push('');
  lines.push(`roots: ${r.roots.join(', ')}`);
  lines.push(
    `files=${r.filesScanned} loc=${r.stats.totalLoc} avg=${r.stats.avgLoc} max=${r.stats.maxLoc} (${r.stats.maxLocFile ?? '—'})`
  );
  if (r.test.ran) {
    lines.push(
      `tests: ${r.test.ok ? 'ok' : 'FAIL'} ${r.test.summary ?? ''} (${r.test.seconds?.toFixed(2)}s)`
    );
    lines.push(`  $ ${r.test.command}`);
  }
  lines.push('');
  lines.push(`## Findings (${r.findings.length})`);
  for (const f of r.findings.slice(0, 80)) {
    lines.push(`- **${f.severity}** \`${f.kind}\` \`${f.path}\` — ${f.message}`);
    if (f.evidence) lines.push(`  - ${f.evidence}`);
  }
  if (r.findings.length > 80) {
    lines.push(`- … +${r.findings.length - 80} more`);
  }
  lines.push('');
  lines.push('## Next (manual)');
  lines.push('1. Delete unused exports / thin aliases');
  lines.push('2. Add missing focused tests before splitting large files');
  lines.push('3. Prefer inline over new helper layers');
  return lines.join('\n');
}

export async function runSimplifyLoopOnce(options: {
  roots?: string[];
  skipTests?: boolean;
}): Promise<SimplifyScanReport> {
  const roots = options.roots ?? ['src/inventory', 'tools/live-tracker-cli.ts'];
  const { findings, files, locByFile } = await scanSimplifyTargets(roots);
  const locs = [...locByFile.values()];
  const totalLoc = locs.reduce((a, b) => a + b, 0);
  let test: SimplifyScanReport['test'] = {
    ran: false,
    ok: null,
    command: '',
    seconds: null,
  };
  if (!options.skipTests) {
    const t = await runFocusedTests(files.filter(f => f.includes('inventory') || f.includes('live-tracker')));
    test = {
      ran: true,
      ok: t.ok,
      command: t.command,
      seconds: t.seconds,
      summary: t.summary,
    };
  }

  let maxLoc = 0;
  let maxLocFile: string | null = null;
  for (const [f, n] of locByFile) {
    if (n > maxLoc) {
      maxLoc = n;
      maxLocFile = f;
    }
  }

  return {
    at: new Date().toISOString(),
    roots,
    filesScanned: files.length,
    findings,
    test,
    stats: {
      totalLoc,
      avgLoc: files.length ? Math.round(totalLoc / files.length) : 0,
      maxLoc,
      maxLocFile,
    },
  };
}

export async function writeSimplifyReport(
  report: SimplifyScanReport,
  options: { dir?: string } = {}
): Promise<{ md: string; json: string }> {
  const dir = options.dir ?? joinPath(REPORT_DIR, 'simplify-loop');
  await Bun.$`mkdir -p ${dir}`.quiet();
  const stamp = report.at.replace(/[:.]/g, '-');
  const mdPath = joinPath(dir, `simplify-${stamp}.md`);
  const jsonPath = joinPath(dir, `simplify-${stamp}.json`);
  const latestMd = joinPath(dir, 'latest.md');
  const latestJson = joinPath(dir, 'latest.json');
  const md = formatSimplifyReport(report);
  await Bun.write(mdPath, md);
  await Bun.write(jsonPath, JSON.stringify(report, null, 2));
  await Bun.write(latestMd, md);
  await Bun.write(latestJson, JSON.stringify(report, null, 2));
  return { md: mdPath, json: jsonPath };
}
