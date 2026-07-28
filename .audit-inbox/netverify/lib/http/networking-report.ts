/**
 * Networking / route probe reports with Bun.inspect.custom + inspect.table.
 *
 * Docs shape:
 * ```ts
 * class Foo {
 *   [Bun.inspect.custom]() { return "foo"; }
 * }
 * console.log(new Foo()); // => "foo"
 * ```
 *
 * Prefer `console.log(report)` over hand-rolling table strings — Bun calls
 * `[Bun.inspect.custom]` automatically (same as Node `util.inspect.custom`).
 * `JSON.stringify(report)` uses `toJSON()` (plain rows + rendered strings).
 *
 * @see https://bun.com/docs/runtime/utils#bun-inspect-custom — Bun.inspect.custom
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options — Bun.inspect.table
 * @see https://bun.com/docs/runtime/utils#bun-inspect — Bun.inspect
 */

import { inspectCustom, shouldColor } from '../console-depth.ts';
import type { HealthRouteObjects, PublicRouteDef } from './public-routes.ts';

export type TableRow = Record<string, string | number | boolean | null | undefined>;

export type RouteProbeRow = {
  path: string;
  name: string;
  category: string;
  kind: string;
  status: number | 'ERR';
  ms: number;
  pass: boolean;
  critical: boolean;
  note?: string;
};

export type RouteProbeResult = {
  base: string;
  health: HealthRouteObjects | null;
  catalog: PublicRouteDef[];
  rows: RouteProbeRow[];
  summary: { total: number; passed: number; failed: number; criticalFailed: number };
};

/**
 * Format rows with Bun.inspect.table.
 * Docs overload: `(data, { colors })` auto-picks columns from object keys,
 * or `(data, properties, { colors })` to project columns.
 */
export function inspectTable(
  rows: TableRow[],
  columns?: string[],
  opts: { colors?: boolean } = {}
): string {
  if (!rows.length) return '(empty)';
  const colors = opts.colors ?? shouldColor();
  // Never pass undefined as properties — Bun treats it poorly.
  return columns?.length
    ? Bun.inspect.table(rows, columns, { colors })
    : Bun.inspect.table(rows, { colors });
}

function routeStatsRows(health: HealthRouteObjects | null): TableRow[] {
  const rs = health?.routeStats;
  if (!rs) return [{ field: '(no /health)', value: 'serve-public down?' }];
  return [
    { field: 'staticRoutes', value: rs.staticRoutes ?? '—' },
    { field: 'fileRoutes', value: rs.fileRoutes ?? '—' },
    { field: 'staticHits', value: rs.staticHits ?? '—' },
    { field: 'fileHits', value: rs.fileHits ?? '—' },
    { field: 'notModified304', value: rs.notModified304 ?? '—' },
    {
      field: 'totalMemoryUsed',
      value:
        rs.totalMemoryUsed != null ? `${Math.round(rs.totalMemoryUsed / 1024)} KiB` : '—',
    },
    { field: 'decision.rule', value: rs.decision?.rule ?? '—' },
  ];
}

function probeRows(rows: RouteProbeRow[]): TableRow[] {
  return rows.map(r => ({
    path: r.path,
    name: r.name,
    category: r.category,
    kind: r.kind,
    status: r.status,
    ms: r.ms,
    crit: r.critical ? 'Y' : '',
    pass: r.pass ? 'PASS' : 'FAIL',
  }));
}

export type RouteReportJson = {
  base: string;
  summary: RouteProbeResult['summary'];
  health: HealthRouteObjects | null;
  routeStats: TableRow[];
  hotPreloaded: TableRow[];
  strategies: TableRow[];
  routes: TableRow[];
  byCategory: Record<string, TableRow[]>;
  /** Pre-rendered Bun.inspect.table strings (colors off for JSON stability). */
  rendered: {
    routeStats: string;
    hotPreloaded: string;
    strategies: string;
    routes: string;
    byCategory: Record<string, string>;
  };
};

/**
 * Full local route probe report.
 * - `console.log(report)` → tables via `[Bun.inspect.custom]`
 * - `JSON.stringify(report)` → structured rows + rendered tables via `toJSON`
 */
export class RouteProbeReport {
  readonly base: string;
  readonly health: HealthRouteObjects | null;
  readonly rows: RouteProbeRow[];
  readonly summary: RouteProbeResult['summary'];

  constructor(probe: RouteProbeResult) {
    this.base = probe.base;
    this.health = probe.health;
    this.rows = probe.rows;
    this.summary = probe.summary;
  }

  /** Object-row slices for tables / spreadsheets. */
  slices(): Omit<RouteReportJson, 'rendered' | 'base' | 'summary' | 'health'> {
    const serve = this.health?.serve;
    const routeStats = routeStatsRows(this.health);
    const hotPreloaded = (serve?.hotPreloaded ?? []).map((p, i) => ({ i, path: p }));
    const strategies = Object.entries(serve?.strategies ?? {}).map(([k, v]) => ({
      strategy: k,
      rule: v,
    }));
    const routes = probeRows(this.rows);
    const byCategory: Record<string, TableRow[]> = {};
    for (const r of this.rows) {
      (byCategory[r.category] ??= []).push({
        path: r.path,
        kind: r.kind,
        status: String(r.status),
        ms: r.ms,
        crit: r.critical ? 'Y' : '',
        pass: r.pass ? 'PASS' : 'FAIL',
      });
    }
    return { routeStats, hotPreloaded, strategies, routes, byCategory };
  }

  /**
   * Build inspect.table strings.
   * @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
   */
  render(opts: { colors?: boolean } = {}): RouteReportJson['rendered'] {
    const colors = opts.colors ?? shouldColor();
    const s = this.slices();
    const byCategory: Record<string, string> = {};
    for (const [c, slice] of Object.entries(s.byCategory)) {
      byCategory[c] = inspectTable(slice, ['path', 'kind', 'status', 'ms', 'crit', 'pass'], {
        colors,
      });
    }
    return {
      routeStats: inspectTable(s.routeStats, ['field', 'value'], { colors }),
      hotPreloaded: s.hotPreloaded.length
        ? inspectTable(s.hotPreloaded, ['i', 'path'], { colors })
        : '(none)',
      strategies: s.strategies.length
        ? inspectTable(s.strategies, ['strategy', 'rule'], { colors })
        : '(none)',
      routes: inspectTable(s.routes, ['path', 'kind', 'status', 'ms', 'crit', 'pass'], {
        colors,
      }),
      byCategory,
    };
  }

  toJSON(): RouteReportJson {
    const s = this.slices();
    return {
      base: this.base,
      summary: this.summary,
      health: this.health,
      ...s,
      rendered: this.render({ colors: false }),
    };
  }

  /**
   * @see https://bun.com/docs/runtime/utils#bun-inspect-custom
   * Bun.inspect / console.log call this automatically.
   */
  [inspectCustom](_depth?: number, options?: { colors?: boolean }): string {
    const colors = options?.colors ?? shouldColor();
    const r = this.render({ colors });
    const serve = this.health?.serve;
    const parts = [
      `RouteProbeReport · ${this.base} · ${this.summary.passed}/${this.summary.total} pass · critFail=${this.summary.criticalFailed}`,
      '',
      '── ROUTE OBJECTS (/health.routeStats) ──',
      r.routeStats,
    ];
    if (this.health?.serve?.hotPreloaded?.length) {
      parts.push('', '── HOT PRELOADED (serve.hotPreloaded) ──', r.hotPreloaded);
    }
    if (serve?.etagScope) {
      parts.push(`ETag scope: ${serve.etagScope}`);
    }
    if (Object.keys(serve?.strategies ?? {}).length) {
      parts.push('', '── STRATEGIES ──', r.strategies);
    }
    parts.push('', '── PUBLIC ROUTE CATALOG (all paths) ──', r.routes);
    parts.push('', '── BY CATEGORY ──');
    for (const [c, table] of Object.entries(r.byCategory)) {
      parts.push('', `  · ${c}`, table);
    }
    return parts.join('\n');
  }
}

// ── Multi-target networking checks (typed) ─────────────────────────────────

/** Optimization step kinds (stable ids for grouping / JSON). */
export const NET_OPTIMIZATION_TYPES = [
  'dns-prefetch',
  'dns-cache',
  'preconnect',
  'cold-fetch',
  'warm-fetch',
  'response-text',
  'response-json',
  'response-formdata',
  'response-bytes',
  'response-arraybuffer',
  'response-blob',
  'disk-write',
] as const;

export type NetOptimizationType = (typeof NET_OPTIMIZATION_TYPES)[number];

/** Human labels for inspect.table + CLI. */
export const NET_OPTIMIZATION_LABELS: Record<NetOptimizationType, string> = {
  'dns-prefetch': 'DNS Prefetch',
  'dns-cache': 'DNS Cache',
  preconnect: 'Preconnect',
  'cold-fetch': 'Cold Fetch',
  'warm-fetch': 'Warm Fetch',
  'response-text': 'response.text()',
  'response-json': 'response.json()',
  'response-formdata': 'response.formData()',
  'response-bytes': 'response.bytes()',
  'response-arraybuffer': 'response.arrayBuffer()',
  'response-blob': 'response.blob()',
  'disk-write': 'Disk Write',
};

/** Target bucket (ops, registry, dashboard, …). */
export type NetTargetCategory =
  | 'ops'
  | 'registry'
  | 'dashboard'
  | 'pages'
  | 'trading'
  | 'control'
  | 'messaging'
  | 'storage'
  | (string & {});

export type NetCheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';

/** One networking optimization measurement for a target. */
export type NetCheckRow = {
  target: string;
  category: NetTargetCategory;
  /** Machine id — use for byType grouping. */
  type: NetOptimizationType;
  /** Display label (from NET_OPTIMIZATION_LABELS). */
  optimization: string;
  metric: string;
  status: NetCheckStatus;
  detail?: string;
};

export type NetworkingChecksMeta = {
  base: string;
  bun: string;
  revision: string;
};

export type NetCheckTypeSummary = {
  type: NetOptimizationType;
  label: string;
  total: number;
  passed: number;
  failed: number;
  info: number;
  skipped: number;
};

export type NetworkingChecksSummary = {
  total: number;
  passed: number;
  failed: number;
  info: number;
  skipped: number;
  byType: NetCheckTypeSummary[];
  byCategory: Array<{
    category: string;
    total: number;
    passed: number;
    failed: number;
  }>;
};

export type NetworkingChecksReportJson = {
  meta: NetworkingChecksMeta;
  summary: NetworkingChecksSummary;
  rows: NetCheckRow[];
  byType: Record<NetOptimizationType, NetCheckRow[]>;
  byCategory: Record<string, NetCheckRow[]>;
  /** Object rows for tables. */
  tables: {
    all: TableRow[];
    byType: Record<string, TableRow[]>;
    byCategory: Record<string, TableRow[]>;
    typeSummary: TableRow[];
  };
  rendered: {
    all: string;
    byType: Record<string, string>;
    byCategory: Record<string, string>;
    typeSummary: string;
  };
};

/** Build a typed row with label filled from type. */
export function netCheckRow(
  partial: Omit<NetCheckRow, 'optimization'> & { optimization?: string }
): NetCheckRow {
  return {
    ...partial,
    optimization: partial.optimization ?? NET_OPTIMIZATION_LABELS[partial.type],
  };
}

function countStatus(rows: NetCheckRow[]): Pick<
  NetworkingChecksSummary,
  'total' | 'passed' | 'failed' | 'info' | 'skipped'
> {
  let passed = 0;
  let failed = 0;
  let info = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.status === 'PASS') passed++;
    else if (r.status === 'FAIL') failed++;
    else if (r.status === 'INFO') info++;
    else if (r.status === 'SKIP') skipped++;
  }
  return { total: rows.length, passed, failed, info, skipped };
}

function tableRowsFromChecks(rows: NetCheckRow[]): TableRow[] {
  return rows.map(r => ({
    target: r.target,
    category: r.category,
    type: r.type,
    optimization: r.optimization,
    metric: r.metric,
    status: r.status,
  }));
}

/**
 * Multi-target networking check report (DNS / preconnect / cold-warm / buffer).
 * - Grouped **by type** (optimization kind) and **by category** (target bucket)
 * - `console.log(report)` → `[Bun.inspect.custom]` + inspect.table sections
 */
export class NetworkingChecksReport {
  readonly rows: NetCheckRow[];
  readonly meta: NetworkingChecksMeta;

  constructor(
    rows: NetCheckRow[],
    meta: Partial<NetworkingChecksMeta> = {}
  ) {
    this.rows = rows;
    this.meta = {
      base: meta.base ?? '',
      bun: meta.bun ?? Bun.version,
      revision: meta.revision ?? (Bun.revision || 'unknown'),
    };
  }

  /** Group rows by optimization type (stable NET_OPTIMIZATION_TYPES order). */
  byType(): Record<NetOptimizationType, NetCheckRow[]> {
    const out = {} as Record<NetOptimizationType, NetCheckRow[]>;
    for (const t of NET_OPTIMIZATION_TYPES) out[t] = [];
    for (const r of this.rows) {
      (out[r.type] ??= []).push(r);
    }
    return out;
  }

  /** Group rows by target category. */
  byCategory(): Record<string, NetCheckRow[]> {
    const out: Record<string, NetCheckRow[]> = {};
    for (const r of this.rows) {
      (out[r.category] ??= []).push(r);
    }
    return out;
  }

  summary(): NetworkingChecksSummary {
    const overall = countStatus(this.rows);
    const byTypeMap = this.byType();
    const byType: NetCheckTypeSummary[] = NET_OPTIMIZATION_TYPES.map(type => {
      const slice = byTypeMap[type] ?? [];
      const c = countStatus(slice);
      return {
        type,
        label: NET_OPTIMIZATION_LABELS[type],
        total: c.total,
        passed: c.passed,
        failed: c.failed,
        info: c.info,
        skipped: c.skipped,
      };
    }).filter(s => s.total > 0);

    const byCategory = Object.entries(this.byCategory()).map(([category, slice]) => {
      const c = countStatus(slice);
      return {
        category,
        total: c.total,
        passed: c.passed,
        failed: c.failed,
      };
    });

    return { ...overall, byType, byCategory };
  }

  slices(): Pick<NetworkingChecksReportJson, 'tables' | 'byType' | 'byCategory' | 'summary'> {
    const byType = this.byType();
    const byCategory = this.byCategory();
    const summary = this.summary();

    const tablesByType: Record<string, TableRow[]> = {};
    for (const [type, slice] of Object.entries(byType)) {
      if (!slice.length) continue;
      tablesByType[type] = tableRowsFromChecks(slice);
    }
    const tablesByCategory: Record<string, TableRow[]> = {};
    for (const [cat, slice] of Object.entries(byCategory)) {
      tablesByCategory[cat] = tableRowsFromChecks(slice);
    }

    return {
      summary,
      byType,
      byCategory,
      tables: {
        all: tableRowsFromChecks(this.rows),
        byType: tablesByType,
        byCategory: tablesByCategory,
        typeSummary: summary.byType.map(s => ({
          type: s.type,
          label: s.label,
          total: s.total,
          passed: s.passed,
          failed: s.failed,
          info: s.info,
          skipped: s.skipped,
        })),
      },
    };
  }

  render(opts: { colors?: boolean } = {}): NetworkingChecksReportJson['rendered'] {
    const colors = opts.colors ?? shouldColor();
    const { tables } = this.slices();
    const cols = ['target', 'type', 'optimization', 'metric', 'status'] as const;

    const byType: Record<string, string> = {};
    for (const [type, slice] of Object.entries(tables.byType)) {
      byType[type] = inspectTable(slice, [...cols], { colors });
    }
    const byCategory: Record<string, string> = {};
    for (const [cat, slice] of Object.entries(tables.byCategory)) {
      byCategory[cat] = inspectTable(slice, [...cols], { colors });
    }

    return {
      all: tables.all.length
        ? inspectTable(tables.all, [...cols], { colors })
        : '(no multi-target checks)',
      byType,
      byCategory,
      typeSummary: tables.typeSummary.length
        ? inspectTable(
            tables.typeSummary,
            ['type', 'label', 'total', 'passed', 'failed', 'info', 'skipped'],
            { colors }
          )
        : '(none)',
    };
  }

  toJSON(): NetworkingChecksReportJson {
    const s = this.slices();
    return {
      meta: this.meta,
      rows: this.rows,
      ...s,
      rendered: this.render({ colors: false }),
    };
  }

  /**
   * @see https://bun.com/docs/runtime/utils#bun-inspect-custom
   */
  [inspectCustom](_depth?: number, options?: { colors?: boolean }): string {
    const colors = options?.colors ?? shouldColor();
    const summary = this.summary();
    const rendered = this.render({ colors });
    const rev = this.meta.revision.slice(0, 8);

    const parts = [
      `NetworkingChecksReport · ${this.meta.base || 'multi-target'} · Bun ${this.meta.bun}/${rev}`,
      `  ${summary.passed}/${summary.total} pass · ${summary.failed} fail · ${summary.info} info · ${summary.skipped} skip`,
      '',
      '── BY TYPE (summary) ──',
      rendered.typeSummary,
      '',
      '── ALL CHECKS ──',
      rendered.all,
      '',
      '── BY TYPE ──',
    ];

    for (const t of NET_OPTIMIZATION_TYPES) {
      const table = rendered.byType[t];
      if (!table) continue;
      const label = NET_OPTIMIZATION_LABELS[t];
      const ts = summary.byType.find(s => s.type === t);
      parts.push(
        '',
        `  · ${t} (${label})${ts ? ` · ${ts.passed}/${ts.total}` : ''}`,
        table
      );
    }

    parts.push('', '── BY CATEGORY ──');
    for (const [cat, table] of Object.entries(rendered.byCategory)) {
      const cs = summary.byCategory.find(s => s.category === cat);
      parts.push(
        '',
        `  · ${cat}${cs ? ` · ${cs.passed}/${cs.total}` : ''}`,
        table
      );
    }

    return parts.join('\n');
  }
}
