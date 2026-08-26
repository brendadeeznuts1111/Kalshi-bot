/**
 * route-manifest.ts — the API surface SSOT for the research server.
 *
 * Every route the dashboard/browser serves is declared here once with its
 * method, integration layer, CSRF/cache posture and doc reference. The
 * /bun/api page renders this table; the routes:check gate (tools/routes-
 * check.ts) verifies the manifest is consistent AND that serve.ts never
 * grows an unregistered route (coverage scan over the pathname literals).
 *
 * Layers mirror the map-page integration taxonomy:
 *   channels   — the signal pipeline + actions (/dashboard, /api/signals)
 *   branding   — TOKENS/brand assets + design-system APIs (/brand/*, /api/design)
 *   pipeline   — content/docs/design gate surfaces (/content/posts, /api/audit.jsonl)
 *   data       — event-store, registry, sports, liquidity, polymarket
 *   ops        — health, status, ops dashboard, videos, live channel
 *   trading    — order entry/cancel/book (compliance-gated, never bypassed)
 *   research   — the report browser (Bun.serve routes map)
 */

export type RouteLayer = 'channels' | 'branding' | 'pipeline' | 'data' | 'ops' | 'trading' | 'research';
export type RouteMethod = 'GET' | 'POST' | 'GET|POST';

export type RouteDef = {
  /** Path as served. A trailing "/*" marks a wildcard/dir route; ":param" a pattern. */
  path: string;
  method: RouteMethod;
  layer: RouteLayer;
  /** Handler or surface name (human-readable; matches serve.ts where practical). */
  handler: string;
  /** CSRF-guarded (double-submit session). */
  csrf?: boolean;
  /** Cache posture ("no-cache" | "public, max-age=N" | "dir" | "etag"). */
  cache?: string;
  /** Docs/section reference (AGENT-PITFALLS §N or docs/*.md). */
  docRef?: string;
};

export const ROUTE_MANIFEST: readonly RouteDef[] = [
  // ── Research / report browser (Bun.serve routes map) ──
  { path: '/', method: 'GET', layer: 'research', handler: 'handleHome', cache: 'no-cache', docRef: 'src/research/views.ts' },
  { path: '/runs', method: 'GET', layer: 'research', handler: 'handleRunsList', cache: 'no-cache' },
  { path: '/api/runs/:id', method: 'GET', layer: 'research', handler: 'handleRunApi', cache: 'no-cache' },
  { path: '/repo/:owner/:name', method: 'GET', layer: 'research', handler: 'handleRepoPage', cache: 'no-cache' },
  { path: '/reports/latest.md', method: 'GET', layer: 'research', handler: 'handleLatestReport', cache: 'no-cache' },
  { path: '/reports/*', method: 'GET', layer: 'research', handler: 'report browser', cache: 'no-cache' },
  { path: '/architecture', method: 'GET', layer: 'research', handler: 'handleArchitecture', cache: 'no-cache' },

  // ── Channels (signal pipeline + actions) ──
  { path: '/dashboard', method: 'GET', layer: 'channels', handler: 'renderDashboard', csrf: true, cache: 'no-cache', docRef: 'src/institutions/signal-pipeline.ts' },
  { path: '/api/signals', method: 'GET', layer: 'channels', handler: 'collectSignals -> json', cache: '30s' },
  { path: '/api/signals/actions/<name>', method: 'POST', layer: 'channels', handler: 'action dispatcher', csrf: true, cache: 'no-cache', docRef: 'channel-registry.ts CHANNEL_ACTIONS' },

  // ── Branding (TOKENS + brand assets + design-system APIs) ──
  { path: '/colors.css', method: 'GET', layer: 'branding', handler: 'token CSS', cache: 'etag', docRef: 'docs/DESIGN-SYSTEM.md' },
  { path: '/design-system.js', method: 'GET', layer: 'branding', handler: 'design-system bundle', cache: 'etag' },
  { path: '/design-system.css', method: 'GET', layer: 'branding', handler: 'computed token vars', cache: 'etag' },
  { path: '/brand.svg', method: 'GET', layer: 'branding', handler: 'brandCardSvg', cache: 'public, max-age=60' },
  { path: '/brand/card.png', method: 'GET', layer: 'branding', handler: 'brandCardPng (Bun.Image + WebView raster)', cache: 'no-cache', docRef: 'src/lib/brand-image.ts' },
  { path: '/brand/swatch/<token>.png', method: 'GET', layer: 'branding', handler: 'brandSwatchPng', cache: 'public, max-age=60' },
  { path: '/brand/badge.svg', method: 'GET', layer: 'branding', handler: 'brandBadgeSvg', cache: 'public, max-age=60' },
  { path: '/brand/quote.svg', method: 'GET', layer: 'branding', handler: 'brandQuoteSvg', cache: 'public, max-age=60' },
  { path: '/brand/chart.svg', method: 'GET', layer: 'branding', handler: 'brandChartSvg', cache: 'public, max-age=60' },
  { path: '/brand/purge', method: 'POST', layer: 'branding', handler: 'purge brand caches', csrf: true, cache: 'no-cache' },
  { path: '/api/brand/metrics', method: 'GET', layer: 'branding', handler: 'BrandMetricsSnapshot', cache: 'no-cache' },
  { path: '/api/design', method: 'GET', layer: 'branding', handler: 'DesignAgent.manifest + budgets + audit', cache: 'no-cache', docRef: 'docs/DESIGN-SYSTEM.md' },
  { path: '/api/design/audit', method: 'GET', layer: 'branding', handler: 'DesignAgent.audit(live HQ)', cache: 'no-cache' },
  { path: '/api/design/budgets', method: 'GET', layer: 'branding', handler: 'buildBudgetHealth', cache: 'no-cache' },
  { path: '/api/color/theme', method: 'GET', layer: 'branding', handler: 'themeManifest', cache: 'no-cache' },
  { path: '/design', method: 'GET', layer: 'branding', handler: 'renderDesignPage', cache: 'no-cache' },
  { path: '/design/trend', method: 'GET', layer: 'branding', handler: 'renderTrendPage', cache: 'no-cache' },

  // ── Pipeline (content + docs + audit surfaces) ──
  { path: '/content/posts', method: 'GET', layer: 'pipeline', handler: 'post index', cache: 'no-cache', docRef: 'src/lib/content-pipeline.ts' },
  { path: '/content/posts/<name>.md', method: 'GET', layer: 'pipeline', handler: 'post markdown', cache: 'no-cache' },
  { path: '/content/posts/*', method: 'GET', layer: 'pipeline', handler: 'post render', cache: 'no-cache' },
  { path: '/docs', method: 'GET', layer: 'pipeline', handler: 'repo docs index', cache: 'no-cache' },
  { path: '/docs/<name>', method: 'GET', layer: 'pipeline', handler: 'repo doc page', cache: 'no-cache' },
  { path: '/api/audit.jsonl', method: 'GET', layer: 'pipeline', handler: 'audit evidence NDJSON', cache: 'no-cache' },
  { path: '/api/events.jsonl', method: 'GET', layer: 'pipeline', handler: 'live-tracker NDJSON', cache: 'no-cache' },
  { path: '/api/deps/health', method: 'GET', layer: 'pipeline', handler: 'dedupe/prune/audit gates', cache: '60s', docRef: '/bun/tooling' },
  { path: '/api/meta/audit', method: 'GET', layer: 'pipeline', handler: 'meta audit', cache: 'no-cache' },

  // ── Data (event-store, registry, sports, liquidity, polymarket) ──
  { path: '/hq', method: 'GET', layer: 'data', handler: 'hqApp shell (HTML import)', cache: 'no-cache', docRef: 'src/research/hq-app' },
  { path: '/api/hq', method: 'GET', layer: 'data', handler: 'buildHqPayload', cache: 'no-cache' },
  { path: '/api/hq/tennis', method: 'GET', layer: 'data', handler: 'tennis board', cache: '60s' },
  { path: '/api/hq/tennis/player', method: 'GET', layer: 'data', handler: 'tennis player (?name=)', cache: '60s' },
  { path: '/api/hq/tennis/player/:name', method: 'GET', layer: 'data', handler: 'tennis player (path form)', cache: '60s' },
  { path: '/api/registry/sports-sources', method: 'GET', layer: 'data', handler: 'sports-source catalog', cache: '5s', docRef: 'docs/SPORTS_SOURCE_REGISTRY.md' },
  { path: '/registry/*', method: 'GET', layer: 'data', handler: 'public/registry dir route', cache: 'dir' },
  { path: '/api/glossary', method: 'GET', layer: 'data', handler: 'glossary payload', cache: 'no-cache' },
  { path: '/api/kpi', method: 'GET', layer: 'data', handler: 'event-store KPIs', cache: 'no-cache' },
  { path: '/api/events', method: 'GET', layer: 'data', handler: 'events board', cache: '60s' },
  { path: '/api/profiles', method: 'GET', layer: 'data', handler: 'player profiles', cache: 'no-cache' },
  { path: '/api/opponent-profiles', method: 'GET', layer: 'data', handler: 'opponent profiles', cache: 'no-cache' },
  { path: '/api/liquidity', method: 'GET', layer: 'data', handler: 'liquidity board', cache: 'no-cache' },
  { path: '/api/liquidity/summary', method: 'GET', layer: 'data', handler: 'liquidity summary', cache: 'no-cache' },
  { path: '/api/liquidity/:eventId', method: 'GET', layer: 'data', handler: 'match liquidity by event', cache: 'no-cache' },
  { path: '/api/liquidity/by-tournament/:key', method: 'GET', layer: 'data', handler: 'liquidity by tournament', cache: 'no-cache' },
  { path: '/polymarket/ingest', method: 'POST', layer: 'data', handler: 'polymarket webhook', cache: 'no-cache' },
  { path: '/polymarket/status', method: 'GET', layer: 'data', handler: 'polymarket status', cache: 'no-cache' },
  { path: '/polymarket/ticks', method: 'GET', layer: 'data', handler: 'polymarket ticks', cache: 'no-cache' },
  { path: '/polymarket/line-moves', method: 'GET', layer: 'data', handler: 'polymarket line moves', cache: 'no-cache' },

  // ── Ops (health, status, videos, live channel, agents) ──
  { path: '/health', method: 'GET', layer: 'ops', handler: 'health', cache: 'no-cache' },
  { path: '/status', method: 'GET', layer: 'ops', handler: 'aggregate signal health', cache: '30s' },
  { path: '/healthz', method: 'GET', layer: 'ops', handler: 'alias of /status', cache: '30s' },
  { path: '/ops', method: 'GET', layer: 'ops', handler: 'ops dashboard', csrf: true, cache: 'no-cache' },
  { path: '/ops.json', method: 'GET', layer: 'ops', handler: 'ops dashboard JSON', csrf: true, cache: 'no-cache' },
  { path: '/ops/partners/:nodeId', method: 'GET', layer: 'ops', handler: 'partner detail', cache: 'no-cache' },
  { path: '/ops/kalshi-rotate-key', method: 'POST', layer: 'ops', handler: 'rotate Kalshi key', csrf: true, cache: 'no-cache' },
  { path: '/agent/dispatch', method: 'POST', layer: 'ops', handler: 'agent dispatch', csrf: true, cache: 'no-cache' },
  { path: '/regulatory/health', method: 'GET', layer: 'ops', handler: 'regulatory + exchange probe', cache: 'no-cache' },
  { path: '/api/health/urls', method: 'GET', layer: 'ops', handler: 'OFFICIAL_URLS liveness', cache: 'no-cache' },
  { path: '/api/health/kalshi', method: 'GET', layer: 'ops', handler: 'Kalshi exchange status', cache: 'no-cache' },
  { path: '/api/live', method: 'GET', layer: 'ops', handler: 'live channel (WS upgrade)', cache: 'no-cache', docRef: 'src/institutions/live-channel.ts' },
  { path: '/videos', method: 'GET', layer: 'ops', handler: 'video list page', cache: 'no-cache' },
  { path: '/videos/index.json', method: 'GET', layer: 'ops', handler: 'video manifest', cache: 'no-cache' },
  { path: '/videos/:id', method: 'GET', layer: 'ops', handler: 'video file (Range/206)', cache: 'dir' },
  { path: '/videos/*', method: 'GET', layer: 'ops', handler: 'public/videos dir route', cache: 'dir' },
  { path: '/blog/*', method: 'GET', layer: 'pipeline', handler: 'public/blog dir route (blog-map mirror)', cache: 'dir', docRef: 'AGENT-PITFALLS §183' },
  { path: '/partner-dashboard/*', method: 'GET', layer: 'ops', handler: 'public/partner-dashboard dir route', cache: 'dir' },

  // ── Trading (compliance-gated order entry — manifest is documentation only) ──
  { path: '/place-bet', method: 'POST', layer: 'trading', handler: 'handlePlaceBet', csrf: true, cache: 'no-cache', docRef: 'docs/AUTHORIZED_EXECUTION.md' },
  { path: '/api/trading/order', method: 'POST', layer: 'trading', handler: 'handleTradingOrder', csrf: true, cache: 'no-cache', docRef: 'docs/AUTHORIZED_EXECUTION.md' },
  { path: '/api/trading/cancel', method: 'POST', layer: 'trading', handler: 'handleTradingCancel', csrf: true, cache: 'no-cache' },
  { path: '/api/trading/book', method: 'GET', layer: 'trading', handler: 'handleTradingBook', cache: 'no-cache' },

  // ── Bun capability widget pages (token-built, probe-verified) ──
  ...(['networking', 'streams', 'observability', 'performance', 'utilities', 'overview', 'tooling', 'color', 'live', 'hashing', 'pruning', 'security', 'speed', 'map', 'markdown', 'transpiler', 'xml', 'image', 'plugins', 'api', 'brand'] as const).map((slug) => ({
    path: '/bun/' + slug,
    method: 'GET' as const,
    layer: 'pipeline' as const,
    handler: 'BUN_WIDGETS["/bun/' + slug + '"]',
    cache: 'no-cache',
    docRef: 'src/research/' + slug + '-page.ts',
  })),
];

export const ROUTE_PATHS: readonly string[] = ROUTE_MANIFEST.map((r) => r.path);
export const ROUTE_LAYERS: readonly RouteLayer[] = [...new Set(ROUTE_MANIFEST.map((r) => r.layer))];

export function routeByPath(path: string): RouteDef | undefined {
  return ROUTE_MANIFEST.find((r) => r.path === path);
}

/** True when a manifest entry covers the given exact pathname (exact or pattern). */
export function manifestCovers(pathname: string): boolean {
  return ROUTE_MANIFEST.some((r) => {
    if (r.path === pathname) return true;
    if (r.path.endsWith('/*')) return pathname.startsWith(r.path.slice(0, -1));
    if (r.path.includes(':') || r.path.includes('<')) return false; // patterns checked by the gate, not here
    return false;
  });
}
