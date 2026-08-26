// @see https://bun.com/docs/runtime/markdown#options
// @see https://bun.com/docs/runtime/image
// End-to-end: the Bun.Image + Bun.markdown content pipeline (markdown-images).
import { describe, expect, test, beforeAll } from 'bun:test';
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { processMarkdownImages } from '../../src/lib/markdown-images.ts';

const TMP = '/tmp/mi-test';
const SRC = join(TMP, 'src.png');
const OUT = join(TMP, 'out');

// 1x1 transparent PNG (tiny valid file).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  await Bun.write(SRC, PNG_1x1);
});

describe('processMarkdownImages (Bun.Image + Bun.markdown pipeline)', () => {
  test('processes a local image to webp and rewrites the src with lazy loading', async () => {
    const md = '# T\n\n![pic](/tmp/mi-test/src.png "title")\n';
    const res = await processMarkdownImages(md, { outDir: OUT });
    expect(res.processed).toHaveLength(1);
    const p = res.processed[0]!;
    expect(p.url).toMatch(/\.webp$/);
    expect(p.width).toBeGreaterThan(0);
    expect(p.bytes).toBeGreaterThan(0);
    // file exists on disk
    const file = join(OUT, p.url.split('/').pop()!);
    expect(existsSync(file)).toBe(true);
    // html references the processed file and renders an <img>
    expect(res.html).toContain(p.url);
    expect(res.html).toContain('<img');
    expect(res.skipped).toHaveLength(0);
  });

  test('missing images are skipped and keep their original src', async () => {
    const md = '![gone](/tmp/mi-test/nope.png)\n';
    const res = await processMarkdownImages(md, { outDir: OUT });
    expect(res.processed).toHaveLength(0);
    expect(res.skipped).toEqual(['/tmp/mi-test/nope.png']);
    expect(res.html).toContain('src="/tmp/mi-test/nope.png"');
  });

  test('remote srcs are skipped unless fetchRemote is set', async () => {
    const md = '![remote](https://bun.sh/icons/favicon-32x32.png)\n';
    const off = await processMarkdownImages(md, { outDir: OUT });
    expect(off.skipped).toEqual(['https://bun.sh/icons/favicon-32x32.png']);
    const on = await processMarkdownImages(md, { outDir: OUT, fetchRemote: true });
    expect(on.processed).toHaveLength(1);
    expect(on.processed[0]!.url).toMatch(/\.webp$/);
  }, 20000);

  test('maxWidth resizes and is reflected in the output', async () => {
    const md = '![p](/tmp/mi-test/src.png)\n';
    const res = await processMarkdownImages(md, { outDir: OUT, maxWidth: 1 });
    expect(res.processed).toHaveLength(1);
    expect(res.processed[0]!.url).toContain('-1.webp');
  });

  test('output html is full markdown render (headings + processed images)', async () => {
    const md = '# Head\n\n![p](/tmp/mi-test/src.png)\n\n**bold**\n';
    const res = await processMarkdownImages(md, { outDir: OUT });
    expect(res.html).toContain('<h1');
    expect(res.html).toContain('<strong>bold</strong>');
    expect(res.html).toContain('.webp');
  });
});
