/**
 * odds-registry pipeline integration tests: reference feed fixture + report
 * surface + registry channel signal (the P3-P5 dashboard/report pieces).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  detectValuePatterns,
  loadOddsRegistryConfig,
  oddsRegistryHealth,
  parseOddsXmlEvents,
  type VenuePriceRef,
} from "../../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("odds-registry pipeline (reference feed + signals)", () => {
  test("public/registry/odds-reference.xml parses to one event with 4 bookmakers", async () => {
    const feed = await Bun.file(join(ROOT, "public/registry/odds-reference.xml")).text();
    const events = parseOddsXmlEvents(feed, { sportKey: "soccer_epl", market: "h2h" });
    expect(events).toHaveLength(1);
    expect(events[0]!.bookmakers).toHaveLength(4);
    expect(events[0]!.homeTeam).toBe("Alpha FC");
  });

  test("reference venue refs drive the report detector end-to-end", async () => {
    const feed = await Bun.file(join(ROOT, "public/registry/odds-reference.xml")).text();
    const refs = (await Bun.file(join(ROOT, "public/registry/venue-refs.json")).json()) as VenuePriceRef[];
    const events = parseOddsXmlEvents(feed, { sportKey: "soccer_epl", market: "h2h" });
    const patterns = detectValuePatterns(events, refs);
    const undervalued = patterns.find((p) => p.kind === "venue_undervalued");
    expect(undervalued).toBeDefined();
    expect(undervalued!.venue).toBe("kalshi");
    expect(undervalued!.gap).toBeLessThanOrEqual(-0.04);
  });

  test("registry health signal shape matches the channel contract", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const health = oddsRegistryHealth(cfg);
    expect(health.ok).toBe(true);
    expect(health.bookmakerCount).toBeGreaterThanOrEqual(34);
    expect(health.feeds["bun-xml"]).toBeGreaterThanOrEqual(1);
    expect(health.sports).toContain("soccer_epl");
  });
});

