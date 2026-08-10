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
  parseLiveCountryNames,
  parseLiveLeagueNames,
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
  formatMarketVigRows,
  vigFromCoefficientLines,
  type MarketVigRow,
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

type EventLookupOptions = {
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
async function probePandoraEvent(
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
  let leaguesPayload: unknown | null = null;
  let countriesPayload: unknown | null = null;
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
          if (info.room === 'live.leagues' && !info.envelope.isDiff) {
            leaguesPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.countries' && !info.envelope.isDiff) {
            countriesPayload = info.envelope.payload;
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
  const leagueNames = parseLiveLeagueNames(leaguesPayload);
  const countryNames = parseLiveCountryNames(countriesPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const boardHit = eventDataBoardPayload
    ? findEventInEventDataBoard(eventDataBoardPayload, eventId)
    : null;
  const eventState = boardHit
    ? decodeEventOfferability(boardHit, {
        coeffLineCount: lines.length,
        sportsNames,
        leagueNames,
        countryNames,
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
  let leaguesPayload: unknown | null = null;
  let countriesPayload: unknown | null = null;
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
          if (info.room === 'live.leagues' && !info.envelope.isDiff) {
            leaguesPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.countries' && !info.envelope.isDiff) {
            countriesPayload = info.envelope.payload;
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
  const leagueNames = parseLiveLeagueNames(leaguesPayload);
  const countryNames = parseLiveCountryNames(countriesPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const scan = boardPayload
    ? scanEventDataBoard(boardPayload, {
        sportsNames,
        leagueNames,
        countryNames,
        blocked,
      })
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
  lines.push('## By feed sport (feed id ≠ widget id)');
  lines.push(
    ...mdTable(
      [
        'Feed',
        'Name',
        'SportId',
        'n',
        'Bettable',
        'Lines',
        'OTB',
        'Fin',
        'NotBett',
      ],
      scan.bySport.map(r => [
        r.sportId,
        r.sportName ?? '—',
        r.canonicalSportId ?? '—',
        String(r.total),
        String(r.bettable),
        String(r.hasLines),
        String(r.offTheBoard),
        String(r.finished),
        String(r.notBettable),
      ])
    )
  );

  let list = scan.events;
  if (options.sportFilter) {
    const f = options.sportFilter.trim().toLowerCase();
    list = list.filter(e => {
      if (e.sportId === f || e.sportId === options.sportFilter) return true;
      if (e.canonicalSportId?.toLowerCase() === f) return true;
      if (e.sportName?.toLowerCase() === f) return true;
      if (e.sportName?.toLowerCase().replace(/\s+/g, '_') === f) return true;
      return false;
    });
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
  lines.push(
    ...mdTable(
      [
        'Event',
        'State',
        'L',
        'OTB',
        'Feed',
        'SportId',
        'League',
        'Match',
      ],
      list.slice(0, limit).map(e => [
        String(e.eventId),
        e.stateLabel,
        e.hasLines == null ? '—' : e.hasLines ? 'Y' : 'N',
        e.offTheBoard ? 'Y' : 'N',
        e.sportId
          ? `${e.sportId}${e.sportName ? ` ${e.sportName}` : ''}`
          : '—',
        e.canonicalSportId ?? '—',
        e.leagueName
          ? e.leagueName.slice(0, 24)
          : (e.leagueId ?? '—'),
        e.home || e.away
          ? `${e.home ?? '?'} vs ${e.away ?? '?'}`
          : '—',
      ])
    )
  );
  lines.push('');
  lines.push(
    'note: feed id (eventData) ≠ widget sportOrder ≠ ticket api. ' +
      'SSOT: domain/pandora-feed-sports.ts · blocked → notBettable.'
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

/** Public watch tick — live-tracker + odds-watch tests import this shape. */
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

/** One market suspend interval (off → on). */
type SuspensionInterval = {
  period: string;
  marketType: string;
  offAt: string;
  onAt: string | null;
  durationMs: number | null;
};

type OddsWatchSummary = {
  eventId: number;
  updates: number;
  transitionCounts: Record<string, number>;
  suspensions: SuspensionInterval[];
  openSuspensions: number;
  suspensionCount: number;
  /** Closed suspension durations only. */
  medianSuspensionMs: number | null;
  meanSuspensionMs: number | null;
  byMarketTransitions: Array<{
    period: string;
    marketType: string;
    off: number;
    on: number;
    priceChanges: number;
  }>;
  /** Vig snapshot from last book with lines. */
  vig: MarketVigRow[];
  lastLineCount: number;
  lastOfferedMarkets: number;
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? (s[mid - 1]! + s[mid]!) / 2
    : s[mid]!;
}

/**
 * Aggregate watch history: suspension intervals (market_off → market_on)
 * and per-market transition counts.
 */
export function summarizeOddsWatch(
  history: OddsWatchUpdate[],
  options: { lastLines?: CoefficientLine[] } = {}
): OddsWatchSummary {
  const eventId = history[0]?.eventId ?? 0;
  const transitionCounts: Record<string, number> = {};
  const byMk = new Map<
    string,
    { period: string; marketType: string; off: number; on: number; priceChanges: number }
  >();
  const open = new Map<string, string>(); // key → offAt ISO
  const suspensions: SuspensionInterval[] = [];

  const bumpMk = (
    period: string,
    marketType: string,
    field: 'off' | 'on' | 'priceChanges'
  ) => {
    const k = `${period}\0${marketType}`;
    const mutable = byMk.get(k) ?? {
      period,
      marketType,
      off: 0,
      on: 0,
      priceChanges: 0,
    };
    mutable[field]++;
    byMk.set(k, mutable);
  };

  for (const u of history) {
    for (const t of u.transitions) {
      transitionCounts[t.kind] = (transitionCounts[t.kind] ?? 0) + 1;
      if (t.kind === 'market_off') {
        bumpMk(t.period, t.marketType, 'off');
        const k = `${t.period}\0${t.marketType}`;
        if (!open.has(k)) open.set(k, u.at);
      } else if (t.kind === 'market_on') {
        bumpMk(t.period, t.marketType, 'on');
        const k = `${t.period}\0${t.marketType}`;
        const offAt = open.get(k);
        if (offAt) {
          const durationMs = Math.max(
            0,
            Date.parse(u.at) - Date.parse(offAt)
          );
          suspensions.push({
            period: t.period,
            marketType: t.marketType,
            offAt,
            onAt: u.at,
            durationMs: Number.isFinite(durationMs) ? durationMs : null,
          });
          open.delete(k);
        }
      } else if (t.kind === 'price_change') {
        bumpMk(t.period, t.marketType, 'priceChanges');
      } else if (t.kind === 'selection_off') {
        bumpMk(t.period, t.marketType, 'off');
      } else if (t.kind === 'selection_on') {
        bumpMk(t.period, t.marketType, 'on');
      }
    }
  }

  // still open at end of watch
  for (const [k, offAt] of open) {
    const [period, marketType] = k.split('\0') as [string, string];
    suspensions.push({
      period,
      marketType,
      offAt,
      onAt: null,
      durationMs: null,
    });
  }

  const closedMs = suspensions
    .map(s => s.durationMs)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const last = history[history.length - 1];
  const vigLines = options.lastLines ?? [];

  return {
    eventId,
    updates: history.length,
    transitionCounts,
    suspensions,
    openSuspensions: [...open.keys()].length,
    suspensionCount: suspensions.filter(s => s.onAt != null).length,
    medianSuspensionMs: median(closedMs),
    meanSuspensionMs: closedMs.length
      ? closedMs.reduce((a, b) => a + b, 0) / closedMs.length
      : null,
    byMarketTransitions: [...byMk.values()].sort(
      (a, b) => b.off + b.on + b.priceChanges - (a.off + a.on + a.priceChanges)
    ),
    vig: vigLines.length ? vigFromCoefficientLines(vigLines) : [],
    lastLineCount: last?.lineCount ?? 0,
    lastOfferedMarkets: last?.offeredMarketCount ?? 0,
  };
}

export function formatOddsWatchSummary(s: OddsWatchSummary): string {
  const lines: string[] = [];
  lines.push(`# Watch summary · event ${s.eventId}`);
  lines.push('');
  lines.push(
    ...mdTable(
      ['Metric', 'Value'],
      [
        ['Updates', String(s.updates)],
        ['Lines (last)', String(s.lastLineCount)],
        ['Offered mkts', String(s.lastOfferedMarkets)],
        ['Suspensions closed', String(s.suspensionCount)],
        ['Suspensions open', String(s.openSuspensions)],
        [
          'Median suspend',
          s.medianSuspensionMs != null
            ? `${(s.medianSuspensionMs / 1000).toFixed(1)}s`
            : '—',
        ],
        [
          'Mean suspend',
          s.meanSuspensionMs != null
            ? `${(s.meanSuspensionMs / 1000).toFixed(1)}s`
            : '—',
        ],
      ]
    )
  );
  const tcRows = Object.entries(s.transitionCounts).map(([k, v]) => [
    k,
    String(v),
  ]);
  if (tcRows.length) {
    lines.push('');
    lines.push('## Transitions');
    lines.push(...mdTable(['Kind', 'Count'], tcRows));
  }
  if (s.suspensions.length) {
    lines.push('');
    lines.push('## Suspension intervals');
    lines.push(
      ...mdTable(
        ['Mkt', 'Off', 'On', 'Duration'],
        s.suspensions.slice(0, 20).map(x => [
          `${x.period}/${x.marketType}`,
          x.offAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
          x.onAt
            ? x.onAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')
            : '—',
          x.durationMs != null
            ? `${(x.durationMs / 1000).toFixed(1)}s`
            : 'open',
        ])
      )
    );
  }
  if (s.byMarketTransitions.length) {
    lines.push('');
    lines.push('## Activity by market');
    lines.push(
      ...mdTable(
        ['Mkt', 'Name', 'Off', 'On', 'Price chg'],
        s.byMarketTransitions.slice(0, 14).map(m => [
          `${m.period}/${m.marketType}`,
          pandoraMarketLabel(m.marketType),
          String(m.off),
          String(m.on),
          String(m.priceChanges),
        ])
      )
    );
  }
  if (s.vig.length) {
    lines.push('');
    lines.push('## Vig (last snapshot)');
    lines.push(
      ...mdTable(
        ['Mkt', 'Name', 'Kind', 'Vig', 'Σ imp', 'Legs'],
        s.vig.slice(0, 12).map(v => [
          `${v.period}/${v.marketType}`,
          v.label,
          v.kind,
          `${v.vigPercent.toFixed(2)}%`,
          v.impliedSum.toFixed(3),
          String(v.prices.length),
        ])
      )
    );
  }
  return lines.join('\n');
}

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
): Promise<OddsWatchUpdate[] & { lastLines: CoefficientLine[] }> {
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

  const out = history as OddsWatchUpdate[] & { lastLines: CoefficientLine[] };
  out.lastLines = store.getLines(eventId);
  return out;
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

/** Markdown table from header + row cells (equal column counts). */
function mdTable(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return [];
  const cols = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const pad = (cells: string[]) =>
    '| ' +
    cells
      .map((c, i) => (c ?? '').padEnd(widths[i] ?? 0))
      .join(' | ') +
    ' |';
  const sep =
    '| ' + widths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |';
  return [pad(headers), sep, ...rows.map(r => pad(r.slice(0, cols)))];
}

function fmtAm(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtDec(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

/** Build market price summary cell from lines for period/marketType. */
function marketPriceCell(
  all: CoefficientLine[],
  period: string,
  marketType: string
): string {
  const group = all.filter(
    l => l.period === period && l.marketType === marketType
  );
  if (!group.length) return '—';
  if (marketType === '3' || marketType === '9') {
    const h = group.find(l => l.selection === '1');
    const a = group.find(l => l.selection === '2');
    if (h && a) {
      return `1 ${fmtAm(h.american)} (${fmtDec(h.decimal)}) · 2 ${fmtAm(a.american)} (${fmtDec(a.decimal)})`;
    }
  }
  if (
    marketType === '5' ||
    marketType === '6' ||
    marketType === '7' ||
    marketType === '8'
  ) {
    // pick first selection with both sides
    const bySel = new Map<string, { 0?: CoefficientLine; 1?: CoefficientLine }>();
    for (const l of group) {
      const slot = bySel.get(l.selection) ?? {};
      if (l.sideIndex === 0 || l.sideIndex === 1) slot[l.sideIndex] = l;
      bySel.set(l.selection, slot);
    }
    for (const [sel, sides] of bySel) {
      if (sides[0] && sides[1]) {
        return `${sel}: ${fmtDec(sides[0].decimal)} / ${fmtDec(sides[1].decimal)}`;
      }
    }
    const withLine = group.find(l => l.line != null);
    if (withLine?.line != null) return `line ${withLine.line}`;
  }
  if (marketType === '16') {
    const prim = new Map<string, number>();
    for (const l of group) {
      if (l.decimal < 1.05) continue;
      const prev = prim.get(l.selection);
      if (prev == null || l.decimal > prev) prim.set(l.selection, l.decimal);
    }
    return [...prim.entries()]
      .slice(0, 4)
      .map(
        ([sel, d]) =>
          `${formatSetCorrectScoreLineId(sel) ?? sel}@${fmtDec(d)}`
      )
      .join(' ');
  }
  if (marketType === '18') {
    const byGame = new Map<string, { 0?: number; 1?: number }>();
    for (const l of group) {
      const slot = byGame.get(l.selection) ?? {};
      if (l.sideIndex === 0 || l.sideIndex === 1) slot[l.sideIndex] = l.decimal;
      byGame.set(l.selection, slot);
    }
    return [...byGame.entries()]
      .slice(0, 4)
      .map(([g, s]) => `g${g} ${fmtDec(s[0])}/${fmtDec(s[1])}`)
      .join(' · ');
  }
  return `${group.length} legs`;
}

export function formatEventLookup(r: EventLookupResult): string {
  const lines: string[] = [];
  const es = r.pandora.eventState;
  const matchup =
    es?.home || es?.away
      ? `${es.home ?? '?'} vs ${es.away ?? '?'}`
      : r.streamList.event
        ? `${r.streamList.event.home ?? '?'} vs ${r.streamList.event.away ?? '?'}`
        : '—';

  lines.push(
    `# Event ${r.eventId}` +
      (r.periodId ? ` / ${r.periodId}` : '') +
      (r.sportHint ? ` · ${r.sportHint}` : '')
  );
  lines.push('');
  lines.push(...mdTable(
    ['Field', 'Value'],
    [
      ['Match', matchup],
      [
        'Sport',
        es?.canonicalSportId
          ? `${es.canonicalSportId} · feed=${es.sportId} (${es.sportName ?? '?'})`
          : (es?.sportName ?? r.sportHint ?? '—'),
      ],
      [
        'League',
        es?.leagueName
          ? `${es.leagueName} (${es.leagueId ?? '?'})`
          : (es?.leagueId ?? '—'),
      ],
      [
        'Country',
        es?.countryName
          ? `${es.countryName} (${es.countryId ?? '?'})`
          : (es?.countryId ?? '—'),
      ],
      [
        'State',
        es
          ? `s=${es.state}(${es.stateLabel})` +
            (es.wireState != null && es.wireState !== es.state
              ? ` wire=${es.wireState}`
              : '')
          : '—',
      ],
      [
        'Offer',
        es
          ? `hasLines=${es.hasLines} started=${es.isStarted} OTB=${es.offTheBoard}` +
            (es.blockedReason ? ` ${es.blockedReason}` : '')
          : '—',
      ],
      ['Plane', r.plane],
      ['Path', es?.path?.length ? `s/${es.path.join('/')}` : '—'],
      [
        'Start',
        es?.startTimeSec != null
          ? new Date(es.startTimeSec * 1000).toISOString()
          : '—',
      ],
      ['URL', r.pliveUrl],
      [
        'Book',
        r.pandora.book
          ? `${r.pandora.book.offeredMarketCount} offered / ${r.pandora.book.offMarketCount} off · ${r.pandora.lineCount} lines (${r.pandora.seconds}s)`
          : r.pandora.probed
            ? `${r.pandora.lineCount} lines`
            : 'skipped',
      ],
      [
        'Board',
        r.pandora.eventDataBoard
          ? `sports=${r.pandora.eventDataBoard.sportCount} events=${r.pandora.eventDataBoard.eventCount}`
          : '—',
      ],
      [
        'Inventory',
        r.streamList.hit
          ? `stream-list ✓ ${r.streamList.event?.bucket ?? ''}`
          : 'stream-list ✗',
      ],
      [
        'Catalog',
        r.bookedCatalog
          ? `${r.bookedCatalog.sportName}: ${r.bookedCatalog.name}`
          : '✗',
      ],
    ]
  ));

  if (r.pandora.probed && r.pandora.periods.length) {
    lines.push('');
    lines.push('## Periods');
    lines.push(
      ...mdTable(
        ['Period', 'Label', 'Lines', 'Markets', 'ML (am)', 'Total', 'Spread', 'Focus'],
        r.pandora.periods.map(p => [
          p.periodId,
          p.label,
          String(p.lineCount),
          p.marketTypes
            .map(m => `${m}:${pandoraMarketLabel(m).slice(0, 8)}`)
            .join(', '),
          p.moneyline
            ? `${fmtAm(p.moneyline.homeAmerican)} / ${fmtAm(p.moneyline.awayAmerican)}`
            : '—',
          p.totalLine != null ? String(p.totalLine) : '—',
          p.spreadLine != null ? String(p.spreadLine) : '—',
          r.periodId === p.periodId ? '←' : '',
        ])
      )
    );
  }

  if (r.pandora.probed && r.pandora.book) {
    const b = r.pandora.book;
    const feedId = r.pandora.eventState?.sportId ?? null;
    const periodLabelById = new Map(
      r.pandora.periods.map(p => [p.periodId, p.label] as const)
    );
    const periodCell = (period: string) => {
      const lab =
        periodLabelById.get(period) ??
        labelPeriodId(period, r.sportHint, feedId);
      return lab && lab !== period ? `${period} · ${lab}` : period;
    };
    const vigByKey = new Map(
      vigFromCoefficientLines(r.pandora.lines).map(
        v => [`${v.period}/${v.marketType}`, v] as const
      )
    );
    const offered = b.markets.filter(m => m.offered);
    if (offered.length) {
      lines.push('');
      const sportCol =
        r.pandora.eventState?.canonicalSportId ??
        r.sportHint ??
        (feedId != null ? String(feedId) : '—');
      lines.push('## Markets (offered)');
      lines.push(
        ...mdTable(
          ['Sport', 'Period', 'Mkt type', 'Name', 'Line (r)', 'Vig', 'cls', 'Prices'],
          offered.map(m => {
            const vig = vigByKey.get(`${m.period}/${m.marketType}`);
            return [
              sportCol,
              periodCell(m.period),
              String(m.marketType),
              pandoraMarketLabel(m.marketType),
              m.line != null ? String(m.line) : '—',
              vig ? fmtPct(vig.vigPercent) : '—',
              m.clsDefault != null ? String(m.clsDefault) : '—',
              marketPriceCell(r.pandora.lines, m.period, m.marketType),
            ];
          })
        )
      );
    }
    const off = b.markets.filter(m => !m.offered);
    if (off.length) {
      const sportCol =
        r.pandora.eventState?.canonicalSportId ??
        r.sportHint ??
        (feedId != null ? String(feedId) : '—');
      lines.push('');
      lines.push('## Markets (off / empty o)');
      lines.push(
        ...mdTable(
          ['Sport', 'Period', 'Mkt type', 'Name', 'Line'],
          off.slice(0, 16).map(m => [
            sportCol,
            periodCell(m.period),
            String(m.marketType),
            pandoraMarketLabel(m.marketType),
            m.line != null ? String(m.line) : '—',
          ])
        )
      );
    }
  }

  const feedForLabels = r.pandora.eventState?.sportId ?? null;
  const periodLab = (period: string) =>
    labelPeriodId(period, r.sportHint, feedForLabels);

  // Set correct score table
  const scsLines = r.pandora.lines.filter(
    l => l.marketType === '16' && l.decimal >= 1.05
  );
  if (scsLines.length) {
    const byPeriod = new Map<string, CoefficientLine[]>();
    for (const l of scsLines) {
      const arr = byPeriod.get(l.period) ?? [];
      arr.push(l);
      byPeriod.set(l.period, arr);
    }
    for (const [period, pls] of byPeriod) {
      const best = new Map<string, CoefficientLine>();
      for (const l of pls) {
        const prev = best.get(l.selection);
        if (!prev || l.decimal > prev.decimal) best.set(l.selection, l);
      }
      lines.push('');
      lines.push(
        `## Set correct score (${period}/16 · ${periodLab(period)})`
      );
      lines.push(
        ...mdTable(
          ['Score', 'LineId', 'Decimal', 'American', 'Implied'],
          [...best.values()]
            .sort((a, b) => Number(a.selection) - Number(b.selection))
            .map(l => {
              const imp = 1 / l.decimal;
              return [
                formatSetCorrectScoreLineId(l.selection) ?? l.selection,
                l.selection,
                fmtDec(l.decimal),
                fmtAm(l.american),
                Number.isFinite(imp) ? `${(imp * 100).toFixed(1)}%` : '—',
              ];
            })
        )
      );
    }
  }

  // Game winner table
  const gwLines = r.pandora.lines.filter(l => l.marketType === '18');
  if (gwLines.length) {
    const byKey = new Map<
      string,
      { period: string; game: string; p1?: number; p2?: number; p1am?: number; p2am?: number }
    >();
    for (const l of gwLines) {
      const k = `${l.period}\0${l.selection}`;
      const row =
        byKey.get(k) ??
        ({ period: l.period, game: l.selection } as {
          period: string;
          game: string;
          p1?: number;
          p2?: number;
          p1am?: number;
          p2am?: number;
        });
      if (l.sideIndex === 0) {
        row.p1 = l.decimal;
        row.p1am = l.american;
      } else if (l.sideIndex === 1) {
        row.p2 = l.decimal;
        row.p2am = l.american;
      } else if (row.p1 == null) {
        row.p1 = l.decimal;
        row.p1am = l.american;
      } else {
        row.p2 = l.decimal;
        row.p2am = l.american;
      }
      byKey.set(k, row);
    }
    lines.push('');
    lines.push('## Game winner (18)');
    lines.push(
      ...mdTable(
        ['Period', 'Game', 'P1 dec', 'P1 am', 'P2 dec', 'P2 am', 'Vig'],
        [...byKey.values()]
          .sort(
            (a, b) =>
              a.period.localeCompare(b.period) ||
              Number(a.game) - Number(b.game)
          )
          .map(row => {
            let vig = '—';
            if (row.p1 != null && row.p2 != null && row.p1 > 1 && row.p2 > 1) {
              const sum = 1 / row.p1 + 1 / row.p2;
              vig = fmtPct((sum - 1) * 100);
            }
            return [
              periodLab(row.period),
              row.game,
              fmtDec(row.p1),
              fmtAm(row.p1am),
              fmtDec(row.p2),
              fmtAm(row.p2am),
              vig,
            ];
          })
      )
    );
  }

  if (r.pandora.probed) {
    const vigRows = vigFromCoefficientLines(r.pandora.lines);
    if (vigRows.length) {
      lines.push('');
      const sportCol =
        r.pandora.eventState?.canonicalSportId ?? r.sportHint ?? '—';
      lines.push('## Vig (overround)');
      lines.push(
        ...mdTable(
          ['Sport', 'Period', 'Mkt type', 'Name', 'Kind', 'Vig', 'Σ implied', 'Legs'],
          vigRows.map(v => [
            sportCol,
            periodLab(v.period),
            String(v.marketType),
            v.label,
            v.kind,
            fmtPct(v.vigPercent),
            v.impliedSum.toFixed(3),
            String(v.prices.length),
          ])
        )
      );
    }
  }

  if (!r.pandora.probed) {
    lines.push('');
    lines.push('_pandora skipped_');
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
