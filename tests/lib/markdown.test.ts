// @see https://bun.com/docs/test/writing-tests#matchers
// @see https://bun.com/docs/runtime/markdown#options
import { describe, expect, test } from 'bun:test';
import {
  MARKDOWN_HTML_DASHBOARD,
  MARKDOWN_HTML_DOCS,
  MARKDOWN_HTML_GFM,
  MARKDOWN_HTML_STRICT,
  listMarkdownPresets,
  markdownToAnsi,
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
    const html = markdownToHtml(md, 'gfm');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>');
    expect(html).toMatch(/type=["']checkbox["']/i);
  });

  test('autolinks bare URLs when enabled', () => {
    const html = markdownToHtml('See https://bun.com/docs for more.', 'gfm');
    expect(html).toContain('href="https://bun.com/docs"');
  });

  test('autolinks selective www without requiring scheme', () => {
    const html = markdownToHtml('Visit www.example.com', {
      autolinks: { url: true, www: true, email: false },
    });
    expect(html).toContain('www.example.com');
    expect(html).toContain('href=');
  });

  test('tagFilter escapes disallowed HTML tags', () => {
    const html = markdownToHtml('Hello <script>alert(1)</script>', 'gfm');
    expect(html.toLowerCase()).not.toContain('<script>');
    expect(html).toMatch(/&lt;script|script/i);
  });

  test('docs preset emits heading ids + default is docs', () => {
    const html = markdownToHtml('## Hello World');
    expect(html).toContain('id="hello-world"');
    expect(markdownToHtml('## Hello World', 'docs')).toContain('id="hello-world"');
  });

  test('dashboard preset matches production pattern (no HTML blocks)', () => {
    const md = '## Title\n\n<script>x</script>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const html = markdownToHtml(md, 'dashboard');
    expect(html).toContain('id="title"');
    expect(html).toContain('<table>');
    expect(html.toLowerCase()).not.toContain('<script>');
    expect(MARKDOWN_HTML_DASHBOARD).toMatchObject({
      tagFilter: true,
      autolinks: true,
      noHtmlBlocks: true,
      headings: { ids: true },
    });
  });

  test('strict also disables HTML spans', () => {
    expect(MARKDOWN_HTML_STRICT.noHtmlSpans).toBe(true);
    expect(MARKDOWN_HTML_STRICT.noHtmlBlocks).toBe(true);
  });

  test('preset names are stable', () => {
    expect(listMarkdownPresets()).toEqual(['gfm', 'docs', 'dashboard', 'strict']);
  });

  test('unknown preset throws', () => {
    expect(() => markdownToHtml('# x', 'nope' as 'gfm')).toThrow(/unknown preset/);
  });

  test('MARKDOWN_HTML_GFM locks the official example flags', () => {
    expect(MARKDOWN_HTML_GFM).toEqual({
      tables: true,
      strikethrough: true,
      tasklists: true,
      tagFilter: true,
      autolinks: true,
    });
    expect(MARKDOWN_HTML_DOCS.headings).toEqual({ ids: true, autolink: true });
  });
});

describe('markdownToAnsi', () => {
  test('renders bold without HTML tags', () => {
    const out = markdownToAnsi('# Hello\n\nThis is **bold**.');
    expect(out).toContain('Hello');
    expect(out).not.toContain('<h1>');
    expect(out).not.toContain('<strong>');
  });
});
