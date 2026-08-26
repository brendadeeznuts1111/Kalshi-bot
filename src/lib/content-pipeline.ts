/**
 * content-pipeline.ts — zero-dep content ingestion: Bun.file -> frontmatter
 * -> SHA-256 content hash -> ETag/304. The "content hashing + file + metadata"
 * pipeline, probe-corrected (docs/AGENT-PITFALLS.md §24):
 *
 *   - `Bun.sha` is NOT a general-purpose hash: it is SHA-512/256
 *     (probe: Bun.sha("abc", "hex") === sha512-256 vector, default returns
 *     a Uint8Array). The doc's "pass Uint8Array for speed" claim measured
 *     NO difference (34.7ms vs 33.9ms over 100x1MB). We use CryptoHasher
 *     with sha256 for content fingerprints.
 *   - CryptoHasher verified: sha1/sha256/sha384/sha512/blake2b256/md5/
 *     blake2b512/sha512-256/sha3-256 all match known vectors; digest() with
 *     no arg returns a Buffer; "hex"/"base64" work; "arraybuffer" throws.
 *   - Bun.file verified: exists()/text()/bytes() (Uint8Array)/stat()
 *     (size + mtime Date).
 */
export type ContentItem = {
  id: string;          // slug from frontmatter
  sourcePath: string;
  title: string;
  pubDate: string;     // ISO from frontmatter date
  contentHash: string; // sha256 hex of the raw content
  etag: string;        // quoted hash for the ETag header
  tags: string[];
  body: string;        // markdown body (after frontmatter)
};

/** Hash data with CryptoHasher (sha256 default) -> lowercase hex. */
export function hashContent(data: string | Uint8Array, algo: "sha256" | "sha512" | "sha1" | "sha384" | "blake2b256" = "sha256"): string {
  const h = new Bun.CryptoHasher(algo);
  h.update(data);
  return h.digest("hex");
}

/** Quoted ETag from a content hash ("<hash>" — strong, exact-match). */
export function etagFor(hash: string): string {
  return '"' + hash + '"';
}

/** Frontmatter keys we extract. */
export type Frontmatter = {
  slug?: string;
  title?: string;
  date?: string;
  tags?: string[];
  [k: string]: unknown;
};

/**
 * Parse --- delimited frontmatter (zero-dep; key: value lines, comma
 * lists, quoted strings). Returns metadata + the body after the block.
 * No match -> empty metadata, whole input as body.
 */
export function parseFrontmatter(markdown: string): { data: Frontmatter; content: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!m) return { data: {}, content: markdown };
  const data: Frontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    let value: string | string[] = kv[2]!.trim().replace(/^["']|["']$/g, "");
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    data[key] = value;
  }
  return { data, content: markdown.slice(m[0].length) };
}

/**
 * Render a markdown body to HTML via Bun.markdown.html — probe-verified
 * (AGENT-PITFALLS §27): headings, code fences (class="language-*"),
 * blockquotes, links, lists all render to real HTML. NOTE: Bun.markdown
 * exposes html/ansi/render/react — `render` is PLAIN TEXT (strips markup,
 * probe: "HelloSome bold…"), `html` is the renderer to use. Raw output is
 * trusted (our own content); escape if rendering untrusted markdown.
 */
import { headingTree, markdownHeadings } from "./markdown-headings.ts";

export { headingSlug, type HeadingNode, type HeadingTree } from "./markdown-headings.ts";
import { markdownToHtml } from "./markdown.ts";
import { processMarkdownImages, type MarkdownImageOptions } from "./markdown-images.ts";

/**
 * Plain-text extraction via Bun.markdown.render callbacks — the DOCUMENTED
 * pattern (AGENT-PITFALLS §32). render(md) with no callbacks passes children
 * through unchanged (that's why the raw call looked like stripped text);
 * supplying formatting callbacks gives a clean plaintext rendering.
 */
export function markdownPlaintext(markdown: string): string {
  try {
    return (Bun.markdown as unknown as {
      render(md: string, cbs: Record<string, (c: string, m?: Record<string, unknown>) => string>): string;
    }).render(markdown, {
      heading: (c) => c + '\n',
      paragraph: (c) => c + '\n',
      list: (c) => c,
      listItem: (c) => '- ' + c + '\n',
      link: (c, m) => c + (m && m.href ? ' (' + String(m.href) + ')' : ''),
      strong: (c) => c,
      emphasis: (c) => c,
      codespan: (c) => '`' + c + '`',
    });
  } catch {
    return markdown;
  }
}

/** TOC HTML (nested list of fragment links) for a post body. */
export function renderMarkdownToc(body: string): string {
  const nodes = markdownHeadings(body);
  if (nodes.length <= 1) return "";
  const tree = headingTree(nodes);
  const walk = (ts: ReturnType<typeof headingTree>): string =>
    '<ul>' + ts.map((t) => '<li><a href="#' + t.node.slug + '">' + t.node.text + '</a>' + (t.children.length ? walk(t.children) : '') + '</li>').join('') + '</ul>';
  return walk(tree);
}

export function renderMarkdownBody(body: string): string {
  try {
    // docs preset: GFM + tagFilter + autolinks + heading ids (verified Bun
    // 1.4.0 options); prose class applies the shared typography layer.
    return '<div class="prose">' + markdownToHtml(body, "docs") + '</div>';
  } catch {
    return '<pre>' + body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</pre>';
  }
}

/**
 * Async variant: render markdown body and process every image through
 * Bun.Image (resize → webp → write) via the markdown-images pipeline.
 * HTML is wrapped in the prose typography layer. Images that cannot be
 * processed keep their original src (reported in skipped).
 */
export async function renderMarkdownBodyWithImages(
  body: string,
  opts: MarkdownImageOptions,
): Promise<string> {
  const { html, skipped } = await processMarkdownImages(body, opts);
  // Do NOT embed raw srcs into HTML (comment breakout / attribute injection
  // via '-->' or quotes). Reference by index only — the caller can join
  // skipped[i] against the markdown srcs themselves.
  const note = skipped.length
    ? '<!-- markdown-images skipped: ' + skipped.length + ' image(s) (see processMarkdownImages result.skipped) -->'
    : '';
  return '<div class="prose">' + html + '</div>' + note;
}

/** Ingest one markdown file -> ContentItem (hash of the RAW content). */
export async function ingestContentItem(filePath: string): Promise<ContentItem> {
  const file = Bun.file(filePath);
  const raw = await file.text();
  const { data, content: body } = parseFrontmatter(raw);
  const contentHash = hashContent(raw); // hash the raw file, incl. frontmatter
  const id = (data.slug as string | undefined) ?? filePath.split("/").pop()!.replace(/\.md$/, "");
  const tags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
  return {
    id,
    sourcePath: filePath,
    title: (data.title as string | undefined) ?? id,
    pubDate: data.date ? new Date(String(data.date)).toISOString() : "",
    contentHash,
    etag: etagFor(contentHash),
    tags,
    body,
  };
}
