/**
 * markdown-page.ts — /bun/markdown: the FULL Bun.markdown API surface,
 * systematically probed against Bun 1.4.0 (AGENT-PITFALLS §34). Every
 * documented html() option + render() callback + react() behavior has a
 * probe result: verified / corrected (docs claim, runtime differs) /
 * marketing. Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_MARKETING, W_NOTE } from '../lib/widget-page.ts';

export function renderMarkdownPage(): string {
  const htmlOpts = widgetTable(['html() option', 'Probe (Bun 1.4.0)'], [
    { cells: ['<code>headings: { ids: true }</code> / <code>true</code>', W_VERIFIED + ' <h1 id="faster"> — native GitHub-style slugs, dupes -1/-2'] },
    { cells: ['<code>autolinks: true</code> and <code>{ url, www }</code>', W_VERIFIED + ' bare https:// + www. both link'] },
    { cells: ['<code>wikiLinks: true</code>', W_VERIFIED + ' emits <code>&lt;x-wikilink data-target&gt;</code> custom element (not <a>)'] },
    { cells: ['<code>noHtmlSpans: true</code>', W_VERIFIED + ' raw spans escaped (<code>&lt;span&gt;</code>)'] },
    { cells: ['<code>noHtmlBlocks: true</code>', W_VERIFIED + ' raw block tags become paragraph text'] },
    { cells: ['<code>permissiveAtxHeaders: true</code>', W_VERIFIED + ' #not-a-header becomes <h1>'] },
    { cells: ['<code>noIndentedCodeBlocks: true</code>', W_VERIFIED + ' indented code -> <p> not <pre>'] },
    { cells: ['<code>underline: true</code>', W_CORRECTED + ' ACCEPTED but NO-OP — __x__ stays <strong> in 1.4.0'] },
    { cells: ['<code>latexMath: true</code>', W_CORRECTED + ' ACCEPTED but NO-OP — $x$ stays literal in 1.4.0'] },
    { cells: ['<code>collapseWhitespace: true</code>', W_CORRECTED + ' ACCEPTED but NO-OP — triple spaces preserved'] },
    { cells: ['<code>hardSoftBreaks: true</code>', W_CORRECTED + ' ACCEPTED but NO-OP — newline stays space'] },
    { cells: ['<code>tagFilter</code>', W_CORRECTED + ' ACCEPTED but NO-OP — <b> not filtered in 1.4.0'] },
  ]);
  const callbacks = widgetTable(['render() callback', 'Meta (verified)'], [
    { cells: ['<code>heading</code>', '{ level, id } — id from headings:{ids:true}'] },
    { cells: ['<code>code</code>', '{ language } (e.g. ts)'] },
    { cells: ['<code>list</code>', '{ ordered, start, depth } — ordered start=1, depth 0/1/2 nested verified'] },
    { cells: ['<code>listItem</code>', '{ index, ordered, start, depth, checked } — task item reports checked:true'] },
    { cells: ['<code>th</code>/<code>td</code>', '{ align } (undefined when no alignment)'] },
    { cells: ['<code>link</code> / <code>image</code>', '{ href, title? } / { src, title? }'] },
    { cells: ['<code>strong</code> <code>emphasis</code> <code>codespan</code> <code>strikethrough</code> <code>text</code>', 'children only'] },
    { cells: ['<code>paragraph</code> <code>blockquote</code> <code>hr</code> <code>table</code>/<code>thead</code>/<code>tbody</code>/<code>tr</code> <code>html</code>', 'block callbacks — all fire'] },
    { cells: ['null return drops element; omitted callback = pass-through', W_VERIFIED + ' both behaviors'] },
  ]);
  const native = widgetTable(['Our wrapper', 'Now (native)'], [
    { cells: ['<code>markdownHeadings</code>', W_VERIFIED + ' render() heading callbacks + native ids — no HTML regex, no manual slugger'] },
    { cells: ['<code>renderMarkdownToc</code>', W_VERIFIED + ' nested fragment TOC from the callback tree'] },
    { cells: ['<code>markdownPlaintext</code>', W_VERIFIED + ' render callbacks — GFM tables/tasks flattened natively'] },
    { cells: ['<code>renderMarkdownBody</code>', W_VERIFIED + ' html() with GFM defaults (tables/tasks/strikethrough)'] },
  ]);
  const react = widgetTable(['react()', 'Probe'], [
    { cells: ['<code>react(md, overrides?, { reactVersion: 18 })</code>', W_VERIFIED + ' default emits Symbol.for("react.transitional.element") — the React 19+ element type (verified from React source: REACT_ELEMENT_TYPE = renameElementSymbol ? transitional : legacy)'] },
    { cells: ['<code>{ reactVersion: 18 }</code>', W_VERIFIED + ' emits Symbol.for("react.element") — the legacy React 18 type; probe: $$typeof flips exactly'] },
    { cells: ['tag overrides (h1-h6, p, pre, a, img, code, del, br, table…)', W_NOTE + ' overrides map verified to exist; element shape not rendered without React'] },
  ]);
  return renderWidgetPage({
    title: 'Bun.markdown Full API',
    subtitle: 'Every documented option + callback + meta probed against Bun 1.4.0 — verified / corrected / marketing',
    badges: ['12 html options', '19 callbacks', 'native ids', 'GFM on by default', 'Bun 1.3.8 (Zig)'],
    links: ['/bun/overview', '/bun/speed', '/content/posts', '/bun/map'],
    sections: [
      { heading: 'html() options (probe matrix)', html: htmlOpts },
      { heading: 'render() callbacks + meta', html: callbacks },
      { heading: 'Our wrappers — native, not hand-rolled', html: native },
      { heading: 'react()', html: react },
    ],
    footer: 'Full probe matrix: docs/AGENT-PITFALLS.md §34 · wrappers: src/lib/markdown-headings.ts + content-pipeline.ts',
  });
}