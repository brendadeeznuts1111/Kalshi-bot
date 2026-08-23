/**
 * adoption-audit lib (src/lib/adoption-audit.ts): coverage report of Bun
 * v1.4 networking features (dir routes, fetch compress, h2 client).
 * Temp fixture repo so the audit never depends on this repo's state.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdoptionAudit, adoptionAuditPasses } from '../../src/lib/adoption-audit.ts';
import type { AdoptionCheck } from '../../src/lib/adoption-audit.ts';

let root: string;

function write(rel: string, content: string) {
  const p = join(root, rel);
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  writeFileSync(p, content);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'adoption-audit-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('runAdoptionAudit', () => {
  test('dir routes used -> ok; no public dir + no routes -> n/a', () => {
    // No public/, no routes: n/a.
    let checks = runAdoptionAudit(root);
    expect(checks[0]!.status).toBe('n/a');
    // With a dir route: ok.
    write('src/server.ts', 'routes: { "/static/*": { dir: "./public" } }');
    checks = runAdoptionAudit(root);
    expect(checks[0]!.status).toBe('ok');
  });

  test('compress: no POST bodies -> n/a; POST without compress -> gap', () => {
    const checks = runAdoptionAudit(root);
    // No POST bodies in fixture -> n/a.
    expect(checks[1]!.status).toBe('n/a');
    write('src/post.ts', 'fetch("http://x", { method: "POST", body: JSON.stringify({}) })');
    const withPost = runAdoptionAudit(root);
    expect(withPost[1]!.status).toBe('gap');
  });

  test('protocol:http2 absent with fetch calls -> gap', () => {
    const checks = runAdoptionAudit(root);
    // Fixture has fetch() now (from previous test) -> gap.
    expect(checks[2]!.status).toBe('gap');
  });
});

describe('adoptionAuditPasses', () => {
  test('n/a and ok pass; gap fails', () => {
    expect(adoptionAuditPasses([{ name: 'a', status: 'n/a', detail: '' }])).toBe(true);
    expect(adoptionAuditPasses([{ name: 'a', status: 'ok', detail: '' }])).toBe(true);
    expect(adoptionAuditPasses([{ name: 'a', status: 'gap', detail: '' }])).toBe(false);
  });
});