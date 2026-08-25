/**
 * brand-page.ts — /bun/brand: the brand asset manifest as a living page.
 * Every /brand/* surface, its content-type, cache policy, generator, metric
 * key and token provenance — from brand-manifest.ts, the SSOT the brand
 * channel and /api/brand/metrics read. Token-built audited surface.
 */
import { renderWidgetPage, widgetTable } from '../lib/widget-page.ts';
import { BRAND_MANIFEST, BRAND_SUMMARY } from '../institutions/brand-manifest.ts';

const cell = (v: string): string => '<code>' + v + '</code>';
const badge = (v: string): string => '<span class="badge dim">' + v + '</span>';

export function renderBrandPage(): string {
  const rows = widgetTable(['Route', 'Method', 'Type', 'Cache', 'Generator', 'Metrics', 'Provenance'], BRAND_MANIFEST.map((a) => ({
    cells: [
      cell(a.route),
      badge(a.method),
      badge(a.contentType),
      badge(a.cache),
      cell(a.generator),
      a.metricsKey ? badge(String(a.metricsKey)) : '<span class="muted">—</span>',
      '<span class="muted">' + a.provenance + '</span>',
    ],
  })));
  return renderWidgetPage({
    title: 'Brand Surface',
    subtitle: BRAND_SUMMARY.name + ' — ' + BRAND_SUMMARY.wordmark + ' ' + BRAND_SUMMARY.accentWord + ' · ' + BRAND_SUMMARY.tagline + ' · design v' + BRAND_SUMMARY.designVersion,
    badges: [BRAND_MANIFEST.length + ' assets', 'token-built surfaces', 'design:check audited'],
    links: ['/brand.svg', '/api/design', '/design', '/bun/map', '/dashboard'],
    sections: [
      { heading: 'Assets', html: rows },
      { heading: 'Contract', html: '<ul><li>Every fill/stroke is a TOKENS value — the design audit (design:check + /api/design/audit) passes by construction.</li><li>Metric keys here are the BrandMetricsSnapshot keys the brand channel reads on /dashboard.</li><li><code>/brand/purge</code> is CSRF-guarded; <code>/brand/card.png</code> warms the WebView raster cache on first request (§18).</li></ul>' },
    ],
    footer: 'Manifest: src/institutions/brand-manifest.ts · generators: src/lib/brand-image.ts (Bun.Image + Bun.WebView)',
  });
}
