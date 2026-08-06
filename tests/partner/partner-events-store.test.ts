// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import type { PartnerLiveEvent } from "../../src/partner/types.ts";
import {
  filterLiveEventsBySport,
  listPartnerStreamIds,
  upsertPartnerLiveEvents,
} from "../../src/partner/partner-events-store.ts";

function ev(
  partial: Partial<PartnerLiveEvent> & { streamId: number; sport: string },
): PartnerLiveEvent {
  return {
    partner: "fantasy402",
    sport: partial.sport,
    league: partial.league ?? "League",
    eventId: String(partial.streamId),
    home: partial.home ?? "A",
    away: partial.away ?? "B",
    streamId: partial.streamId,
    feedId: partial.feedId ?? 0,
    donbestId: null,
  };
}

describe("partner_events store", () => {
  test("filterLiveEventsBySport separates tennis vs table tennis", () => {
    const rows = [
      ev({ streamId: 1, sport: "Tennis" }),
      ev({ streamId: 2, sport: "Table tennis" }),
      ev({ streamId: 3, sport: "Table Tennis" }),
    ];
    expect(filterLiveEventsBySport(rows, "table_tennis").map((e) => e.streamId)).toEqual([
      2, 3,
    ]);
    expect(filterLiveEventsBySport(rows, "tennis").map((e) => e.streamId)).toEqual([1]);
  });

  test("upsertPartnerLiveEvents inserts then updates without re-insert", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const first = [
      ev({ streamId: 100, sport: "Table tennis", home: "P1", away: "P2" }),
      ev({ streamId: 101, sport: "Table tennis" }),
    ];
    const r1 = upsertPartnerLiveEvents(db, first, { nowMs: 1_000 });
    expect(r1.inserted.length).toBe(2);
    expect(r1.updated.length).toBe(0);
    expect(listPartnerStreamIds(db, "fantasy402").size).toBe(2);

    const second = [
      ev({ streamId: 100, sport: "Table tennis", home: "P1", away: "P2x" }),
      ev({ streamId: 102, sport: "Table tennis" }),
    ];
    const r2 = upsertPartnerLiveEvents(db, second, { nowMs: 2_000 });
    expect(r2.inserted.length).toBe(1);
    expect(r2.inserted[0]!.streamId).toBe("102");
    expect(r2.updated.length).toBe(1);
    expect(listPartnerStreamIds(db, "fantasy402").size).toBe(3);

    const row = db
      .query(
        `SELECT home, away, last_updated AS lastUpdated FROM partner_events WHERE stream_id = '100'`,
      )
      .get() as { home: string; away: string; lastUpdated: number };
    expect(row.away).toBe("P2x");
    expect(row.lastUpdated).toBe(2_000);
  });
});
