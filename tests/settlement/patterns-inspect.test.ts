// @see https://bun.com/docs/runtime/utils#bun-inspect
// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  edgePatternsByFamily,
  listEdgePatterns,
  parseEdgePatternSortBy,
  sortEdgePatterns,
} from '../../src/settlement/index.ts';

/**
 * Mirrors live-tracker `patterns --inspect` payload + Bun.inspect options.
 * Keeps CLI dump contract pinned without spawning the full CLI.
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
  const payload = {
    sortBy,
    desc,
    families: edgePatternsByFamily(),
    patterns: catalog,
  };
  return Bun.inspect(payload, {
    colors: false,
    compact: false,
    depth: 4,
    sorted: true,
  });
}

describe('patterns --inspect (Bun.inspect contract)', () => {
  test('sorted keys + depth include patterns and families', () => {
    const text = inspectPatternsPayload('id');
    expect(text).toContain('patterns:');
    expect(text).toContain('families:');
    expect(text).toContain('sortBy:');
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
    const text = inspectPatternsPayload();
    expect(text).toContain('void.live-ml-unfinished');
  });
});
