// @see https://bun.com/docs/runtime/sqlite
/**
 * Persist Buckeye / Fantasy402 stream inventory (stream-list-v2) into skin_events.
 *
 * One row per inventory_id covers both plive and ezlive (shared Plive shell).
 * Wire field `stream_id` is mapped to interior `inventoryId` at parse.
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
import { parseStreamList } from '../partner/fantasy-ultra/parse.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import type { InventoryEvent } from '../partner/types.ts';

/** Default inventory identity for Fantasy402 stream-list under Buckeye. */
export type InventoryIdentity = {
  /**
   * @deprecated Deprecated mirror of `bookId` written to skin_events.partner.
   * Not a FactoryWager seat partner CODE — do not use as identity.
   */
  partner: string;
  skinId: SkinId;
  bookId: BookId;
  inventoryLiveProduct: LiveProductId;
};

export function buckeyeInventoryIdentity(): InventoryIdentity {
  const bookId = resolveBookId('fantasy402');
  if (!bookId) throw new Error('BookId fantasy402 missing from BOOKS catalog');
  return {
    partner: bookId,
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
  const byBucket = resolveSport({ liveProduct: 'plive', inventoryBucket: bucket });
  if (byBucket) return byBucket.sportId;
  const spaced = raw.toLowerCase().replace(/_/g, ' ');
  if (spaced.includes('table tennis')) {
    const tt = resolveSport({ liveProduct: 'plive', inventoryBucket: 'table_tennis' });
    if (tt) return tt.sportId;
  }
  if (spaced === 'tennis' || (spaced.includes('tennis') && !spaced.includes('table'))) {
    const t = resolveSport({ liveProduct: 'plive', inventoryBucket: 'tennis' });
    if (t) return t.sportId;
  }
  return bucket;
}

/** Resolve stream-list league → CompetitionId (null when unseeded / junk). */
export function resolveInventoryCompetitionId(input: {
  liveProduct: LiveProductId;
  sport: string;
  league: string;
  /** Wire stream bucket when known (e.g. football). Do not pass SportId here. */
  inventoryBucket?: string;
}): CompetitionId | null {
  const sport = input.sport.trim();
  const bucket = input.inventoryBucket?.trim().toLowerCase() || undefined;
  // Never pass sportId as inventoryBucket — soccer ≠ football stream bucket.
  const hit = resolveCompetition({
    liveProduct: input.liveProduct,
    league: input.league,
    ...(isSportId(sport) ? { sportId: sport } : {}),
    ...(bucket && bucket !== sport ? { inventoryBucket: bucket } : {}),
  });
  return hit?.competitionId ?? null;
}

export type SkinEventRow = {
  /** @deprecated Mirror of bookId — identity is (bookId, inventoryId). */
  partner: string;
  inventoryId: string;
  lsId: string | null;
  oddsEventId: string | null;
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

type SkinEventUpsertResult = {
  inserted: SkinEventRow[];
  updated: SkinEventRow[];
  seen: number;
};

/** List inventory ids for a book (identity key — not seat partner). */
export function listSkinInventoryIds(db: Database, bookId: string): Set<string> {
  const rows = db
    .query(`SELECT inventory_id AS inventoryId FROM skin_events WHERE book_id = $b`)
    .all({ $b: bookId }) as Array<{ inventoryId: string }>;
  return new Set(rows.map(r => String(r.inventoryId)));
}

/** SSOT InventoryEvent → skin row (upsert + dry-run plan). */
function liveEventToRow(
  event: InventoryEvent,
  nowMs: number,
  identity: InventoryIdentity,
  existing?: { firstSeen: number; status?: string }
): SkinEventRow {
  const inventoryId = String(event.inventoryId ?? '').trim();
  const sport = normalizeInventorySport(event.sport);
  const league = event.league ?? '';
  return {
    partner: identity.bookId,
    inventoryId,
    lsId: null,
    oddsEventId: null,
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

type UpsertSkinLiveEventsOptions = {
  nowMs?: number;
  identity?: InventoryIdentity;
  /** Plan only — no SQLite writes (same stamps as live upsert). */
  dryRun?: boolean;
};

/**
 * Upsert live inventory rows. Returns which inventory_ids were newly inserted.
 * Stamps Buckeye / Fantasy402 / plive-shell by default.
 * `dryRun: true` → plan insert/update without writing (replaces forked mappers).
 */
export function upsertSkinLiveEvents(
  db: Database,
  events: InventoryEvent[],
  options: UpsertSkinLiveEventsOptions = {}
): SkinEventUpsertResult {
  const nowMs = options.nowMs ?? Date.now();
  const identity = options.identity ?? buckeyeInventoryIdentity();
  const dryRun = options.dryRun === true;

  const inserted: SkinEventRow[] = [];
  const updated: SkinEventRow[] = [];

  const bookSets = new Map<string, Set<string>>();
  const getSet = (bookId: string) => {
    let s = bookSets.get(bookId);
    if (!s) {
      s = listSkinInventoryIds(db, bookId);
      bookSets.set(bookId, s);
    }
    return s;
  };

  const insert = dryRun
    ? null
    : db.query(`
    INSERT INTO skin_events (
      partner, inventory_id, ls_id, odds_event_id, sport, league, home, away,
      feed_id, start_time, status, first_seen, last_updated,
      skin_id, book_id, inventory_live_product, competition_id
    ) VALUES (
      $partner, $inventory_id, $ls_id, $odds_event_id, $sport, $league, $home, $away,
      $feed_id, $start_time, $status, $first_seen, $last_updated,
      $skin_id, $book_id, $inventory_live_product, $competition_id
    )
    ON CONFLICT(book_id, inventory_id) DO UPDATE SET
      partner = excluded.partner,
      sport = excluded.sport,
      league = excluded.league,
      home = excluded.home,
      away = excluded.away,
      feed_id = excluded.feed_id,
      last_updated = excluded.last_updated,
      skin_id = excluded.skin_id,
      inventory_live_product = excluded.inventory_live_product,
      competition_id = excluded.competition_id
  `);

  let seen = 0;
  for (const event of events) {
    const set = getSet(identity.bookId);
    const inventoryId = String(event.inventoryId ?? '').trim();
    if (!inventoryId) continue;
    seen++;
    const isNew = !set.has(inventoryId);
    const row = liveEventToRow(event, nowMs, identity, {
      firstSeen: nowMs,
      status: 'unknown',
    });
    if (!dryRun && insert) {
      insert.run({
        $partner: row.bookId,
        $inventory_id: row.inventoryId,
        $ls_id: row.lsId,
        $odds_event_id: row.oddsEventId,
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
    }
    if (isNew) {
      set.add(inventoryId);
      inserted.push(row);
    } else {
      updated.push(row);
    }
  }

  return { inserted, updated, seen };
}

/**
 * Filter coverage-catalog InventoryEvent rows by sport.
 *
 * Matches on **normalized sportId** (via {@link normalizeInventorySport}), not raw
 * wire labels — so `--sport=soccer` includes stream bucket `Football`, and
 * `football` does **not** pull in American Football.
 */
export function filterLiveEventsBySport(
  events: InventoryEvent[],
  sport: string
): InventoryEvent[] {
  const wantRaw = sport.trim();
  if (!wantRaw || wantRaw.toLowerCase() === 'all') return events;
  const wantId =
    normalizeInventorySport(wantRaw) || normalizeSportToken(wantRaw);
  if (!wantId) return events;

  return events.filter(e => {
    const eventId =
      normalizeInventorySport(e.sport) ||
      e.sport.toLowerCase().replace(/\s+/g, '_');
    return eventId === wantId;
  });
}

/**
 * Parsed `--sport` selection for inventory watch/sync.
 * - `all` — full board
 * - `sports` — one or more tokens (CSV); multi-sport fetches full board then filters
 */
export type InventorySportSelection =
  | { kind: 'all' }
  | { kind: 'sports'; sports: string[] };

/** Canonical sport token: trim, collapse whitespace → `_`, lowercase aliases. */
export function normalizeSportToken(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!t) return '';
  if (t === 'tabletennis' || t === 'table_tennis') return 'table_tennis';
  return t;
}

/**
 * Parse `--sport` CSV (spaces around commas OK).
 *
 * | Input | Result |
 * | ----- | ------ |
 * | `all` | full board |
 * | `table_tennis` | single sport |
 * | `table_tennis, tennis` | multi (spaces trimmed) |
 * | `table_tennis,tennis,all` | `all` wins if any token is all |
 * | empty / whitespace | `all` |
 */
export function parseInventorySportsCsv(raw: string | undefined | null): InventorySportSelection {
  if (raw == null) return { kind: 'all' };
  const parts = raw
    .split(',')
    .map(p => normalizeSportToken(p))
    .filter(Boolean);
  if (parts.length === 0) return { kind: 'all' };
  if (parts.some(p => p === 'all')) return { kind: 'all' };
  const seen = new Set<string>();
  const sports: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    sports.push(p);
  }
  return { kind: 'sports', sports };
}

/** Stable display / report string (`all` or `table_tennis,tennis`). */
export function formatInventorySportSelection(sel: InventorySportSelection): string {
  return sel.kind === 'all' ? 'all' : sel.sports.join(',');
}

/**
 * Stream fetch sport arg: single token as-is; multi-sport and `all` → `all`
 * (client-side filter after full board).
 */
export function resolveInventoryFetchSport(sel: InventorySportSelection): string {
  if (sel.kind === 'all') return 'all';
  if (sel.sports.length === 1) return sel.sports[0]!;
  return 'all';
}

/** Filter events by selection (union for multi-sport; tennis ≠ table tennis). */
export function filterLiveEventsBySports(
  events: InventoryEvent[],
  sel: InventorySportSelection
): InventoryEvent[] {
  if (sel.kind === 'all') return events;
  if (sel.sports.length === 0) return events;
  if (sel.sports.length === 1) {
    return filterLiveEventsBySport(events, sel.sports[0]!);
  }
  const seen = new Set<string>();
  const out: InventoryEvent[] = [];
  for (const sport of sel.sports) {
    for (const e of filterLiveEventsBySport(events, sport)) {
      if (seen.has(e.inventoryId)) continue;
      seen.add(e.inventoryId);
      out.push(e);
    }
  }
  return out;
}

/** Sport string for booked-catalog narrow (undefined when all or multi). */
export function inventorySportForCatalogFetch(
  sel: InventorySportSelection
): string | undefined {
  if (sel.kind === 'all') return undefined;
  if (sel.sports.length === 1) return sel.sports[0];
  return undefined;
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
  return `${row.sport} · ${row.league || '—'} · ${matchup} · inv=${row.inventoryId}${suffix}`;
}

/**
 * Public Plive shell stream-list → InventoryEvent[] (no Fantasy402 login).
 * Covers Buckeye plive + ezlive inventory.
 */
export async function fetchPublicPliveStreamEvents(
  options: {
    sport?: string;
    fetchImpl?: typeof fetch;
    /** When true, use only disk cache (tests / offline). */
    cacheOnly?: boolean;
    /** Override disk cache path (tests). */
    cachePath?: string;
    /** Skip writing disk cache (tests / one-shot). */
    skipCacheWrite?: boolean;
  } = {}
): Promise<InventoryEvent[]> {
  const { fetchPublicStreamListWire } = await import('./stream-list-fetch.ts');
  // Injected fetchImpl (tests): isolate from operator disk cache so a live watch
  // cannot poison unit fixtures.
  const isolate = options.fetchImpl != null;
  const cachePath =
    options.cachePath ??
    (isolate ? `/tmp/inventory-stream-list-test-${process.pid}.json` : undefined);
  const { wire } = await fetchPublicStreamListWire({
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.cacheOnly !== undefined ? { cacheOnly: options.cacheOnly } : {}),
    ...(cachePath !== undefined ? { cachePath } : {}),
    skipCacheWrite: options.skipCacheWrite ?? isolate,
  });
  return parseStreamList(wire, { sport: options.sport ?? 'all' });
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
      `inventory:watch supports --skin=buckeye only (got ${skinRaw || '(empty)'})`
    );
  }
  const bookId = resolveBookId(bookRaw);
  if (!bookId || bookId !== 'fantasy402') {
    throw new Error(
      `inventory:watch supports --book=fantasy402 only (got ${bookRaw || '(empty)'})`
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
