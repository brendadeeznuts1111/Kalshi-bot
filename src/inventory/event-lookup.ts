/**
 * Look up a plive deep-link event id across inventory + priced planes.
 *
 * Inventory: stream-list-v2 + skin_events
 * Priced: Pandora eventCoefficients.{id}
 * Metadata: Statscore booked catalog (odds_event_id match only)
 *
 * Widget route (Angular): `/event/:eventId/:periodId?`
 *   #!/event/197488581      → event shell
 *   #!/event/197488581/m    → match period focus
 *   #!/event/197488581/s1   → period s1 if offered
 *
 *   bun run domain:event -- --id=197548901
 *   bun run domain:event -- --id=197488581 --period=m
 *   bun run domain:event -- --url='https://plive…/live/?#!/event/197488581/m'
 */
// @see https://bun.com/docs/api/fetch
// @see https://bun.com/docs/api/websockets
import type { Database } from 'bun:sqlite';
import { PLIVE_STREAM_ENDPOINTS } from '../domain/live-product-endpoints.ts';
import type { FetchFn } from '../institutions/resilient-fetch.ts';
import { openEventStore } from '../institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../institutions/event-store/paths.ts';
import { CoefficientStore } from '../partner/fantasy-ultra/coefficient-store.ts';
import {
  analyzeCoefficientBook,
  diffOfferFingerprints,
  extractCoefficientLines,
  type CoefficientBookState,
  type CoefficientLine,
  type OfferTransition,
} from '../partner/fantasy-ultra/coefficients.ts';
import {
  PANDORA_DEFAULT_SESSION,
  PandoraSocket,
} from '../partner/fantasy-ultra/pandora-socket.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import type { PartnerMarket } from '../partner/types.ts';
import { defaultBookedCatalogCachePath } from './booked-catalog-cache.ts';

export type StreamListEventHit = {
  bucket: string;
  inventoryId: string;
  sport: string | null;
  league: string | null;
  home: string | null;
  away: string | null;
  streamId: number | null;
  feedId: number | null;
};

export type SkinEventHit = {
  inventoryId: string;
  sport: string | null;
  league: string | null;
  home: string | null;
  away: string | null;
  competitionId: string | null;
  oddsEventId: string | null;
  inventoryLiveProduct: string | null;
};

export type BookedCatalogHit = {
  oddsEventId: string;
  name: string;
  sportName: string;
};

export type EventLookupPlane = 'inventory' | 'priced_only' | 'catalog_only' | 'unknown';

/** Period slice of the coefficient book (m = match, s1/h1/q1/…). */
export type EventPeriodSummary = {
  periodId: string;
  /** Human label (sport-aware when hint known). */
  label: string;
  lineCount: number;
  marketTypes: string[];
  /** Deep link focusing this period. */
  pliveUrl: string;
  /** ML american home/away when marketType 3 present. */
  moneyline?: { homeAmerican: number; awayAmerican: number; homeDecimal: number; awayDecimal: number };
  totalLine?: number;
  spreadLine?: number;
};

export type EventLookupResult = {
  eventId: string;
  /** Requested period focus (from --period or /m in URL); null = all. */
  periodId: string | null;
  pliveUrl: string;
  /** Same event without period segment. */
  pliveUrlBare: string;
  plane: EventLookupPlane;
  /**
   * Best-effort sport context: stream-list sport, catalog, or inferred from
   * periods/markets (basketball totals, tennis sets, soccer halves, …).
   */
  sportHint: string | null;
  streamList: { hit: boolean; event: StreamListEventHit | null };
  skinEvents: SkinEventHit | null;
  bookedCatalog: BookedCatalogHit | null;
  pandora: {
    probed: boolean;
    seconds: number;
    subscribed: boolean;
    lineCount: number;
    /** All periods seen on the book. */
    periods: EventPeriodSummary[];
    /** Lines (optionally filtered to periodId). */
    lines: CoefficientLine[];
    markets: Array<{
      ticker: string;
      label: string;
      homePrice: number | null;
      awayPrice: number | null;
      oddsEventId: string;
    }>;
    eventDataKeys: string[];
    /** True when periodId was requested but not present on the book. */
    periodMissing: boolean;
    /**
     * Per-market offer map from coefficient payload.
     * Offered ⇔ `o` has valid decimals. `cls` is limit class, not suspend.
     */
    book: CoefficientBookState | null;
  };
  notes: string[];
};

export type EventLookupOptions = {
  eventId: string | number;
  /**
   * Period deep-link focus (`m`, `s1`, `h1`, …).
   * Filters display lines; still loads full book for period inventory.
   */
  periodId?: string | null;
  /** Pandora listen window (default 8s). 0 = skip Pandora. */
  pandoraSeconds?: number;
  streamListUrl?: string;
  catalogCachePath?: string;
  dbPath?: string;
  db?: Database;
  fetchImpl?: FetchFn;
  WebSocketImpl?: typeof WebSocket;
  skipStreamList?: boolean;
  skipDb?: boolean;
  skipCatalog?: boolean;
  skipPandora?: boolean;
};

function competitors(ev: Record<string, unknown>): {
  home: string | null;
  away: string | null;
} {
  const c = ev.competitiors ?? ev.competitors;
  if (!c || typeof c !== 'object') return { home: null, away: null };
  const o = c as Record<string, unknown>;
  return {
    home: o.home != null ? String(o.home) : null,
    away: o.away != null ? String(o.away) : null,
  };
}

/**
 * Parse event id (+ optional period) from bare id, `id/m`, or full plive URL.
 * Route shape: #!/event/:eventId/:periodId?
 */
export function parseEventRef(raw: string): {
  eventId: string;
  periodId: string | null;
} {
  const s = raw.trim();
  // Full URL or hash fragment
  const hashMatch = s.match(
    /#?!?\/?event\/(\d+)(?:\/([A-Za-z0-9_-]+))?/i
  );
  if (hashMatch) {
    return {
      eventId: hashMatch[1]!,
      periodId: hashMatch[2] ? hashMatch[2].trim() : null,
    };
  }
  // query ?event= or path tail
  const q = s.match(/[?&](?:id|event)=(\d+)/i);
  if (q) return { eventId: q[1]!, periodId: null };

  // bare 197488581 or 197488581/m
  const bare = s.match(/^(\d{5,})(?:\/([A-Za-z0-9_-]+))?$/);
  if (bare) {
    return {
      eventId: bare[1]!,
      periodId: bare[2] ? bare[2].trim() : null,
    };
  }
  throw new Error(
    `cannot parse event ref (want id, id/period, or plive #!/event/id[/period]): ${s.slice(0, 120)}`
  );
}

/**
 * Build plive deep link.
 * Widget: `/event/:eventId/:periodId?` — period `m` = match (all sports).
 */
export function pliveEventUrl(
  eventId: string | number,
  periodId?: string | null,
  options: { hideSidebar?: boolean } = {}
): string {
  const id = String(eventId).trim();
  const p = periodId?.trim();
  const path = p ? `#!/event/${id}/${p}` : `#!/event/${id}`;
  const qs = options.hideSidebar === false ? '' : '?hideSidebar=true';
  // Observed working: .../live/?#!/event/197488581/m and ...?#!/event/id?hideSidebar=true
  if (p) {
    return `${PLIVE_STREAM_ENDPOINTS.streamOrigin}${PLIVE_STREAM_ENDPOINTS.livePathPrefix}?${path}`;
  }
  return `${PLIVE_STREAM_ENDPOINTS.streamOrigin}${PLIVE_STREAM_ENDPOINTS.livePathPrefix}?${path}${qs}`;
}

/**
 * Sport-aware period labels for Pandora period codes.
 * Codes are shared across sports; hint disambiguates s1 = set vs segment.
 */
export function labelPeriodId(
  periodId: string,
  sportHint?: string | null
): string {
  const p = periodId.trim().toLowerCase();
  const sport = (sportHint ?? '').toLowerCase().replace(/\s+/g, '_');
  if (p === 'm') return 'match (full game)';

  const setSports =
    /tennis|table_tennis|volleyball|badminton|beach|squash|pickle/.test(sport);
  const halfSports = /soccer|football|futsal|handball|rugby|aussie|bandy/.test(
    sport
  );
  const quarterSports = /basketball|american_football|football_nfl|aussie/.test(
    sport
  );
  const periodSports = /ice_hockey|hockey|floorbandy|bandy/.test(sport);
  const inningSports = /baseball|softball|cricket/.test(sport);

  const sn = p.match(/^s(\d+)$/);
  if (sn) {
    const n = sn[1]!;
    if (setSports) return `set ${n}`;
    if (periodSports) return `period ${n}`;
    if (inningSports) return `segment ${n}`;
    return `segment/set ${n}`;
  }
  const hn = p.match(/^h(\d+)$/);
  if (hn) {
    const n = hn[1]!;
    if (halfSports || !sport) return `half ${n}`;
    return `half ${n}`;
  }
  const qn = p.match(/^q(\d+)$/);
  if (qn) return `quarter ${qn[1]}`;
  const pn = p.match(/^p(\d+)$/);
  if (pn) {
    if (periodSports || !sport) return `period ${pn[1]}`;
    return `period ${pn[1]}`;
  }
  const inn = p.match(/^(?:i|inn)(\d+)$/);
  if (inn) return `inning ${inn[1]}`;
  if (p === 'ot' || p === 'overtime') return 'overtime';
  if (p === 'so' || p === 'shootout') return 'shootout';
  if (p === 'fg' || p === 'f5') return p === 'f5' ? 'first 5 innings' : periodId;
  return periodId;
}

/**
 * Infer sport family from coefficient shape when inventory/catalog lack names.
 * Heuristic only — used for period labels and notes.
 */
export function inferSportHintFromLines(
  lines: CoefficientLine[],
  fallback?: string | null
): string | null {
  if (fallback && fallback.trim()) {
    const f = fallback.trim().toLowerCase().replace(/\s+/g, '_');
    // map stream-list buckets
    if (f === 'football') return 'soccer';
    return f;
  }
  if (!lines.length) return null;
  const periods = new Set(lines.map(l => (l.period || 'm').toLowerCase()));
  const totals = lines
    .filter(l => l.marketType === '5' && l.line != null)
    .map(l => Number(l.line));
  const maxTot = totals.length ? Math.max(...totals) : 0;
  const hasQ = [...periods].some(p => /^q\d+$/.test(p));
  const hasH = [...periods].some(p => /^h\d+$/.test(p));
  const hasS = [...periods].some(p => /^s\d+$/.test(p));
  const hasP = [...periods].some(p => /^p\d+$/.test(p));
  // basketball game totals typically 140–240
  if (maxTot >= 120 && maxTot <= 280) return 'basketball';
  // soccer totals usually < 10
  if (hasH && maxTot > 0 && maxTot <= 12) return 'soccer';
  if (hasQ) return 'basketball';
  if (hasP && maxTot > 0 && maxTot < 20) return 'ice_hockey';
  // tennis sets: s1/s2/s3, totals often games < 40 or absent
  if (hasS && (maxTot === 0 || maxTot < 50)) return 'tennis';
  if (hasH) return 'soccer';
  if (hasS) return 'tennis';
  if (maxTot > 0 && maxTot < 15) return 'soccer';
  return null;
}

/** Summarize coefficient lines by period for deep-link inventory. */
export function summarizePeriods(
  eventId: string,
  lines: CoefficientLine[],
  sportHint?: string | null
): EventPeriodSummary[] {
  const byPeriod = new Map<string, CoefficientLine[]>();
  for (const l of lines) {
    const p = l.period || 'm';
    const arr = byPeriod.get(p) ?? [];
    arr.push(l);
    byPeriod.set(p, arr);
  }
  const out: EventPeriodSummary[] = [];
  for (const [periodId, pls] of [...byPeriod.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const marketTypes = [...new Set(pls.map(l => l.marketType))].sort();
    const ml = pls.filter(l => l.marketType === '3');
    const h = ml.find(l => l.selection === '1');
    const a = ml.find(l => l.selection === '2');
    const total = pls.find(l => l.marketType === '5' && l.line != null);
    const spread = pls.find(l => l.marketType === '6' && l.line != null);
    const row: EventPeriodSummary = {
      periodId,
      label: labelPeriodId(periodId, sportHint),
      lineCount: pls.length,
      marketTypes,
      pliveUrl: pliveEventUrl(eventId, periodId),
    };
    if (h && a) {
      row.moneyline = {
        homeAmerican: h.american,
        awayAmerican: a.american,
        homeDecimal: h.decimal,
        awayDecimal: a.decimal,
      };
    }
    if (total?.line != null) row.totalLine = total.line;
    if (spread?.line != null) row.spreadLine = spread.line;
    out.push(row);
  }
  return out;
}

export function filterLinesByPeriod(
  lines: CoefficientLine[],
  periodId: string | null | undefined
): CoefficientLine[] {
  if (!periodId) return lines;
  return lines.filter(l => l.period === periodId);
}

export async function lookupStreamListEvent(
  eventId: string,
  options: {
    url?: string;
    fetchImpl?: FetchFn;
  } = {}
): Promise<StreamListEventHit | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url ?? PLIVE_STREAM_ENDPOINTS.streamListUrl;
  const res = await fetchImpl(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
      referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
    },
  });
  if (!res.ok) throw new Error(`stream-list HTTP ${res.status}`);
  const wire = (await res.json()) as {
    sports?: Record<
      string,
      { events?: Record<string, Record<string, unknown>> }
    >;
  };

  for (const [bucket, block] of Object.entries(wire.sports ?? {})) {
    for (const [id, ev] of Object.entries(block.events ?? {})) {
      const streamId =
        ev.stream_id != null && Number.isFinite(Number(ev.stream_id))
          ? Number(ev.stream_id)
          : null;
      if (id !== eventId && String(streamId) !== eventId) continue;
      const { home, away } = competitors(ev);
      return {
        bucket,
        inventoryId: id,
        sport: ev.sport != null ? String(ev.sport) : null,
        league: ev.league != null ? String(ev.league) : null,
        home,
        away,
        streamId,
        feedId:
          ev.feed_id != null && Number.isFinite(Number(ev.feed_id))
            ? Number(ev.feed_id)
            : null,
      };
    }
  }
  return null;
}

export function lookupSkinEvent(
  db: Database,
  eventId: string
): SkinEventHit | null {
  const row = db
    .query(
      `SELECT inventory_id AS inventoryId, sport, league, home, away,
              competition_id AS competitionId, odds_event_id AS oddsEventId,
              inventory_live_product AS inventoryLiveProduct
       FROM skin_events
       WHERE inventory_id = $id OR odds_event_id = $id
       LIMIT 1`
    )
    .get({ $id: eventId }) as SkinEventHit | null;
  return row ?? null;
}

export async function lookupBookedCatalog(
  eventId: string,
  cachePath = defaultBookedCatalogCachePath()
): Promise<BookedCatalogHit | null> {
  try {
    const file = Bun.file(cachePath);
    if (!(await file.exists())) return null;
    const raw = (await file.json()) as {
      entries?: Array<{ oddsEventId?: string; name?: string; sportName?: string }>;
    };
    const hit = (raw.entries ?? []).find(e => String(e.oddsEventId) === eventId);
    if (!hit?.oddsEventId) return null;
    return {
      oddsEventId: String(hit.oddsEventId),
      name: String(hit.name ?? ''),
      sportName: String(hit.sportName ?? ''),
    };
  } catch {
    return null;
  }
}

export async function probePandoraEvent(
  eventId: number,
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
  } = {}
): Promise<{
  subscribed: boolean;
  lines: CoefficientLine[];
  markets: PartnerMarket[];
  eventDataKeys: string[];
  book: CoefficientBookState | null;
  lastPayload: unknown | null;
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 8, 2), 30);
  const store = new CoefficientStore();
  let subscribed = false;
  let eventDataKeys: string[] = [];
  let lastPayload: unknown | null = null;
  const main = `live.main.${PANDORA_DEFAULT_SESSION.mainToken}`;

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({ eventIds: [eventId] });
          try {
            sock.emit('subscribe', [`${main}.eventData.${eventId}`]);
          } catch {
            /* optional */
          }
        },
        onEvent: (name, args) => {
          if (name.includes(`eventCoefficients.${eventId}`)) subscribed = true;
          if (Array.isArray(args?.[0]) && String(args[0][0] ?? '').includes(String(eventId))) {
            subscribed = true;
          }
        },
        onCoefficients: info => {
          if (info.eventId === eventId || info.room.includes(String(eventId))) {
            if (info.room.includes('eventCoefficients')) subscribed = true;
            store.ingest(info);
            if (
              info.room.includes('eventCoefficients') &&
              !info.envelope.isDiff &&
              info.envelope.payload
            ) {
              lastPayload = info.envelope.payload;
            }
            if (info.room.includes('eventData') && !info.envelope.isDiff) {
              const p = info.envelope.payload;
              if (p && typeof p === 'object' && !Array.isArray(p)) {
                eventDataKeys = Object.keys(p as object).slice(0, 24);
              }
            }
          }
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  const lines = store.getLines(eventId);
  const book = lastPayload
    ? analyzeCoefficientBook(eventId, lastPayload)
    : lines.length
      ? analyzeCoefficientBook(eventId, {
          id: eventId,
          c: rebuildCFromLines(lines),
        })
      : null;

  return {
    subscribed,
    lines,
    markets: store.toPartnerMarkets().filter(m => m.oddsEventId === String(eventId)),
    eventDataKeys,
    book,
    lastPayload,
  };
}

/** Best-effort c{} tree from extracted lines (for book analysis without raw payload). */
function rebuildCFromLines(
  lines: CoefficientLine[]
): Record<string, Record<string, { o: Record<string, number | number[]> }>> {
  const c: Record<
    string,
    Record<string, { o: Record<string, number | number[]> }>
  > = {};
  for (const l of lines) {
    const period = c[l.period] ?? (c[l.period] = {});
    const mkt = period[l.marketType] ?? (period[l.marketType] = { o: {} });
    if (l.sideIndex != null) {
      const arr = (mkt.o[l.selection] as number[] | undefined) ?? [];
      arr[l.sideIndex] = l.decimal;
      mkt.o[l.selection] = arr;
    } else {
      mkt.o[l.selection] = l.decimal;
    }
  }
  return c;
}

export type OddsWatchUpdate = {
  at: string;
  eventId: number;
  lineCount: number;
  offeredMarketCount: number;
  transitions: OfferTransition[];
  book: CoefficientBookState | null;
};

/**
 * Watch coefficient book and emit offer transitions (on/off/price).
 * Primary signal for “odds taken off”: selection_off / market_off.
 */
export async function watchEventOdds(
  eventId: number,
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    onUpdate?: (u: OddsWatchUpdate) => void;
  } = {}
): Promise<OddsWatchUpdate[]> {
  const seconds = Math.min(Math.max(options.seconds ?? 30, 5), 300);
  const store = new CoefficientStore();
  const history: OddsWatchUpdate[] = [];
  let prevLines: CoefficientLine[] = [];
  let lastPayload: unknown | null = null;

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({ eventIds: [eventId] });
        },
        onCoefficients: info => {
          if (info.eventId !== eventId && !info.room.includes(String(eventId))) {
            return;
          }
          if (!info.room.includes('eventCoefficients')) return;
          store.ingest(info);
          if (!info.envelope.isDiff && info.envelope.payload) {
            lastPayload = info.envelope.payload;
          }
          const lines = store.getLines(eventId);
          const transitions = diffOfferFingerprints(prevLines, lines);
          const book = lastPayload
            ? analyzeCoefficientBook(eventId, lastPayload)
            : analyzeCoefficientBook(eventId, {
                id: eventId,
                c: rebuildCFromLines(lines),
              });
          if (transitions.length > 0 || prevLines.length === 0) {
            const u: OddsWatchUpdate = {
              at: new Date().toISOString(),
              eventId,
              lineCount: lines.length,
              offeredMarketCount: book.offeredMarketCount,
              transitions,
              book,
            };
            history.push(u);
            options.onUpdate?.(u);
          }
          prevLines = lines;
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  return history;
}

function classifyPlane(r: {
  streamHit: boolean;
  skin: boolean;
  catalog: boolean;
  pandoraLines: number;
}): EventLookupPlane {
  if (r.streamHit || r.skin) return 'inventory';
  if (r.pandoraLines > 0) return 'priced_only';
  if (r.catalog) return 'catalog_only';
  return 'unknown';
}

export async function lookupEvent(
  options: EventLookupOptions
): Promise<EventLookupResult> {
  const eventId = String(options.eventId).trim();
  if (!/^\d+$/.test(eventId)) {
    throw new Error(`event id must be numeric (got ${eventId})`);
  }
  const periodId = options.periodId?.trim() || null;
  const notes: string[] = [];
  const pandoraSeconds =
    options.skipPandora || options.pandoraSeconds === 0
      ? 0
      : Math.min(Math.max(options.pandoraSeconds ?? 8, 2), 30);

  let streamHit: StreamListEventHit | null = null;
  if (!options.skipStreamList) {
    try {
      streamHit = await lookupStreamListEvent(eventId, {
        url: options.streamListUrl,
        fetchImpl: options.fetchImpl,
      });
    } catch (e) {
      notes.push(
        `stream-list error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  let skin: SkinEventHit | null = null;
  if (!options.skipDb) {
    try {
      const db =
        options.db ??
        openEventStore({ dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB });
      skin = lookupSkinEvent(db, eventId);
    } catch (e) {
      notes.push(`skin_events error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let catalog: BookedCatalogHit | null = null;
  if (!options.skipCatalog) {
    catalog = await lookupBookedCatalog(
      eventId,
      options.catalogCachePath ?? defaultBookedCatalogCachePath()
    );
  }

  let allLines: CoefficientLine[] = [];
  let pandora = {
    probed: false,
    seconds: pandoraSeconds,
    subscribed: false,
    lineCount: 0,
    periods: [] as EventPeriodSummary[],
    lines: [] as CoefficientLine[],
    markets: [] as EventLookupResult['pandora']['markets'],
    eventDataKeys: [] as string[],
    periodMissing: false,
    book: null as CoefficientBookState | null,
  };

  if (pandoraSeconds > 0) {
    try {
      const p = await probePandoraEvent(Number(eventId), {
        seconds: pandoraSeconds,
        WebSocketImpl: options.WebSocketImpl,
      });
      allLines = p.lines;
      // sport hint filled after stream/catalog known — see below after blocks
      const periods = summarizePeriods(eventId, allLines, null);
      const periodMissing =
        !!periodId && periods.length > 0 && !periods.some(x => x.periodId === periodId);
      const filtered = filterLinesByPeriod(allLines, periodId);
      pandora = {
        probed: true,
        seconds: pandoraSeconds,
        subscribed: p.subscribed,
        lineCount: allLines.length,
        periods,
        lines: filtered.slice(0, 60),
        markets: p.markets.map(m => ({
          ticker: m.ticker,
          label: m.label ?? 'market',
          homePrice: m.homePrice ?? null,
          awayPrice: m.awayPrice ?? null,
          oddsEventId: m.oddsEventId,
        })),
        eventDataKeys: p.eventDataKeys,
        periodMissing,
        book: p.book,
      };
      if (p.lines.length === 0) {
        notes.push(
          'Pandora subscribed or timed out with 0 lines — event may be settled/off-book or id is inventory-only'
        );
      } else if (p.book && p.book.offeredMarketCount === 0) {
        notes.push(
          'book has markets but none offered (empty o / no valid decimals) — treated as taken off'
        );
      }
      if (periodMissing) {
        notes.push(
          `period "${periodId}" not on book — available: ${periods.map(x => x.periodId).join(', ') || 'none'}`
        );
      }
      if (periodId && !periodMissing && periods.length) {
        notes.push(
          `period focus "${periodId}" (widget route /event/:id/:periodId?) — showing filtered lines`
        );
      }
      notes.push(
        'odds-off signals: empty o / selection_off / market_off diffs; cls is limit-class not suspend; event state 0=bettable 1=blocked 2=notBettable 3=finished (EVENT_STATES)'
      );
    } catch (e) {
      notes.push(`pandora error: ${e instanceof Error ? e.message : String(e)}`);
      pandora.probed = true;
    }
  }

  if (!streamHit && pandora.lineCount > 0) {
    notes.push(
      'priced_only: Pandora event id is not on public stream-list inventory board'
    );
  }
  if (streamHit && pandora.lineCount === 0 && pandoraSeconds > 0) {
    notes.push(
      'stream-list inventory id ≠ Pandora event id space — #!/event/{streamId}/m usually has no coefficients'
    );
  }

  const plane = classifyPlane({
    streamHit: !!streamHit,
    skin: !!skin,
    catalog: !!catalog,
    pandoraLines: pandora.lineCount,
  });

  let sportHint: string | null = null;
  if (streamHit?.sport?.trim()) {
    sportHint = streamHit.sport.toLowerCase().replace(/\s+/g, '_');
  } else if (skin?.sport?.trim()) {
    sportHint = skin.sport.trim();
  } else if (catalog?.sportName?.trim()) {
    sportHint = catalog.sportName.toLowerCase().replace(/\s+/g, '_');
  } else {
    sportHint = inferSportHintFromLines(allLines, streamHit?.bucket ?? null);
  }

  // Re-label periods with sport hint for display
  if (pandora.periods.length && sportHint) {
    pandora.periods = summarizePeriods(
      eventId,
      // rebuild from full line set if we still have them on filtered-only display
      allLines.length
        ? allLines
        : pandora.lines,
      sportHint
    );
  }

  if (sportHint) {
    notes.push(`sport_hint=${sportHint} (stream/catalog/inference — for period labels)`);
  }

  return {
    eventId,
    periodId,
    pliveUrl: pliveEventUrl(eventId, periodId),
    pliveUrlBare: pliveEventUrl(eventId),
    plane,
    sportHint,
    streamList: { hit: !!streamHit, event: streamHit },
    skinEvents: skin,
    bookedCatalog: catalog,
    pandora,
    notes,
  };
}

/** One stream-list sample per sport bucket (inventory plane). */
export type SportBoardSample = {
  bucket: string;
  inventoryId: string;
  league: string | null;
  home: string | null;
  away: string | null;
  sport: string | null;
  pliveUrl: string;
  /** Pandora coefficients for this id (usually 0 — different id space). */
  pandoraLineCount: number;
  periods: string[];
};

/**
 * Sample live stream-list board across sports (optional short Pandora probe per id).
 * Inventory ids usually have 0 Pandora lines — documents id-space split multi-sport.
 */
export async function sampleStreamListBySport(
  options: {
    maxSports?: number;
    pandoraSeconds?: number;
    fetchImpl?: FetchFn;
    WebSocketImpl?: typeof WebSocket;
    streamListUrl?: string;
  } = {}
): Promise<SportBoardSample[]> {
  const maxSports = Math.min(Math.max(options.maxSports ?? 20, 1), 40);
  const pandoraSeconds = options.pandoraSeconds ?? 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.streamListUrl ?? PLIVE_STREAM_ENDPOINTS.streamListUrl;
  const res = await fetchImpl(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
      referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
    },
  });
  if (!res.ok) throw new Error(`stream-list HTTP ${res.status}`);
  const wire = (await res.json()) as {
    sports?: Record<
      string,
      { events?: Record<string, Record<string, unknown>> }
    >;
  };

  const samples: SportBoardSample[] = [];
  for (const [bucket, block] of Object.entries(wire.sports ?? {})) {
    const events = Object.entries(block.events ?? {});
    if (!events.length) continue;
    const [id, ev] = events[0]!;
    const { home, away } = competitors(ev);
    const sample: SportBoardSample = {
      bucket,
      inventoryId: id,
      league: ev.league != null ? String(ev.league) : null,
      home,
      away,
      sport: ev.sport != null ? String(ev.sport) : null,
      pliveUrl: pliveEventUrl(id, 'm'),
      pandoraLineCount: 0,
      periods: [],
    };
    if (pandoraSeconds > 0) {
      try {
        const p = await probePandoraEvent(Number(id), {
          seconds: pandoraSeconds,
          WebSocketImpl: options.WebSocketImpl,
        });
        sample.pandoraLineCount = p.lines.length;
        sample.periods = [
          ...new Set(p.lines.map(l => l.period || 'm')),
        ].sort();
      } catch {
        /* ignore */
      }
    }
    samples.push(sample);
    if (samples.length >= maxSports) break;
  }
  return samples;
}

export function formatSportBoardSamples(samples: SportBoardSample[]): string {
  const lines: string[] = [];
  lines.push(`stream-list multi-sport sample (${samples.length} buckets)`);
  lines.push(
    'note: #!/event/{id}/m uses Pandora event ids — inventory stream_id usually has 0 coefficient lines'
  );
  lines.push('');
  for (const s of samples) {
    lines.push(
      `${s.bucket.padEnd(16)} id=${s.inventoryId} pandora_lines=${s.pandoraLineCount}` +
        (s.periods.length ? ` periods=[${s.periods.join(',')}]` : '')
    );
    lines.push(
      `  ${s.league ?? '—'} · ${s.home ?? '?'} vs ${s.away ?? '?'}`
    );
    lines.push(`  ${s.pliveUrl}`);
  }
  return lines.join('\n');
}

export function formatEventLookup(r: EventLookupResult): string {
  const lines: string[] = [];
  lines.push(
    `event-lookup id=${r.eventId}` +
      (r.periodId ? ` period=${r.periodId}` : '') +
      ` plane=${r.plane}` +
      (r.sportHint ? ` sport≈${r.sportHint}` : '')
  );
  lines.push(`  url  ${r.pliveUrl}`);
  if (r.periodId) lines.push(`  bare ${r.pliveUrlBare}`);
  lines.push('');
  lines.push('## Inventory plane');
  if (r.streamList.hit && r.streamList.event) {
    const e = r.streamList.event;
    lines.push(
      `  stream-list ✓ bucket=${e.bucket} inventoryId=${e.inventoryId}`
    );
    lines.push(
      `    ${e.league ?? '—'} · ${e.home ?? '?'} vs ${e.away ?? '?'} (sport=${e.sport ?? '—'})`
    );
  } else {
    lines.push('  stream-list ✗ not on public board');
  }
  if (r.skinEvents) {
    const s = r.skinEvents;
    lines.push(
      `  skin_events ✓ sport=${s.sport} league=${s.league} comp=${s.competitionId ?? '—'} odds=${s.oddsEventId ?? '—'}`
    );
    lines.push(`    ${s.home ?? '?'} vs ${s.away ?? '?'}`);
  } else {
    lines.push('  skin_events ✗ not in local event-store');
  }
  lines.push('');
  lines.push('## Catalog / priced');
  if (r.bookedCatalog) {
    lines.push(
      `  booked-catalog ✓ ${r.bookedCatalog.sportName}: ${r.bookedCatalog.name}`
    );
  } else {
    lines.push('  booked-catalog ✗ (cache miss / not linked)');
  }
  if (r.pandora.probed) {
    lines.push(
      `  pandora ${r.pandora.subscribed ? '✓' : '?'} lines=${r.pandora.lineCount} (${r.pandora.seconds}s)` +
        (r.pandora.periodMissing ? ` period=${r.periodId} MISSING` : '')
    );
    if (r.pandora.periods.length) {
      lines.push('  periods (widget /event/:id/:periodId? — all sports):');
      for (const p of r.pandora.periods) {
        const focus = r.periodId === p.periodId ? ' ← focus' : '';
        const ml = p.moneyline
          ? ` ML ${p.moneyline.homeAmerican}/${p.moneyline.awayAmerican}`
          : '';
        const tot = p.totalLine != null ? ` tot=${p.totalLine}` : '';
        const sp = p.spreadLine != null ? ` spr=${p.spreadLine}` : '';
        lines.push(
          `    ${p.periodId.padEnd(4)} ${p.label.padEnd(18)} lines=${String(p.lineCount).padStart(3)} mkt=[${p.marketTypes.join(',')}]${ml}${tot}${sp}${focus}`
        );
        lines.push(`         ${p.pliveUrl}`);
      }
    }
    // Headline prices for focus period (or m)
    const focusPeriod = r.periodId ?? 'm';
    const scope = r.pandora.lines.filter(
      l => !r.periodId || l.period === r.periodId
    );
    const ml = scope.filter(l => l.period === focusPeriod && l.marketType === '3');
    const mlAny = ml.length
      ? ml
      : r.pandora.lines.filter(l => l.period === 'm' && l.marketType === '3');
    if (mlAny.length) {
      const h = mlAny.find(l => l.selection === '1');
      const a = mlAny.find(l => l.selection === '2');
      lines.push(
        `    ML ${h?.period ?? focusPeriod}/3  home am=${h?.american ?? '—'} dec=${h?.decimal ?? '—'}  away am=${a?.american ?? '—'} dec=${a?.decimal ?? '—'}`
      );
    }
    const totals = scope.filter(l => l.marketType === '5' && l.line != null);
    if (totals[0]?.line != null) {
      lines.push(`    Total ${totals[0].period}/5  line=${totals[0].line}`);
    }
    const spreads = scope.filter(l => l.marketType === '6' && l.line != null);
    if (spreads[0]?.line != null) {
      lines.push(`    Spread ${spreads[0].period}/6 line=${spreads[0].line}`);
    }
    for (const m of r.pandora.markets.slice(0, 5)) {
      lines.push(
        `    market ${m.ticker} ${m.label} home=${m.homePrice ?? '—'} away=${m.awayPrice ?? '—'}`
      );
    }
    if (r.pandora.eventDataKeys.length) {
      lines.push(`    eventData keys: ${r.pandora.eventDataKeys.join(', ')}`);
    }
    if (r.pandora.book) {
      const b = r.pandora.book;
      lines.push(
        `  book offeredMarkets=${b.offeredMarketCount} offMarkets=${b.offMarketCount} lines=${b.lineCount}`
      );
      const off = b.markets.filter(m => !m.offered);
      if (off.length) {
        lines.push(
          `    off: ${off
            .slice(0, 12)
            .map(m => `${m.period}/${m.marketType}`)
            .join(', ')}${off.length > 12 ? '…' : ''}`
        );
      }
      const sampleCls = b.markets
        .filter(m => m.clsDefault != null)
        .slice(0, 6)
        .map(m => `${m.period}/${m.marketType} cls._d=${m.clsDefault}`);
      if (sampleCls.length) {
        lines.push(`    cls (limit class, not suspend): ${sampleCls.join('; ')}`);
      }
    }
  } else {
    lines.push('  pandora skipped');
  }
  if (r.notes.length) {
    lines.push('');
    lines.push('## Notes');
    for (const n of r.notes) lines.push(`  · ${n}`);
  }
  lines.push('');
  lines.push(
    'route: /event/:eventId/:periodId? · m=match · inventory≠pandora id space · ezlive shares plive shell'
  );
  return lines.join('\n');
}
