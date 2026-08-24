/**
 * video-page.ts — /videos: the branded <video> consumer for files in
 * public/videos (served by the Bun.serve dir route with automatic
 * Range/206 seek support). Enforced design surface: token-built shell.
 */
import { BRAND } from '../institutions/design-tokens.ts';

const VIDEO_EXTS = ['.mp4', '.webm', '.ogv', '.mov', '.m4v'] as const;
export function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Safe single-segment video id for the /videos/:id param route: no path
 * separators, no traversal, reasonable length, video extension only. The
 * param route OWNS all single-segment paths (param beats wildcard), so this
 * guard is the traversal defense for hand-rolled Bun.file serving.
 */
export function isSafeVideoId(id: string | undefined | null): boolean {
  if (!id) return false;
  if (id.length > 120) return false;
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return false;
  if (id.startsWith('.') || id.includes('\0')) return false;
  return isVideoFile(id);
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export function renderVideoPage(videos: string[]): string {
  const cards = videos.length
    ? videos
        .map((name) =>
          '<div class="vid"><video controls preload="metadata" src="/videos/' + esc(name) + '">' +
            'Your browser does not support the video tag.' +
            '</video><div class="vid-name">' + esc(name) + '</div></div>',
        )
        .join('')
    : '<div class="muted">No videos yet — drop files (mp4/webm/…) into <code>public/videos/</code>. Range/seek is handled automatically by Bun.serve (206 Partial Content).</div>';
  return '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc(BRAND.name) + ' — videos</title>' +
    '<link rel="stylesheet" href="/design-system.css" />' +
    '<style>' +
    'body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, \"SF Pro Text\", Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }' +
    'header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }' +
    'header h1 { margin: 0; font-size: 1.2rem; letter-spacing: 0.04em; }' +
    'header h1 span { color: var(--acc); }' +
    'header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }' +
    '.vid { margin-bottom: 1.5rem; }' +
    'video { width: 100%; max-width: 720px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; display: block; }' +
    '.vid-name { color: var(--dim); font-family: var(--mono); font-size: 0.8rem; margin-top: 0.4rem; }' +
    'a { color: var(--acc); }' +
    '</style></head><body>' +
    '<header><h1>' + esc(BRAND.name) + ' <span>videos</span></h1><p>' + esc(videos.length) + ' file(s) · served with Range/206 by Bun.serve · <a href="/videos/index.json">manifest</a> · <a href="/design">design</a> · <a href="/design/trend">trend</a></p></header>' +
    cards +
    '</body></html>';
}
