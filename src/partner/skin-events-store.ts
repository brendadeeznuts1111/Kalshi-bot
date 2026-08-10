// @see https://bun.com/docs/runtime/sqlite
/**
 * Persist Buckeye / Fantasy402 stream inventory (stream-list-v2) into skin_events.
 *
 * One row per stream_id covers both plive and ezlive (shared Plive shell).
 */
import type { Database } from 'bun:sqlite';
import {
  isBookId,
  isLiveProductId,
  isSkinId,
  isSportId,
  resolveBookId,
  resolveCompetition,
  resolveSport,
  streamEndpointsForLiveProduct,
  type BookId,
  type CompetitionId,
  type LiveProductId,
  type SkinId,
} from '../domain/index.ts';
import { getSkin } from '../domain/skins.ts';
import { parseStreamList } from './fantasy-ultra/parse.ts';
import { FANTASY_ULTRA_DEFAULTS } from './fantasy-ultra/types.ts';
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

/** Resolve stream-list league → CompetitionId (null when unseeded / junk). */
export function resolveInventoryCompetitionId(input: {
  liveProduct: LiveProductId;
  sport: string;
  league: string;
}): CompetitionId | null {
  const sport = input.sport.trim();
  const hit = resolveCompetition({
    liveProduct: input.liveProduct,
    league: input.league,
    sportId: isSportId(sport) ? sport : undefined,
    streamBucket: sport || undefined,
  });
  return hit?.competitionId ?? null;
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
  /** Seeded CompetitionId when league maps; null for unknown wire labels. */
  competitionId: CompetitionId | null;
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
  const sport = normalizeInventorySport(event.sport);
  const league = event.league ?? '';
  return {
    partner: identity.partner,
    streamId,
    lsId: null,
    clientEventId: null,
    sport,
    league,
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
    competitionId: resolveInventoryCompetitionId({
      liveProduct: identity.inventoryLiveProduct,
      sport,
      league,
    }),
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
      skin_id, book_id, inventory_live_product, competition_id
    ) VALUES (
      $partner, $stream_id, $ls_id, $client_event_id, $sport, $league, $home, $away,
      $feed_id, $start_time, $status, $first_seen, $last_updated,
      $skin_id, $book_id, $inventory_live_product, $competition_id
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
      inventory_live_product = excluded.inventory_live_product,
      competition_id = excluded.competition_id
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
      $competition_id: row.competitionId,
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
  const idBits = [
    row.skinId ? `skin=${row.skinId}` : '',
    row.bookId ? `book=${row.bookId}` : '',
    row.competitionId ? `comp=${row.competitionId}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const suffix = idBits ? ` · ${idBits}` : '';
  return `${row.sport} · ${row.league || '—'} · ${matchup} · stream=${row.streamId}${suffix}`;
}

/**
 * Public Plive shell stream-list → PartnerLiveEvent[] (no Fantasy402 login).
 * Covers Buckeye plive + ezlive inventory.
 */
export async function fetchPublicPliveStreamEvents(
  options: { sport?: string; fetchImpl?: typeof fetch } = {}
): Promise<PartnerLiveEvent[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(FANTASY_ULTRA_DEFAULTS.streamListUrl, {
    headers: {
      accept: 'application/json, text/plain, */*',
      origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
      referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `skin_events: stream-list HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`
    );
  }
  const json: unknown = await res.json();
  return parseStreamList(json, { sport: options.sport ?? 'all' });
}

/** Rewrite skin_events.sport toward canonical ids when resolvable. */
export function normalizeSkinEventsSports(db: Database): number {
  const rows = db.query(`SELECT rowid AS rid, sport FROM skin_events`).all() as Array<{
    rid: number;
    sport: string;
  }>;
  const upd = db.query(`UPDATE skin_events SET sport = $s WHERE rowid = $r`);
  let n = 0;
  for (const row of rows) {
    const next = normalizeInventorySport(row.sport ?? '');
    if (!next || next === row.sport) continue;
    upd.run({ $s: next, $r: row.rid });
    n += 1;
  }
  return n;
}

/** Stamp / refresh competition_id from sport + league (seeded mappings only). */
export function stampSkinEventsCompetitionIds(db: Database): number {
  const rows = db
    .query(
      `SELECT rowid AS rid, sport, league,
              inventory_live_product AS inv,
              competition_id AS competitionId
       FROM skin_events`
    )
    .all() as Array<{
    rid: number;
    sport: string;
    league: string;
    inv: string | null;
    competitionId: string | null;
  }>;
  const upd = db.query(`UPDATE skin_events SET competition_id = $c WHERE rowid = $r`);
  let n = 0;
  for (const row of rows) {
    const liveRaw = (row.inv ?? '').trim() || 'plive';
    const liveProduct: LiveProductId = isLiveProductId(liveRaw) ? liveRaw : 'plive';
    const next = resolveInventoryCompetitionId({
      liveProduct,
      sport: row.sport ?? '',
      league: row.league ?? '',
    });
    const prev = row.competitionId?.trim() || null;
    if (next === prev) continue;
    upd.run({ $c: next, $r: row.rid });
    n += 1;
  }
  return n;
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
