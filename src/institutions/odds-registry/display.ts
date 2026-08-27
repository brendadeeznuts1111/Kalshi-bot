/**
 * display.ts — odds-registry display: status card (WebView-rasterized, NOT the
 * broken Bun.Image(svg) path — probed: SVG is not a decodable format on 1.4.0;
 * Bun.WebView is the rasterizer) + registry health summary.
 */
import { TOKENS } from "../../institutions/design-tokens.ts";
import type { OddsRegistryConfig } from "./types.ts";

export type StatusTone = "ok" | "warn" | "bad" | "dim";

const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Token-built 1200x630 status card SVG (tone color + headline + subline). */
export function statusCardSvg(tone: StatusTone, headline: string, subline = ""): string {
  const t = TOKENS.color;
  const color = t[tone];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">',
    '<rect width="1200" height="630" fill="' + color + '"/>',
    '<text x="600" y="300" font-family="system-ui" font-size="72" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">' + esc(headline) + '</text>',
    subline ? '<text x="600" y="390" font-family="system-ui" font-size="30" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="central">' + esc(subline) + '</text>' : "",
    '</svg>',
  ].join("");
}

/**
 * Rasterize the status card to PNG via Bun.WebView (verified rasterizer;
 * retry pattern from brandCardPng). Returns null on failure.
 */
export async function statusCardPng(
  tone: StatusTone,
  headline: string,
  subline = "",
  opts: { width?: number; height?: number } = {},
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof Bun.WebView !== "function") return null;
  const width = opts.width ?? 1200;
  const height = opts.height ?? 630;
  const html = '<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:' + TOKENS.color.bg + '}</style></head><body>' + statusCardSvg(tone, headline, subline) + '</body></html>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  type WvOptions = NonNullable<ConstructorParameters<typeof Bun.WebView>[0]>;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let view: Bun.WebView | undefined;
    try {
      view = new Bun.WebView({
        width,
        height,
        backend: process.platform === "darwin" ? "webkit" : "chrome",
        url: dataUrl,
      } as WvOptions);
      // WebKit needs a settle window; under parallel test load the first
      // attempts contend with sibling WebViews, so back off aggressively.
      await new Promise((res) => setTimeout(res, 500 + attempt * 400));
      const shot = await view.screenshot({ format: "png", encoding: "buffer" });
      // detach from any shared buffer; WebView screenshot buffers are plain ArrayBuffers
      return new Uint8Array(shot.buffer.slice(shot.byteOffset, shot.byteOffset + shot.byteLength) as ArrayBuffer);
    } catch {
      // transient WebKit contention — retry (try/finally guarantees close)
    } finally {
      try { view?.close(); } catch { /* already closed */ }
    }
  }
  return null;
}

/** Per-feed type summary for the registry health surface. */
export function oddsRegistryHealth(cfg: OddsRegistryConfig): {
  ok: boolean;
  bookmakerCount: number;
  capacityFloor: number;
  feeds: Record<string, number>;
  sports: string[];
} {
  const feeds: Record<string, number> = {};
  const sports = new Set<string>();
  for (const bk of cfg.bookmakers) {
    feeds[bk.feed] = (feeds[bk.feed] ?? 0) + 1;
    for (const s of bk.sports) sports.add(s);
  }
  return {
    ok: cfg.bookmakers.length >= cfg.capacityFloor,
    bookmakerCount: cfg.bookmakers.length,
    capacityFloor: cfg.capacityFloor,
    feeds,
    sports: [...sports].sort(),
  };
}

