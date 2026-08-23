/**
 * runtime-surface probe (src/lib/runtime-surface.ts): verifies the INSTALLED
 * bun binary exposes the APIs this repo relies on. Tests run under bun, so
 * they assert the same binary the guard checks (pitfalls sections 10-15).
 */
import { describe, test, expect } from 'bun:test';
import { runRuntimeSurfaceProbe, surfaceProbePasses } from '../../src/lib/runtime-surface.ts';
import type { SurfaceCheck } from '../../src/lib/runtime-surface.ts';

describe('runRuntimeSurfaceProbe', () => {
  test('all checks pass on the installed bun', () => {
    const checks = runRuntimeSurfaceProbe();
    expect(checks.length).toBeGreaterThanOrEqual(6);
    for (const c of checks) {
      expect(c.ok, c.name + ': ' + c.detail).toBe(true);
    }
    expect(surfaceProbePasses(checks)).toBe(true);
  });

  test('checks cover the v1.4 surface facts', () => {
    const names = runRuntimeSurfaceProbe().map((c) => c.name);
    expect(names).toContain('Bun.dns.prefetch + getCacheStats');
    expect(names).toContain('process.on(memoryPressure)');
    expect(names).toContain('Temporal enabled');
    expect(names).toContain('Bun.YAML 1.2 semantics (yes/on/no are strings)');
    expect(names).toContain('res.writeHeader removed (node:http)');
  });
});

describe('surfaceProbePasses', () => {
  test('false when any check fails', () => {
    const checks: SurfaceCheck[] = [
      { name: 'a', ok: true, detail: '' },
      { name: 'b', ok: false, detail: '' },
    ];
    expect(surfaceProbePasses(checks)).toBe(false);
  });

  test('true when all pass', () => {
    const checks: SurfaceCheck[] = [{ name: 'a', ok: true, detail: '' }];
    expect(surfaceProbePasses(checks)).toBe(true);
  });
});