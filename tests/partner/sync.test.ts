// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import type {
  FantasySessionAdapter,
  PartnerBookedEvent,
  PartnerLiveEvent,
} from "../../src/partner/types.ts";
import { CoefficientStore } from "../../src/partner/fantasy-ultra/coefficient-store.ts";
import {
  matchBookedClientEventId,
  runPartnerInventorySync,
} from "../../src/partner/sync.ts";

function live(
  streamId: number,
  sport: string,
  home: string,
  away: string,
): PartnerLiveEvent {
  return {
    partner: "fantasy402",
    sport,
    league: "Test League",
    eventId: String(streamId),
    home,
    away,
    streamId,
    feedId: 0,
    donbestId: null,
  };
}

function mockAdapter(
  events: PartnerLiveEvent[],
  booked: PartnerBookedEvent[] = [],
): FantasySessionAdapter {
  return {
    partnerId: "fantasy402",
    login: async () => ({ desktop: "https://x/", mobile: "https://x/" }),
    fetchEvents: async () => events,
    fetchLimits: async () => ({ maxStake: 0, maxWin: 0 }),
    placeOrder: async () => ({ success: false, error: "stub" }),
    renewToken: async () => "tok",
    warmSession: async () => {},
    fetchSports: async () => [],
    getBearerToken: () => "tok",
    getLiveUrls: () => null,
    fetchBookedEvent: async () => null,
    listBookedEvents: async () => booked,
  };
}

describe("partner sync", () => {
  test("matchBookedClientEventId soft-matches names", () => {
    const cid = matchBookedClientEventId("Andrey Martinyuk", "Aleksandr Timofeev", [
      {
        clientEventId: "19690946",
        name: "Andrii Martyniuk - Oleksandr Tymofieiev",
      },
      {
        clientEventId: "111",
        name: "Andrey Martinyuk - Aleksandr Timofeev",
      },
    ]);
    // exact substring match on second
    expect(cid).toBe("111");
  });

  test("runPartnerInventorySync inserts new and reports capabilities", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const events = [
      live(1, "Table Tennis", "A", "B"),
      live(2, "Table Tennis", "C", "D"),
    ];
    const booked: PartnerBookedEvent[] = [
      {
        partner: "fantasy402",
        statscoreId: 9,
        clientEventId: "999",
        name: "A - B",
        sportName: "Table tennis",
        sportId: 46,
        competition: null,
        startDate: null,
        statusName: null,
        statusType: null,
        betStatus: "active",
        relationStatus: null,
      },
    ];
    const adapter = mockAdapter(events, booked);
    const report = await runPartnerInventorySync(db, adapter, {
      sport: "table_tennis",
      enrichBooked: true,
      nowMs: 5000,
    });
    expect(report.seen).toBe(2);
    expect(report.inserted).toBe(2);
    expect(report.enriched).toBe(1);
    expect(report.capabilities.inventory).toBe(true);
    expect(report.capabilities.pricedOdds).toBe(false);
    expect(report.capabilities.placeBetRequest).toBe(false);
    expect(report.capabilities.liquidityMerge).toBe(false);

    const row = db
      .query(
        `SELECT client_event_id AS cid FROM partner_events WHERE stream_id = '1'`,
      )
      .get() as { cid: string | null };
    expect(row.cid).toBe("999");
  });

  test("pricedOdds true when coefficientStore has ML lines", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const events = [live(1, "table_tennis", "A", "B")];
    const store = new CoefficientStore();
    store.ingest({
      room: "live.main.TOK.eventCoefficients.99",
      eventId: 99,
      envelope: {
        isDiff: false,
        payload: { id: 99, c: { m: { "3": { o: { "1": 1.8, "2": 2.0 } } } } },
      },
      lines: [],
    });
    const report = await runPartnerInventorySync(db, mockAdapter(events), {
      sport: "table_tennis",
      coefficientStore: store,
      nowMs: 1,
    });
    expect(report.capabilities.pricedOdds).toBe(true);
    expect(report.notes.some((n) => /Pandora store has/i.test(n))).toBe(true);
  });
});
