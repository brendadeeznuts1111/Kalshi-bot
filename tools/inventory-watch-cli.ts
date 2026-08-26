#!/usr/bin/env bun
/**
 * Poll Plive shell stream-list into skin_events (Buckeye-scoped).
 * One inventory feed covers plive + ezlive (shared Plive shell).
 *
 * Inventory is **public** (widget origin/referer) — Fantasy402 login env is optional.
 * Optional env for session warm: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID,
 * FANTASY402_AGENT_ID, FANTASY402_PASSWORD
 *
 * Usage:
 *   bun run inventory:watch
 *   bun run inventory:watch -- --sport=table_tennis
 *   bun run inventory:watch -- --sport=table_tennis,tennis
 *   bun run inventory:watch -- --sport="table_tennis, tennis"   # spaces OK
 *   bun run inventory:watch -- --sport=all --json
 *   bun run inventory:watch -- --once --dry-run
 *   bun run inventory:watch -- --once --dry-run --json
 *   bun run inventory:watch -- --once --skin=buckeye --book=fantasy402
 *   bun run inventory:watch -- --once --sport=all --enrich-booked
 *
 * --sport: single, CSV multi (spaces trimmed), or all. Multi fetches full board then filters.
 * --dry-run: plan insert/update only (no SQLite writes, no Telegram). Incompatible with --loop.
 * --enrich-booked: soft Statscore name → odds_event_id (needs Fantasy adapter; scope=board).
 * Optional: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to notify on new rows (live only).
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/spawn
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { getFantasySessionAdapter, loadFantasy402ProfileFromEnv } from '../src/partner/index.ts';
import { formatLeagueLine, upsertInventoryLeagues } from '../src/inventory/leagues.ts';
import { maybeNotifyInventoryTelegram } from '../src/inventory/notify.ts';
import {
  applyBookedOddsEnrich,
  collectBoardEnrichCandidates,
  formatOddsLinkCoverage,
  oddsLinkCoverage,
  parseEnrichBookedScope,
  planInventoryUpsert,
} from '../src/inventory/sync.ts';
import {
  fetchPublicPliveStreamEvents,
  filterLiveEventsBySports,
  formatInventorySportSelection,
  formatSkinEventLine,
  inventorySportForCatalogFetch,
  liveProductsCoveredByInventory,
  normalizeSkinEventsSports,
  parseInventorySportsCsv,
  resolveInventoryFetchSport,
  resolveWatchInventoryIdentity,
  upsertSkinLiveEvents,
  type InventoryIdentity,
  type InventorySportSelection,
} from '../src/inventory/skin-events-store.ts';
import type { FantasySessionAdapter, InventoryEvent } from '../src/partner/types.ts';

async function loadInventoryEvents(sportSel: InventorySportSelection): Promise<{
  events: InventoryEvent[];
  source: 'adapter' | 'public-stream-list';
  adapter: FantasySessionAdapter | null;
}> {
  const fetchSport = resolveInventoryFetchSport(sportSel);
  const profile = loadFantasy402ProfileFromEnv();
  if (profile) {
    const adapter = getFantasySessionAdapter(profile, { warmSession: false });
    try {
      await adapter.login();
    } catch {
      // stream-list is public; login warm is best-effort
    }
    const events = await adapter.fetchInventory({ sport: fetchSport });
    return { events, source: 'adapter', adapter };
  }
  const events = await fetchPublicPliveStreamEvents({ sport: fetchSport });
  return { events, source: 'public-stream-list', adapter: null };
}

async function pollOnce(options: {
  sportSel: InventorySportSelection;
  sportLabel: string;
  json: boolean;
  identity: InventoryIdentity;
  dryRun: boolean;
  enrichBooked: boolean;
  enrichBookedScope: ReturnType<typeof parseEnrichBookedScope>;
}): Promise<{ newCount: number; seen: number }> {
  const loaded = await loadInventoryEvents(options.sportSel);
  const events = filterLiveEventsBySports(loaded.events, options.sportSel);

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  if (!options.dryRun) {
    normalizeSkinEventsSports(db);
  }
  const result = options.dryRun
    ? planInventoryUpsert(db, events, { identity: options.identity })
    : upsertSkinLiveEvents(db, events, { identity: options.identity });
  const leagueSource =
    result.inserted.length + result.updated.length > 0
      ? [...result.inserted, ...result.updated]
      : events;
  const leagues = upsertInventoryLeagues(db, leagueSource, {
    identity: options.identity,
    dryRun: options.dryRun,
  });
  const covers = liveProductsCoveredByInventory(options.identity.skinId);

  let enriched = 0;
  let enrichCandidates = 0;
  let enrichNote: string | null = null;
  if (options.enrichBooked) {
    if (!loaded.adapter) {
      enrichNote = 'enrich skipped: needs Fantasy adapter (set FANTASY402_* env)';
    } else {
      try {
        const catalogSport = inventorySportForCatalogFetch(options.sportSel);
        const sportFilter =
          catalogSport == null
            ? undefined
            : catalogSport.includes('table')
              ? 'table'
              : catalogSport;
        const booked = await loaded.adapter.listBookedEvents({
          ...(sportFilter !== undefined ? { sport: sportFilter } : {}),
          limit: 200,
        });
        const catalog = booked.map(b => ({
          oddsEventId: b.oddsEventId,
          name: b.name,
        }));
        const candidates = collectBoardEnrichCandidates(
          result,
          db,
          options.identity.bookId,
          options.enrichBookedScope
        );
        enrichCandidates = candidates.length;
        const touch = new Map(result.inserted.concat(result.updated).map(r => [r.inventoryId, r]));
        enriched = applyBookedOddsEnrich(db, options.identity.bookId, candidates, catalog, {
          dryRun: options.dryRun,
          touch,
        });
        enrichNote = options.dryRun
          ? `enrich dry-run scope=${options.enrichBookedScope} would match ${enriched}/${enrichCandidates}`
          : `enrich scope=${options.enrichBookedScope} matched ${enriched}/${enrichCandidates}`;
      } catch (err) {
        enrichNote = `enrich skipped: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  const oddsLink = options.dryRun
    ? null
    : oddsLinkCoverage(db, options.identity.bookId);

  const newLines = result.inserted.map(formatSkinEventLine);
  const mode = options.dryRun ? 'inventory:watch --dry-run' : 'inventory:watch';
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: options.dryRun,
          sport: options.sportLabel,
          skinId: options.identity.skinId,
          bookId: options.identity.bookId,
          inventoryLiveProduct: options.identity.inventoryLiveProduct,
          coversLiveProducts: covers,
          source: loaded.source,
          seen: result.seen,
          inserted: result.inserted.length,
          updated: result.updated.length,
          enriched,
          enrichCandidates,
          enrichBookedScope: options.enrichBooked ? options.enrichBookedScope : null,
          enrichNote,
          oddsLink,
          leagues: {
            seen: leagues.seen,
            inserted: leagues.inserted,
            updated: leagues.updated,
            newLeagues: leagues.newLeagues.slice(0, 50),
          },
          newEvents: result.inserted.map(r => ({
            inventoryId: r.inventoryId,
            sport: r.sport,
            league: r.league,
            home: r.home,
            away: r.away,
            feedId: r.feedId,
            skinId: r.skinId,
            bookId: r.bookId,
            inventoryLiveProduct: r.inventoryLiveProduct,
            oddsEventId: r.oddsEventId,
          })),
          ...(options.dryRun
            ? {
                updatedEvents: result.updated.slice(0, 50).map(r => ({
                  inventoryId: r.inventoryId,
                  sport: r.sport,
                  league: r.league,
                  home: r.home,
                  away: r.away,
                })),
              }
            : {}),
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `${mode} skin=${options.identity.skinId} book=${options.identity.bookId} ` +
        `source=${loaded.source} covers=${covers.join('+')} sport=${options.sportLabel} ` +
        `seen=${result.seen} new=${result.inserted.length} updated=${result.updated.length}` +
        ` leagues=${leagues.seen}/${leagues.inserted}new` +
        (options.enrichBooked ? ` enriched=${enriched}/${enrichCandidates}` : '') +
        (options.dryRun ? ' (no write)' : '')
    );
    if (enrichNote) console.log(`  ${enrichNote}`);
    if (oddsLink) console.log(`  ${formatOddsLinkCoverage(oddsLink)}`);
    for (const line of newLines) {
      console.log(`  + ${line}`);
    }
    for (const L of leagues.newLeagues.slice(0, 8)) {
      console.log(`  +L ${formatLeagueLine(L)}`);
    }
    if (options.dryRun && result.updated.length > 0) {
      for (const row of result.updated.slice(0, 20)) {
        console.log(`  ~ ${formatSkinEventLine(row)}`);
      }
      if (result.updated.length > 20) {
        console.log(`  ~ … ${result.updated.length - 20} more would update`);
      }
    }
  }

  if (!options.dryRun && result.inserted.length) {
    await maybeNotifyInventoryTelegram({
      title: 'New Fantasy402 / Buckeye events:',
      lines: result.inserted.map(r => `• ${formatSkinEventLine(r)}`),
    });
  }

  return { newCount: result.inserted.length, seen: result.seen };
}

async function main(): Promise<void> {
  // Default table_tennis for interactive; operator core CSV or --sport=all (cron uses all)
  const sportSel = parseInventorySportsCsv(argValue('sport') ?? 'table_tennis');
  const sportLabel = formatInventorySportSelection(sportSel);
  const json = hasFlag('json');
  const dryRun = hasFlag('dry-run') || hasFlag('dryRun');
  const loop = hasFlag('loop');
  const once = hasFlag('once') || !loop;
  const enrichBooked = hasFlag('enrich-booked');
  const enrichBookedScope = parseEnrichBookedScope(argValue('enrich-scope'));
  if (loop && dryRun) {
    throw new Error('inventory:watch --dry-run cannot be combined with --loop');
  }
  const skinArg = argValue('skin');
  const bookArg = argValue('book');
  const identity = resolveWatchInventoryIdentity({
    ...(skinArg !== undefined ? { skin: skinArg } : {}),
    ...(bookArg !== undefined ? { book: bookArg } : {}),
  });
  // Default 30s — near-real-time inventory without hammering the feed
  const intervalMs = Math.max(Number(argValue('interval-ms') ?? '30000') || 30_000, 5_000);

  if (once) {
    await pollOnce({
      sportSel,
      sportLabel,
      json,
      identity,
      dryRun,
      enrichBooked,
      enrichBookedScope,
    });
    return;
  }

  console.log(
    `inventory:watch loop skin=${identity.skinId} book=${identity.bookId} ` +
      `sport=${sportLabel} intervalMs=${intervalMs}`
  );
  for (;;) {
    try {
      await pollOnce({
        sportSel,
        sportLabel,
        json: false,
        identity,
        dryRun: false,
        enrichBooked,
        enrichBookedScope,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await Bun.sleep(intervalMs);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
