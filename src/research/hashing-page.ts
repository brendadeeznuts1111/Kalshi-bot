/**
 * hashing-page.ts — /bun/hashing: Content Hashing & Metadata widget.
 * Probe-corrected claims (AGENT-PITFALLS §24): Bun.sha is SHA-512/256,
 * not a "general-purpose" hash; "Uint8Array is faster" measured NO
 * difference; CryptoHasher sha256 verified against known vectors.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_MARKETING } from '../lib/widget-page.ts';

export function renderHashingPage(): string {
  const hashApi = widgetTable(['API', 'Claim', 'Probe'], [
    { cells: ['<code>Bun.sha(data)</code>', '"general-purpose hashing"', W_CORRECTED + ' it is SHA-512/256 — hex of "abc" matches the sha512-256 vector, default return is a Uint8Array'] },
    { cells: ['<code>Bun.sha(data, "hex" | "base64")</code>', 'encodings', W_VERIFIED + ' hex/base64/utf8 accepted; "arraybuffer" throws (unknown encoding)'] },
    { cells: ['<code>Bun.CryptoHasher("sha256")</code>', 'SHA-256', W_VERIFIED + ' matches vector ba7816bf…; sha1/sha384/sha512/blake2b256/md5/blake2b512/sha512-256/sha3-256 all verified'] },
    { cells: ['<code>digest("hex"|"base64")</code>', 'digest forms', W_VERIFIED + ' hex/base64 strings; no-arg returns Buffer; "arraybuffer" throws'] },
    { cells: ['Uint8Array faster than string', 'performance', W_MARKETING + ' measured ~34.7ms vs ~33.9ms over 100x1MB — no material difference'] },
  ]);
  const fileApi = widgetTable(['Bun.file()', 'Probe'], [
    { cells: ['<code>exists()</code>', W_VERIFIED + ' false for missing files'] },
    { cells: ['<code>text()</code> / <code>bytes()</code>', W_VERIFIED + ' string / Uint8Array (lazy, Blob-compatible)'] },
    { cells: ['<code>stat()</code>', W_VERIFIED + ' size + mtime (Date) — content-addressed ETag source'] },
  ]);
  const pipeline = widgetTable(['Stage', 'Zero-dep impl'], [
    { cells: ['Ingest', '<code>Bun.file(path).text()</code>'] },
    { cells: ['Parse', 'hand-rolled frontmatter (--- block, key: value, lists)'] },
    { cells: ['Hash', '<code>new Bun.CryptoHasher("sha256").update(raw).digest("hex")</code>'] },
    { cells: ['Store', '<code>ContentItem</code> {id, sourcePath, title, pubDate, contentHash, etag, tags, body}'] },
    { cells: ['Serve', 'ETag = quoted hash; <code>If-None-Match</code> -> 304 (notModified helper)'] },
  ]);
  return renderWidgetPage({
    title: 'Content Hashing & Metadata',
    subtitle: 'Bun.file -> frontmatter -> SHA-256 -> ETag/304 — the content pipeline, probe-verified',
    badges: ['sha256', 'ETag/304', 'conditional GET', 'zero deps'],
    links: ['/content/posts', '/content/posts/hello-world.md', '/bun/overview'],
    sections: [
      { heading: 'Hashing APIs (probe table)', html: hashApi },
      { heading: 'File API', html: fileApi },
      { heading: 'The pipeline', html: pipeline },
      { heading: 'Live routes', html: '<ul><li><a href="/content/posts">/content/posts</a> — index with SHA-256 ETags</li><li><a href="/content/posts/hello-world.md">/content/posts/hello-world.md</a> — raw markdown, ETag/304</li><li>any post page sends ETag + honors If-None-Match (304)</li></ul>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §24 · source: src/lib/content-pipeline.ts',
  });
}
