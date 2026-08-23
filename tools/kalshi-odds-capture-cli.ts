#!/usr/bin/env bun
/**
 * `bun run kalshi:odds-capture` — persist live fantasy402 odds into odds_ticks.
 *
 * Connects the Pandora WS (FantasyUltraAdapter), subscribes to the live
 * events from skin_events (odds_event_id set for a sport), and persists the
 * coefficient book after every ingest — filling the live-odds contract that
 * `massey:edge-flags` consumes (event_id = odds_event_id, sides home/away).
 *
 * Usage:
 *   bun run kalshi:odds-capture -- --sport=tennis --seconds=60
 *   bun run kalshi:odds-capture -- --sport=volleyball --seconds=120 --db=research/cache/event-store.db
 *   bun run kalshi:odds-capture -- --dry-run
 *
 * Flags:
 *   --sport     book sport bucket (default tennis).
 *   --seconds   capture duration (default 30).
 *   --db=PATH   event-store db path (default research/cache/event-store.db).
 *   --dry-run   list the subscribe set from skin_events without connecting.
 *
 * Requires fantasy402 env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID,
 * FANTASY402_AGENT_ID, FANTASY402_PASSWORD (and the desk domain, defaulting
 * through the SKINS mapper).
 *
 * @see src/institutions/event-store/odds-ticks-store.ts — persistence contract
 * @see src/institutions/massey/edge-flags.ts — consumer
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { PANDORA_ODDS_SOURCE } from '../src/partner/fantasy-ultra/odds-persist.ts';
import { FantasyUltraAdapter } from '../src/partner/fantasy-ultra/adapter.ts';

assertBunAtLeast('1.4.0', 'kalshi:odds-capture');

const sport = argValue('sport') ?? 'tennis';
const seconds = Number(argValue('seconds') ?? '30') || 30;
const dbPath = argValue('db') ?? DEFAULT_EVENT_STORE_DB;

const env = Bun.env;

function subscribeSet(db: ReturnType<typeof openEventStore>, forSport: string): string[] {
  const rows = db
    .query('SELECT DISTINCT odds_event_id FROM skin_events WHERE sport = ? AND odds_event_id IS NOT NULL AND odds_event_id != \'\'')
    .all(forSport) as Array<{ odds_event_id: string }>;
  return rows.map((r) => r.odds_event_id).sort();
}

const db = openEventStore({ dbPath });
const eventIds = subscribeSet(db, sport);
console.log('sport: ' + sport + ' · subscribe set: ' + eventIds.length + ' event id(s)');
if (eventIds.length === 0) {
  console.error('no odds_event_id rows for ' + sport + ' — nothing to capture');
  process.exit(1);
}
if (hasFlag('dry-run')) {
  for (const id of eventIds.slice(0, 20)) console.log('  ' + id);
  console.log('dry-run: not connecting');
  process.exit(0);
}

const bearerToken = env.FANTASY402_BEARER_TOKEN?.trim();
const customerID = env.FANTASY402_CUSTOMER_ID?.trim();
const agentID = env.FANTASY402_AGENT_ID?.trim();
const password = env.FANTASY402_PASSWORD?.trim();
if (!bearerToken || !customerID || !agentID || !password) {
  console.error(
    'Missing fantasy402 env: FANTASY402_BEARER_TOKEN, FANTASY402_CUSTOMER_ID, FANTASY402_AGENT_ID, FANTASY402_PASSWORD',
  );
  process.exit(2);
}

const adapter = new FantasyUltraAdapter({
  credentials: {
    customerID,
    agentID,
    password,
    bearerToken,
    domain: env.FANTASY402_DOMAIN ?? 'https://desk.fantasy402.com',
    skin: Number(env.FANTASY402_SKIN ?? '2') || 2,
    currency: 'USD',
  },
  persistence: { db },
});

adapter.connectWebSocket({}, { eventIds, subscribeLive: true });
console.log('capturing for ' + seconds + 's (Ctrl-C to stop early)…');
await Bun.sleep(seconds * 1000);
const stored = db.query('SELECT COUNT(*) AS n FROM odds_ticks WHERE source = ?').get(PANDORA_ODDS_SOURCE) as { n: number };
console.log('stored odds_ticks rows (source ' + PANDORA_ODDS_SOURCE + '): ' + stored.n);
process.exit(0);
