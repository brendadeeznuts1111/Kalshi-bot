/**
 * Price series + SVG chart for live-tracker PRICE_CHANGE streams.
 * Pure (no I/O) — CLI loads logs and writes --out.
 */
import type { LiveTrackerEvent } from './live-tracker.ts';

export type ChartSeriesSpec = {
  /** Pandora event id */
  eventId: string | number;
  /** Market type id (e.g. 3 = ML) */
  marketType: string;
  /** Period focus (default m) */
  period?: string;
  /** Optional selection filter (1/2 or line id). Omit = first selection seen. */
  selection?: string | null;
  /** Legend label override */
  label?: string;
};

export type ChartPoint = {
  tMs: number;
  time: string;
  price: number;
};

export type ChartSeries = {
  key: string;
  label: string;
  eventId: string;
  marketType: string;
  period: string;
  selection: string | null;
  points: ChartPoint[];
};

export type ChartBuildOptions = {
  /** Width/height of SVG viewBox */
  width?: number;
  height?: number;
  /** Pad around plot */
  pad?: number;
  /** Overlay multiple series on one axes (default true) */
  overlay?: boolean;
  title?: string;
};

const COLORS = [
  '#5b9fd4',
  '#e0a44c',
  '#3dba7a',
  '#c084fc',
  '#e05a5a',
  '#6c9ef8',
  '#f0c14b',
  '#2dd4bf',
];

export function seriesKey(spec: ChartSeriesSpec): string {
  const p = spec.period ?? 'm';
  const s = spec.selection?.trim() || '*';
  return `${spec.eventId}:${p}/${spec.marketType}:${s}`;
}

/**
 * Build a step series of decimal prices from PRICE_CHANGE events.
 * Uses `to` as the new price; tracks per selection and picks selection
 * (explicit or first observed).
 */
export function buildPriceSeries(
  events: LiveTrackerEvent[],
  spec: ChartSeriesSpec
): ChartSeries {
  const period = spec.period ?? 'm';
  const eventId = String(spec.eventId);
  const marketType = String(spec.marketType);
  const wantSel = spec.selection?.trim() || null;

  // selection → last price
  const last = new Map<string, number>();
  let activeSel = wantSel;
  const points: ChartPoint[] = [];

  const sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
  for (const e of sorted) {
    if (String(e.eventId) !== eventId) continue;
    if ((e.period ?? 'm') !== period) continue;
    if (String(e.marketType ?? '') !== marketType) continue;

    if (e.eventType === 'PRICE_CHANGE') {
      const sel = String(e.selection ?? '').trim() || '1';
      if (wantSel && sel !== wantSel) continue;
      if (!activeSel) activeSel = sel;
      if (sel !== activeSel) continue;
      const price = Number(e.to);
      if (!Number.isFinite(price)) continue;
      last.set(sel, price);
      const tMs = Date.parse(e.time);
      if (!Number.isFinite(tMs)) continue;
      points.push({ tMs, time: e.time, price });
    } else if (
      e.eventType === 'MARKET_REMOVED' ||
      e.eventType === 'SELECTION_REMOVED'
    ) {
      const sel = e.selection != null ? String(e.selection) : activeSel;
      if (wantSel && sel && sel !== wantSel) continue;
      if (activeSel && sel && sel !== activeSel) continue;
      // gap: do not add point — line breaks via consecutive points only
    } else if (e.eventType === 'MARKET_ADDED' || e.eventType === 'SELECTION_ADDED') {
      // no price yet
    }
  }

  const label =
    spec.label ??
    `e${eventId} ${period}/${marketType}` +
      (activeSel ? ` sel=${activeSel}` : '');

  return {
    key: seriesKey({ ...spec, selection: activeSel }),
    label,
    eventId,
    marketType,
    period,
    selection: activeSel,
    points,
  };
}

export function buildPriceSeriesMany(
  events: LiveTrackerEvent[],
  specs: ChartSeriesSpec[]
): ChartSeries[] {
  return specs.map(s => buildPriceSeries(events, s));
}

/** Pair sequential --event / --market flags from argv. */
export function parseEventMarketPairs(
  argv: string[] = process.argv
): ChartSeriesSpec[] {
  const pairs: ChartSeriesSpec[] = [];
  let curEvent: string | null = null;
  let curPeriod = 'm';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const take = (name: string): string | undefined => {
      if (a === `--${name}`) {
        const n = argv[i + 1];
        if (n && !n.startsWith('--')) {
          i++;
          return n;
        }
        return undefined;
      }
      if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
      return undefined;
    };
    const ev = take('event') ?? take('event-id') ?? take('market-id');
    if (ev != null) {
      curEvent = ev.replace(/^#/, '');
      continue;
    }
    const per = take('period');
    if (per != null) {
      curPeriod = per;
      continue;
    }
    const mkt = take('market') ?? take('market-type');
    if (mkt != null && curEvent) {
      pairs.push({
        eventId: curEvent,
        marketType: mkt,
        period: curPeriod,
      });
    }
  }
  return pairs;
}

function niceRange(min: number, max: number): { lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 1, hi: 2 };
  if (min === max) return { lo: min * 0.95, hi: max * 1.05 || 1 };
  const pad = (max - min) * 0.08;
  return { lo: min - pad, hi: max + pad };
}

function esc(s: string): string {
  return Bun.escapeHTML(s); // native (§43)
}

/**
 * Render multi-series price chart as SVG (overlay on shared axes).
 */
export function renderPriceChartSvg(
  seriesList: ChartSeries[],
  options: ChartBuildOptions = {}
): string {
  const width = options.width ?? 960;
  const height = options.height ?? 420;
  const pad = options.pad ?? 48;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2 - 28; // legend room

  const allPts = seriesList.flatMap(s => s.points);
  if (!allPts.length) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0c0f14"/>
  <text x="${width / 2}" y="${height / 2}" fill="#8b9bb0" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14">no PRICE_CHANGE points for series</text>
</svg>
`;
  }

  const tMin = Math.min(...allPts.map(p => p.tMs));
  const tMax = Math.max(...allPts.map(p => p.tMs));
  const pMin = Math.min(...allPts.map(p => p.price));
  const pMax = Math.max(...allPts.map(p => p.price));
  const { lo: yLo, hi: yHi } = niceRange(pMin, pMax);
  const tSpan = Math.max(tMax - tMin, 1);
  const ySpan = Math.max(yHi - yLo, 1e-9);

  const xOf = (tMs: number) => pad + ((tMs - tMin) / tSpan) * plotW;
  const yOf = (price: number) => pad + 8 + (1 - (price - yLo) / ySpan) * plotH;

  const paths: string[] = [];
  const legend: string[] = [];
  seriesList.forEach((s, i) => {
    const color = COLORS[i % COLORS.length]!;
    if (s.points.length === 0) {
      legend.push(
        `<g transform="translate(${pad + i * 160},${height - 18})">
          <rect width="10" height="10" fill="${color}" opacity="0.35"/>
          <text x="14" y="10" fill="#8b9bb0" font-size="11" font-family="ui-monospace,monospace">${esc(s.label)} (empty)</text>
        </g>`
      );
      return;
    }
    // step polyline: horizontal then vertical between points
    const d: string[] = [];
    s.points.forEach((pt, j) => {
      const x = xOf(pt.tMs);
      const y = yOf(pt.price);
      if (j === 0) d.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
      else {
        const prev = s.points[j - 1]!;
        const x0 = xOf(prev.tMs);
        d.push(`L ${x.toFixed(1)} ${yOf(prev.price).toFixed(1)}`);
        d.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        void x0;
      }
    });
    paths.push(
      `<path d="${d.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`
    );
    // dots
    for (const pt of s.points) {
      paths.push(
        `<circle cx="${xOf(pt.tMs).toFixed(1)}" cy="${yOf(pt.price).toFixed(1)}" r="2.5" fill="${color}"/>`
      );
    }
    legend.push(
      `<g transform="translate(${pad + (i % 4) * 220},${height - 18 - Math.floor(i / 4) * 14})">
        <rect width="12" height="3" y="4" fill="${color}"/>
        <text x="16" y="10" fill="#e8eef6" font-size="11" font-family="ui-monospace,monospace">${esc(s.label)} n=${s.points.length}</text>
      </g>`
    );
  });

  // axes
  const yTicks = 5;
  const grid: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = yLo + (ySpan * i) / yTicks;
    const y = yOf(v);
    grid.push(
      `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${pad + plotW}" y2="${y.toFixed(1)}" stroke="#2a3544" stroke-width="1"/>`
    );
    grid.push(
      `<text x="${pad - 8}" y="${(y + 4).toFixed(1)}" fill="#8b9bb0" font-size="10" text-anchor="end" font-family="ui-monospace,monospace">${v.toFixed(2)}</text>`
    );
  }
  // time labels ends
  const t0 = new Date(tMin).toISOString().slice(11, 19);
  const t1 = new Date(tMax).toISOString().slice(11, 19);
  grid.push(
    `<text x="${pad}" y="${pad + plotH + 22}" fill="#8b9bb0" font-size="10" font-family="ui-monospace,monospace">${t0}Z</text>`
  );
  grid.push(
    `<text x="${pad + plotW}" y="${pad + plotH + 22}" fill="#8b9bb0" font-size="10" text-anchor="end" font-family="ui-monospace,monospace">${t1}Z</text>`
  );

  const title =
    options.title ??
    `live-tracker chart · ${seriesList.length} series` +
      (options.overlay === false ? ' (panels)' : ' (overlay)');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0c0f14"/>
  <text x="${pad}" y="28" fill="#e8eef6" font-size="15" font-family="system-ui,sans-serif" font-weight="600">${esc(title)}</text>
  <text x="${pad}" y="44" fill="#8b9bb0" font-size="11" font-family="ui-monospace,monospace">decimal price · step from PRICE_CHANGE</text>
  <rect x="${pad}" y="${pad + 8}" width="${plotW}" height="${plotH}" fill="#141a22" stroke="#2a3544"/>
  ${grid.join('\n  ')}
  ${paths.join('\n  ')}
  ${legend.join('\n  ')}
</svg>
`;
}
