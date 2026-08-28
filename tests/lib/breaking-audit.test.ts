/**
 * breaking-audit lib (src/lib/breaking-audit.ts): Bun v1.4 breaking-change
 * scan. Uses a TEMP fixture repo so the audit never depends on this repo's
 * actual state (pitfalls section 16/17).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBreakingAudit, breakingAuditPasses, staleAllowlistEntries } from '../../src/lib/breaking-audit.ts';
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
  test('clean repo passes all 19 checks', () => {
    const findings = runBreakingAudit(root);
    expect(findings).toHaveLength(19);
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

  test('flags a real .node addon binary (Bun.Glob scanSync)', () => {
    write('src/addon.node', '\x7fELF');
    try {
      const findings = runBreakingAudit(root);
      const addon = findings.find((f) => f.check.includes('Native addons'))!;
      expect(addon.status).toBe('warn');
      expect(addon.detail).toContain('src/addon.node');
    } finally {
      rmSync(join(root, 'src/addon.node'));
    }
  });

  test('does not match table.nodeId as a native addon (find -name *.node)', () => {
    // 'table.nodeId' column reference must NOT trigger the addon check,
    // and the audit must not break when find returns nothing.
    write('src/db.ts', 'column("table.nodeId")\n');
    const findings = runBreakingAudit(root);
    const addon = findings.find((f) => f.check.includes('Native addons'))!;
    expect(addon.status).toBe('ok');
  });

  test('flags Bun.serve port from raw env as warn', () => {
    write('src/env-port.ts', 'Bun.serve({ port: Bun.env.PORT, fetch: () => new Response("x") });\n');
    const findings = runBreakingAudit(root);
    const port = findings.find((f) => f.check.includes('port from raw env'))!;
    expect(port.status).toBe('warn');
    expect(port.detail).toContain('env-port.ts');
  });

  test('flags server websocket routes / server.upgrade() as warn', () => {
    write('src/ws.ts', 'const ok = server.upgrade(req);\n');
    const findings = runBreakingAudit(root);
    const ws = findings.find((f) => f.check.includes('websocket routes'))!;
    expect(ws.status).toBe('warn');
    expect(ws.detail).toContain('ws.ts');
  });

  test('flags fetch redirect:"error" as warn', () => {
    write('src/redir.ts', 'fetch(url, { redirect: "error" });\n');
    const findings = runBreakingAudit(root);
    const r = findings.find((f) => f.check.includes('redirect:"error"'))!;
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('redir.ts');
  });

  test('flags spawn validation traps as warn', () => {
    write('src/spawn.ts', 'Bun.spawnSync(["true"], { timeout: NaN });\n');
    const findings = runBreakingAudit(root);
    const s = findings.find((f) => f.check.includes('spawn validation traps'))!;
    expect(s.status).toBe('warn');
    expect(s.detail).toContain('spawn.ts');
  });

  test('flags Response.error() as warn', () => {
    write('src/resperr.ts', 'return Response.error();\n');
    const findings = runBreakingAudit(root);
    const r = findings.find((f) => f.check.includes('Response.error()'))!;
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('resperr.ts');
  });

  test('flags fs.rmdir({ recursive: true }) as warn (removed in 1.4, S216)', () => {
    write('src/rmdir-rec.ts', 'rmdirSync(dir, { recursive: true });\n');
    const findings = runBreakingAudit(root);
    const r = findings.find((f) => f.check.includes('fs.rmdir'))!;
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('rmdir-rec.ts');
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

describe('staleAllowlistEntries (§166)', () => {
  test('reports every allowlist entry as stale when none exist', async () => {
    const stale = await staleAllowlistEntries(root);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0]).toContain('no matching file');
  });

  test('finds nothing stale in this repo (dead allowlist entries fail here)', async () => {
    const repoRoot = join(import.meta.dir, '..', '..');
    const stale = await staleAllowlistEntries(repoRoot);
    expect(stale).toEqual([]);
  });
});