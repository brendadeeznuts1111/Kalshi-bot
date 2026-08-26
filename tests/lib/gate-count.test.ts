/**
 * gate-count lib (src/lib/gate-count.ts §167): structural derivation of
 * the verify:contracts gate count — immune to formatting changes.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countGates } from '../../src/lib/gate-count.ts';

describe('countGates (§167)', () => {
  test('counts array elements regardless of formatting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-count-'));
    const fixture = [
      'const gates = [',
      '  ["a:check"], // comment',
      '',
      '  [',
      "    'b:probe',",
      '  ],',
      "  ['c:gate'],",
      '  ["d", "extra"],',
      '] as const;',
    ].join('\n');
    writeFileSync(join(dir, 'vc.ts'), fixture);
    expect(countGates(join(dir, 'vc.ts'))).toBe(4);
    rmSync(dir, { recursive: true, force: true });
  });

  test('throws when the gates array is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-count-'));
    writeFileSync(join(dir, 'vc.ts'), 'const other = [1, 2, 3];\n');
    expect(() => countGates(join(dir, 'vc.ts'))).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test('live repo gates array counts 58 (drift fails here)', () => {
    expect(countGates()).toBe(58);
  });
});