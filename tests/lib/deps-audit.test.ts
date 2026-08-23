/**
 * deps-audit replacement table (tools/bun-deps-audit.ts): the v1.4
 * dependency-killer mapping. Ensures the table stays complete and
 * correctly typed (pitfalls sections 13-19).
 */
import { describe, test, expect } from 'bun:test';
import { REPLACEMENTS } from '../../tools/bun-deps-audit.ts';

describe('REPLACEMENTS', () => {
  test('covers every package the v1.4 blog claims Bun replaces', () => {
    const blogReplaced = [
      'express', 'serve-static', 'sirv', 'json5', 'ndjson', 'jsonc-parser',
      'fast-xml-parser', 'xml2js', '@iarna/toml', 'tar', 'path-to-regexp',
      'string-width', 'slice-ansi', 'wrap-ansi', 'cli-truncate', 'compression',
      'pako', 'concurrently', 'npm-run-all', 'marked', 'node-cron', 'puppeteer',
      'sharp', 'node-pty', 'strip-ansi', 'escape-html', 'cli-table', 'cli-table3',
    ];
    const missing = blogReplaced.filter((p) => !(p in REPLACEMENTS));
    expect(missing).toEqual([]);
  });

  test('every replacement is non-empty and mentions a Bun API', () => {
    for (const [pkg, replacement] of Object.entries(REPLACEMENTS)) {
      expect(replacement.length).toBeGreaterThan(0);
      expect(replacement).toMatch(/Bun\.|CompressionStream|URLPattern|bun run/);
    }
  });
});