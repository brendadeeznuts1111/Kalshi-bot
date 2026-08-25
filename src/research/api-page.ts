/**
 * api-page.ts — /bun/api: the route manifest as a living page. Every route
 * the research server serves, grouped by integration layer (channels /
 * branding / pipeline / data / ops / trading / research), with method,
 * CSRF and cache posture. Rendered from route-manifest.ts — the SSOT the
 * routes:check gate enforces against serve.ts. Token-built audited page.
 */
import { renderWidgetPage, widgetTable } from '../lib/widget-page.ts';
import { ROUTE_MANIFEST, ROUTE_LAYERS, type RouteDef, type RouteLayer } from './route-manifest.ts';

const LAYER_LABELS: Record<RouteLayer, string> = {
  channels: 'Signal pipeline + actions (/dashboard, /api/signals)',
  branding: 'TOKENS · brand assets · design-system APIs',
  pipeline: 'Content · docs · design gates and audit surfaces',
  data: 'Event-store · registry · sports · liquidity · polymarket',
  ops: 'Health · status · ops dashboard · videos · live channel',
  trading: 'Order entry / cancel / book (compliance-gated)',
  research: 'Report browser (Bun.serve routes map)',
};

const cell = (v: string): string => '<code>' + v + '</code>';
const badge = (v: string): string => '<span class="badge dim">' + v + '</span>';

function routeRows(defs: RouteDef[]): string {
  return widgetTable(['Path', 'Method', 'Handler', 'CSRF', 'Cache'], defs.map((r) => ({
    cells: [
      cell(r.path),
      r.method === 'GET|POST' ? badge('GET/POST') : badge(r.method),
      cell(r.handler),
      r.csrf ? badge('csrf') : '<span class="muted">—</span>',
      r.cache ? badge(String(r.cache)) : '<span class="muted">—</span>',
    ],
  })));
}

export function renderApiPage(): string {
  const sections = ROUTE_LAYERS.map((layer) => ({
    heading: layer + ' — ' + LAYER_LABELS[layer],
    html: routeRows(ROUTE_MANIFEST.filter((r) => r.layer === layer)),
  }));
  return renderWidgetPage({
    title: 'API Surface',
    subtitle: 'Every route served, grouped by integration layer — from route-manifest.ts, enforced by routes:check',
    badges: [ROUTE_MANIFEST.length + ' routes', 'routes:check gate', 'layer taxonomy from /bun/map'],
    links: ['/dashboard', '/bun/map', '/bun/xml', '/bun/overview', '/ops'],
    sections,
    footer: 'Manifest: src/research/route-manifest.ts · gate: bun run routes:check (verify:contracts #20) · trading routes never bypass compliance (docs/AUTHORIZED_EXECUTION.md)',
  });
}
