import { describe, expect, test } from "bun:test";
import { makeEventStoreDb } from "../../lib/fixtures/event-store.ts";
import {
  FONBET_BOOK_ID,
  FONBET_ODDS_SOURCE,
  persistFonbetEvent,
  upsertFonbetEvent,
} from "../../../src/institutions/fonbet/sync.ts";
import type { FonbetEventRow } from "../../../src/institutions/fonbet/parse.ts";
import { loadPricedBookEvents } from "../../../src/institutions/event-store/odds-ticks-store.ts";

function makeDb(): ReturnType<typeof makeEventStoreDb> {
  return makeEventStoreDb();
}

function row(over: Partial<FonbetEventRow> = {}): FonbetEventRow {
  return {
    id: "41393426",
    home: "Balestier Khalsa",
    away: "Young Lions",
    league: "Singapore. Premier League",
    sport: "volleyball",
    competitionId: "singapore_premier_league",
    homeDecimal: 1.96,
    awayDecimal: 2.1,
    asOf: 1_700_000_000_000,
    startAt: 1_689_162_300_000,
    ...over,
  };
}

describe("fonbet sync (unified event-store contract)", () => {
  test("upsertFonbetEvent inserts and updates by (book_id, inventory_id)", () => {
    const db = makeDb();
    expect(upsertFonbetEvent(db, row())).toBe(1);
    const first = db.query("SELECT * FROM skin_events WHERE book_id = ?").get(FONBET_BOOK_ID) as { home: string; away: string; competition_id: string };
    expect(first.home).toBe("Balestier Khalsa");
    expect(first.competition_id).toBe("singapore_premier_league");
    expect(upsertFonbetEvent(db, row({ home: "New Home" }))).toBe(1);
    const updated = db.query("SELECT home FROM skin_events WHERE book_id = ?").get(FONBET_BOOK_ID) as { home: string };
    expect(updated.home).toBe("New Home");
  });

  test("persistFonbetEvent writes odds_ticks under the unified contract", () => {
    const db = makeDb();
    const n = persistFonbetEvent(db, row());
    expect(n).toBe(2);
    const ticks = db.query("SELECT side, decimal_odds FROM odds_ticks WHERE source = ? ORDER BY side").all(FONBET_ODDS_SOURCE) as Array<{ side: string; decimal_odds: number }>;
    expect(ticks.map((t) => [t.side, t.decimal_odds])).toEqual([
      ["away", 2.1],
      ["home", 1.96],
    ]);
    // The edge-flags reader sees the event as priced.
    const priced = loadPricedBookEvents(db, "volleyball");
    expect(priced).toHaveLength(1);
    expect(priced[0]!.homeDecimal).toBeCloseTo(1.96, 2);
    expect(priced[0]!.awayDecimal).toBeCloseTo(2.1, 2);
  });

  test("unpriced events persist the catalog but write no ticks", () => {
    const db = makeDb();
    expect(persistFonbetEvent(db, row({ homeDecimal: null, awayDecimal: null }))).toBe(0);
    expect((db.query("SELECT COUNT(*) AS n FROM skin_events").get() as { n: number }).n).toBe(1);
  });
});
