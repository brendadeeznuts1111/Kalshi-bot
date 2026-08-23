// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  formatSimplifyReport,
  scanSimplifyTargets,
} from '../../src/research/simplify-loop.ts';

describe('simplify-loop scan', () => {
  // @ts-expect-error — bun-types lags runtime: test options timeout supported since Bun 1.2
  test('scans inventory and flags large / unused surfaces', { timeout: 30_000 }, async () => {
    const { findings, files, locByFile } = await scanSimplifyTargets(
      ['src/inventory', 'tools/live-tracker-cli.ts'],
      { checkUnused: true }
    );
    expect(files.length).toBeGreaterThan(5);
    expect(locByFile.get('src/inventory/event-lookup.ts') ?? 0).toBeGreaterThan(
      400
    );
    // event-lookup should appear as large_file
    expect(findings.some(f => f.path.includes('event-lookup') && f.kind === 'large_file')).toBe(
      true
    );
    const report = formatSimplifyReport({
      at: '2026-08-10T00:00:00.000Z',
      roots: ['src/inventory'],
      filesScanned: files.length,
      findings: findings.slice(0, 5),
      test: { ran: false, ok: null, command: '', seconds: null },
      stats: {
        totalLoc: 1000,
        avgLoc: 50,
        maxLoc: 2000,
        maxLocFile: 'src/inventory/event-lookup.ts',
      },
    });
    expect(report).toContain('simplify-loop');
    expect(report).toContain('Findings');
  });
});
