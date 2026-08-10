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
  applyCoefficientDiff,
  decodeEventOfferability,
  diffEventDataOfferability,
  diffOfferFingerprints,
  extractCoefficientLines,
  findEventInEventDataBoard,
  isEventDataBoardPayload,
  parseEventDataDiffPath,
  parseLiveSportsNames,
  parsePandoraBlocked,
  scanEventDataBoard,
  summarizeEventDataBoard,
  type CoefficientBookState,
  type CoefficientLine,
  type EventDataBoardScan,
  type EventDataBoardSummary,
  type EventDataStateTransition,
  type EventOfferability,
  type OfferTransition,
  type PandoraBlockedSets,
} from '../partner/fantasy-ultra/coefficients.ts';
import {
  pandoraMarketLabel,
  describeCoefficientSelection,
  formatSetCorrectScoreLineId,
} from '../partner/fantasy-ultra/market-decode.ts';
import {
  PANDORA_DEFAULT_SESSION,
  PandoraSocket,
} from '../partner/fantasy-ultra/pandora-socket.ts';
import type { PandoraHostId } from '../partner/fantasy-ultra/pandora-hosts.ts';
import {
  resolvePandoraHostId,
} from '../partner/fantasy-ultra/pandora-hosts.ts';
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
    pandoraHost?: PandoraHostId | string;
  } = {}
): Promise<{
  subscribed: boolean;
  lines: CoefficientLine[];
  markets: PartnerMarket[];
  eventDataKeys: string[];
  book: CoefficientBookState | null;
  lastPayload: unknown | null;
  eventState: EventOfferability | null;
  eventDataBoard: EventDataBoardSummary | null;
  sportsNames: Map<string, string>;
  blocked: PandoraBlockedSets | null;
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 8, 2), 30);
  const store = new CoefficientStore();
  let subscribed = false;
  let eventDataKeys: string[] = [];
  let lastPayload: unknown | null = null;
  let eventDataBoardPayload: unknown | null = null;
  let sportsPayload: unknown | null = null;
  let blockedRaw: unknown | null = null;

  const host = resolvePandoraHostId(options.pandoraHost);

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          // subscribeLive already includes bulk `${main}.eventData` + live.sports
          sock.subscribeLive({ eventIds: [eventId] });
        },
        onEvent: (name, args) => {
          if (name.includes(`eventCoefficients.${eventId}`)) subscribed = true;
          if (Array.isArray(args?.[0]) && String(args[0][0] ?? '').includes(String(eventId))) {
            subscribed = true;
          }
        },
        onCoefficients: info => {
          if (info.room === 'live.sports' && !info.envelope.isDiff) {
            sportsPayload = info.envelope.payload;
            return;
          }
          if (
            info.room.includes('groupProfile') &&
            !info.envelope.isDiff &&
            info.envelope.payload &&
            typeof info.envelope.payload === 'object'
          ) {
            const gp = info.envelope.payload as { blocked?: unknown };
            if (gp.blocked != null) blockedRaw = gp.blocked;
            return;
          }
          if (info.room.includes('eventData')) {
            const p = info.envelope.payload;
            if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
              eventDataBoardPayload = p;
              eventDataKeys = Object.keys(p as object).slice(0, 24);
            } else if (
              info.envelope.isDiff &&
              eventDataBoardPayload &&
              typeof eventDataBoardPayload === 'object' &&
              Array.isArray(p)
            ) {
              eventDataBoardPayload = applyCoefficientDiff(
                eventDataBoardPayload as Record<string, unknown>,
                p
              );
            }
            return;
          }
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

  const sportsNames = parseLiveSportsNames(sportsPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const boardHit = eventDataBoardPayload
    ? findEventInEventDataBoard(eventDataBoardPayload, eventId)
    : null;
  const eventState = boardHit
    ? decodeEventOfferability(boardHit, {
        coeffLineCount: lines.length,
        sportsNames,
        blocked,
        board: eventDataBoardPayload,
      })
    : null;
  const eventDataBoard = eventDataBoardPayload
    ? summarizeEventDataBoard(eventDataBoardPayload)
    : null;

  return {
    subscribed,
    lines,
    markets: store.toPartnerMarkets().filter(m => m.oddsEventId === String(eventId)),
    eventDataKeys,
    book,
    lastPayload,
    eventState,
    eventDataBoard,
    sportsNames,
    blocked,
  };
}

/**
 * Capture full eventData board + live.sports names + groupProfile.blocked.
 * Used by `domain:event --board`.
 */
export async function scanPandoraEventBoard(
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    pandoraHost?: PandoraHostId | string;
  } = {}
): Promise<{
  scan: EventDataBoardScan | null;
  sportsNames: Map<string, string>;
  blocked: PandoraBlockedSets | null;
  seconds: number;
  host: PandoraHostId;
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 10, 3), 45);
  const host = resolvePandoraHostId(options.pandoraHost);
  let boardPayload: unknown | null = null;
  let sportsPayload: unknown | null = null;
  let blockedRaw: unknown | null = null;

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({});
        },
        onCoefficients: info => {
          if (info.room === 'live.sports' && !info.envelope.isDiff) {
            sportsPayload = info.envelope.payload;
            return;
          }
          if (
            info.room.includes('groupProfile') &&
            !info.envelope.isDiff &&
            info.envelope.payload &&
            typeof info.envelope.payload === 'object'
          ) {
            const gp = info.envelope.payload as { blocked?: unknown };
            if (gp.blocked != null) blockedRaw = gp.blocked;
            return;
          }
          if (!info.room.includes('eventData')) return;
          if (info.room.includes('eventCoefficients')) return;
          const p = info.envelope.payload;
          if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
            boardPayload = p;
          } else if (
            info.envelope.isDiff &&
            boardPayload &&
            typeof boardPayload === 'object' &&
            Array.isArray(p)
          ) {
            boardPayload = applyCoefficientDiff(
              boardPayload as Record<string, unknown>,
              p
            );
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

  const sportsNames = parseLiveSportsNames(sportsPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const scan = boardPayload
    ? scanEventDataBoard(boardPayload, { sportsNames, blocked })
    : null;

  return { scan, sportsNames, blocked, seconds, host };
}

export function formatEventBoardScan(
  scan: EventDataBoardScan,
  options: {
    sportFilter?: string | null;
    bettableOnly?: boolean;
    otbOnly?: boolean;
    limit?: number;
    blocked?: PandoraBlockedSets | null;
  } = {}
): string {
  const limit = Math.min(Math.max(options.limit ?? 40, 5), 200);
  const lines: string[] = [];
  const s = scan.summary;
  lines.push(
    `eventData board  sports=${s.sportCount} events=${s.eventCount}  ` +
      `db=${s.dbCount} kb=${s.kbCount}`
  );
  lines.push(
    `  effective: bettableWithLines=${scan.bettableWithLines}  OTB=${scan.offTheBoard}  ` +
      `blockedOverlay=${scan.blockedOverlayCount}`
  );
  lines.push(
    `  byState: ${Object.entries(scan.byState)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`
  );
  if (options.blocked) {
    lines.push(
      `  groupProfile.blocked: sports=[${[...options.blocked.sports].join(',')}]  ` +
        `leagues=${options.blocked.leagues.size}  events=${options.blocked.events.size}`
    );
  }
  lines.push('');
  lines.push('## By feed sport (live.sports id — not ticket apiSportId)');
  lines.push(
    '  id   name              n  bettable  lines  OTB  fin  notBett  blocked'
  );
  for (const r of scan.bySport) {
    const name = (r.sportName ?? '?').padEnd(16).slice(0, 16);
    lines.push(
      `  ${r.sportId.padStart(3)}  ${name}  ${String(r.total).padStart(3)}  ` +
        `${String(r.bettable).padStart(8)}  ${String(r.hasLines).padStart(5)}  ` +
        `${String(r.offTheBoard).padStart(3)}  ${String(r.finished).padStart(3)}  ` +
        `${String(r.notBettable).padStart(7)}  ${String(r.blocked).padStart(7)}`
    );
  }

  let list = scan.events;
  if (options.sportFilter) {
    const f = options.sportFilter;
    list = list.filter(
      e =>
        e.sportId === f ||
        (e.sportName && e.sportName.toLowerCase() === f.toLowerCase())
    );
  }
  if (options.bettableOnly) {
    list = list.filter(e => e.state === 0 && e.hasLines && !e.offTheBoard);
  }
  if (options.otbOnly) {
    list = list.filter(e => e.offTheBoard);
  }
  // prefer interesting first: bettable with lines, then others
  list = [...list].sort((a, b) => {
    const score = (e: EventOfferability) =>
      (e.state === 0 && e.hasLines ? 0 : 10) +
      (e.offTheBoard ? 1 : 0) +
      (e.blockedReason ? 0.5 : 0);
    return score(a) - score(b) || a.eventId - b.eventId;
  });

  lines.push('');
  lines.push(
    `## Events (showing ${Math.min(limit, list.length)}/${list.length}` +
      (options.sportFilter ? ` sport=${options.sportFilter}` : '') +
      (options.bettableOnly ? ' bettable+lines' : '') +
      (options.otbOnly ? ' OTB only' : '') +
      ')'
  );
  for (const e of list.slice(0, limit)) {
    const teams =
      e.home || e.away
        ? `${e.home ?? '?'} vs ${e.away ?? '?'}`
        : '(no teams)';
    const blk = e.blockedReason ? ` [${e.blockedReason}]` : '';
    const wire =
      e.wireState != null && e.wireState !== e.state
        ? ` wire_s=${e.wireState}`
        : '';
    lines.push(
      `  ${e.eventId}  s=${e.state}(${e.stateLabel})${wire}  l=${e.hasLines}  ` +
        `OTB=${e.offTheBoard}  ${e.sportName ?? e.sportId ?? '?'}${blk}`
    );
    lines.push(`    ${teams}  #!/event/${e.eventId}/m`);
  }
  lines.push('');
  lines.push(
    'note: feed sport ids from live.sports (1=Baseball 2=Basketball 5=Soccer 8=Tennis 93=TT …); ' +
      'ticket apiSportId map differs (legacy tennis=2). blocked sports force notBettable (calculateState).'
  );
  return lines.join('\n');
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
  eventState: EventOfferability | null;
  eventTransitions: EventDataStateTransition[];
};

/**
 * Watch coefficient book + eventData board for offer transitions.
 * Primary market signals: selection_off / market_off.
 * Primary event signals: state s→2|3, hasLines l→false (OTB).
 */
export async function watchEventOdds(
  eventId: number,
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    pandoraHost?: PandoraHostId | string;
    onUpdate?: (u: OddsWatchUpdate) => void;
  } = {}
): Promise<OddsWatchUpdate[]> {
  const seconds = Math.min(Math.max(options.seconds ?? 30, 5), 300);
  const host = resolvePandoraHostId(options.pandoraHost);
  const store = new CoefficientStore();
  const history: OddsWatchUpdate[] = [];
  let prevLines: CoefficientLine[] = [];
  let lastPayload: unknown | null = null;
  let boardPayload: Record<string, unknown> | null = null;
  let prevEventState: EventOfferability | null = null;

  const emitUpdate = (
    transitions: OfferTransition[],
    eventTransitions: EventDataStateTransition[],
    force = false
  ) => {
    const lines = store.getLines(eventId);
    const book = lastPayload
      ? analyzeCoefficientBook(eventId, lastPayload)
      : lines.length
        ? analyzeCoefficientBook(eventId, {
            id: eventId,
            c: rebuildCFromLines(lines),
          })
        : null;
    const hit = boardPayload
      ? findEventInEventDataBoard(boardPayload, eventId)
      : null;
    const eventState = hit
      ? decodeEventOfferability(hit, { coeffLineCount: lines.length })
      : null;
    const et =
      eventTransitions.length > 0
        ? eventTransitions
        : diffEventDataOfferability(prevEventState, eventState);

    if (
      !force &&
      transitions.length === 0 &&
      et.length === 0 &&
      prevLines.length > 0
    ) {
      prevEventState = eventState;
      return;
    }

    const u: OddsWatchUpdate = {
      at: new Date().toISOString(),
      eventId,
      lineCount: lines.length,
      offeredMarketCount: book?.offeredMarketCount ?? 0,
      transitions,
      book,
      eventState,
      eventTransitions: et,
    };
    history.push(u);
    options.onUpdate?.(u);
    prevLines = lines;
    prevEventState = eventState;
  };

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({ eventIds: [eventId] });
        },
        onCoefficients: info => {
          if (info.room.includes('eventData')) {
            const p = info.envelope.payload;
            if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
              boardPayload = p as Record<string, unknown>;
              emitUpdate([], [], prevLines.length === 0);
            } else if (
              info.envelope.isDiff &&
              boardPayload &&
              Array.isArray(p)
            ) {
              const relevant = (p as Array<{ path?: string; op?: string; value?: unknown }>).filter(
                op => {
                  if (!op?.path) return false;
                  const parsed = parseEventDataDiffPath(op.path);
                  return parsed.eventId === eventId;
                }
              );
              boardPayload = applyCoefficientDiff(boardPayload, p);
              if (relevant.length > 0 || prevLines.length === 0) {
                const eventTransitions: EventDataStateTransition[] = [];
                for (const op of relevant) {
                  const parsed = parseEventDataDiffPath(op.path!);
                  if (parsed.field === 'l' && typeof op.value === 'boolean') {
                    eventTransitions.push({
                      kind: 'lines_flag',
                      eventId,
                      hasLines: op.value,
                    });
                  } else if (parsed.field === 's' || parsed.field === 'ip' || parsed.field === 'il') {
                    eventTransitions.push({
                      kind: 'state_change',
                      eventId,
                      field: parsed.field,
                      to: op.value,
                    });
                  } else if (op.op === 'remove' && parsed.field === '_node') {
                    eventTransitions.push({ kind: 'event_removed', eventId });
                  }
                }
                emitUpdate([], eventTransitions);
              }
            }
            return;
          }
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
          emitUpdate(transitions, [], prevLines.length === 0);
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
  // Prefer eventData feed sport (isTableTennis ⇒ 93) over period inference —
  // TT also uses s1/s2 and was mis-labeled tennis from lines alone.
  if (pandora.eventState?.sportName?.trim()) {
    sportHint = pandora.eventState.sportName
      .toLowerCase()
      .replace(/\s+/g, '_');
  } else if (pandora.eventState?.sportId === '93') {
    sportHint = 'table_tennis';
  } else if (pandora.eventState?.sportId === '8') {
    sportHint = 'tennis';
  } else if (streamHit?.sport?.trim()) {
    sportHint = streamHit.sport.toLowerCase().replace(/\s+/g, '_');
  } else if (skin?.sport?.trim()) {
    sportHint = skin.sport.trim();
  } else if (catalog?.sportName?.trim()) {
    sportHint = catalog.sportName.toLowerCase().replace(/\s+/g, '_');
  } else {
    sportHint = inferSportHintFromLines(allLines, streamHit?.bucket ?? null);
  }
  if (!sportHint && pandora.eventState?.sportId) {
    sportHint = `feed_sport_${pandora.eventState.sportId}`;
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
    if (r.pandora.eventDataBoard) {
      const b = r.pandora.eventDataBoard;
      lines.push(
        `  board sports=${b.sportCount} events=${b.eventCount} db=${b.dbCount} kb=${b.kbCount}` +
          (b.offlineFlags ? ` offlineFlags=${b.offlineFlags.filter(Boolean).length}/${b.offlineFlags.length}` : '')
      );
    }
    if (r.pandora.eventState) {
      const es = r.pandora.eventState;
      const wire =
        es.wireState != null && es.wireState !== es.state
          ? ` wire_s=${es.wireState}`
          : '';
      lines.push(
        `  eventState s=${es.state}(${es.stateLabel})${wire} hasLines=${es.hasLines} ` +
          `isStarted=${es.isStarted} isLive=${es.isLive} OTB=${es.offTheBoard}` +
          (es.sportName ? ` sport=${es.sportName}` : '') +
          (es.blockedReason ? ` ${es.blockedReason}` : '')
      );
      if (es.home || es.away) {
        lines.push(
          `    ${es.home ?? '?'} vs ${es.away ?? '?'}  path=s/${es.path.join('/')}` +
            (es.startTimeSec != null
              ? ` start=${new Date(es.startTimeSec * 1000).toISOString()}`
              : '') +
            (es.donbestId ? ` db=${es.donbestId}` : '')
        );
      } else if (es.path.length) {
        lines.push(
          `    path=s/${es.path.join('/')}` +
            (es.donbestId ? ` db=${es.donbestId}` : '')
        );
      }
    }
    if (r.pandora.book) {
      const b = r.pandora.book;
      lines.push(
        `  book offeredMarkets=${b.offeredMarketCount} offMarkets=${b.offMarketCount} lines=${b.lineCount}`
      );
      const offered = b.markets.filter(m => m.offered).slice(0, 16);
      if (offered.length) {
        lines.push(
          `    markets: ${offered
            .map(
              m =>
                `${m.period}/${m.marketType}(${pandoraMarketLabel(m.marketType)})` +
                (m.line != null ? ` r=${m.line}` : '')
            )
            .join(', ')}`
        );
      }
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
      // market 16 set correct score decode samples
      const scs = r.pandora.lines
        .filter(l => l.marketType === '16')
        .slice(0, 8);
      if (scs.length) {
        lines.push(
          `    set_correct_score (m/16 lineId=p1<<16|p2): ${scs
            .map(l => {
              const lab =
                formatSetCorrectScoreLineId(l.selection) ?? l.selection;
              return `${lab}@${l.decimal.toFixed(2)}`;
            })
            .join('  ')}`
        );
      }
      // game winner samples (TT s*/18)
      const gw = r.pandora.lines
        .filter(l => l.marketType === '18')
        .slice(0, 6);
      if (gw.length) {
        lines.push(
          `    game_winner (18): ${gw
            .map(l =>
              describeCoefficientSelection(l.marketType, l.selection, {
                sideIndex: l.sideIndex,
              }) + `=${l.decimal.toFixed(2)}`
            )
            .join('  ')}`
        );
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
