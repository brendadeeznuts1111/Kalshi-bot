#!/usr/bin/env bun
/**
 * `bun run db:canonicalize` — apply the data-model unification backfills.
 *
 * Opens the event-store, adds the match_key columns (migration), copies
 * match_key from event_links onto linked odds_ticks rows, and rewrites
 * winner/loser odds sides to home/away via events competitor names.
 * Idempotent: only fills empty match_keys and resolves unambiguous sides.
 *
 * @see docs/DATA_MODEL.md — the unified model
 * @see src/institutions/event-store/odds-canonicalize.ts
 */
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import {
  backfillMatchKeys,
  canonicalizeOddsSides,
} from '../src/institutions/event-store/odds-canonicalize.ts';

assertBunAtLeast('1.4.0', 'db:canonicalize');

const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
const keys = backfillMatchKeys(db);
const sides = canonicalizeOddsSides(db);
console.log('match_key backfilled:', keys.updated, 'rows');
console.log('sides canonicalized:', sides.updated, 'rows');
const remaining = db
  .query("SELECT COUNT(*) AS n FROM odds_ticks WHERE side IN ('winner','loser')")
  .get() as { n: number };
console.log('remaining winner/loser rows:', remaining.n);
db.close();
