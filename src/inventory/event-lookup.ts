/** Look up plive event across inventory + Pandora. See domain:event CLI. */
// @see https://bun.com/docs/api/fetch
import type { Database } from 'bun:sqlite';
import { PLIVE_STREAM_ENDPOINTS } from '../domain/live-product-endpoints.ts';
import {
  feedSportSlug,
  sportIdFromFeedSportId,
} from '../domain/pandora-feed-sports.ts';
import {
  periodLabel,
  periodLabelForFeedSport,
} from '../domain/odds-selection.ts';
import type { FetchFn } from '../institutions/resilient-fetch.ts';
import { openEventStore } from '../institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../institutions/event-store/paths.ts';
import type {
  CoefficientBookState,
  CoefficientLine,
  EventDataBoardSummary,
  EventOfferability,
} from '../partner/fantasy-ultra/coefficients.ts';
import type { PandoraHostId } from '../partner/fantasy-ultra/pandora-hosts.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import { defaultBookedCatalogCachePath } from './booked-catalog-cache.ts';
import { probePandoraEvent } from './pandora-listen.ts';

/** Internal plane hit shapes (nested under EventLookupResult). */
type StreamListEventHit = {
  bucket: string;
  inventoryId: string;
  sport: string | null;
  league: string | null;
  home: string | null;
  away: string | null;
  streamId: number | null;
  feedId: number | null;
};

type SkinEventHit = {
  inventoryId: string;
  sport: string | null;
  league: string | null;
  home: string | null;
  away: string | null;
  competitionId: string | null;
  oddsEventId: string | null;
  inventoryLiveProduct: string | null;
};

type BookedCatalogHit = {
  oddsEventId: string;
  name: string;
  sportName: string;
};

type EventLookupPlane = 'inventory' | 'priced_only' | 'catalog_only' | 'unknown';

/** Period slice of the coefficient book (m = match, s1/h1/q1/…). */
type EventPeriodSummary = {
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
  /** stream-list / catalog / inferred from periods+markets */
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
    /** True when periodId was requested but not present on the book. */
    periodMissing: boolean;
    /**
     * Per-market offer map from coefficient payload.
     * Offered ⇔ `o` has valid decimals. `cls` is limit class, not suspend.
     */
    book: CoefficientBookState | null;
    /**
     * Event-level offerability from eventData board
     * (`s[sport][country][league][id][12]` → EVENT_STATES / hasLines).
     */
    eventState: EventOfferability | null;
    /** Board-level summary (sport/event counts, db/kb sizes). */
    eventDataBoard: EventDataBoardSummary | null;
  };
  notes: string[];
};

type EventLookupOptions = {
  eventId: string | number;
  /** Period focus (`m`, `s1`, …); filters display lines */
  periodId?: string | null;
  /** Pandora listen window (default 8s). 0 = skip */
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
  /**
   * Pandora edge: `pandora` (plive default) or `spandora` (public sportswidgets).
   * Same LINE_SET / protocol.
   */
  pandoraHost?: PandoraHostId | string;
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
 *
 * Prefer `feedSportId` → baked live.sportPeriod (`periodLabelForFeedSport`)
 * so baseball s1 = "1st Inning", TT s1 = "1st Game", not "set 1".
 * Fall back to sportHint heuristics, then generic periodLabel.
 */
export function labelPeriodId(
  periodId: string,
  sportHint?: string | null,
  feedSportId?: number | string | null
): string {
  const raw = periodId.trim();
  if (!raw) return '?';

  if (feedSportId != null && String(feedSportId).trim() !== '') {
    const baked = periodLabelForFeedSport(feedSportId, raw);
    if (baked && baked !== raw) {
      if (raw.toLowerCase() === 'm') {
        const low = baked.toLowerCase();
        if (low === 'match' || low === 'game') return 'match (full game)';
      }
      return baked;
    }
  }

  const p = raw.toLowerCase();
  const sport = (sportHint ?? '').toLowerCase().replace(/\s+/g, '_');
  if (p === 'm') return 'match (full game)';

  // TT / badminton use "Game" units — check before bare tennis "set"
  const gameSports = /table_tennis|badminton|padel/.test(sport);
  const setSports =
    (/tennis|volleyball|beach|squash|pickle/.test(sport) && !gameSports) ||
    sport === 'tennis';
  // Do not treat american_football as soccer halves
  const halfSports =
    /soccer|futsal|handball|rugby/.test(sport) ||
    (sport === 'football' && !/american/.test(sport));
  const quarterSports =
    /basketball|american_football|football_nfl|australian_rules/.test(sport);
  const periodSports = /ice_hockey|hockey|floorball|bandy/.test(sport);
  const inningSports = /baseball|softball|cricket/.test(sport);

  const sn = p.match(/^s(\d+)$/);
  if (sn) {
    const n = sn[1]!;
    if (gameSports) return `game ${n}`;
    if (setSports) return `set ${n}`;
    if (quarterSports) return `quarter ${n}`;
    if (periodSports) return `period ${n}`;
    if (inningSports) return `inning ${n}`;
    if (halfSports) return `half ${n}`;
    return `segment ${n}`;
  }
  const hn = p.match(/^h(\d+)$/);
  if (hn) return `half ${hn[1]}`;
  const qn = p.match(/^q(\d+)$/);
  if (qn) return `quarter ${qn[1]}`;
  const pn = p.match(/^p(\d+)$/);
  if (pn) return `period ${pn[1]}`;
  const inn = p.match(/^(?:i|inn)(\d+)$/);
  if (inn) return `inning ${inn[1]}`;
  if (p === 'ot' || p === 'overtime') return 'overtime';
  if (p === 'so' || p === 'shootout') return 'shootout';
  if (p === 'fg' || p === 'f5') return p === 'f5' ? 'first 5 innings' : raw;
  const generic = periodLabel(raw);
  return generic !== raw ? generic : raw;
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
  sportHint?: string | null,
  feedSportId?: number | string | null
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
      label: labelPeriodId(periodId, sportHint, feedSportId),
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

/** Internal: stream-list plane probe (used by lookupEvent). */
async function lookupStreamListEvent(
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

/** Internal: skin_events plane probe. */
function lookupSkinEvent(
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

/** Internal: Statscore catalog cache probe. */
async function lookupBookedCatalog(
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

/** Internal: short coefficient probe for one event id. */
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
    periodMissing: false,
    book: null as CoefficientBookState | null,
    eventState: null as EventOfferability | null,
    eventDataBoard: null as EventDataBoardSummary | null,
  };

  if (pandoraSeconds > 0) {
    try {
      const p = await probePandoraEvent(Number(eventId), {
        seconds: pandoraSeconds,
        WebSocketImpl: options.WebSocketImpl,
        pandoraHost: options.pandoraHost,
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
        periodMissing,
        book: p.book,
        eventState: p.eventState,
        eventDataBoard: p.eventDataBoard,
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
      if (p.eventState) {
        const es = p.eventState;
        notes.push(
          `eventData state=${es.state}(${es.stateLabel})` +
            (es.wireState != null && es.wireState !== es.state
              ? ` wire_s=${es.wireState}`
              : '') +
            ` hasLines=${es.hasLines} isStarted=${es.isStarted} OTB=${es.offTheBoard}` +
            (es.sportName ? ` sport=${es.sportName}` : '') +
            (es.blockedReason ? ` ${es.blockedReason}` : '') +
            (es.home || es.away
              ? ` · ${es.home ?? '?'} vs ${es.away ?? '?'}`
              : '')
        );
        if (es.offTheBoard) {
          notes.push(
            'event off the board (mainapp isOTB): finished|notBettable|blocked|!hasOdds' +
              (es.blockedReason ? ` (groupProfile ${es.blockedReason})` : '')
          );
        }
      } else if (p.eventDataBoard) {
        notes.push(
          `eventData board loaded (${p.eventDataBoard.eventCount} events) but id not under s[sport][country][league]`
        );
      }
      if (p.blocked && p.blocked.sports.size) {
        notes.push(
          `groupProfile blocked sports=[${[...p.blocked.sports].join(',')}] leagues=${p.blocked.leagues.size}`
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
        'odds-off: coeff empty o / selection_off / market_off; eventData s=0..3 + l hasLines; cls=limit-class not suspend'
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
  // Prefer Pandora feedSportId → SportId SSOT over period inference
  // (TT uses s1/s2 and was mis-labeled tennis from lines alone).
  if (pandora.eventState?.sportId) {
    const sid = sportIdFromFeedSportId(pandora.eventState.sportId);
    sportHint =
      sid ??
      feedSportSlug(pandora.eventState.sportId) ??
      pandora.eventState.sportName?.toLowerCase().replace(/\s+/g, '_') ??
      null;
  }
  if (!sportHint && streamHit?.sport?.trim()) {
    sportHint = streamHit.sport.toLowerCase().replace(/\s+/g, '_');
  } else if (!sportHint && skin?.sport?.trim()) {
    sportHint = skin.sport.trim();
  } else if (!sportHint && catalog?.sportName?.trim()) {
    sportHint = catalog.sportName.toLowerCase().replace(/\s+/g, '_');
  } else if (!sportHint) {
    sportHint = inferSportHintFromLines(allLines, streamHit?.bucket ?? null);
  }

  // Re-label periods with feedSportId bake + sport hint for display
  const feedSportId = pandora.eventState?.sportId ?? null;
  if (pandora.periods.length && (feedSportId != null || sportHint)) {
    pandora.periods = summarizePeriods(
      eventId,
      // rebuild from full line set if we still have them on filtered-only display
      allLines.length ? allLines : pandora.lines,
      sportHint,
      feedSportId
    );
  }

  if (sportHint || feedSportId != null) {
    notes.push(
      `period_labels=` +
        (feedSportId != null ? `feed=${feedSportId}` : 'hint') +
        (sportHint ? ` sport=${sportHint}` : '') +
        ' (bake > hint > generic)'
    );
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
