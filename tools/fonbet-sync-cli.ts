#!/usr/bin/env bun
/**
 * `bun run fonbet:sync` — Fonbet pregame + live lines into the unified store.
 *
 * Connects the ODDSCORP WebSocket feed (bookmaker id FON), subscribes to
 * pregame + live, and persists each event's moneyline home/away decimal
 * odds into skin_events + odds_ticks — the massey edge-flags pipeline
 * consumes them with zero changes.
 *
 * Usage:
 *   ODDSCORP_AUTH_KEY=… bun run fonbet:sync -- --sport=volleyball --seconds=60
 *   bun run fonbet:sync -- --sport=tennis --seconds=120 --db=research/cache/event-store.db
 *   bun run fonbet:sync -- --fixture=captures/ --sport=volleyball   (offline: parse saved messages)
 *
 * Flags:
 *   --sport     feed sport filter (e.g. volleyball, tennis); omit = all.
 *   --seconds   live capture duration (default 30).
 *   --db=PATH   event-store db path (default research/cache/event-store.db).
 *   --fixture   file or dir of saved ODDSCORP messages (JSONL: one message array per line).
 *
 * Requires ODDSCORP_AUTH_KEY for live mode (from the feed provider).
 * The parser is fixture-first — verify against a real capture before trusting.
 *
 * @see src/institutions/fonbet/parse.ts — wire parser
 * @see src/institutions/fonbet/sync.ts — unified persistence
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { parseFonbetEvent, type FonbetMarketWire } from '../src/institutions/fonbet/parse.ts';
import { persistFonbetEvent } from '../src/institutions/fonbet/sync.ts';

assertBunAtLeast('1.4.0', 'fonbet:sync');

type WireMessage = unknown[];

function handleMessage(db: ReturnType<typeof openEventStore>, msg: WireMessage, marketsByKey: Map<string, FonbetMarketWire[]>, sport?: string): { events: number; odds: number } {
  const kind = msg[1];
  const key = typeof msg[2] === 'string' ? msg[2] : '';
  const payload = msg[3];
  if (kind === 'update_markets' && Array.isArray(payload)) {
    marketsByKey.set(key, payload as FonbetMarketWire[]);
    return { events: 0, odds: 0 };
  }
  if (kind === 'update_event' && payload && typeof payload === 'object') {
    const ev = payload as Record<string, unknown>;
    if (sport && String(ev.sport ?? '').toLowerCase() !== sport) return { events: 0, odds: 0 };
    const row = parseFonbetEvent(ev as never, marketsByKey.get(key) ?? []);
    if (!row) return { events: 0, odds: 0 };
    const odds = persistFonbetEvent(db, row);
    return { events: 1, odds };
  }
  return { events: 0, odds: 0 };
}

function loadMessages(fixturePath: string): WireMessage[] {
  const files = statSync(fixturePath).isDirectory()
    ? readdirSync(fixturePath).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json')).sort().map((f) => join(fixturePath, f))
    : [fixturePath];
  const out: WireMessage[] = [];
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const v = JSON.parse(t);
        if (Array.isArray(v)) out.push(v);
      } catch {
        // skip malformed lines
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const sport = argValue('sport')?.trim().toLowerCase();
  const fixture = argValue('fixture');
  const dbPath = argValue('db') ?? DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const marketsByKey = new Map<string, FonbetMarketWire[]>();

  if (fixture) {
    const messages = loadMessages(fixture);
    let events = 0;
    let odds = 0;
    for (const msg of messages) {
      const r = handleMessage(db, msg, marketsByKey, sport);
      events += r.events;
      odds += r.odds;
    }
    console.log('fixture: ' + messages.length + ' messages · ' + events + ' events persisted · ' + odds + ' odds ticks');
    process.exit(0);
  }

  const authKey = Bun.env.ODDSCORP_AUTH_KEY?.trim();
  if (!authKey) {
    console.error('Live mode requires ODDSCORP_AUTH_KEY (fixture mode: --fixture=…)');
    process.exit(2);
  }
  const seconds = Number(argValue('seconds') ?? '30') || 30;
  let events = 0;
  let odds = 0;
  const ws = new WebSocket('ws://api.oddscp.com:8001');
  ws.onopen = () => {
    ws.send(JSON.stringify({
      cmd: 'subscribe',
      auth_key: authKey,
      needed_bk: ['fonbet:prematch', 'fonbet:live'],
      needed_sport: sport ? [sport] : undefined,
      send_events_ids: true,
      send_actual_first: true,
      short_format: true,
    }));
    console.log('subscribed fonbet:prematch + fonbet:live' + (sport ? ' · sport=' + sport : ''));
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as WireMessage;
      const r = handleMessage(db, msg, marketsByKey, sport);
      events += r.events;
      odds += r.odds;
    } catch {
      // non-JSON keepalive
    }
  };
  console.log('capturing for ' + seconds + 's (Ctrl-C to stop early)…');
  await Bun.sleep(seconds * 1000);
  ws.close();
  console.log('captured: ' + events + ' events · ' + odds + ' odds ticks');
  process.exit(0);
}

await main();
