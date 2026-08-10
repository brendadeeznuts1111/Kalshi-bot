// @see https://bun.com/docs/runtime/sqlite
/**
 * Inventory sync — coverage ground-truth pipeline (not seat partner).
 *
 * REAL today:
 *  - stream-list-v2 → skin_events (detect new inventory_ids)
 *  - optional soft enrich: Statscore booked-events list by name match → odds_event_id
 *
 * NOT real yet (do not invent):
 *  - markets / lines from stream-list or livescorepro booked-events
 *  - placeOrder POST
 *  - merge into Kalshi match_liquidity
 *
 * Pandora priced book (optional): when `coefficientStore` (or adapter store)
 * has moneyline lines, report `pricedOdds: true` — still no liquidity merge.
 */
import type { Database } from 'bun:sqlite';
import type { CoefficientStore } from '../partner/fantasy-ultra/coefficient-store.ts';
import type { FantasySessionAdapter, InventoryEvent } from '../partner/types.ts';
import {
  buckeyeInventoryIdentity,
  filterLiveEventsBySport,
  formatSkinEventLine,
  listSkinInventoryIds,
  liveEventToRow,
  normalizeSkinEventsSports,
  upsertSkinLiveEvents,
  type InventoryIdentity,
  type SkinEventRow,
  type SkinEventUpsertResult,
} from './skin-events-store.ts';

export type InventorySyncOptions = {
  sport?: string;
  /** Soft-match Statscore booked names for NEW rows only (metadata, not odds). */
  enrichBooked?: boolean;
  nowMs?: number;
  /** Explicit Pandora book; else adapter.getCoefficientStore() when present. */
  coefficientStore?: CoefficientStore;
  /** Defaults to Buckeye / Fantasy402 / plive shell. */
  identity?: InventoryIdentity;
  /**
   * Fetch + plan insert/update only — no SQLite writes, no booked enrich UPDATE,
   * no sport-label normalize. Report counts are would-be.
   */
  dryRun?: boolean;
};

export type InventorySyncReport = {
  sport: string;
  seen: number;
  inserted: number;
  updated: number;
  newEvents: SkinEventRow[];
  /** Existing inventory_ids that would be refreshed (dry-run or real). */
  updatedEvents?: SkinEventRow[];
  enriched: number;
  /** True when no DB mutations were applied. */
  dryRun: boolean;
  capabilities: {
    inventory: true;
    eventDetection: true;
    bookedMetadata: boolean;
    pricedOdds: boolean;
    placeBetRequest: false;
    liquidityMerge: false;
  };
  notes: string[];
};

function resolveCoefficientStore(
  adapter: FantasySessionAdapter,
  options: InventorySyncOptions
): CoefficientStore | null {
  if (options.coefficientStore) return options.coefficientStore;
  const maybe = adapter as FantasySessionAdapter & {
    getCoefficientStore?: () => CoefficientStore;
  };
  if (typeof maybe.getCoefficientStore === 'function') {
    return maybe.getCoefficientStore();
  }
  return null;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Soft match "Home vs Away" inventory to Statscore "Home - Away" booked name.
 */
export function matchBookedOddsEventId(
  home: string | null,
  away: string | null,
  booked: Array<{ oddsEventId: string; name: string }>
): string | null {
  if (!home || !away || booked.length === 0) return null;
  const h = normalizeName(home);
  const a = normalizeName(away);
  for (const b of booked) {
    const n = normalizeName(b.name);
    if (n.includes(h) && n.includes(a)) return b.oddsEventId;
  }
  return null;
}

/** Plan insert vs update without writing (reads existing inventory_ids only). */
export function planInventoryUpsert(
  db: Database,
  events: InventoryEvent[],
  options: {
    nowMs?: number;
    identity?: InventoryIdentity;
  } = {}
): SkinEventUpsertResult {
  const nowMs = options.nowMs ?? Date.now();
  const identity = options.identity ?? buckeyeInventoryIdentity();
  const existing = listSkinInventoryIds(db, identity.bookId);
  const inserted: SkinEventRow[] = [];
  const updated: SkinEventRow[] = [];
  let seen = 0;
  for (const event of events) {
    const inventoryId = String(event.inventoryId ?? '').trim();
    if (!inventoryId) continue;
    seen++;
    const row = liveEventToRow(event, nowMs, identity, {
      firstSeen: nowMs,
      status: 'unknown',
    });
    if (existing.has(inventoryId)) {
      updated.push(row);
    } else {
      inserted.push(row);
    }
  }
  return { inserted, updated, seen };
}

export async function runInventorySync(
  db: Database,
  adapter: FantasySessionAdapter,
  options: InventorySyncOptions = {}
): Promise<InventorySyncReport> {
  const sport = options.sport ?? 'table_tennis';
  const dryRun = options.dryRun === true;
  const notes: string[] = [];
  if (dryRun) {
    notes.push('dry-run: no SQLite writes (plan only)');
  }
  const fetchSport =
    sport === 'all'
      ? 'all'
      : sport.replace(/\s+/g, '_').toLowerCase() === 'table_tennis' ||
          sport.toLowerCase() === 'table tennis'
        ? 'table_tennis'
        : sport.replace(/\s+/g, '_').toLowerCase() === 'tennis'
          ? 'tennis'
          : sport.replace(/\s+/g, '_').toLowerCase();

  // Inventory does not require login
  let events: InventoryEvent[] = await adapter.fetchInventory({
    sport: fetchSport === 'all' ? 'all' : fetchSport,
  });
  if (sport !== 'all') {
    events = filterLiveEventsBySport(events, sport);
  }

  const identity = options.identity ?? buckeyeInventoryIdentity();
  if (!dryRun) {
    normalizeSkinEventsSports(db);
  }

  const upsert: SkinEventUpsertResult = dryRun
    ? planInventoryUpsert(db, events, { nowMs: options.nowMs, identity })
    : upsertSkinLiveEvents(db, events, {
        nowMs: options.nowMs,
        identity,
      });

  let enriched = 0;
  if (options.enrichBooked && upsert.inserted.length > 0) {
    try {
      const sportFilter = sport.toLowerCase().includes('table')
        ? 'table'
        : sport === 'all'
          ? undefined
          : sport;
      const booked = await adapter.listBookedEvents({
        sport: sportFilter,
        limit: 100,
      });
      const catalog = booked.map(b => ({
        oddsEventId: b.oddsEventId,
        name: b.name,
      }));
      if (dryRun) {
        for (const row of upsert.inserted) {
          const cid = matchBookedOddsEventId(row.home, row.away, catalog);
          if (!cid) continue;
          row.oddsEventId = cid;
          enriched++;
        }
        notes.push(
          `booked enrich (dry-run): would match ${enriched}/${upsert.inserted.length} new rows by name`
        );
      } else {
        const update = db.query(`
        UPDATE skin_events
        SET odds_event_id = $cid, last_updated = $ts
        WHERE book_id = $book AND inventory_id = $iid AND (odds_event_id IS NULL OR odds_event_id = '')
      `);
        const ts = options.nowMs ?? Date.now();
        for (const row of upsert.inserted) {
          const cid = matchBookedOddsEventId(row.home, row.away, catalog);
          if (!cid) continue;
          update.run({
            $cid: cid,
            $ts: ts,
            $book: row.bookId,
            $iid: row.inventoryId,
          });
          row.oddsEventId = cid;
          enriched++;
        }
        notes.push(
          `booked enrich: matched ${enriched}/${upsert.inserted.length} new rows by name (metadata only — no prices)`
        );
      }
    } catch (err) {
      notes.push(`booked enrich skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (options.enrichBooked) {
    notes.push('booked enrich: no new rows to match');
  }

  const store = resolveCoefficientStore(adapter, options);
  const pricedEvents = store?.pricedEventCount() ?? 0;
  const pricedLines = store?.lineCount() ?? 0;
  const pricedOdds = pricedEvents > 0;
  if (pricedOdds) {
    notes.push(
      `priced odds: Pandora store has ${pricedEvents} event(s), ${pricedLines} line(s) (ML via fetchMarkets; no liquidity merge)`
    );
  } else {
    notes.push(
      'priced odds: not available from stream-list or Statscore livescorepro; Pandora store empty'
    );
  }
  notes.push('placeBet POST: still unmapped (ticket response parser ready)');
  notes.push(
    pricedOdds
      ? 'liquidity:ground merge: deferred (priced book in store only)'
      : 'liquidity:ground merge: deferred until priced markets exist'
  );

  return {
    sport,
    seen: upsert.seen,
    inserted: upsert.inserted.length,
    updated: upsert.updated.length,
    newEvents: upsert.inserted,
    updatedEvents: upsert.updated,
    enriched,
    dryRun,
    capabilities: {
      inventory: true,
      eventDetection: true,
      bookedMetadata: options.enrichBooked === true,
      pricedOdds,
      placeBetRequest: false,
      liquidityMerge: false,
    },
    notes,
  };
}

export function formatSyncReport(report: InventorySyncReport): string {
  const mode = report.dryRun ? 'inventory:sync --dry-run' : 'inventory:sync';
  const lines = [
    `${mode} sport=${report.sport} seen=${report.seen} new=${report.inserted} updated=${report.updated} enriched=${report.enriched}`,
    ...report.newEvents.map(e => `  + ${formatSkinEventLine(e)}`),
    ...(report.dryRun && report.updatedEvents && report.updatedEvents.length > 0
      ? report.updatedEvents
          .slice(0, 20)
          .map(e => `  ~ ${formatSkinEventLine(e)}`)
          .concat(
            report.updatedEvents.length > 20
              ? [`  ~ … ${report.updatedEvents.length - 20} more would update`]
              : []
          )
      : []),
    ...report.notes.map(n => `  · ${n}`),
  ];
  return lines.join('\n');
}
