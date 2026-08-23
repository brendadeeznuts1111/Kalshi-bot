import { describe, expect, test } from "bun:test";
import {
  filterFonbetEvent,
  nextReconnectDelay,
  prefetchDns,
} from "../../../src/institutions/fonbet/connection.ts";
import type { FonbetEventWire } from "../../../src/institutions/fonbet/parse.ts";

const EV: FonbetEventWire = {
  bk_event_id: "FONSCADAD2564010",
  bk_event_native_id: "41393426",
  event_name: "Nebraska vs Texas",
  league_name: "NCAA Women Volleyball",
  sport: "volleyball",
  team1: "Nebraska",
  team2: "Texas",
};

describe("fonbet connection manager (Bun-native)", () => {
  test("filterFonbetEvent: sport filter (exact, lowercased)", () => {
    expect(filterFonbetEvent(EV, { sport: "volleyball" })).toBe(true);
    expect(filterFonbetEvent(EV, { sport: "Volleyball" })).toBe(true);
    expect(filterFonbetEvent(EV, { sport: "tennis" })).toBe(false);
  });

  test("filterFonbetEvent: league filter (case-insensitive exact)", () => {
    expect(filterFonbetEvent(EV, { leagues: ["NCAA Women Volleyball"] })).toBe(true);
    expect(filterFonbetEvent(EV, { leagues: ["ncaa women volleyball"] })).toBe(true);
    expect(filterFonbetEvent(EV, { leagues: ["Premier League"] })).toBe(false);
  });

  test("filterFonbetEvent: team filter (substring, both sides)", () => {
    expect(filterFonbetEvent(EV, { teams: ["Nebraska"] })).toBe(true);
    expect(filterFonbetEvent(EV, { teams: ["texas"] })).toBe(true);
    expect(filterFonbetEvent(EV, { teams: ["Real Madrid"] })).toBe(false);
  });

  test("filterFonbetEvent: empty filters pass everything", () => {
    expect(filterFonbetEvent(EV)).toBe(true);
  });

  test("nextReconnectDelay backs off exponentially and caps", () => {
    expect(nextReconnectDelay(0, 1000, 30000)).toBe(1000);
    expect(nextReconnectDelay(1, 1000, 30000)).toBe(2000);
    expect(nextReconnectDelay(2, 1000, 30000)).toBe(4000);
    expect(nextReconnectDelay(5, 1000, 30000)).toBe(30000); // capped
    expect(nextReconnectDelay(0, 250, 5000)).toBe(250);
  });

  test("prefetchDns warms known hosts without throwing", () => {
    expect(() => prefetchDns(["api.oddscp.com", { hostname: "example.com", port: 443 }])).not.toThrow();
  });
});
