// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  FANTASY_SPORT_MAPPINGS,
  FANTASY_WIDGET_CONFIG,
  americanToDecimal,
  decimalToAmerican,
  fantasySportByApiId,
  fantasySportByStreamBucket,
  fantasySportByWidgetId,
  normalizeOdds,
  roundUsOddsDown,
  seedFantasySportMappings,
  truncateDecimal,
} from "../../src/partner/index.ts";

describe("fantasy widget sport map", () => {
  test("table tennis: api 93 vs widget 220", () => {
    const tt = fantasySportByApiId(93);
    expect(tt?.canonical).toBe("table_tennis");
    expect(tt?.widgetSportId).toBe(220);
    expect(tt?.streamBucket).toBe("table_tennis");
    expect(fantasySportByWidgetId(220)?.apiSportId).toBe(93);
    expect(fantasySportByStreamBucket("table_tennis")?.apiSportId).toBe(93);
  });

  test("widget config flags", () => {
    expect(FANTASY_WIDGET_CONFIG.oddsFormat).toBe("american");
    expect(FANTASY_WIDGET_CONFIG.roundUSOddsDown).toBe(true);
    expect(FANTASY_WIDGET_CONFIG.customWebSocketUrl).toContain("pandora.ganchrow.com");
    expect(FANTASY_SPORT_MAPPINGS.length).toBeGreaterThanOrEqual(4);
  });

  test("seed provider_sport_mappings", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const n = seedFantasySportMappings(db);
    expect(n).toBe(FANTASY_SPORT_MAPPINGS.length);
    const row = db
      .query(
        `SELECT api_sport_id AS api, widget_sport_id AS widget FROM provider_sport_mappings
         WHERE provider = 'fantasy402' AND canonical = 'table_tennis'`,
      )
      .get() as { api: number; widget: number };
    expect(row.api).toBe(93);
    expect(row.widget).toBe(220);
  });
});

describe("odds format (widget policy)", () => {
  test("american ↔ decimal", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2, 6);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 6);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 6);
    expect(decimalToAmerican(2)).toBeCloseTo(100, 6);
    expect(decimalToAmerican(1.5)).toBeCloseTo(-200, 6);
  });

  test("roundUsOddsDown against bettor", () => {
    expect(roundUsOddsDown(110.9)).toBe(110);
    expect(roundUsOddsDown(-110.1)).toBe(-111);
  });

  test("normalizeOdds stores dual + truncates decimal places", () => {
    // ticket sample ~1.89285 decimal → american then back under policy
    const fromDec = normalizeOdds(1.8928569555282593, "decimal");
    expect(fromDec.decimal).toBe(truncateDecimal(fromDec.decimal, 3));
    expect(Number.isFinite(fromDec.american)).toBe(true);

    const fromAm = normalizeOdds(-115, "american");
    expect(fromAm.american).toBe(-115);
    expect(fromAm.decimal).toBeCloseTo(1.869, 3);
  });
});
