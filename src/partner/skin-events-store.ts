// @see https://bun.com/docs/runtime/sqlite
/**
 * Persist Buckeye / Fantasy402 stream inventory (stream-list-v2) into skin_events.
 *
 * One row per stream_id covers both plive and ezlive (shared Plive shell).
 */
import type { Database } from 'bun:sqlite';
import {
  isBookId,
  isSkinId,
  resolveBookId,
  resolveSport,
  streamEndpointsForLiveProduct,
  type BookId,
  type LiveProductId,
  type SkinId,
} from '../domain/index.ts';
import { getSkin } from '../domain/skins.ts';
import type { PartnerLiveEvent } from './types.ts';

/** Default inventory identity for Fantasy402 stream-list under Buckeye. */
export type InventoryIdentity = {
  partner: string;
  skinId: SkinId;
  bookId: BookId;
  inventoryLiveProduct: LiveProductId;
};

export function buckeyeInventoryIdentity(): InventoryIdentity {
  const bookId = resolveBookId('fantasy402');
  if (!bookId) throw new Error('BookId fantasy402 missing from BOOKS catalog');
  return {
    partner: 'fantasy402',
    skinId: 'buckeye',
    bookId,
    inventoryLiveProduct: 'plive',
  };
}

/**
 * Live products covered by the inventory shell for a skin.
 * Buckeye → plive + ezlive (shared SportsWidgets stream feed).
 */
export function liveProductsCoveredByInventory(skinId: string): LiveProductId[] {
  if (!isSkinId(skinId)) return [];
  const skin = getSkin(skinId);
  if (!skin) return [];
  return skin.offeredLiveProducts.filter(p => streamEndpointsForLiveProduct(p) != null);
}

/** Normalize wire sport labels toward canonical SportId when mapped on plive. */
export function normalizeInventorySport(wire: string): string {
  const raw = wire.trim();
  if (!raw) return '';
  const bucket = raw.toLowerCase().replace(/\s+/g, '_');
  const byBucket = resolveSport({ liveProduct: 'plive', streamBucket: bucket });
  if (byBucket) return byBucket.sportId;
  const spaced = raw.toLowerCase().replace(/_/g, ' ');
  if (spaced.includes('table tennis')) {
    const tt = resolveSport({ liveProduct: 'plive', streamBucket: 'table_tennis' });
    if (tt) return tt.sportId;
  }
  if (spaced === 'tennis' || (spaced.includes('tennis') && !spaced.includes('table'))) {
    const t = resolveSport({ liveProduct: 'plive', streamBucket: 'tennis' });
    if (t) return t.sportId;
  }
  return bucket;
}

export type SkinEventRow = {
  partner: string;
  streamId: string;
  lsId: string | null;
  clientEventId: string | null;
  sport: string;
  league: string;
  home: string | null;
  away: string | null;
  feedId: string | null;
  startTime: number | null;
  status: string;
  firstSeen: number;
  lastUpdated: number;
  skinId: SkinId;
  bookId: BookId;
  inventoryLiveProduct: LiveProductId;
};

export type SkinEventUpsertResult = {
  inserted: SkinEventRow[];
  updated: SkinEventRow[];
  seen: number;
};

export function listSkinStreamIds(db: Database, partner: string): Set<string> {
  const rows = db
    .query(`SELECT stream_id AS streamId FROM skin_events WHERE partner = $p`)
    .all({ $p: partner }) as Array<{ streamId: string }>;
  return new Set(rows.map(r => String(r.streamId)));
}

export function liveEventToRow(
  event: PartnerLiveEvent,
  nowMs: number,
  identity: InventoryIdentity,
  existing?: { firstSeen: number; status?: string }
): SkinEventRow {
  const streamId = event.streamId != null ? String(event.streamId) : String(event.eventId || '');
  return {
    partner: identity.partner,
    streamId,
    lsId: null,
    clientEventId: null,
    sport: normalizeInventorySport(event.sport),
    league: event.league,
    home: event.home,
    away: event.away,
    feedId: event.feedId != null ? String(event.feedId) : null,
    startTime: null,
    status: existing?.status ?? 'unknown',
    firstSeen: existing?.firstSeen ?? nowMs,
    lastUpdated: nowMs,
    skinId: identity.skinId,
    bookId: identity.bookId,
    inventoryLiveProduct: identity.inventoryLiveProduct,
  };
}

export type UpsertSkinLiveEventsOptions = {
  nowMs?: number;
  identity?: InventoryIdentity;
};

/**
 * Upsert live inventory rows. Returns which stream_ids were newly inserted.
 * Stamps Buckeye / Fantasy402 / plive-shell by default.
 */
export function upsertSkinLiveEvents(
  db: Database,
  events: PartnerLiveEvent[],
  options: UpsertSkinLiveEventsOptions = {}
): SkinEventUpsertResult {
  const nowMs = options.nowMs ?? Date.now();
  const identity = options.identity ?? buckeyeInventoryIdentity();
  const insert = db.query(`
    INSERT INTO skin_events (
      partner, stream_id, ls_id, client_event_id, sport, league, home, away,
      feed_id, start_time, status, first_seen, last_updated,
      skin_id, book_id, inventory_live_product
    ) VALUES (
      $partner, $stream_id, $ls_id, $client_event_id, $sport, $league, $home, $away,
      $feed_id, $start_time, $status, $first_seen, $last_updated,
      $skin_id, $book_id, $inventory_live_product
    )
    ON CONFLICT(partner, stream_id) DO UPDATE SET
      sport = excluded.sport,
      league = excluded.league,
      home = excluded.home,
      away = excluded.away,
      feed_id = excluded.feed_id,
      last_updated = excluded.last_updated,
      skin_id = excluded.skin_id,
      book_id = excluded.book_id,
      inventory_live_product = excluded.inventory_live_product
  `);

  const inserted: SkinEventRow[] = [];
  const updated: SkinEventRow[] = [];

  const partnerSets = new Map<string, Set<string>>();
  const getSet = (partner: string) => {
    let s = partnerSets.get(partner);
    if (!s) {
      s = listSkinStreamIds(db, partner);
      partnerSets.set(partner, s);
    }
    return s;
  };

  for (const event of events) {
    const set = getSet(identity.partner);
    const streamId = event.streamId != null ? String(event.streamId) : String(event.eventId || '');
    if (!streamId) continue;
    const isNew = !set.has(streamId);
    const row = liveEventToRow(event, nowMs, identity, {
      firstSeen: nowMs,
      status: 'unknown',
    });
    insert.run({
      $partner: row.partner,
      $stream_id: row.streamId,
      $ls_id: row.lsId,
      $client_event_id: row.clientEventId,
      $sport: row.sport,
      $league: row.league,
      $home: row.home,
      $away: row.away,
      $feed_id: row.feedId,
      $start_time: row.startTime,
      $status: row.status,
      $first_seen: row.firstSeen,
      $last_updated: row.lastUpdated,
      $skin_id: row.skinId,
      $book_id: row.bookId,
      $inventory_live_product: row.inventoryLiveProduct,
    });
    if (isNew) {
      set.add(streamId);
      inserted.push(row);
    } else {
      updated.push(row);
    }
  }

  return { inserted, updated, seen: events.length };
}

/** Filter PartnerLiveEvent by sport (table tennis, tennis, …). */
export function filterLiveEventsBySport(
  events: PartnerLiveEvent[],
  sport: string
): PartnerLiveEvent[] {
  const want = sport.trim().toLowerCase().replace(/_/g, ' ');
  if (!want || want === 'all') return events;
  return events.filter(e => {
    const s = e.sport.toLowerCase().replace(/_/g, ' ');
    if (want === 'table tennis' || want === 'tabletennis') {
      return s.includes('table tennis') || s === 'table tennis';
    }
    if (want === 'tennis') {
      // exact tennis, not table tennis
      return s === 'tennis' || (s.includes('tennis') && !s.includes('table'));
    }
    return s === want || s.includes(want);
  });
}

export function formatSkinEventLine(row: SkinEventRow): string {
  const matchup = [row.home, row.away].filter(Boolean).join(' vs ') || 'TBD';
  const idBits = [row.skinId ? `skin=${row.skinId}` : '', row.bookId ? `book=${row.bookId}` : '']
    .filter(Boolean)
    .join(' ');
  const suffix = idBits ? ` · ${idBits}` : '';
  return `${row.sport} · ${row.league || '—'} · ${matchup} · stream=${row.streamId}${suffix}`;
}

/** Resolve watch-CLI skin/book flags (Buckeye / Fantasy402 only for this tool). */
export function resolveWatchInventoryIdentity(input: {
  skin?: string;
  book?: string;
}): InventoryIdentity {
  const defaults = buckeyeInventoryIdentity();
  const skinRaw = (input.skin ?? defaults.skinId).trim().toLowerCase();
  const bookRaw = (input.book ?? defaults.bookId).trim().toLowerCase();
  if (!isSkinId(skinRaw) || skinRaw !== 'buckeye') {
    throw new Error(
      `partner:watch-events supports --skin=buckeye only (got ${skinRaw || '(empty)'})`
    );
  }
  const bookId = resolveBookId(bookRaw);
  if (!bookId || bookId !== 'fantasy402') {
    throw new Error(
      `partner:watch-events supports --book=fantasy402 only (got ${bookRaw || '(empty)'})`
    );
  }
  if (!isBookId(bookId)) {
    throw new Error(`Invalid BookId: ${bookRaw}`);
  }
  return {
    partner: defaults.partner,
    skinId: 'buckeye',
    bookId,
    inventoryLiveProduct: 'plive',
  };
}
