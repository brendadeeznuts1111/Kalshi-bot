/**
 * breaking-audit lib (src/lib/breaking-audit.ts): Bun v1.4 breaking-change
 * scan. Uses a TEMP fixture repo so the audit never depends on this repo's
 * actual state (pitfalls section 16/17).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBreakingAudit, breakingAuditPasses } from '../../src/lib/breaking-audit.ts';
import type { BreakingFinding } from '../../src/lib/breaking-audit.ts';

let root: string;

function write(path: string, content: string) {
  writeFileSync(join(root, path), content);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'breaking-audit-'));
  // Baseline: v1 lock, frozen, no offenders.
  write('package.json', JSON.stringify({ name: 'fixture', scripts: {}, dependencies: {} }));
  write('bun.lock', JSON.stringify({ lockfileVersion: 1, configVersion: 1 }));
  write('bunfig.toml', '[install]\nfrozenLockfile = true\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('runBreakingAudit', () => {
  test('clean repo passes all 7 checks', () => {
    const findings = runBreakingAudit(root);
    expect(findings).toHaveLength(7);
    expect(breakingAuditPasses(findings)).toBe(true);
  });

  test('flags res.writeHeader usage as fail', () => {
    write('src/evil.ts', 'res.writeHeader(200);\n');
    const findings = runBreakingAudit(root);
    const wH = findings.find((f) => f.check.includes('writeHeader'))!;
    expect(wH.status).toBe('fail');
    expect(wH.detail).toContain('evil.ts');
  });

  test('flags unfrozen v2 lock as warn', () => {
    write('bun.lock', JSON.stringify({ lockfileVersion: 2, configVersion: 1 }));
    write('bunfig.toml', '[install]\nfrozenLockfile = false\n');
    const findings = runBreakingAudit(root);
    const lock = findings.find((f) => f.check.includes('bun.lock'))!;
    expect(lock.status).toBe('warn');
  });

  test('does not match table.nodeId as a native addon (find -name *.node)', () => {
    // 'table.nodeId' column reference must NOT trigger the addon check,
    // and the audit must not break when find returns nothing.
    write('src/db.ts', 'column("table.nodeId")\n');
    const findings = runBreakingAudit(root);
    const addon = findings.find((f) => f.check.includes('Native addons'))!;
    expect(addon.status).toBe('ok');
  });
});

describe('breakingAuditPasses', () => {
  test('false when any finding is not ok', () => {
    const findings: BreakingFinding[] = [
      { check: 'a', status: 'ok', detail: '' },
      { check: 'b', status: 'warn', detail: '' },
    ];
    expect(breakingAuditPasses(findings)).toBe(false);
  });
});