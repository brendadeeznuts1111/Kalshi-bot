/**
 * perf-audit lib (src/lib/perf-audit.ts): verify the repo keeps the Bun
 * v1.4 toolchain wins (pitfalls section 23/24). Uses a temp fixture repo
 * so the audit never depends on this repo's actual config.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPerfAudit, perfAuditPasses } from '../../src/lib/perf-audit.ts';
import type { PerfCheck } from '../../src/lib/perf-audit.ts';

let root: string;
let globalBunfig: string;

function write(rel: string, content: string) {
  const p = join(root, rel);
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  writeFileSync(p, content);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'perf-audit-'));
  globalBunfig = join(root, 'global-bunfig.toml');
  writeFileSync(globalBunfig, '[install]\nlinker = "isolated"\nglobalStore = true\n');
  write('package.json', JSON.stringify({
    name: 'fixture',
    scripts: { test: 'bun test --parallel --timings=.t.json' },
  }));
  write('bunfig.toml', '[install]\nfrozenLockfile = true\n');
  write('.github/workflows/check.yml', 'run: bun audit\nrun: bun dedupe --check\n');
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('runPerfAudit', () => {
  test('all four checks pass on a configured fixture', () => {
    const checks = runPerfAudit(root, globalBunfig);
    expect(checks).toHaveLength(4);
    expect(perfAuditPasses(checks)).toBe(true);
  });

  test('flags a test script without --parallel as warn', () => {
    write('package.json', JSON.stringify({ name: 'f', scripts: { test: 'bun test --isolate' } }));
    const checks = runPerfAudit(root, globalBunfig);
    const t = checks.find((c) => c.name.includes('--parallel'))!;
    expect(t.status).toBe('warn');
    expect(perfAuditPasses(checks)).toBe(false);
  });

  test('flags missing globalStore/linker as warn', () => {
    writeFileSync(globalBunfig, '[install]\nfrozenLockfile = true\n');
    const checks = runPerfAudit(root, globalBunfig);
    const store = checks.find((c) => c.name.includes('global virtual store'))!;
    expect(store.status).toBe('warn');
  });

  test('no CI workflows -> audit/dedupe check is warn, not n/a', () => {
    // Temporarily remove the workflows dir; the check should warn (CI
    // audit/dedupe is expected) rather than silently pass.
    rmSync(join(root, '.github'), { recursive: true, force: true });
    const checks = runPerfAudit(root, globalBunfig);
    const ci = checks.find((c) => c.name.includes('CI security'))!;
    expect(ci.status).toBe('warn');
    // Restore for the other tests.
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/check.yml'), 'run: bun audit\nrun: bun dedupe --check\n');
  });
});

describe('perfAuditPasses', () => {
  test('n/a checks do not fail the gate', () => {
    const checks: PerfCheck[] = [
      { name: 'a', status: 'ok', detail: '' },
      { name: 'b', status: 'n/a', detail: '' },
    ];
    expect(perfAuditPasses(checks)).toBe(true);
  });
});