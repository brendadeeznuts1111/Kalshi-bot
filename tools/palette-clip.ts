#!/usr/bin/env bun
/**
 * palette:clip — capture the Bun.color palette clip as an actual VIDEO.
 *
 * Opens a self-contained page that CYCLES through Bun.color output formats
 * (hex · css · rgb · hsl · lab · number · lch · oklab · oklch · hsv) for a
 * rotating hue, captures N frames via Bun.WebView (WebKit, offline data: URL),
 * composes them into an MP4 with ffmpeg, keeps frame 0 as the PNG poster,
 * writes public/videos/palette-clip.{mp4,png}, and registers the clip in
 * public/videos/clips.json (the clips manifest).
 *
 * Format facts (probe-verified on Bun 1.4.0):
 *   - Bun.color supports hex/css/rgb/hsl/lab/number (+ ansi variants)
 *   - hsv/lch/oklab/oklch are NOT in the Bun.color 1.4.0 format list — the
 *     kernel (convertColorFallback) computes them; labels show which.
 *   - Format strings are PRECOMPUTED server-side: Bun.color does not exist
 *     in the WebView (browser) context.
 *
 *   bun run palette:clip
 */
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { COLORS, type ColorKey } from '../src/lib/color/palette.ts';
import { convertColorFallback } from '../src/lib/color/kernel.ts';
import { readImageMeta } from '../src/lib/brand-image.ts';

const ROOT = join(import.meta.dir, '..');
const OUT_DIR = join(ROOT, 'public/videos');
const OUT_MP4 = join(OUT_DIR, 'palette-clip.mp4');
const OUT_PNG = join(OUT_DIR, 'palette-clip.png');
const MANIFEST = join(OUT_DIR, 'clips.json');
const FRAMES_DIR = '/tmp/palette-clip-frames';

const FPS = 20;
const SECONDS = 3;
const FRAME_COUNT = FPS * SECONDS;

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Formats shown, in cycle order. First 6 are Bun.color-native; last 4 kernel. */
const FORMATS = ['hex', 'css', 'rgb', 'hsl', 'lab', 'number', 'lch', 'oklab', 'oklch', 'hsv'] as const;

function formatValue(hex: string, f: (typeof FORMATS)[number]): string {
  switch (f) {
    case 'hex': return String(Bun.color(hex, 'hex'));
    case 'css': return String(Bun.color(hex, 'css'));
    case 'rgb': return String(Bun.color(hex, 'rgb'));
    case 'hsl': return String(Bun.color(hex, 'hsl'));
    case 'lab': return String(Bun.color(hex, 'lab'));
    case 'number': return String(Bun.color(hex, 'number'));
    default: return String(convertColorFallback(hex, f));
  }
}

/** Build the self-contained cycling page (dark token-style shell). */
function buildPage(): string {
  const paletteKeys = Object.keys(COLORS) as ColorKey[];
  const swatches = paletteKeys
    .slice(0, 14)
    .map((k) => {
      const hex = COLORS[k];
      return '<div class="sw"><div class="chip" style="background:' + hex + '"></div><code>' + esc(k) + '</code><code class="dim">' + esc(hex) + '</code></div>';
    })
    .join('');

  const hueCards = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((h) => 'hsl(' + h + ', 80%, 55%)')
    .map((c, ci) => {
      const labels = FORMATS.map((f, fi) => {
        const val = formatValue(c, f);
        return '<div class="fmt" style="animation-delay:' + (-fi * 1.1) + 's"><span class="tag">' + f + '</span><span class="val">' + esc(val) + '</span></div>';
      }).join('');
      return '<div class="card" style="animation-delay:' + (-ci * 1.4) + 's;background:' + c + '">' + labels + '<code class="src">' + esc(c) + '</code></div>';
    })
    .join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}html,body{background:#0b0e14;color:#d7dee9;font:13px/1.45 -apple-system,"SF Pro Text",Segoe UI,sans-serif;padding:28px 32px 36px}' +
    'h1{font-size:20px;letter-spacing:.02em;color:#4da3ff;font-weight:700;margin-bottom:4px}' +
    '.sub{color:#7d8798;font-size:11px;margin-bottom:18px}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:22px}' +
    '.card{position:relative;flex:1 1 150px;min-width:150px;height:120px;border-radius:10px;padding:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
    '.fmt{position:absolute;inset:auto 10px 26px;opacity:0;animation:swap 11s linear infinite;white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}' +
    '.fmt .tag{display:inline-block;background:rgba(0,0,0,.45);border-radius:4px;padding:1px 5px;margin-right:6px;font-weight:700}' +
    '.fmt .val{background:rgba(0,0,0,.35);border-radius:4px;padding:1px 5px}' +
    '.card .src{position:absolute;left:10px;top:8px;font-size:10px;color:rgba(255,255,255,.85);text-shadow:0 1px 2px rgba(0,0,0,.5)}' +
    '@keyframes swap{0%,7%{opacity:0}8%,16%{opacity:1}17%,100%{opacity:0}}' +
    '.huebar{height:26px;border-radius:13px;background:linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 55%),hsl(180 80% 55%),hsl(240 80% 55%),hsl(300 80% 55%),hsl(360 80% 55%));margin-bottom:20px}' +
    '.grid{display:flex;gap:10px;flex-wrap:wrap}' +
    '.sw{width:96px;text-align:center}.chip{height:44px;border-radius:8px;border:1px solid #232a3a;margin-bottom:4px}.sw code{display:block;font-size:9.5px;color:#d7dee9}.sw .dim{color:#7d8798}' +
    '.foot{color:#7d8798;font-size:9.5px;margin-top:16px}' +
    '</style></head><body>' +
    '<h1>Bun.color — palette clip</h1>' +
    '<p class="sub">Cycles through output formats (hex css rgb hsl lab number · kernel: lch oklab oklch hsv) for a rotating hue — Bun ' + esc(Bun.version) + '</p>' +
    '<div class="row">' + hueCards + '</div>' +
    '<div class="huebar"></div>' +
    '<div class="grid">' + swatches + '</div>' +
    '<p class="foot">captured by Bun.WebView · offline data: URL · formats verified: Bun.color 1.4.0 supports lab (not hsv/lch/oklab/oklch — kernel-computed)</p>' +
    '</body></html>';
}

/** Capture FRAME_COUNT frames via Bun.WebView (WebKit settle + retry). */
async function captureFrames(): Promise<Blob[] | null> {
  const html = buildPage();
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  type WebViewOpts = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await using view = new Bun.WebView({
        width: 1280,
        height: 720,
        backend: process.platform === 'darwin' ? 'webkit' : 'chrome',
        url: dataUrl,
      } as WebViewOpts);
      await new Promise((res) => setTimeout(res, 600 + attempt * 300));
      const frames: Blob[] = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        // screenshot() defaults to a Blob (image/png) — verified; keep it blob-native.
        const shotBlob = await view.screenshot();
        frames.push(shotBlob as Blob);
        // ~1 frame per 50ms at 20fps — pacing the capture so the animation advances
        await new Promise((res) => setTimeout(res, 45));
      }
      return frames;
    } catch {
      // transient WebKit contention — retry once
    }
  }
  return null;
}

/** Compose frames → MP4 with ffmpeg; returns true on success. */
async function composeMp4(): Promise<boolean> {
  const proc = Bun.spawn([
    'ffmpeg',
    '-y',
    '-framerate', String(FPS),
    '-i', join(FRAMES_DIR, 'frame-%03d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT_MP4,
  ], { stdout: 'ignore', stderr: 'ignore' });
  const exit = await proc.exited;
  return exit === 0;
}

/** Upsert the palette clip in the clips manifest (deterministic, no timestamps). */
function registerClip(meta: { width: number; height: number }, posterBytes: number, videoBytes: number): void {
  const existing: { version: number; clips: Array<Record<string, unknown>> } = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
    : { version: 1, clips: [] };
  const entry = {
    id: 'palette-clip',
    kind: 'video',
    title: 'Bun.color palette clip',
    file: 'palette-clip.mp4',
    poster: 'palette-clip.png',
    width: meta.width,
    height: meta.height,
    videoBytes,
    posterBytes,
    durationSeconds: SECONDS,
    formats: [...FORMATS],
    note: 'Bun.WebView frame capture composed with ffmpeg; cycles Bun.color output formats (kernel computes hsv/lch/oklab/oklch).',
  };
  const rest = existing.clips.filter((c) => c.id !== 'palette-clip');
  rest.push(entry);
  writeFileSync(MANIFEST, JSON.stringify({ version: 1, clips: rest }, null, 2) + String.fromCharCode(10));
}

if (typeof Bun.WebView !== 'function') {
  console.error('palette:clip: Bun.WebView unavailable — cannot rasterize');
  process.exit(1);
}
if (!existsSync('/opt/homebrew/bin/ffmpeg') && !existsSync('/usr/local/bin/ffmpeg')) {
  console.error('palette:clip: ffmpeg not found — need it to compose the MP4');
  process.exit(1);
}

rmSync(FRAMES_DIR, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const frames = await captureFrames();
if (!frames) {
  console.error('palette:clip: capture failed (WebKit busy?) — retry');
  process.exit(1);
}
for (let i = 0; i < frames.length; i += 1) {
  await Bun.write(join(FRAMES_DIR, 'frame-' + String(i).padStart(3, '0') + '.png'), frames[i]!);
}
// poster = frame 0
await Bun.write(OUT_PNG, frames[0]!);

const ok = await composeMp4();
if (!ok) {
  console.error('palette:clip: ffmpeg composition failed — keeping poster only');
  process.exit(1);
}
rmSync(FRAMES_DIR, { recursive: true, force: true });

const meta = await readImageMeta(OUT_PNG);
if (!meta || meta.format !== 'png') {
  console.error('palette:clip: poster verification FAILED', JSON.stringify(meta));
  process.exit(1);
}
const mp4Size = existsSync(OUT_MP4) ? Bun.file(OUT_MP4).size : 0;
registerClip({ width: meta.width, height: meta.height }, frames[0]!.size, mp4Size);
console.error('palette:clip ok -> public/videos/palette-clip.mp4 (' + mp4Size + ' B) + poster.png (' + frames[0]!.size + ' B, ' + meta.width + 'x' + meta.height + ') · manifest: public/videos/clips.json');
