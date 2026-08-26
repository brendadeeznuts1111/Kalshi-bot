// @see https://bun.com/docs/runtime/markdown#options
// Locks the Bun.markdown behaviors verified by runtime probes on Bun 1.4.0
// (see the session's md-defaults probe). Guards against regressions and
// documents known limitations (latexMath, bare-domain autolinks).
import { describe, expect, test } from 'bun:test';
import { markdownToHtml, markdownToHtmlAccent } from '../../src/lib/markdown.ts';

describe('Bun.markdown verified patterns (Bun 1.4.0)', () => {
  test('GFM tables / strikethrough / task lists are on by default', () => {
    const html = markdownToHtml('| A | B |\n| - | - |\n| 1 | 2 |\n\n~~x~~\n\n- [x] done');
    expect(html).toContain('<table>');
    expect(html).toContain('<del>');
    expect(html).toMatch(/type="checkbox"/i);
  });

  test('GFM features can be disabled individually', () => {
    expect(markdownToHtml('~~x~~', { strikethrough: false })).not.toContain('<del>');
    expect(markdownToHtml('| a |', { tables: false })).not.toContain('<table>');
  });

  test('autolinks are OFF by default', () => {
    const html = markdownToHtml('bun.sh www.example.com me@example.com', {}); // {} = raw Bun.markdown defaults
    expect(html).not.toContain('<a');
  });

  test('autolinks:true links scheme URLs, www, and email', () => {
    const html = markdownToHtml('https://bun.sh www.example.com me@example.com', { autolinks: true });
    expect(html).toContain('href="https://bun.sh"');
    expect(html).toContain('href="http://www.example.com"');
    expect(html).toContain('href="mailto:me@example.com"');
  });

  test('bare domains are NOT auto-linked even with autolinks:true', () => {
    const html = markdownToHtml('bun.sh', { autolinks: true });
    expect(html).not.toContain('<a');
  });

  test('granular autolinks {url, www} leaves email unlinked', () => {
    const html = markdownToHtml('https://x.dev www.example.com me@example.com', {
      autolinks: { url: true, www: true },
    });
    expect(html).toContain('href="https://x.dev"');
    expect(html).toContain('href="http://www.example.com"');
    expect(html).not.toContain('mailto:');
  });

  test('tagFilter is off by default; on it escapes disallowed tags', () => {
    expect(markdownToHtml('Hi <script>x</script>', {})).toContain('<script>x</script>'); // {} = raw defaults
    const safe = markdownToHtml('Hi <script>x</script>', { tagFilter: true });
    expect(safe).not.toContain('<script>x</script>');
    expect(safe).toContain('&lt;script');
  });

  test('headings ids off by default; { ids: true } adds slug ids', () => {
    expect(markdownToHtml('## Hello World', {})).not.toContain('id="'); // {} = raw defaults
    expect(markdownToHtml('## Hello World', { headings: { ids: true } })).toContain('id="hello-world"');
  });

  test('wikiLinks off by default; on renders the <x-wikilink> element', () => {
    expect(markdownToHtml('[[target]]')).not.toContain('wikilink');
    const html = markdownToHtml('[[target]]', { wikiLinks: true });
    expect(html).toContain('x-wikilink');
    expect(html).toContain('data-target="target"');
  });

  test('latexMath has no runtime effect on Bun 1.4.0 (known limitation)', () => {
    // Probed: option is declared in bun-types but $...$ / $$...$$ pass through.
    expect(markdownToHtml('$x^2$', { latexMath: true })).toContain('$x^2$');
  });

  test('markdownToHtml accepts a raw Options object (granular override)', () => {
    const html = markdownToHtml('me@example.com only', { autolinks: { email: true } });
    expect(html).toContain('mailto:me@example.com');
  });
});

describe('markdownToHtmlAccent (Bun.color in the renderer)', () => {
  test('styles headings with the Bun.color-normalized accent', () => {
    const html = markdownToHtmlAccent('# Accent Heading', '#4da3ff');
    expect(html).toContain('.prose h1,.prose h2,.prose h3,.prose h4{color:#4da3ff}');
    expect(html).toContain('<div class="prose">');
    expect(html).toContain('id="accent-heading"');
  });

  test('no accent -> no style block (default foreground headings)', () => {
    expect(markdownToHtmlAccent('# X')).not.toContain('<style>');
  });

  test('invalid accent is rejected by Bun.color (no style injected)', () => {
    expect(markdownToHtmlAccent('# X', 'not-a-color')).not.toContain('<style>');
  });
});
