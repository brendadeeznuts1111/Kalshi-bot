// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  FANTASY_SPORT_MAPPINGS,
  inventoryFromStreamList,
  primaryFantasySports,
  staticSportMapSummary,
} from "../../src/partner/index.ts";

describe("sports inventory", () => {
  test("static map covers full stream-list set + 4 primary", () => {
    const s = staticSportMapSummary();
    expect(s.total).toBeGreaterThanOrEqual(30);
    expect(s.primary).toBe(4);
    // ticket plane: mainapp isX + TT betGroups (soccer/tennis/golf/racing/fighting/TT…)
    expect(s.withApiId).toBeGreaterThanOrEqual(8);
    expect(s.withFeedId).toBeGreaterThanOrEqual(20);
    expect(primaryFantasySports().map((m) => m.canonical).sort()).toEqual([
      "basketball",
      "soccer",
      "table_tennis",
      "tennis",
    ]);
    expect(FANTASY_SPORT_MAPPINGS.every((m) => m.streamBucket.length > 0)).toBe(
      true,
    );
  });

  test("inventoryFromStreamList counts events and leagues", () => {
    const wire = {
      sports: {
        tennis: {
          count: 2,
          events: {
            a: { sport: "Tennis", league: "ITF A" },
            b: { sport: "Tennis", league: "ATP" },
          },
        },
        table_tennis: {
          events: {
            c: { sport: "Table Tennis", league: "Masters. Russia" },
          },
        },
        cricket: {
          events: {
            d: { sport: "Cricket", league: "IPL" },
            e: { sport: "Cricket", league: "IPL" },
          },
        },
        brand_new_sport: {
          events: {
            f: { sport: "New", league: "X" },
          },
        },
      },
    };
    const inv = inventoryFromStreamList(wire);
    expect(inv.sportBuckets).toBe(4);
    expect(inv.totalEvents).toBe(6);
    expect(inv.unmappedBuckets).toEqual(["brand_new_sport"]);

    const tt = inv.rows.find((r) => r.streamBucket === "table_tennis");
    expect(tt?.mapped).toBe(true);
    expect(tt?.primary).toBe(true);
    expect(tt?.eventCount).toBe(1);
    expect(tt?.leagues[0]?.league).toBe("Masters. Russia");

    const cricket = inv.rows.find((r) => r.streamBucket === "cricket");
    expect(cricket?.mapped).toBe(true);
    expect(cricket?.primary).toBe(false);
    expect(cricket?.mapping?.apiSportId).toBeNull();
    expect(cricket?.eventCount).toBe(2);
    expect(cricket?.leagueCount).toBe(1);

    const unk = inv.rows.find((r) => r.streamBucket === "brand_new_sport");
    expect(unk?.mapped).toBe(false);
  });
});
