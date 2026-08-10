/**
 * Pure builders for the inventory coverage board (sports-as-columns layout).
 * Bake tool + tests share this — no DB / filesystem here.
 */
import { KNOWN_MARKET_LABELS, marketLabel } from '../domain/odds-selection.ts';
import {
  listLiveProductSportBindings,
  type LiveProductSportBinding,
} from '../domain/live-product-sport-bindings.ts';
import {
  periodUnitForFeedSport,
  bakedPeriodLabel,
} from '../domain/pandora-sport-periods.ts';
import { sportIdFromFeedSportId } from '../domain/pandora-feed-sports.ts';
import type {
  WidgetDomainSnapshot,
  WidgetLiveSport,
  WidgetWagerType,
} from '../domain/widget-domain-extract.ts';
import type { SportId } from '../domain/sports.ts';

export type MarketCell = 'primary' | 'secondary' | 'yes' | '—';

export type SportColumnMetrics = {
  sport: string;
  events: number;
  linked: number;
  fillPct: number;
  leagues: number;
  mapped: number;
  mapPct: number;
  /** Pandora live.leagues count when snapshot present. */
  pandoraLeagues: number;
  feedSportId: number | null;
  widgetSportId: number | null;
  apiSportId: number | null;
  /** Segment unit noun from baked sportPeriod (Inning, Set, Game, …). */
  periodUnit: string | null;
  /** Example s1 label when baked. */
  periodS1: string | null;
  bindingStatus: string | null;
};

export type MarketMatrix = {
  marketIds: string[];
  sports: string[];
  cells: Record<string, Record<string, MarketCell>>;
  labels: Record<string, string>;
  /** Catalog product counts by typeId from live.wagerTypes. */
  wagerTypeCounts: Record<string, number>;
};

export type WagerFamilyRow = {
  typeId: number | null;
  count: number;
  sampleName: string;
  knownLabel: string | null;
};

function flagRole(v: unknown): MarketCell | null {
  if (v === 'primary') return 'primary';
  if (v === 'secondary') return 'secondary';
  if (v === true || v === 1 || v === '1' || v === 'true') return 'yes';
  if (v == null || v === false) return null;
  return 'yes';
}

/** Prefer stronger role when merging feed shells for one SportId. */
export function mergeMarketCell(
  prev: MarketCell | undefined,
  next: MarketCell
): MarketCell {
  if (!prev || prev === '—') return next;
  if (next === 'primary' || prev === 'primary') return 'primary';
  if (next === 'secondary' || prev === 'secondary') return 'secondary';
  if (next === 'yes' || prev === 'yes') return 'yes';
  return next;
}

function bindingForSport(
  sport: string,
  bindings: readonly LiveProductSportBinding[]
): LiveProductSportBinding | undefined {
  return (
    bindings.find(b => b.sportId === sport) ??
    bindings.find(b => b.inventoryBucket === sport)
  );
}

/**
 * Build column metrics for inventory sports (order = highest events first).
 */
export function buildSportColumns(input: {
  eventRows: Array<{ sport: string; n: number; linked: number }>;
  leagueRows: Array<{ sport: string; n: number; mapped: number }>;
  pandoraLeagueBySport?: Record<string, number>;
  liveProduct?: 'plive' | 'ezlive';
}): SportColumnMetrics[] {
  const liveProduct = input.liveProduct ?? 'plive';
  const bindings = listLiveProductSportBindings(liveProduct);
  const map = new Map<
    string,
    { events: number; linked: number; leagues: number; mapped: number }
  >();

  for (const r of input.eventRows) {
    const sport = r.sport || '?';
    const cur = map.get(sport) ?? { events: 0, linked: 0, leagues: 0, mapped: 0 };
    cur.events = Number(r.n) || 0;
    cur.linked = Number(r.linked) || 0;
    map.set(sport, cur);
  }
  for (const r of input.leagueRows) {
    const sport = r.sport || '?';
    const cur = map.get(sport) ?? { events: 0, linked: 0, leagues: 0, mapped: 0 };
    cur.leagues = Number(r.n) || 0;
    cur.mapped = Number(r.mapped) || 0;
    map.set(sport, cur);
  }

  const cols: SportColumnMetrics[] = [];
  for (const [sport, m] of map) {
    const b = bindingForSport(sport, bindings);
    const feed = b?.feedSportId ?? null;
    cols.push({
      sport,
      events: m.events,
      linked: m.linked,
      fillPct: m.events ? Math.round((m.linked / m.events) * 100) : 0,
      leagues: m.leagues,
      mapped: m.mapped,
      mapPct: m.leagues ? Math.round((m.mapped / m.leagues) * 100) : 0,
      pandoraLeagues: input.pandoraLeagueBySport?.[sport] ?? 0,
      feedSportId: feed,
      widgetSportId: b?.widgetSportId ?? null,
      apiSportId: b?.apiSportId ?? null,
      periodUnit: feed != null ? periodUnitForFeedSport(feed) : null,
      periodS1: feed != null ? bakedPeriodLabel(feed, 's1') : null,
      bindingStatus: b?.status ?? null,
    });
  }

  return cols.sort(
    (a, b) => b.events - a.events || a.sport.localeCompare(b.sport)
  );
}

/**
 * Market-type × sport matrix.
 * Merges live.sports marketFlags across all feed shells for a SportId.
 * Always includes known market catalog ids (even if no flags).
 */
export function buildMarketMatrix(input: {
  liveSports: WidgetLiveSport[];
  /** Column order preference (inventory sports). */
  sportOrder: string[];
  wagerTypes?: WidgetWagerType[];
}): MarketMatrix {
  const cells: Record<string, Record<string, MarketCell>> = {};
  const sportKeys = new Set<string>();

  // Aggregate flags by canonical SportId first
  const flagsBySport = new Map<string, Record<string, MarketCell>>();

  for (const s of input.liveSports) {
    const canon =
      s.sportIdCanonical ??
      sportIdFromFeedSportId(s.id) ??
      null;
    if (!canon) continue;
    const key = String(canon);
    sportKeys.add(key);
    const bag = flagsBySport.get(key) ?? {};
    for (const [mid, val] of Object.entries(s.marketFlags ?? {})) {
      const role = flagRole(val);
      if (!role) continue;
      bag[mid] = mergeMarketCell(bag[mid], role);
    }
    flagsBySport.set(key, bag);
  }

  // Also index by inventory bucket alias when binding sportId differs
  // (e.g. soccer inventory bucket "football" — rare after canonicalize)

  const mSports = [
    ...input.sportOrder.filter(s => sportKeys.has(s) || flagsBySport.has(s)),
    ...[...sportKeys]
      .filter(s => !input.sportOrder.includes(s))
      .sort(),
  ];

  // Known catalog first, then any extra flags seen live
  const knownIds = Object.keys(KNOWN_MARKET_LABELS);
  const liveIds = new Set<string>();
  for (const bag of flagsBySport.values()) {
    for (const k of Object.keys(bag)) liveIds.add(k);
  }
  const marketIds = [
    ...knownIds,
    ...[...liveIds].filter(id => !knownIds.includes(id)).sort((a, b) =>
      Number(a) - Number(b) || a.localeCompare(b)
    ),
  ];

  const labels: Record<string, string> = {};
  for (const id of marketIds) {
    labels[id] = marketLabel(id);
  }

  for (const mid of marketIds) {
    cells[mid] = {};
    for (const sp of mSports) {
      const bag = flagsBySport.get(sp);
      cells[mid]![sp] = bag?.[mid] ?? '—';
    }
  }

  const wagerTypeCounts: Record<string, number> = {};
  for (const w of input.wagerTypes ?? []) {
    if (w.typeId == null) continue;
    const k = String(w.typeId);
    wagerTypeCounts[k] = (wagerTypeCounts[k] ?? 0) + 1;
  }

  return { marketIds, sports: mSports, cells, labels, wagerTypeCounts };
}

/** Top wager-type families for the board strip. */
export function buildWagerFamilyRows(
  wagerTypes: WidgetWagerType[],
  limit = 16
): WagerFamilyRow[] {
  const map = new Map<number | null, { count: number; sampleName: string }>();
  for (const w of wagerTypes) {
    const k = w.typeId ?? null;
    const cur = map.get(k);
    if (cur) cur.count += 1;
    else map.set(k, { count: 1, sampleName: w.name });
  }
  return [...map.entries()]
    .map(([typeId, v]) => ({
      typeId,
      count: v.count,
      sampleName: v.sampleName,
      knownLabel:
        typeId != null && String(typeId) in KNOWN_MARKET_LABELS
          ? marketLabel(String(typeId))
          : null,
    }))
    .sort((a, b) => b.count - a.count || String(a.typeId).localeCompare(String(b.typeId)))
    .slice(0, limit);
}

/** Count Pandora snapshot leagues by canonical SportId. */
export function pandoraLeaguesBySport(
  snap: WidgetDomainSnapshot
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of snap.liveLeagues ?? []) {
    const sid =
      l.sportIdCanonical ??
      (l.sportId ? sportIdFromFeedSportId(l.sportId) : null) ??
      (l.platformSport ? sportIdFromFeedSportId(l.platformSport) : null);
    if (!sid) continue;
    out[sid] = (out[sid] ?? 0) + 1;
  }
  return out;
}

/** Resolve SportId columns that are inventory buckets but map via bindings. */
export function normalizeInventorySportKey(sport: string): SportId | string {
  const bindings = listLiveProductSportBindings('plive');
  const byBucket = bindings.find(b => b.inventoryBucket === sport);
  if (byBucket) return byBucket.sportId;
  return sport;
}
