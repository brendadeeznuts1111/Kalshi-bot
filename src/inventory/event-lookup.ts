/**
 * Look up a plive deep-link event id across inventory + priced planes.
 *
 * Inventory: stream-list-v2 + skin_events
 * Priced: Pandora eventCoefficients.{id}
 * Metadata: Statscore booked catalog (odds_event_id match only)
 *
 *   bun run domain:event -- --id=197548901
 */
// @see https://bun.com/docs/api/fetch
// @see https://bun.com/docs/api/websockets
import type { Database } from 'bun:sqlite';
import { PLIVE_STREAM_ENDPOINTS } from '../domain/live-product-endpoints.ts';
import type { FetchFn } from '../institutions/resilient-fetch.ts';
import { openEventStore } from '../institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../institutions/event-store/paths.ts';
import { CoefficientStore } from '../partner/fantasy-ultra/coefficient-store.ts';
import type { CoefficientLine } from '../partner/fantasy-ultra/coefficients.ts';
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

export type EventLookupResult = {
  eventId: string;
  pliveUrl: string;
  plane: EventLookupPlane;
  streamList: { hit: boolean; event: StreamListEventHit | null };
  skinEvents: SkinEventHit | null;
  bookedCatalog: BookedCatalogHit | null;
  pandora: {
    probed: boolean;
    seconds: number;
    subscribed: boolean;
    lineCount: number;
    lines: CoefficientLine[];
    markets: Array<{
      ticker: string;
      label: string;
      homePrice: number | null;
      awayPrice: number | null;
      oddsEventId: string;
    }>;
    eventDataKeys: string[];
  };
  notes: string[];
};

export type EventLookupOptions = {
  eventId: string | number;
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

export function pliveEventUrl(eventId: string | number): string {
  const id = String(eventId).trim();
  return `${PLIVE_STREAM_ENDPOINTS.streamOrigin}${PLIVE_STREAM_ENDPOINTS.livePathPrefix}?#!/event/${id}?hideSidebar=true`;
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
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 8, 2), 30);
  const store = new CoefficientStore();
  let subscribed = false;
  let eventDataKeys: string[] = [];
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

  return {
    subscribed,
    lines: store.getLines(eventId),
    markets: store.toPartnerMarkets().filter(m => m.oddsEventId === String(eventId)),
    eventDataKeys,
  };
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

  let pandora = {
    probed: false,
    seconds: pandoraSeconds,
    subscribed: false,
    lineCount: 0,
    lines: [] as CoefficientLine[],
    markets: [] as EventLookupResult['pandora']['markets'],
    eventDataKeys: [] as string[],
  };

  if (pandoraSeconds > 0) {
    try {
      const p = await probePandoraEvent(Number(eventId), {
        seconds: pandoraSeconds,
        WebSocketImpl: options.WebSocketImpl,
      });
      pandora = {
        probed: true,
        seconds: pandoraSeconds,
        subscribed: p.subscribed,
        lineCount: p.lines.length,
        lines: p.lines.slice(0, 40),
        markets: p.markets.map(m => ({
          ticker: m.ticker,
          label: m.label ?? 'market',
          homePrice: m.homePrice ?? null,
          awayPrice: m.awayPrice ?? null,
          oddsEventId: m.oddsEventId,
        })),
        eventDataKeys: p.eventDataKeys,
      };
      if (p.lines.length === 0) {
        notes.push(
          'Pandora subscribed or timed out with 0 lines — event may be settled/off-book'
        );
      }
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
    notes.push('on inventory board but no coefficient lines in probe window');
  }

  const plane = classifyPlane({
    streamHit: !!streamHit,
    skin: !!skin,
    catalog: !!catalog,
    pandoraLines: pandora.lineCount,
  });

  return {
    eventId,
    pliveUrl: pliveEventUrl(eventId),
    plane,
    streamList: { hit: !!streamHit, event: streamHit },
    skinEvents: skin,
    bookedCatalog: catalog,
    pandora,
    notes,
  };
}

export function formatEventLookup(r: EventLookupResult): string {
  const lines: string[] = [];
  lines.push(`event-lookup id=${r.eventId} plane=${r.plane}`);
  lines.push(`  url ${r.pliveUrl}`);
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
      `  pandora ${r.pandora.subscribed ? '✓' : '?'} lines=${r.pandora.lineCount} (${r.pandora.seconds}s)`
    );
    const ml = r.pandora.lines.filter(l => l.period === 'm' && l.marketType === '3');
    if (ml.length) {
      const h = ml.find(l => l.selection === '1');
      const a = ml.find(l => l.selection === '2');
      lines.push(
        `    ML m/3  home am=${h?.american ?? '—'} dec=${h?.decimal ?? '—'}  away am=${a?.american ?? '—'} dec=${a?.decimal ?? '—'}`
      );
    }
    const totals = r.pandora.lines.filter(l => l.period === 'm' && l.marketType === '5');
    if (totals[0]?.line != null) {
      lines.push(`    Total m/5  line=${totals[0].line}`);
    }
    const spreads = r.pandora.lines.filter(l => l.period === 'm' && l.marketType === '6');
    if (spreads[0]?.line != null) {
      lines.push(`    Spread m/6 line=${spreads[0].line}`);
    }
    for (const m of r.pandora.markets.slice(0, 5)) {
      lines.push(
        `    market ${m.ticker} ${m.label} home=${m.homePrice ?? '—'} away=${m.awayPrice ?? '—'}`
      );
    }
    if (r.pandora.eventDataKeys.length) {
      lines.push(`    eventData keys: ${r.pandora.eventDataKeys.join(', ')}`);
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
    'planes: inventory=stream-list/skin_events · priced=Pandora coefficients · ezlive shares plive shell'
  );
  return lines.join('\n');
}
