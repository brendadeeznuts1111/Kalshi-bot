// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import type {
  FantasySessionAdapter,
  PartnerBookedEvent,
  InventoryEvent,
} from "../../src/partner/types.ts";
import { CoefficientStore } from "../../src/partner/fantasy-ultra/coefficient-store.ts";
import {
  matchBookedOddsEventId,
  runInventorySync,
} from "../../src/inventory/sync.ts";

function live(
  inventoryId: number,
  sport: string,
  home: string,
  away: string,
): InventoryEvent {
  return {
    partner: "fantasy402",
    sport,
    league: "Test League",
    inventoryId: String(inventoryId),
    home,
    away,
    feedId: 0,
    donbestId: null,
  };
}

function mockAdapter(
  events: InventoryEvent[],
  booked: PartnerBookedEvent[] = [],
): FantasySessionAdapter {
  return {
    partnerId: "fantasy402",
    login: async () => ({ desktop: "https://x/", mobile: "https://x/" }),
    fetchInventory: async () => events,
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

describe("inventory sync", () => {
  test("matchBookedOddsEventId soft-matches names", () => {
    const cid = matchBookedOddsEventId("Andrey Martinyuk", "Aleksandr Timofeev", [
      {
        oddsEventId: "19690946",
        name: "Andrii Martyniuk - Oleksandr Tymofieiev",
      },
      {
        oddsEventId: "111",
        name: "Andrey Martinyuk - Aleksandr Timofeev",
      },
    ]);
    // exact substring match on second
    expect(cid).toBe("111");
  });

  test("runInventorySync inserts new and reports capabilities", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const events = [
      live(1, "Table Tennis", "A", "B"),
      live(2, "Table Tennis", "C", "D"),
    ];
    const booked: PartnerBookedEvent[] = [
      {
        partner: "fantasy402",
        statscoreId: 9,
        oddsEventId: "999",
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
    const report = await runInventorySync(db, adapter, {
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
    expect(report.coversLiveProducts).toContain("plive");
    expect(report.coversLiveProducts).toContain("ezlive");
    expect(report.sportHistogram.table_tennis).toBe(2);
    expect(report.newBySport.table_tennis).toBe(2);
    expect(report.dryRun).toBe(false);

    const row = db
      .query(
        `SELECT odds_event_id AS cid FROM skin_events WHERE inventory_id = '1'`,
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
    const report = await runInventorySync(db, mockAdapter(events), {
      sport: "table_tennis",
      coefficientStore: store,
      nowMs: 1,
    });
    expect(report.capabilities.pricedOdds).toBe(true);
    expect(report.notes.some((n) => /Pandora store has/i.test(n))).toBe(true);
  });

  test("dry-run plans inserts without writing skin_events", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const events = [
      live(10, "table_tennis", "A", "B"),
      live(11, "table_tennis", "C", "D"),
    ];
    const report = await runInventorySync(db, mockAdapter(events), {
      sport: "table_tennis",
      dryRun: true,
      nowMs: 9000,
    });
    expect(report.dryRun).toBe(true);
    expect(report.seen).toBe(2);
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.newEvents.map((e) => e.inventoryId).sort()).toEqual(["10", "11"]);
    expect(report.notes.some((n) => /dry-run/i.test(n))).toBe(true);

    const count = db
      .query(`SELECT COUNT(*) AS n FROM skin_events`)
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  test("dry-run splits new vs existing inventory_ids", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const seed = [live(1, "table_tennis", "A", "B")];
    await runInventorySync(db, mockAdapter(seed), {
      sport: "table_tennis",
      nowMs: 1000,
    });
    const again = [
      live(1, "table_tennis", "A", "B"),
      live(2, "table_tennis", "X", "Y"),
    ];
    const report = await runInventorySync(db, mockAdapter(again), {
      sport: "table_tennis",
      dryRun: true,
      nowMs: 2000,
    });
    expect(report.dryRun).toBe(true);
    expect(report.inserted).toBe(1);
    expect(report.updated).toBe(1);
    expect(report.newEvents[0]?.inventoryId).toBe("2");
    expect(report.updatedEvents?.[0]?.inventoryId).toBe("1");

    const count = db
      .query(`SELECT COUNT(*) AS n FROM skin_events`)
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
