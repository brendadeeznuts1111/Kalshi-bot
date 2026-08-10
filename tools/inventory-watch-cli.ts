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
 *   bun run inventory:watch -- --sport=all --json
 *   bun run inventory:watch -- --once --skin=buckeye --book=fantasy402
 *
 * Optional: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to notify on new rows.
 */
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/spawn
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { getFantasySessionAdapter, loadFantasy402ProfileFromEnv } from '../src/partner/index.ts';
import {
  fetchPublicPliveStreamEvents,
  filterLiveEventsBySport,
  formatSkinEventLine,
  liveProductsCoveredByInventory,
  normalizeSkinEventsSports,
  resolveWatchInventoryIdentity,
  upsertSkinLiveEvents,
  type InventoryIdentity,
} from '../src/partner/skin-events-store.ts';
import type { InventoryEvent } from '../src/partner/types.ts';

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function maybeNotifyTelegram(lines: string[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || process.env.TELEGRAM_GROUP_ID?.trim();
  if (!token || !chatId || lines.length === 0) return;
  const text = ['New Fantasy402 / Buckeye events:', ...lines.slice(0, 12)].join('\n');
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // non-fatal
  }
}

function resolveFetchSport(sportArg: string): string {
  if (sportArg === 'all') return 'all';
  const norm = sportArg.replace(/\s+/g, '_').toLowerCase();
  if (norm === 'table_tennis' || sportArg.toLowerCase() === 'table tennis') {
    return 'table_tennis';
  }
  if (norm === 'tennis') return 'tennis';
  return sportArg;
}

async function loadInventoryEvents(sport: string): Promise<{
  events: InventoryEvent[];
  source: 'adapter' | 'public-stream-list';
}> {
  const fetchSport = resolveFetchSport(sport);
  const profile = loadFantasy402ProfileFromEnv();
  if (profile) {
    const adapter = getFantasySessionAdapter(profile, { warmSession: false });
    try {
      await adapter.login();
    } catch {
      // stream-list is public; login warm is best-effort
    }
    const events = await adapter.fetchInventory({
      sport: fetchSport === 'all' ? 'all' : fetchSport,
    });
    return { events, source: 'adapter' };
  }
  const events = await fetchPublicPliveStreamEvents({
    sport: fetchSport === 'all' ? 'all' : fetchSport,
  });
  return { events, source: 'public-stream-list' };
}

async function pollOnce(options: {
  sport: string;
  json: boolean;
  identity: InventoryIdentity;
}): Promise<{ newCount: number; seen: number }> {
  const loaded = await loadInventoryEvents(options.sport);
  let events = loaded.events;
  if (options.sport !== 'all') {
    events = filterLiveEventsBySport(events, options.sport);
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  normalizeSkinEventsSports(db);
  const result = upsertSkinLiveEvents(db, events, { identity: options.identity });
  const covers = liveProductsCoveredByInventory(options.identity.skinId);

  const newLines = result.inserted.map(formatSkinEventLine);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          sport: options.sport,
          skinId: options.identity.skinId,
          bookId: options.identity.bookId,
          inventoryLiveProduct: options.identity.inventoryLiveProduct,
          coversLiveProducts: covers,
          source: loaded.source,
          seen: result.seen,
          inserted: result.inserted.length,
          updated: result.updated.length,
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
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `inventory:watch skin=${options.identity.skinId} book=${options.identity.bookId} ` +
        `source=${loaded.source} covers=${covers.join('+')} sport=${options.sport} ` +
        `seen=${result.seen} new=${result.inserted.length} updated=${result.updated.length}`
    );
    for (const line of newLines) {
      console.log(`  + ${line}`);
    }
  }

  if (result.inserted.length) {
    await maybeNotifyTelegram(result.inserted.map(r => `• ${formatSkinEventLine(r)}`));
  }

  return { newCount: result.inserted.length, seen: result.seen };
}

async function main(): Promise<void> {
  const sport = argValue('sport') ?? 'table_tennis';
  const json = hasFlag('json');
  const once = hasFlag('once') || !hasFlag('loop');
  const identity = resolveWatchInventoryIdentity({
    skin: argValue('skin'),
    book: argValue('book'),
  });
  // Default 30s — near-real-time inventory without hammering the feed
  const intervalMs = Math.max(Number(argValue('interval-ms') ?? '30000') || 30_000, 5_000);

  if (once) {
    await pollOnce({ sport, json, identity });
    return;
  }

  console.log(
    `inventory:watch loop skin=${identity.skinId} book=${identity.bookId} ` +
      `sport=${sport} intervalMs=${intervalMs}`
  );
  for (;;) {
    try {
      await pollOnce({ sport, json: false, identity });
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
