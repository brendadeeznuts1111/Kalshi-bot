// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { liveEvent, memoryDb, mockFantasyAdapter } from "./fixtures.ts";
import type {
  FantasySessionAdapter,
  PartnerBookedEvent,
  InventoryEvent,
} from "../../src/partner/types.ts";
import { CoefficientStore } from "../../src/partner/fantasy-ultra/coefficient-store.ts";
import { matchBookedOddsEventId } from "../../src/inventory/booked-match.ts";
import {
  applyBookedOddsEnrich,
  collectBoardEnrichCandidates,
  listUnlinkedSkinEvents,
  formatOddsLinkCoverage,
  oddsLinkCoverage,
  parseEnrichBookedScope,
  runInventorySync,
} from "../../src/inventory/sync.ts";
import { upsertSkinLiveEvents } from "../../src/inventory/skin-events-store.ts";


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

  test("matchBookedOddsEventId handles LAST, FIRST and translit last names", () => {
    expect(
      matchBookedOddsEventId("RAWAT, SIDHARTH", "MITSUI, SHUNSUKE -", [
        { oddsEventId: "19748002", name: "Sidharth Rawat - Shunsuke Mitsui" },
      ]),
    ).toBe("19748002");
    expect(
      matchBookedOddsEventId("Yuriy Kolos", "Vladimir Stepanovich Ivasiv", [
        { oddsEventId: "19750986", name: "Yurii Kolos - Volodymyr Ivasiv" },
      ]),
    ).toBe("19750986");
    // short tokens like univ must not false-positive
    expect(
      matchBookedOddsEventId(
        "Sankt-Peterburg (univ)",
        "Luganskaya Narodnaya Respublika (univ)",
        [{ oddsEventId: "19681374", name: "Tecnico Univ. - Mushuc Runa" }],
      ),
    ).toBeNull();
  });

  test("runInventorySync inserts new and reports capabilities", async () => {
    const db = memoryDb();
    const events = [
      liveEvent(1, "Table Tennis", "A", "B"),
      liveEvent(2, "Table Tennis", "C", "D"),
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
    const adapter = mockFantasyAdapter(events, booked);
    const report = await runInventorySync(db, adapter, {
      sport: "table_tennis",
      enrichBooked: true,
      bookedCatalog: [{ oddsEventId: "999", name: "A - B" }],
      nowMs: 5000,
    });
    expect(report.seen).toBe(2);
    expect(report.inserted).toBe(2);
    expect(report.enriched).toBe(1);
    expect(report.enrichCandidates).toBe(2);
    expect(report.enrichBookedScope).toBe("board");
    expect(report.pricedEventCount).toBe(0);
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

  test("enrich scope board re-links unlinked updates; unlinked scans book", async () => {
    const db = memoryDb();
    // Seed row without odds_event_id
    upsertSkinLiveEvents(db, [liveEvent(10, "table_tennis", "Home X", "Away Y")], {
      nowMs: 1000,
    });
    expect(listUnlinkedSkinEvents(db, "fantasy402").length).toBe(1);

    const booked: PartnerBookedEvent[] = [
      {
        partner: "fantasy402",
        statscoreId: 1,
        oddsEventId: "555",
        name: "Home X - Away Y",
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
    // Same inventory_id → update path
    const report = await runInventorySync(
      db,
      mockFantasyAdapter([liveEvent(10, "table_tennis", "Home X", "Away Y")], booked),
      {
        sport: "table_tennis",
        enrichBooked: true,
        enrichBookedScope: "board",
        bookedCatalog: [{ oddsEventId: "555", name: "Home X - Away Y" }],
        nowMs: 2000,
      },
    );
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(1);
    expect(report.enriched).toBe(1);
    expect(report.enrichCandidates).toBe(1);

    const cid = (
      db
        .query(`SELECT odds_event_id AS c FROM skin_events WHERE inventory_id = '10'`)
        .get() as { c: string | null }
    ).c;
    expect(cid).toBe("555");
    expect(listUnlinkedSkinEvents(db, "fantasy402").length).toBe(0);
  });

  test("parseEnrichBookedScope + applyBookedOddsEnrich dry-run", () => {
    expect(parseEnrichBookedScope("new")).toBe("new");
    expect(parseEnrichBookedScope("unlinked")).toBe("unlinked");
    expect(parseEnrichBookedScope(undefined)).toBe("board");
    const db = memoryDb();
    upsertSkinLiveEvents(db, [liveEvent(1, "table_tennis", "A", "B")], { nowMs: 1 });
    const n = applyBookedOddsEnrich(
      db,
      "fantasy402",
      [{ inventoryId: "1", home: "A", away: "B" }],
      [{ oddsEventId: "42", name: "A - B" }],
      { dryRun: true },
    );
    expect(n).toBe(1);
    const still = listUnlinkedSkinEvents(db, "fantasy402");
    expect(still.length).toBe(1);
  });

  test("oddsLinkCoverage tracks linked vs unlinked", async () => {
    const db = memoryDb();
    const booked: PartnerBookedEvent[] = [
      {
        partner: "fantasy402",
        statscoreId: 1,
        oddsEventId: "777",
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
    const report = await runInventorySync(
      db,
      mockFantasyAdapter(
        [liveEvent(1, "table_tennis", "A", "B"), liveEvent(2, "table_tennis", "C", "D")],
        booked,
      ),
      {
        sport: "table_tennis",
        enrichBooked: true,
        bookedCatalog: [{ oddsEventId: "777", name: "A - B" }],
        nowMs: 9,
      },
    );
    expect(report.oddsLink).not.toBeNull();
    expect(report.oddsLink!.total).toBe(2);
    expect(report.oddsLink!.linked).toBe(1);
    expect(report.oddsLink!.unlinked).toBe(1);
    expect(report.oddsLink!.linkedPct).toBe(50);
    const cov = oddsLinkCoverage(db, "fantasy402");
    expect(formatOddsLinkCoverage(cov)).toContain("linked=1/2");
  });

  test("pricedOdds true when coefficientStore has ML lines", async () => {
    const db = memoryDb();
    const events = [liveEvent(1, "table_tennis", "A", "B")];
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
    const report = await runInventorySync(db, mockFantasyAdapter(events), {
      sport: "table_tennis",
      coefficientStore: store,
      nowMs: 1,
    });
    expect(report.capabilities.pricedOdds).toBe(true);
    expect(report.notes.some((n) => /Pandora store has/i.test(n))).toBe(true);
  });

  test("dry-run plans inserts without writing skin_events", async () => {
    const db = memoryDb();
    const events = [
      liveEvent(10, "table_tennis", "A", "B"),
      liveEvent(11, "table_tennis", "C", "D"),
    ];
    const report = await runInventorySync(db, mockFantasyAdapter(events), {
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
    const db = memoryDb();
    const seed = [liveEvent(1, "table_tennis", "A", "B")];
    await runInventorySync(db, mockFantasyAdapter(seed), {
      sport: "table_tennis",
      nowMs: 1000,
    });
    const again = [
      liveEvent(1, "table_tennis", "A", "B"),
      liveEvent(2, "table_tennis", "X", "Y"),
    ];
    const report = await runInventorySync(db, mockFantasyAdapter(again), {
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
