/**
 * markdown-images.ts — the Bun.Image + Bun.markdown content pipeline.
 *
 * Renders a markdown document and, in the SAME pass, processes every image it
 * contains via Bun.Image (verified on Bun 1.4.0: chainable resize → webp →
 * write, lazy pipeline, metadata() without full decode). Collection uses the
 * verified render() `image` callback (it fires with (alt, {src, title})); the
 * FINAL render goes through html() — render() is a plain-text element stream,
 * so building HTML from its callbacks alone would drop all formatting.
 * (Probe-verified: render('# H **b**') === 'Hb'.)
 *
 * Verified API facts it depends on (see tests/lib/markdown-verified.test.ts):
 *   - Bun.markdown.render(md, { image: (alt, { src, title }) => string })
 *   - new Bun.Image(bytes) / Bun.file(path).image()
 *   - .resize(width) keeps aspect · .webp({ quality }) · .write(path)
 *   - .metadata() → { width, height, format }
 * Terminal methods are bytes/buffer/toBuffer/write/blob/toBase64 — NOT
 * arrayBuffer() (that is not a Bun.Image method; probe-verified).
 *
 * @see https://bun.com/docs/runtime/image (chainable pipeline, metadata,
 *      terminals — write() returns bytes, no arrayBuffer())
 * @see https://bun.com/docs/runtime/markdown (render() image callback, html())
 */
import { mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

export type MarkdownImageOptions = {
  /** Directory for processed files (created if missing). */
  outDir: string;
  /** URL prefix for rewritten src (defaults to the outDir basename). */
  urlPrefix?: string;
  /** Resize width (aspect preserved; single-width-arg verified). Default 1200. */
  maxWidth?: number;
  /** WebP quality 1–100. Default 80. */
  quality?: number;
  /** Allow http(s) srcs (fetched). Default false — local files only. */
  fetchRemote?: boolean;
};

export type ProcessedImage = {
  src: string;              // original markdown src
  url: string;              // rewritten URL in the output HTML
  width: number;
  height: number;
  bytes: number;
};

export type MarkdownImagesResult = {
  html: string;             // rendered HTML with rewritten image srcs
  processed: ProcessedImage[];
  skipped: string[];        // srcs that could not be processed (missing/unsupported)
};

const escapeAttr = (v: string): string => Bun.escapeHTML(v);

/** Hash a src into a stable 8-hex filename token. */
function fileToken(src: string): string {
  const h = new Bun.CryptoHasher('sha1');
  h.update(src);
  return h.digest('hex').slice(0, 8);
}

/** Collect image refs from markdown via the verified render() image callback. */
function collectImages(md: string): Array<{ alt: string; src: string; title?: string }> {
  const refs: Array<{ alt: string; src: string; title?: string }> = [];
  try {
    Bun.markdown.render(md, {
      image: (children, meta) => {
        // exactOptionalPropertyTypes: title only when present
        refs.push(meta.title ? { alt: children, src: meta.src, title: meta.title } : { alt: children, src: meta.src });
        return '';
      },
    });
  } catch {
    /* unparseable markdown — fall through with zero refs */
  }
  return refs;
}

/** Process one image src → webp file in outDir. Returns null if skipped. */
async function processOne(
  src: string,
  opts: MarkdownImageOptions,
): Promise<ProcessedImage | null> {
  let input: ArrayBuffer | Uint8Array;
  if (/^https?:\/\//i.test(src)) {
    if (!opts.fetchRemote) return null;
    const res = await fetch(src);
    if (!res.ok) return null;
    input = await res.arrayBuffer();
  } else {
    const file = Bun.file(src);
    if (!(await file.exists())) return null;
    input = await file.arrayBuffer();
  }
  // Single decode: metadata() does not consume the instance — resize/webp
  // chain off the SAME Image (probe-verified; write() returns bytes written).
  const img = new Bun.Image(input);
  const meta = await img.metadata();
  const width = opts.maxWidth ?? 1200;
  const outName = basename(src, extname(src)) + '-' + fileToken(src) + '-' + width + '.webp';
  mkdirSync(opts.outDir, { recursive: true });
  const dest = join(opts.outDir, outName);
  const written = await img.resize(width).webp({ quality: opts.quality ?? 80 }).write(dest);
  const prefix = opts.urlPrefix ?? basename(opts.outDir);
  return { src, url: prefix + '/' + outName, width: meta.width, height: meta.height, bytes: written };
}

/**
 * Render markdown to HTML, processing every ![alt](src) image through
 * Bun.Image (resize → webp → write). Missing/unsupported images are left as
 * their original src and reported in `skipped`.
 */
export async function processMarkdownImages(
  md: string,
  opts: MarkdownImageOptions,
): Promise<MarkdownImagesResult> {
  const refs = collectImages(md);
  const unique = [...new Map(refs.map((r) => [r.src, r])).values()];
  const map = new Map<string, ProcessedImage>();
  const skipped: string[] = [];
  for (const r of unique) {
    const out = await processOne(r.src, opts);
    if (out) map.set(r.src, out);
    else skipped.push(r.src);
  }
  // Rewrite processed srcs in the markdown itself (markdown image syntax
  // ![alt](src "title") — replace the ](src opener), then render complete
  // HTML via html(). Links that share a processed URL are also rewritten.
  let outMd = md;
  for (const done of map.values()) {
    outMd = outMd.split('](' + done.src).join('](' + done.url);
  }
  const html = Bun.markdown.html(outMd);
  return { html, processed: [...map.values()], skipped };
}
