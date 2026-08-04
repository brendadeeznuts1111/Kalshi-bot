#!/usr/bin/env bun
/**
 * Poll Fantasy402 stream-list inventory and upsert partner_events.
 * Detects new stream_ids (default sport: table tennis).
 *
 * Env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD
 *
 * Usage:
 *   bun run partner:watch-events
 *   bun run partner:watch-events -- --sport=table_tennis
 *   bun run partner:watch-events -- --sport=all --json
 *   bun run partner:watch-events -- --once
 *
 * Optional: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to notify on new rows.
 */
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/spawn
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  getFantasySessionAdapter,
  requireFantasy402ProfileFromEnv,
} from "../src/partner/index.ts";
import {
  filterLiveEventsBySport,
  formatPartnerEventLine,
  upsertPartnerLiveEvents,
} from "../src/partner/partner-events-store.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function maybeNotifyTelegram(lines: string[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || process.env.TELEGRAM_GROUP_ID?.trim();
  if (!token || !chatId || lines.length === 0) return;
  const text = ["New Fantasy402 events:", ...lines.slice(0, 12)].join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    sportArg === "all"
      ? "all"
      : sportArg.replace(/\s+/g, "_").toLowerCase() === "table_tennis" ||
          sportArg.toLowerCase() === "table tennis"
        ? "table_tennis"
        : sportArg.replace(/\s+/g, "_").toLowerCase() === "tennis"
          ? "tennis"
          : sportArg;

  let events = await adapter.fetchEvents({
    sport: fetchSport === "all" ? "all" : fetchSport,
  });
  // When API filter is all, still allow client filter
  if (options.sport !== "all") {
    events = filterLiveEventsBySport(events, options.sport);
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const result = upsertPartnerLiveEvents(db, events);

  const newLines = result.inserted.map(formatPartnerEventLine);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          sport: options.sport,
          seen: result.seen,
          inserted: result.inserted.length,
          updated: result.updated.length,
          newEvents: result.inserted.map((r) => ({
            streamId: r.streamId,
            sport: r.sport,
            league: r.league,
            home: r.home,
            away: r.away,
            feedId: r.feedId,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `partner:watch-events sport=${options.sport} seen=${result.seen} new=${result.inserted.length} updated=${result.updated.length}`,
    );
    for (const line of newLines) {
      console.log(`  + ${line}`);
    }
  }

  if (result.inserted.length) {
    await maybeNotifyTelegram(
      result.inserted.map((r) => `• ${formatPartnerEventLine(r)}`),
    );
  }

  return { newCount: result.inserted.length, seen: result.seen };
}

async function main(): Promise<void> {
  const sport = argValue("sport") ?? "table_tennis";
  const json = hasFlag("json");
  const once = hasFlag("once") || !hasFlag("loop");
  const intervalMs = Math.max(
    Number(argValue("interval-ms") ?? "60000") || 60_000,
    5_000,
  );

  if (once) {
    await pollOnce({ sport, json });
    return;
  }

  console.log(
    `partner:watch-events loop sport=${sport} intervalMs=${intervalMs}`,
  );
  for (;;) {
    try {
      await pollOnce({ sport, json: false });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await Bun.sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
