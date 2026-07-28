/**
 * Public route catalog for serve-public + portal dashboards.
 *
 * Mirrors `scripts/serve-public.ts` `buildPublicRoutes()` + fetch-handler paths
 * and hot-preloaded static assets. Used by:
 *   - tools/verify-networking.ts --routes
 *   - ops / health dashboards that list endpoint inventory
 *
 * Kind legend:
 *   simd-route   — Bun.serve `routes` exact match (SIMD)
 *   fetch-handler — `fetch` fallback (path prefix / static file)
 *   hot-static   — preloaded memory ETag asset (hotByUrl)
 *   file-static  — disk / respondAuto (portal HTML, large JSON)
 */

export type PublicRouteKind = 'simd-route' | 'fetch-handler' | 'hot-static' | 'file-static';

export type PublicRouteCategory =
  | 'ready'
  | 'health'
  | 'api'
  | 'portal'
  | 'registry'
  | 'proof'
  | 'monitoring';

export type PublicRouteDef = {
  path: string;
  name: string;
  category: PublicRouteCategory;
  kind: PublicRouteKind;
  /** Fail suite if this path is not reachable. */
  critical?: boolean;
  method?: 'GET' | 'HEAD';
  /** HTTP statuses that count as reachable for this route. */
  okStatuses?: number[];
  note?: string;
};

/**
 * Exact SIMD routes registered in `buildPublicRoutes()` (plus known portal file routes).
 * Keep in sync when adding handlers in scripts/serve-public.ts.
 */
export const SIMD_ROUTES: PublicRouteDef[] = [
  {
    path: '/ready',
    name: 'Ready',
    category: 'ready',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/health',
    name: 'Health JSON',
    category: 'health',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/health/pre',
    name: 'Health plain',
    category: 'health',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
    note: 'shared data ETag with /health (Vary: Accept)',
  },
  {
    path: '/api/proof',
    name: 'API proof',
    category: 'proof',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/api/monitoring',
    name: 'Monitoring API',
    category: 'api',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/api/operations/summary',
    name: 'Ops summary API',
    category: 'api',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/api/catalog',
    name: 'Catalog API',
    category: 'api',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/api/dod',
    name: 'DOD API',
    category: 'api',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/api/channels/events',
    name: 'Channels events',
    category: 'api',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/api/registry',
    name: 'Registry index',
    category: 'registry',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/api/registry/static',
    name: 'Registry static aggregate',
    category: 'registry',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/api/registry/search',
    name: 'Registry search',
    category: 'registry',
    kind: 'simd-route',
    okStatuses: [200],
    note: 'empty q may still 200 with empty hits',
  },
  {
    path: '/monitoring',
    name: 'Monitoring page',
    category: 'monitoring',
    kind: 'simd-route',
    okStatuses: [200],
  },
  {
    path: '/portal',
    name: 'Portal index',
    category: 'portal',
    kind: 'simd-route',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/portal/',
    name: 'Portal index /',
    category: 'portal',
    kind: 'simd-route',
    okStatuses: [200],
  },
];

/** Portal dashboard HTML surfaces (file/static via fetch or directory index). */
export const PORTAL_DASHBOARD_ROUTES: PublicRouteDef[] = [
  {
    path: '/portal/ops/',
    name: 'Ops dashboard',
    category: 'portal',
    kind: 'file-static',
    critical: true,
    okStatuses: [200],
    note: 'operations-dashboard.js · routing proof widgets',
  },
  {
    path: '/portal/health/',
    name: 'Health dashboard',
    category: 'portal',
    kind: 'file-static',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/portal/env/',
    name: 'Env checklist',
    category: 'portal',
    kind: 'file-static',
    okStatuses: [200],
  },
  {
    path: '/portal/dod/',
    name: 'DOD portal',
    category: 'portal',
    kind: 'file-static',
    okStatuses: [200],
  },
  {
    path: '/portal/catalog/',
    name: 'Catalog portal',
    category: 'portal',
    kind: 'file-static',
    okStatuses: [200],
  },
];

/** Env status API (fetch-handler in serve-public). */
export const FETCH_HANDLER_ROUTES: PublicRouteDef[] = [
  {
    path: '/api/env',
    name: 'Env status API',
    category: 'api',
    kind: 'fetch-handler',
    okStatuses: [200],
  },
];

/**
 * Typical hot-preloaded paths (subset of health.serve.hotPreloaded).
 * Live list is merged at probe time from GET /health.
 */
export const HOT_STATIC_ROUTES: PublicRouteDef[] = [
  {
    path: '/registry/ops-summary.json',
    name: 'Ops summary artifact',
    category: 'registry',
    kind: 'hot-static',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/registry/static.json',
    name: 'Static aggregate',
    category: 'registry',
    kind: 'hot-static',
    okStatuses: [200],
  },
  {
    path: '/registry/monitoring.json',
    name: 'Monitoring artifact',
    category: 'registry',
    kind: 'hot-static',
    okStatuses: [200],
  },
  {
    path: '/registry/registry.json',
    name: 'Registry index file',
    category: 'registry',
    kind: 'hot-static',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/registry/prediction/report.html',
    name: 'Prediction report',
    category: 'registry',
    kind: 'file-static',
    critical: true,
    okStatuses: [200],
  },
  {
    path: '/registry/@factorywager/routing-test/latest.json',
    name: 'Routing-test proof',
    category: 'proof',
    kind: 'hot-static',
    okStatuses: [200],
  },
  {
    path: '/registry/@factorywager/bun-utils-test/latest.json',
    name: 'Bun-utils proof',
    category: 'proof',
    kind: 'hot-static',
    okStatuses: [200],
  },
  {
    path: '/registry/@factorywager/registry-snapshot/latest.json',
    name: 'Registry snapshot',
    category: 'proof',
    kind: 'hot-static',
    okStatuses: [200],
  },
  {
    path: '/tools/bun-api-coverage-proof.json',
    name: 'API coverage proof',
    category: 'proof',
    kind: 'hot-static',
    okStatuses: [200],
  },
];

/** Full catalog (deduped by path, first wins). */
export function publicRouteCatalog(): PublicRouteDef[] {
  const seen = new Set<string>();
  const out: PublicRouteDef[] = [];
  for (const r of [
    ...SIMD_ROUTES,
    ...PORTAL_DASHBOARD_ROUTES,
    ...FETCH_HANDLER_ROUTES,
    ...HOT_STATIC_ROUTES,
  ]) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out;
}

/** Group catalog for dashboards / inspect.table sections. */
export function publicRoutesByCategory(): Record<PublicRouteCategory, PublicRouteDef[]> {
  const cats = {} as Record<PublicRouteCategory, PublicRouteDef[]>;
  for (const r of publicRouteCatalog()) {
    (cats[r.category] ??= []).push(r);
  }
  return cats;
}

/** Shape expected from GET /health for route objects. */
export type HealthRouteObjects = {
  routeStats?: {
    staticRoutes?: number;
    fileRoutes?: number;
    totalMemoryUsed?: number;
    staticHits?: number;
    fileHits?: number;
    notModified304?: number;
    decision?: { rule?: string; staticMaxBytes?: number; hotMaxBytes?: number };
  };
  serve?: {
    strategies?: Record<string, string>;
    etagScope?: string;
    hotPreloaded?: string[];
  };
  status?: string;
  bun?: string;
};

export function mergeHotFromHealth(
  catalog: PublicRouteDef[],
  health: HealthRouteObjects | null
): PublicRouteDef[] {
  const hot = health?.serve?.hotPreloaded ?? [];
  if (!hot.length) return catalog;
  const seen = new Set(catalog.map(r => r.path));
  const extra: PublicRouteDef[] = [];
  for (const path of hot) {
    if (seen.has(path)) continue;
    seen.add(path);
    extra.push({
      path,
      name: path,
      category: path.startsWith('/api/') ? 'api' : path.startsWith('/registry/') ? 'registry' : 'proof',
      kind: 'hot-static',
      okStatuses: [200],
      note: 'from health.serve.hotPreloaded',
    });
  }
  return [...catalog, ...extra];
}
