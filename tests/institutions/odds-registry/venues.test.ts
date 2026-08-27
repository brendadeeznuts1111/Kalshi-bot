/**
 * odds-registry vs venues tests: per-sport consensus table joins bookmaker
 * capacity with Kalshi/Polymarket declared coverage.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  compareOddsVsVenues,
  loadOddsRegistryConfig,
  venueSports,
} from "../../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("odds-registry vs venues", () => {
  test("payload declares odds-vs-venues/v1 with per-sport rows", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const p = compareOddsVsVenues(cfg, new Date("2026-01-01T00:00:00Z"));
    expect(p.schema).toBe("odds-vs-venues/v1");
    expect(p.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(p.capacityFloor).toBe(34);
    expect(p.rows.length).toBeGreaterThanOrEqual(4);
  });

  test("rows carry bookmaker count, markets, and venue coverage", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const p = compareOddsVsVenues(cfg);
    for (const row of p.rows) {
      expect(row.bookmakers).toBeGreaterThan(0);
      expect(row.markets.length).toBeGreaterThan(0);
      expect(row.venues.length).toBeGreaterThanOrEqual(2); // Kalshi + Polymarket
    }
    const total = p.rows.reduce((a, r) => a + r.bookmakers, 0);
    expect(total).toBeGreaterThanOrEqual(34);
  });

  test("tennis_atp joins to venue tennis via VENUE_SPORT_MAP", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const p = compareOddsVsVenues(cfg);
    const tennisRow = p.rows.find((r) => r.sport === "tennis_atp");
    expect(tennisRow).toBeDefined();
    const kalshi = tennisRow!.venues.find((v) => v.key === "kalshi")!;
    expect(kalshi.declared).toBe(true);
    expect(kalshi.state).toBe("enabled");
    const poly = tennisRow!.venues.find((v) => v.key === "polymarket")!;
    expect(poly.declared).toBe(true);
  });

  test("venue coverage reflects declared integrations (state present or absent)", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const p = compareOddsVsVenues(cfg);
    const keys = new Set(p.rows.flatMap((r) => r.venues.map((v) => v.key)));
    expect(keys.has("kalshi")).toBe(true);
    expect(keys.has("polymarket")).toBe(true);
    for (const row of p.rows) {
      for (const v of row.venues) {
        if (v.declared) expect(v.state).toBeTruthy();
        else expect(v.state).toBeNull();
      }
    }
  });

  test("venueSports lists declared venue sports", () => {
    const sports = venueSports();
    const keys = new Set(sports.map((s) => s.key));
    expect(keys.has("tennis")).toBe(true);
    for (const s of sports) expect(s.label.length).toBeGreaterThan(0);
  });
});

