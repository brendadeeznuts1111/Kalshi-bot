import { describe, expect, test } from "bun:test";
import {
  extractMoneyline,
  parseFonbetEvent,
  type FonbetEventWire,
  type FonbetMarketWire,
} from "../../../src/institutions/fonbet/parse.ts";

// Fixtures mirror the documented ODDSCORP wire shapes.
const EVENT: FonbetEventWire = {
  bk_event_id: "FONSCADAD2564010",
  bk_event_native_id: "41393426",
  event_name: "Balestier Khalsa vs Young Lions",
  league_name: "Singapore. Premier League",
  sport: "soccer",
  sport_id: "SC",
  team1: "Balestier Khalsa",
  team2: "Young Lions",
  meta: JSON.stringify({ start_at: 1689162300, eng_team1: "Balestier Khalsa", eng_team2: "Young Lions" }),
};

const MARKETS: FonbetMarketWire[] = [
  // market_type 1 = match winner: home outcome named after team1
  ["WINNER__1", 0, "1.96", "", JSON.stringify({ market_type: 1, market_name: "Winner", outcome_name: "Balestier Khalsa" })] as FonbetMarketWire,
  // away outcome named after team2
  ["WINNER__2", 0, "2.10", "", JSON.stringify({ market_type: 1, market_name: "Winner", outcome_name: "Young Lions" })] as FonbetMarketWire,
  // totals (market_type 2) must be ignored
  ["TOTALS__OVER(2.5)", 0, "1.85", "", JSON.stringify({ market_type: 2, market_name: "Total", outcome_name: "Over (2.5)" })] as FonbetMarketWire,
];

describe("fonbet parse (ODDSCORP wire shape)", () => {
  test("extractMoneyline resolves home/away by team name and skips totals", () => {
    const ml = extractMoneyline(EVENT, MARKETS);
    expect(ml.homeDecimal).toBeCloseTo(1.96, 2);
    expect(ml.awayDecimal).toBeCloseTo(2.1, 2);
  });

  test("parseFonbetEvent normalizes to the unified row", () => {
    const row = parseFonbetEvent(EVENT, MARKETS, 1_700_000_000_000);
    expect(row).not.toBeNull();
    expect(row!.id).toBe("41393426");
    expect(row!.home).toBe("Balestier Khalsa");
    expect(row!.away).toBe("Young Lions");
    expect(row!.sport).toBe("soccer");
    expect(row!.competitionId).toBe("singapore_premier_league");
    expect(row!.homeDecimal).toBeCloseTo(1.96, 2);
    expect(row!.awayDecimal).toBeCloseTo(2.1, 2);
    expect(row!.startAt).toBe(1_689_162_300_000);
    expect(row!.asOf).toBe(1_700_000_000_000);
  });

  test("events without two teams are rejected", () => {
    expect(parseFonbetEvent({ ...EVENT, team2: undefined }, [], 1)).toBeNull();
  });

  test("numeric 1/2 selections resolve without team-name outcomes", () => {
    const markets: FonbetMarketWire[] = [
      ["1", 0, "1.50", "", JSON.stringify({ market_type: 1, outcome_name: "1" })] as FonbetMarketWire,
      ["2", 0, "2.75", "", JSON.stringify({ market_type: 1, outcome_name: "2" })] as FonbetMarketWire,
    ];
    const ml = extractMoneyline(EVENT, markets);
    expect(ml.homeDecimal).toBeCloseTo(1.5, 2);
    expect(ml.awayDecimal).toBeCloseTo(2.75, 2);
  });
});
