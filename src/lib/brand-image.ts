/**
 * brand-image.ts — Bun.Image + branding integration (constructor API).
 *
 * Bun 1.4.0 image library (bun.com/blog/bun-v1.4 — API looks like sharp):
 *   const img = new Bun.Image(bytes);                    // decode (in-memory)
 *   img.resize(w, h, { fit: 'inside' }).rotate(90).webp({ quality: 85 });
 *   new Response(img.resize(200).jpeg());                // Image is a body
 * Formats: JPEG/PNG/WebP/GIF/BMP (+ HEIC/AVIF/TIFF on macOS/Windows).
 *
 * This module gives the design system:
 *  - `brandCardSvg()` — KALSHI HQ wordmark card from BRAND + TOKENS
 *    (token-compliant enforced surface) served at /brand.svg;
 *  - `brandSwatchPng(hex, size)` — solid token-color PNGs served at
 *    /brand/swatch/<token>.png, streamed through the Image API;
 *  - `decodeImage/readImageMeta/convertImageFile` — the shared Bun.Image
 *    surface for the terminal tool, routes, and gates.
 */
import { BRAND, DESIGN_SYSTEM_VERSION, TOKENS } from '../institutions/design-tokens.ts';
import { convertColorFallback } from '../lib/color/kernel.ts';
import { encodeSolidColorPng } from '../partner/visuals.ts';

export type ImageMeta = {
  path?: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
};

export type ConvertOptions = {
  format?: 'png' | 'jpeg' | 'webp' | 'avif';
  width?: number;
  height?: number;
  /** sharp-style fit for resize (Bun.Image supports 'inside' | 'fill'). */
  fit?: 'inside' | 'fill';
  rotate?: number;
  quality?: number;
};

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/** Hex token value -> { r, g, b } via the browser-safe kernel. */
export function tokenRgb(hex: string): { r: number; g: number; b: number } {
  const rgb = convertColorFallback(hex, '{rgb}');
  if (!rgb || typeof rgb === 'string' || typeof rgb === 'number') return { r: 0, g: 0, b: 0 };
  return rgb;
}

/**
 * KALSHI HQ brand card (OG-style 1200x630) built entirely from TOKENS —
 * every fill/stroke is a token value, so the design audit passes by
 * construction. Served at /brand.svg (Bun.Image cannot rasterize SVG).
 */
export function brandCardSvg(): string {
  const t = TOKENS.color;
  const swatches = [
    [t.acc, 'acc'],
    [t.ok, 'ok'],
    [t.warn, 'warn'],
    [t.bad, 'bad'],
  ] as const;
  const swatchRects = swatches
    .map(([hex, name], i) => {
      const x = 104 + i * 88;
      return '<rect x="' + x + '" y="420" width="64" height="64" rx="14" fill="' + hex + '"/><text x="' + x + '" y="516" font-family="ui-monospace, monospace" font-size="20" fill="' + t.dim + '">' + name + '</text>';
    })
    .join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
    '<rect width="1200" height="630" fill="' + t.bg + '"/>' +
    '<rect x="60" y="60" width="1080" height="510" rx="20" fill="' + t.panel + '" stroke="' + t.line + '" stroke-width="2"/>' +
    '<text x="104" y="280" font-family="ui-monospace, monospace" font-size="116" font-weight="700" fill="' + t.fg + '">' + esc(BRAND.wordmark) + ' <tspan fill="' + t.acc + '">' + esc(BRAND.accentWord) + '</tspan></text>' +
    '<text x="108" y="360" font-family="-apple-system, Segoe UI, sans-serif" font-size="42" fill="' + t.dim + '">' + esc(BRAND.tagline) + '</text>' +
    swatchRects +
    '<text x="104" y="540" font-family="ui-monospace, monospace" font-size="22" fill="' + t.dim + '">v' + esc(DESIGN_SYSTEM_VERSION) + '</text>' +
    '</svg>';
}

/** Solid token-color PNG (square) via the repo's hand-rolled encoder. */
export function brandSwatchPng(hex: string, size = 64): Uint8Array {
  const { r, g, b } = tokenRgb(hex);
  return encodeSolidColorPng(r, g, b, size);
}

/**
 * Decode image bytes with the Bun.Image constructor (in-memory — no temp
 * files). Throws for unsupported formats (JPEG/PNG/WebP/GIF/BMP + macOS
 * HEIC/AVIF/TIFF supported).
 */
export function decodeImage(data: Uint8Array | Blob | ArrayBuffer): InstanceType<typeof Bun.Image> {
  return new Bun.Image(data);
}

/**
 * Apply sharp-style transforms (resize with fit, rotate, re-encode) and
 * return the resulting Image — which is itself Response-body compatible
 * (new Response(image)). Ground-truth metadata via the encoded image.
 */
export async function transformImage(
  data: Uint8Array | Blob | ArrayBuffer,
  opts: ConvertOptions = {},
): Promise<{ image: InstanceType<typeof Bun.Image>; meta: ImageMeta }> {
  let img = decodeImage(data);
  if (opts.width || opts.height) {
    const fit = opts.fit ?? 'inside';
    img = img.resize(opts.width ?? img.width, opts.height ?? img.height, { fit });
  }
  if (opts.rotate) img = img.rotate(opts.rotate);
  const format = opts.format ?? 'png';
  const quality = opts.quality ?? 80;
  const encoded =
    format === 'jpeg' ? await img.jpeg({ quality }) :
    format === 'webp' ? await img.webp({ quality }) :
    format === 'avif' ? await img.avif({ quality }) :
    await img.png();
  const bytes = await encoded.bytes();
  // metadata() on a transformed image reflects the SOURCE; re-decode the
  // encoded bytes for ground-truth dimensions/format.
  const meta = await decodeImage(bytes).metadata();
  return { image: encoded, meta: { width: meta.width, height: meta.height, format: meta.format, bytes: bytes.length } };
}

/**
 * Read an image file's metadata via the constructor (in-memory decode of
 * the file bytes). Returns null when missing or not an image format.
 */
export async function readImageMeta(path: string): Promise<ImageMeta | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const img = decodeImage(await file.bytes());
    const meta = await img.metadata();
    return { path, width: meta.width, height: meta.height, format: meta.format, bytes: file.size };
  } catch {
    return null;
  }
}

/** Convert + write to disk; returns on-disk ground-truth metadata. */
export async function convertImageFile(
  input: string,
  outPath: string,
  opts: ConvertOptions = {},
): Promise<ImageMeta | null> {
  try {
    const { image } = await transformImage(await Bun.file(input).bytes(), opts);
    await image.write(outPath);
    return readImageMeta(outPath);
  } catch {
    return null;
  }
}

/** Bun.WebView is available (webkit on macOS, chrome elsewhere). */
export function hasWebView(): boolean {
  return typeof Bun.WebView === 'function';
}

/**
 * Rasterize the brand card to PNG via Bun.WebView (the Bun 1.4.0
 * rasterizer path — Bun.Image cannot rasterize SVG). Returns null when
 * WebView is unavailable or the capture fails.
 */
export async function brandCardPng(
  opts: { width?: number; height?: number; font?: string } = {},
): Promise<Uint8Array | null> {
  if (!hasWebView()) return null;
  const width = opts.width ?? 1200;
  const height = opts.height ?? 630;
  // Optional web font: injected as a stylesheet link (validated https/non-
  // localhost by the caller via validateFontUrl) so the rasterized card can
  // use embedded fonts instead of system-only.
  const fontLink = opts.font
    ? '<link rel="stylesheet" href="' + esc(opts.font) + '" />'
    : '';
  const html = '<!DOCTYPE html><html><head>' + fontLink + '<style>html,body{margin:0;padding:0;background:' + TOKENS.color.bg + '}</style></head><body>' + brandCardSvg() + '</body></html>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  type BrandWebViewOptions = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;
  // WebKit screenshots are flaky under parallel load ("Completion handler for
  // function call is no longer reachable") — retry with escalating settles.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await using view = new Bun.WebView({
        width,
        height,
        backend: process.platform === 'darwin' ? 'webkit' : 'chrome',
        url: dataUrl,
      } as BrandWebViewOptions);
      // Settle delay: an immediate screenshot can race layout.
      await new Promise((res) => setTimeout(res, 400 + attempt * 300));
      const shot = await view.screenshot({ format: 'png', encoding: 'buffer' });
      return new Uint8Array(shot); // Buffer is a Uint8Array — copy to a plain one
    } catch {
      // transient WebKit contention — retry once
    }
  }
  return null;
}

/**
 * Stream an Image as a Response body. Runtime-verified (bun-v1.4 blog:
 * `new Response(img.resize(200).jpeg())`), but bun-types 1.4.0 don't
 * declare Image as BodyInit yet — the cast is exact.
 */
export function imageResponse(
  image: InstanceType<typeof Bun.Image>,
  headers: Record<string, string> = {},
): Response {
  return new Response(image as unknown as BodyInit, { headers });
}

// ── Brand templates (all token-built, audited surfaces) ──────────────────

/**
 * Semantic status badge card (SVG). tone: ok|warn|bad|dim; text clamped to
 * 40 chars. Served at /brand/badge.svg?tone=ok&text=...
 */
export function brandBadgeSvg(tone: 'ok' | 'warn' | 'bad' | 'dim', text: string): string {
  const t = TOKENS.color;
  const color = t[tone];
  const tint = tone === 'ok' ? t.okTint : tone === 'warn' ? t.warnTint : tone === 'bad' ? t.badTint : t.panel2;
  const label = String(text).slice(0, 40) || 'STATUS';
  const w = Math.max(220, 40 + label.length * 15);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="64" viewBox="0 0 ' + w + ' 64">' +
    '<rect x="8" y="8" width="' + (w - 16) + '" height="48" rx="24" fill="' + tint + '" stroke="' + color + '" stroke-width="2"/>' +
    '<circle cx="30" cy="32" r="6" fill="' + color + '"/>' +
    '<text x="52" y="39" font-family="ui-monospace, monospace" font-size="20" font-weight="700" fill="' + color + '">' + esc(label.toUpperCase()) + '</text>' +
    '</svg>';
}

/**
 * Quote card (SVG) for social proof / findings. Served at
 * /brand/quote.svg?quote=...&by=... (quote clamped to 160 chars).
 */
export function brandQuoteSvg(quote: string, attribution: string): string {
  const t = TOKENS.color;
  const q = String(quote).slice(0, 160);
  const by = String(attribution).slice(0, 60);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240">' +
    '<rect width="800" height="240" fill="' + t.bg + '"/>' +
    '<text x="48" y="70" font-family="ui-monospace, monospace" font-size="64" fill="' + t.acc + '">“</text>' +
    '<text x="48" y="130" font-family="-apple-system, Segoe UI, sans-serif" font-size="30" fill="' + t.fg + '">' + esc(q) + '</text>' +
    (by ? '<text x="48" y="190" font-family="ui-monospace, monospace" font-size="22" fill="' + t.dim + '">— ' + esc(by) + '</text>' : '') +
    '</svg>';
}

/**
 * Bar-chart preview card (SVG). values: 1-12 numbers, clamped; bars use
 * the acc token with the max bar highlighted in ok.
 */
export function brandChartSvg(values: number[]): string {
  const t = TOKENS.color;
  const nums = values.slice(0, 12).map((v) => Math.max(0, Math.min(1e9, Number(v) || 0)));
  const max = Math.max(...nums, 1);
  const bw = 60;
  const gap = 20;
  const w = Math.max(320, nums.length * (bw + gap) + 40);
  const bars = nums
    .map((v, i) => {
      const h = Math.max(4, Math.round((v / max) * 180));
      const x = 24 + i * (bw + gap);
      const y = 210 - h;
      const fill = v === max ? t.ok : t.acc;
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="8" fill="' + fill + '"/>';
    })
    .join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="240" viewBox="0 0 ' + w + ' 240">' +
    '<rect width="' + w + '" height="240" fill="' + t.bg + '"/>' +
    '<rect x="12" y="12" width="' + (w - 24) + '" height="216" rx="14" fill="' + t.panel + '"/>' +
    bars +
    '</svg>';
}

/**
 * Optional web font for the WebView rasterizer: injects a CSS <link> into
 * the HTML wrapper. Validated to https + non-localhost (SSRF guard).
 */
export function validateFontUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Shared clamp for image dimensions (100-4000); missing/empty -> fallback. */
export function clampDim(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(100, Math.min(4000, Math.round(n)));
}
