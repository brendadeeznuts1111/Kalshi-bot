// @see https://bun.com/docs/runtime/sqlite
/**
 * Durable inventory league registry — survives inventory_id board churn.
 * Dimension: book + stream bucket + league label (not seat partner).
 */
import type { Database } from 'bun:sqlite';
import {
  getCompetition,
  normalizeLeagueKey,
  type CompetitionKind,
} from '../domain/competitions.ts';
import {
  inferCompetitionCountryCode,
  inferCompetitionKind,
  resolveCompetitionMeta,
} from '../domain/competition-meta.ts';
import { resolveCompetition } from '../domain/resolve-competition.ts';
import { isSportId } from '../domain/sports.ts';
import { listLiveProductSportBindings } from '../domain/live-product-sport-bindings.ts';
import { resolveInventoryCompetitionId, normalizeInventorySport } from './skin-events-store.ts';
import type { InventoryIdentity, SkinEventRow } from './skin-events-store.ts';
import type { InventoryEvent } from '../partner/types.ts';
import { buckeyeInventoryIdentity } from './skin-events-store.ts';

export type InventoryLeagueRow = {
  bookId: string;
  inventoryBucket: string;
  sportId: string;
  leagueKey: string;
  leagueKeyNorm: string;
  competitionId: string | null;
  eventCountLive: number;
  peakEventCount: number;
  firstSeen: number;
  lastSeen: number;
  sampleHome: string | null;
  sampleAway: string | null;
};

/** Desk geo/kind attached at display/JSON time (not stored on inventory_leagues). */
export type InventoryLeagueMetaView = {
  countryCode: string | null;
  kind: CompetitionKind;
  /** True when meta was inferred from label (not explicit competition seed fields). */
  inferred: boolean;
};

export type InventoryLeagueRowWithMeta = InventoryLeagueRow & {
  meta: InventoryLeagueMetaView;
};

export type InventoryLeagueUpsertResult = {
  seen: number;
  inserted: number;
  updated: number;
  newLeagues: InventoryLeagueRow[];
  /** All leagues observed on this poll (after merge plan). */
  liveLeagues: InventoryLeagueRow[];
};

export function ensureInventoryLeaguesSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS inventory_leagues (
    book_id TEXT NOT NULL,
    inventory_bucket TEXT NOT NULL,
    sport_id TEXT NOT NULL DEFAULT '',
    league_key TEXT NOT NULL,
    league_key_norm TEXT NOT NULL,
    competition_id TEXT,
    event_count_live INTEGER NOT NULL DEFAULT 0,
    peak_event_count INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    sample_home TEXT,
    sample_away TEXT,
    PRIMARY KEY (book_id, inventory_bucket, league_key_norm)
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_inventory_leagues_last_seen ON inventory_leagues (last_seen)`
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_inventory_leagues_sport ON inventory_leagues (sport_id)`
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_inventory_leagues_competition ON inventory_leagues (competition_id)`
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_inventory_leagues_unmapped ON inventory_leagues (book_id, competition_id)`
  );
}

/** Map normalized sport id → preferred stream inventory bucket (plive bindings). */
export function inventoryBucketForSport(sportId: string): string {
  const id = sportId.trim().toLowerCase();
  if (!id) return '';
  const hit = listLiveProductSportBindings('plive').find(b => b.sportId === id);
  return hit?.inventoryBucket ?? id;
}

type LeagueAgg = {
  sportId: string;
  inventoryBucket: string;
  leagueKey: string;
  leagueKeyNorm: string;
  eventCountLive: number;
  sampleHome: string | null;
  sampleAway: string | null;
  competitionId: string | null;
};

function aggregateLeaguesFromRows(
  rows: Array<{
    sport: string;
    league: string;
    home?: string | null;
    away?: string | null;
    competitionId?: string | null;
  }>,
  liveProduct: string
): LeagueAgg[] {
  const by = new Map<string, LeagueAgg>();
  for (const r of rows) {
    const leagueKey = String(r.league ?? '').trim();
    if (!leagueKey || leagueKey === '(unknown)') continue;
    const sportId = normalizeInventorySport(r.sport) || r.sport.trim().toLowerCase();
    const inventoryBucket = inventoryBucketForSport(sportId) || sportId;
    const leagueKeyNorm = normalizeLeagueKey(leagueKey);
    if (!leagueKeyNorm) continue;
    const pk = `${inventoryBucket}\0${leagueKeyNorm}`;
    let agg = by.get(pk);
    if (!agg) {
      const competitionId =
        r.competitionId !== undefined
          ? r.competitionId
          : resolveInventoryCompetitionId({
              liveProduct: liveProduct as 'plive',
              sport: sportId,
              league: leagueKey,
            });
      agg = {
        sportId,
        inventoryBucket,
        leagueKey,
        leagueKeyNorm,
        eventCountLive: 0,
        sampleHome: r.home ?? null,
        sampleAway: r.away ?? null,
        competitionId,
      };
      by.set(pk, agg);
    }
    agg.eventCountLive++;
    if (!agg.sampleHome && r.home) {
      agg.sampleHome = r.home;
      agg.sampleAway = r.away ?? null;
    }
  }
  return [...by.values()];
}

function leaguesFromSkinEventRows(
  rows: SkinEventRow[],
  identity?: InventoryIdentity
): LeagueAgg[] {
  const liveProduct = identity?.inventoryLiveProduct ?? 'plive';
  return aggregateLeaguesFromRows(
    rows.map(r => ({
      sport: r.sport,
      league: r.league,
      home: r.home,
      away: r.away,
      competitionId: r.competitionId,
    })),
    liveProduct
  );
}

function leaguesFromInventoryEvents(
  events: InventoryEvent[],
  identity?: InventoryIdentity
): LeagueAgg[] {
  const id = identity ?? buckeyeInventoryIdentity();
  return aggregateLeaguesFromRows(
    events.map(e => ({
      sport: e.sport,
      league: e.league ?? '',
      home: e.home,
      away: e.away,
    })),
    id.inventoryLiveProduct
  );
}

function existingLeagueKeys(
  db: Database,
  bookId: string
): Set<string> {
  const rows = db
    .query(
      `SELECT inventory_bucket AS b, league_key_norm AS n
       FROM inventory_leagues WHERE book_id = $book`
    )
    .all({ $book: bookId }) as Array<{ b: string; n: string }>;
  return new Set(rows.map(r => `${r.b}\0${r.n}`));
}

function existingPeaks(
  db: Database,
  bookId: string
): Map<string, { peak: number; firstSeen: number }> {
  const rows = db
    .query(
      `SELECT inventory_bucket AS b, league_key_norm AS n,
              peak_event_count AS peak, first_seen AS firstSeen
       FROM inventory_leagues WHERE book_id = $book`
    )
    .all({ $book: bookId }) as Array<{
    b: string;
    n: string;
    peak: number;
    firstSeen: number;
  }>;
  const m = new Map<string, { peak: number; firstSeen: number }>();
  for (const r of rows) {
    m.set(`${r.b}\0${r.n}`, { peak: Number(r.peak) || 0, firstSeen: Number(r.firstSeen) || 0 });
  }
  return m;
}

/** Plan league upsert without writing. */
export function planInventoryLeagues(
  db: Database,
  events: InventoryEvent[] | SkinEventRow[],
  options: { nowMs?: number; identity?: InventoryIdentity } = {}
): InventoryLeagueUpsertResult {
  ensureInventoryLeaguesSchema(db);
  const nowMs = options.nowMs ?? Date.now();
  const identity = options.identity ?? buckeyeInventoryIdentity();
  const aggs =
    events.length > 0 &&
    typeof (events[0] as SkinEventRow).inventoryId === 'string' &&
    typeof (events[0] as SkinEventRow).bookId === 'string'
      ? leaguesFromSkinEventRows(events as SkinEventRow[], identity)
      : leaguesFromInventoryEvents(events as InventoryEvent[], identity);

  const existing = existingLeagueKeys(db, identity.bookId);
  const peaks = existingPeaks(db, identity.bookId);
  const newLeagues: InventoryLeagueRow[] = [];
  const liveLeagues: InventoryLeagueRow[] = [];
  let inserted = 0;
  let updated = 0;

  for (const a of aggs) {
    const pk = `${a.inventoryBucket}\0${a.leagueKeyNorm}`;
    const prev = peaks.get(pk);
    const isNew = !existing.has(pk);
    const firstSeen = prev?.firstSeen && prev.firstSeen > 0 ? prev.firstSeen : nowMs;
    const peak = Math.max(prev?.peak ?? 0, a.eventCountLive);
    const row: InventoryLeagueRow = {
      bookId: identity.bookId,
      inventoryBucket: a.inventoryBucket,
      sportId: a.sportId,
      leagueKey: a.leagueKey,
      leagueKeyNorm: a.leagueKeyNorm,
      competitionId: a.competitionId,
      eventCountLive: a.eventCountLive,
      peakEventCount: peak,
      firstSeen,
      lastSeen: nowMs,
      sampleHome: a.sampleHome,
      sampleAway: a.sampleAway,
    };
    liveLeagues.push(row);
    if (isNew) {
      inserted++;
      newLeagues.push(row);
    } else {
      updated++;
    }
  }

  return {
    seen: aggs.length,
    inserted,
    updated,
    newLeagues,
    liveLeagues,
  };
}

/** Upsert leagues observed on this poll. Resets event_count_live for live keys; peaks grow. */
export function upsertInventoryLeagues(
  db: Database,
  events: InventoryEvent[] | SkinEventRow[],
  options: { nowMs?: number; identity?: InventoryIdentity; dryRun?: boolean } = {}
): InventoryLeagueUpsertResult {
  ensureInventoryLeaguesSchema(db);
  if (options.dryRun) {
    return planInventoryLeagues(db, events, options);
  }

  const nowMs = options.nowMs ?? Date.now();
  const identity = options.identity ?? buckeyeInventoryIdentity();
  const plan = planInventoryLeagues(db, events, { nowMs, identity });

  const upsert = db.query(`
    INSERT INTO inventory_leagues (
      book_id, inventory_bucket, sport_id, league_key, league_key_norm,
      competition_id, event_count_live, peak_event_count,
      first_seen, last_seen, sample_home, sample_away
    ) VALUES (
      $book, $bucket, $sport, $league, $norm,
      $comp, $live, $peak,
      $first, $last, $home, $away
    )
    ON CONFLICT(book_id, inventory_bucket, league_key_norm) DO UPDATE SET
      sport_id = excluded.sport_id,
      league_key = excluded.league_key,
      competition_id = COALESCE(excluded.competition_id, inventory_leagues.competition_id),
      event_count_live = excluded.event_count_live,
      peak_event_count = CASE
        WHEN excluded.peak_event_count > inventory_leagues.peak_event_count
        THEN excluded.peak_event_count
        ELSE inventory_leagues.peak_event_count
      END,
      last_seen = excluded.last_seen,
      sample_home = COALESCE(excluded.sample_home, inventory_leagues.sample_home),
      sample_away = COALESCE(excluded.sample_away, inventory_leagues.sample_away)
  `);

  // Zero live counts for this book first so stale leagues show event_count_live=0
  db.query(
    `UPDATE inventory_leagues SET event_count_live = 0 WHERE book_id = $book`
  ).run({ $book: identity.bookId });

  for (const row of plan.liveLeagues) {
    upsert.run({
      $book: row.bookId,
      $bucket: row.inventoryBucket,
      $sport: row.sportId,
      $league: row.leagueKey,
      $norm: row.leagueKeyNorm,
      $comp: row.competitionId,
      $live: row.eventCountLive,
      $peak: row.peakEventCount,
      $first: row.firstSeen,
      $last: row.lastSeen,
      $home: row.sampleHome,
      $away: row.sampleAway,
    });
  }

  return plan;
}

type ListInventoryLeaguesOptions = {
  bookId?: string;
  unmappedOnly?: boolean;
  sportId?: string;
  limit?: number;
  /** Prefer last_seen desc (default) or peak_event_count desc */
  orderBy?: 'last_seen' | 'peak';
};

export function listInventoryLeagues(
  db: Database,
  options: ListInventoryLeaguesOptions = {}
): InventoryLeagueRow[] {
  ensureInventoryLeaguesSchema(db);
  const bookId = options.bookId ?? buckeyeInventoryIdentity().bookId;
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 5000);
  const order =
    options.orderBy === 'peak'
      ? 'peak_event_count DESC, last_seen DESC'
      : 'last_seen DESC, peak_event_count DESC';

  const clauses = ['book_id = $book'];
  const params: Record<string, string | number> = { $book: bookId, $limit: limit };
  if (options.unmappedOnly) {
    clauses.push('(competition_id IS NULL OR competition_id = "")');
  }
  if (options.sportId?.trim()) {
    clauses.push('sport_id = $sport');
    params.$sport = options.sportId.trim().toLowerCase();
  }

  const sql = `
    SELECT book_id AS bookId, inventory_bucket AS inventoryBucket, sport_id AS sportId,
           league_key AS leagueKey, league_key_norm AS leagueKeyNorm,
           competition_id AS competitionId,
           event_count_live AS eventCountLive, peak_event_count AS peakEventCount,
           first_seen AS firstSeen, last_seen AS lastSeen,
           sample_home AS sampleHome, sample_away AS sampleAway
    FROM inventory_leagues
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${order}
    LIMIT $limit
  `;
  return db.query(sql).all(params) as InventoryLeagueRow[];
}

export function countInventoryLeagues(
  db: Database,
  bookId?: string
): { total: number; unmapped: number; liveNow: number } {
  ensureInventoryLeaguesSchema(db);
  const book = bookId ?? buckeyeInventoryIdentity().bookId;
  const row = db
    .query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN competition_id IS NULL OR competition_id = '' THEN 1 ELSE 0 END) AS unmapped,
         SUM(CASE WHEN event_count_live > 0 THEN 1 ELSE 0 END) AS liveNow
       FROM inventory_leagues WHERE book_id = $book`
    )
    .get({ $book: book }) as {
    total: number;
    unmapped: number;
    liveNow: number;
  };
  return {
    total: Number(row?.total) || 0,
    unmapped: Number(row?.unmapped) || 0,
    liveNow: Number(row?.liveNow) || 0,
  };
}

/**
 * Resolve country/kind for an inventory league row.
 * Prefer mapped competition meta; fall back to label inference when unmapped.
 */
export function resolveInventoryLeagueMeta(
  row: Pick<InventoryLeagueRow, 'competitionId' | 'leagueKey' | 'sportId'>,
): InventoryLeagueMetaView {
  if (row.competitionId) {
    const rec = getCompetition(row.competitionId);
    if (rec) {
      const m = resolveCompetitionMeta(rec);
      return {
        countryCode: m.countryCode,
        kind: m.kind,
        inferred: m.inferred,
      };
    }
  }
  return {
    countryCode: inferCompetitionCountryCode(row.leagueKey),
    kind: inferCompetitionKind(row.leagueKey, row.sportId),
    inferred: true,
  };
}

export function withInventoryLeagueMeta(
  row: InventoryLeagueRow,
): InventoryLeagueRowWithMeta {
  return { ...row, meta: resolveInventoryLeagueMeta(row) };
}

/**
 * Operator TTY line. Meta: `cc=IN kind=country_bucket` (or `cc=?` when unknown).
 */
export function formatLeagueLine(
  row: InventoryLeagueRow,
  options: { meta?: boolean } = {},
): string {
  const showMeta = options.meta !== false;
  const comp = row.competitionId ?? 'unmapped';
  const base = `${row.sportId} · ${row.leagueKey} · live=${row.eventCountLive} peak=${row.peakEventCount} · ${comp}`;
  if (!showMeta) return base;
  const m = resolveInventoryLeagueMeta(row);
  const cc = m.countryCode ?? '?';
  return `${base} · cc=${cc} kind=${m.kind}`;
}

/**
 * Re-resolve competition_id on inventory_leagues from seeded COMPETITIONS.
 * Call after promote --apply in a fresh process (or pass explicit records via
 * stampInventoryLeaguesFromRecords for same-process apply).
 */
export function stampInventoryLeaguesCompetitionIds(
  db: Database,
  bookId?: string
): number {
  ensureInventoryLeaguesSchema(db);
  const book = bookId ?? buckeyeInventoryIdentity().bookId;
  const rows = db
    .query(
      `SELECT inventory_bucket AS inventoryBucket, league_key AS leagueKey,
              sport_id AS sportId, competition_id AS competitionId
       FROM inventory_leagues WHERE book_id = $book`
    )
    .all({ $book: book }) as Array<{
    inventoryBucket: string;
    leagueKey: string;
    sportId: string;
    competitionId: string | null;
  }>;
  const upd = db.query(
    `UPDATE inventory_leagues SET competition_id = $c
     WHERE book_id = $book AND inventory_bucket = $bucket AND league_key_norm = $norm`
  );
  let n = 0;
  for (const row of rows) {
    const sport = row.sportId.trim();
    const hit = resolveCompetition({
      liveProduct: 'plive',
      league: row.leagueKey,
      sportId: isSportId(sport) ? sport : undefined,
      inventoryBucket: row.inventoryBucket || undefined,
    });
    const next = hit?.competitionId ?? null;
    const prev = row.competitionId?.trim() || null;
    if (next === prev) continue;
    upd.run({
      $c: next,
      $book: book,
      $bucket: row.inventoryBucket,
      $norm: normalizeLeagueKey(row.leagueKey),
    });
    n += 1;
  }
  return n;
}

/** Stamp competition_id using explicit records (same-process promote apply). */
export function stampInventoryLeaguesFromRecords(
  db: Database,
  records: Array<{
    id: string;
    sportId: string;
    providerMappings: { plive?: { inventoryBucket: string; leagueKey: string } };
  }>,
  bookId?: string
): number {
  ensureInventoryLeaguesSchema(db);
  const book = bookId ?? buckeyeInventoryIdentity().bookId;
  const upd = db.query(
    `UPDATE inventory_leagues SET competition_id = $c
     WHERE book_id = $book
       AND inventory_bucket = $bucket
       AND league_key_norm = $norm`
  );
  let n = 0;
  for (const rec of records) {
    const map = rec.providerMappings.plive;
    if (!map) continue;
    const r = upd.run({
      $c: rec.id,
      $book: book,
      $bucket: map.inventoryBucket,
      $norm: normalizeLeagueKey(map.leagueKey),
    });
    n += Number(r.changes) || 0;
  }
  return n;
}
