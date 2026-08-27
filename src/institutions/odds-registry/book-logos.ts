/**
 * book-logos.ts — branded bookmaker logo assets, generated not drawn.
 *
 * Every registry book gets a 128×128 PNG: rounded swatch in a deterministic
 * color derived from the book key + white initials (up to 3). Assets live at
 * `public/assets/books/<key>.png` — the bookmaker store's conventional logo
 * path — so the report's Logo column lights up without any config edit.
 *
 * Rasterization reuses the status-card WebView retry pattern (Bun.Image
 * cannot decode SVG on 1.4.0 — probed). Idempotent: existing, non-empty
 * PNGs are skipped unless opts.force.
 */
import type { OddsRegistryConfig } from "./types.ts";

export const BOOK_LOGO_DIR = "public/assets/books";
export const BOOK_LOGO_SIZE = 128;

/** Deterministic brand hue per book key (stable across runs/machines). */
export function bookColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  const hex = Bun.color(`hsl(${h}, 62%, 42%)`, "hex");
  return typeof hex === "string" ? hex : "#52525b";
}

/** Initials for the swatch: first letters of up to 3 words, else first 3 chars. */
export function bookInitials(key: string, name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
  return key.replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase();
}

export function bookLogoSvg(key: string, name: string): string {
  const color = bookColor(key);
  const initials = bookInitials(key, name);
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + BOOK_LOGO_SIZE + '" height="' + BOOK_LOGO_SIZE + '" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" rx="24" fill="' + color + '"/>' +
    '<text x="64" y="78" font-family="-apple-system,Segoe UI,sans-serif" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle">' + esc(initials) + '</text>' +
    '<text x="64" y="104" font-family="-apple-system,Segoe UI,sans-serif" font-size="13" fill="#ffffffcc" text-anchor="middle">' + esc(key) + '</text>' +
    '</svg>'
  );
}

/**
 * Rasterize one logo via WebView (WebKit/chrome backend per platform).
 * Mirrors the status-card retry pattern; null when WebView is unavailable
 * or all attempts lose the race.
 */
export async function bookLogoPng(key: string, name: string, opts: { size?: number } = {}): Promise<Uint8Array | null> {
  if (typeof Bun.WebView !== "function") return null;
  const size = opts.size ?? BOOK_LOGO_SIZE;
  const html = '<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>' + bookLogoSvg(key, name) + '</body></html>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  type WvOptions = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let view: Bun.WebView | undefined;
    try {
      view = new Bun.WebView({
        width: size,
        height: size,
        backend: process.platform === "darwin" ? "webkit" : "chrome",
        url: dataUrl,
      } as WvOptions);
      await new Promise((res) => setTimeout(res, 400 + attempt * 400));
      const shot = await view.screenshot({ format: "png", encoding: "buffer" });
      return new Uint8Array(shot.buffer.slice(shot.byteOffset, shot.byteOffset + shot.byteLength) as ArrayBuffer);
    } catch {
      // transient WebView contention — retry
    } finally {
      try { view?.close(); } catch { /* already closed */ }
    }
  }
  return null;
}

/** Conventional logo path for a book key (the store's fallback). */
export function bookLogoPath(key: string): string {
  return `/assets/books/${key}.png`;
}

/**
 * Generate logos for every registry book that lacks one on disk.
 * Returns the keys written (skips existing unless force).
 */
export async function ensureBookLogos(
  cfg: OddsRegistryConfig,
  root: string,
  opts: { force?: boolean } = {},
): Promise<{ written: string[]; skipped: string[]; failed: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const outDir = root + "/" + BOOK_LOGO_DIR;
  for (const bk of cfg.bookmakers) {
    // Bun.write creates parent directories — no mkdir step needed.
    const out = outDir + "/" + bk.key + ".png";
    if (!opts.force && (await Bun.file(out).exists())) {
      skipped.push(bk.key);
      continue;
    }
    const png = await bookLogoPng(bk.key, bk.name);
    if (png) {
      await Bun.write(out, png);
      written.push(bk.key);
    } else {
      failed.push(bk.key);
    }
  }
  return { written, skipped, failed };
}
