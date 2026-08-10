#!/usr/bin/env bun
/**
 * Poll Fantasy402 stream-list inventory into skin_events (Buckeye-scoped).
 * One inventory feed covers plive + ezlive (shared Plive shell).
 *
 * Env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD
 *
 * Usage:
 *   bun run partner:watch-events
 *   bun run partner:watch-events -- --sport=table_tennis
 *   bun run partner:watch-events -- --sport=all --json
 *   bun run partner:watch-events -- --once --skin=buckeye --book=fantasy402
 *
 * Optional: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to notify on new rows.
 */
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/spawn
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { getFantasySessionAdapter, requireFantasy402ProfileFromEnv } from '../src/partner/index.ts';
import {
  filterLiveEventsBySport,
  formatSkinEventLine,
  liveProductsCoveredByInventory,
  resolveWatchInventoryIdentity,
  upsertSkinLiveEvents,
  type InventoryIdentity,
} from '../src/partner/skin-events-store.ts';

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

async function pollOnce(options: {
  sport: string;
  json: boolean;
  identity: InventoryIdentity;
}): Promise<{ newCount: number; seen: number }> {
  const profile = requireFantasy402ProfileFromEnv();
  const adapter = getFantasySessionAdapter(profile, { warmSession: false });
  // Login optional for stream-list but keeps session consistent
  try {
    await adapter.login();
  } catch {
    // stream-list often works without login; continue
  }

  // Fetch by bucket when sport is table_tennis / tennis; else all then filter
  const sportArg = options.sport;
  const fetchSport =
    sportArg === 'all'
      ? 'all'
      : sportArg.replace(/\s+/g, '_').toLowerCase() === 'table_tennis' ||
          sportArg.toLowerCase() === 'table tennis'
        ? 'table_tennis'
        : sportArg.replace(/\s+/g, '_').toLowerCase() === 'tennis'
          ? 'tennis'
          : sportArg;

  let events = await adapter.fetchEvents({
    sport: fetchSport === 'all' ? 'all' : fetchSport,
  });
  // When API filter is all, still allow client filter
  if (options.sport !== 'all') {
    events = filterLiveEventsBySport(events, options.sport);
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
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
          seen: result.seen,
          inserted: result.inserted.length,
          updated: result.updated.length,
          newEvents: result.inserted.map(r => ({
            streamId: r.streamId,
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
      `partner:watch-events skin=${options.identity.skinId} book=${options.identity.bookId} ` +
        `covers=${covers.join('+')} sport=${options.sport} seen=${result.seen} ` +
        `new=${result.inserted.length} updated=${result.updated.length}`
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
    `partner:watch-events loop skin=${identity.skinId} book=${identity.bookId} ` +
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
