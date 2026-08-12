// @see https://bun.com/docs/test/writing-tests#matchers
// @see https://bun.com/docs/runtime/markdown#options
import { describe, expect, test } from 'bun:test';
import {
  MARKDOWN_HTML_DOCS,
  MARKDOWN_HTML_GFM,
  markdownToHtml,
} from '../../src/lib/markdown.ts';

describe('markdownToHtml', () => {
  test('renders GFM table + strikethrough + task list', () => {
    const md = `
| Feature | Status |
| ------- | ------ |
| Tables | ~~done~~ |
| Tasks | ok |

- [x] shipped
- [ ] next
`.trim();
    const html = markdownToHtml(md, MARKDOWN_HTML_GFM);
    expect(html).toContain('<table>');
    expect(html).toContain('<del>');
    expect(html).toMatch(/type=["']checkbox["']/i);
  });

  test('autolinks bare URLs when enabled', () => {
    const html = markdownToHtml('See https://bun.com/docs for more.', MARKDOWN_HTML_GFM);
    expect(html).toContain('href="https://bun.com/docs"');
  });

  test('tagFilter escapes disallowed HTML tags', () => {
    const html = markdownToHtml('Hello <script>alert(1)</script>', MARKDOWN_HTML_GFM);
    // GFM tag filter rewrites <script to &lt;script (does not execute raw HTML)
    expect(html.toLowerCase()).not.toContain('<script>');
    expect(html).toMatch(/&lt;script|script/i);
  });

  test('docs preset emits heading ids', () => {
    const html = markdownToHtml('## Hello World', MARKDOWN_HTML_DOCS);
    expect(html).toContain('id="hello-world"');
  });

  test('MARKDOWN_HTML_GFM locks the official example flags', () => {
    expect(MARKDOWN_HTML_GFM).toEqual({
      tables: true,
      strikethrough: true,
      tasklists: true,
      tagFilter: true,
      autolinks: true,
    });
  });
});
