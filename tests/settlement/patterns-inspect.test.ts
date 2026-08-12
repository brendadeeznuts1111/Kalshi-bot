// @see https://bun.com/docs/runtime/utils#bun-inspect
// @see https://bun.com/docs/test/writing-tests#matchers
// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import { inspectSnapshot } from '../../src/research/bun-native.ts';
import {
  edgePatternsByFamily,
  listEdgePatterns,
  parseEdgePatternSortBy,
  sortEdgePatterns,
} from '../../src/settlement/index.ts';

/**
 * Mirrors live-tracker `patterns --inspect` via inspectSnapshot(snapshot, { colors, depth, sorted }).
 */
function inspectPatternsPayload(sortByRaw?: string, desc = false): string {
  const sortBy = parseEdgePatternSortBy(sortByRaw, ['family', 'id']);
  const catalog = sortEdgePatterns(listEdgePatterns(), { sortBy, desc }).map(p => ({
    id: p.id,
    family: p.family,
    title: p.title,
    description: p.description,
    scope: p.scope,
  }));
  const snapshot = {
    sortBy,
    desc,
    families: edgePatternsByFamily(),
    patterns: catalog,
  };
  return inspectSnapshot(snapshot, { colors: false, depth: 4, sorted: true });
}

describe('patterns --inspect (Bun.inspect contract)', () => {
  test('sorted keys + depth include patterns and families', () => {
    const text = inspectPatternsPayload('id');
    expect(text).toMatch(/patterns:/);
    expect(text).toMatch(/families:/);
    expect(text).toMatch(/sortBy:/);
    // sorted: true → keys appear alphabetically at top level (desc, families, patterns, sortBy)
    const descAt = text.indexOf('desc:');
    const familiesAt = text.indexOf('families:');
    const patternsAt = text.indexOf('patterns:');
    const sortByAt = text.indexOf('sortBy:');
    expect(descAt).toBeGreaterThanOrEqual(0);
    expect(familiesAt).toBeGreaterThan(descAt);
    expect(patternsAt).toBeGreaterThan(familiesAt);
    expect(sortByAt).toBeGreaterThan(patternsAt);
  });

  test('includes a known pattern id from catalog', () => {
    expect(inspectPatternsPayload()).toMatch(/void\.live-ml-unfinished/);
  });
});
