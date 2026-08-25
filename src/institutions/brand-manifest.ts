/**
 * brand-manifest.ts — the BRAND asset SSOT.
 *
 * Every brand surface the server serves (routes in serve.ts) is declared
 * here once: route, content-type, cache policy, generator, metrics key and
 * token provenance. /bun/brand renders this table; the brand channel
 * signals and /api/brand/metrics read the same metric keys. Nothing about
 * the brand surface is declared inline in the dashboard or routes.
 */
import { BRAND, DESIGN_SYSTEM_VERSION } from './design-tokens.ts';

export type BrandAssetDef = {
  /** Route as served. "<token>" marks a path-parameter segment. */
  route: string;
  method: 'GET' | 'POST';
  contentType: string;
  cache: string;
  /** Generator function in src/lib/brand-image.ts (or route handler). */
  generator: string;
  /** Metrics key in BrandMetricsSnapshot (serve.ts brandMetrics) when tracked. */
  metricsKey?: 'card' | 'swatch' | 'svg' | 'badge' | 'quote' | 'chart' | 'purges';
  /** Token provenance note (design-audit guarantee). */
  provenance: string;
  docRef?: string;
};

export const BRAND_MANIFEST: readonly BrandAssetDef[] = [
  {
    route: '/brand.svg',
    method: 'GET',
    contentType: 'image/svg+xml',
    cache: 'public, max-age=60',
    generator: 'brandCardSvg()',
    metricsKey: 'svg',
    provenance: 'Every fill/stroke is a TOKENS value — audit passes by construction',
  },
  {
    route: '/brand/card.png',
    method: 'GET',
    contentType: 'image/png',
    cache: 'no-cache',
    generator: 'brandCardPng({width,height}) via Bun.WebView raster + Bun.Image',
    metricsKey: 'card',
    provenance: 'Rasterizes brandCardSvg(); WebView fallback per §18',
    docRef: 'docs/AGENT-PITFALLS.md §18',
  },
  {
    route: '/brand/swatch/<token>.png',
    method: 'GET',
    contentType: 'image/png',
    cache: 'public, max-age=60',
    generator: 'brandSwatchPng(tokenHex, size)',
    metricsKey: 'swatch',
    provenance: 'Solid token-color PNG via the hand-rolled encoder (partner/visuals.ts)',
  },
  {
    route: '/brand/badge.svg',
    method: 'GET',
    contentType: 'image/svg+xml',
    cache: 'public, max-age=60',
    generator: 'brandBadgeSvg(tone, text)',
    metricsKey: 'badge',
    provenance: 'Semantic status pill in token hues + 15%-alpha tints',
  },
  {
    route: '/brand/quote.svg',
    method: 'GET',
    contentType: 'image/svg+xml',
    cache: 'public, max-age=60',
    generator: 'brandQuoteSvg(quote, attribution)',
    metricsKey: 'quote',
    provenance: 'Social-proof card; acc/fg/dim tokens only',
  },
  {
    route: '/brand/chart.svg',
    method: 'GET',
    contentType: 'image/svg+xml',
    cache: 'public, max-age=60',
    generator: 'brandChartSvg(values)',
    metricsKey: 'chart',
    provenance: 'Bar chart in acc/ok tokens; max bar highlighted ok',
  },
  {
    route: '/brand/purge',
    method: 'POST',
    contentType: 'application/json',
    cache: 'no-cache',
    generator: 'purge brand caches (serve.ts, CSRF-guarded)',
    metricsKey: 'purges',
    provenance: 'Admin action; increments the purges metric',
  },
  {
    route: '/api/brand/metrics',
    method: 'GET',
    contentType: 'application/json',
    cache: 'no-cache',
    generator: 'BrandMetricsSnapshot (serve.ts brandMetrics)',
    provenance: 'Feeds the brand channel signals on /dashboard',
  },
];

export const BRAND_SUMMARY = {
  name: BRAND.name,
  wordmark: BRAND.wordmark,
  accentWord: BRAND.accentWord,
  tagline: BRAND.tagline,
  designVersion: DESIGN_SYSTEM_VERSION,
};

export function brandAssetByRoute(route: string): BrandAssetDef | undefined {
  return BRAND_MANIFEST.find((a) => a.route === route);
}

/** The BrandMetricsSnapshot keys the brand channel reads (single source). */
export const BRAND_METRIC_KEYS = ['card', 'swatch', 'svg', 'badge', 'quote', 'chart', 'purges'] as const;
