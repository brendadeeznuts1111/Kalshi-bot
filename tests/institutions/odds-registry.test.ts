/**
 * odds-registry tests: Bun.XML config load + >=34 capacity floor gate.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadOddsRegistryConfig, parseOddsRegistryXml, validateOddsRegistry } from "../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("odds-registry Bun.XML config", () => {
  test("loads config/odds-registry.xml via Bun.XML", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    expect(cfg.version).toBe("1");
    expect(cfg.capacityFloor).toBe(34);
    expect(cfg.bookmakers.length).toBeGreaterThanOrEqual(34);
  });

  test("capacity floor gate passes (>=34 bookmakers)", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const v = validateOddsRegistry(cfg);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.bookmakerCount).toBeGreaterThanOrEqual(34);
  });

  test("every bookmaker has key/name/feed/sports and unique keys", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const keys = new Set(cfg.bookmakers.map((b) => b.key));
    expect(keys.size).toBe(cfg.bookmakers.length);
    for (const b of cfg.bookmakers) {
      expect(b.key.length).toBeGreaterThan(0);
      expect(b.name.length).toBeGreaterThan(0);
      expect(["odds-api-v3", "fonbet-ws", "bun-xml"]).toContain(b.feed);
      expect(b.sports.length).toBeGreaterThan(0);
    }
    const feeds = new Set(cfg.bookmakers.map((b) => b.feed));
    expect(feeds.has("bun-xml")).toBe(true); // the Bun.XML feed contract is declared
    expect(feeds.has("fonbet-ws")).toBe(true);
  });

  test("gate FAILS when capacity is below the floor (34 is the min)", () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version=\"1\" capacity-floor=\"34\"><bookmaker key=\"a\" name=\"A\" feed=\"odds-api-v3\"><sport key=\"soccer_epl\"/></bookmaker></odds-registry>',
    );
    const v = validateOddsRegistry(cfg);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("capacity floor"))).toBe(true);
  });

  test("Bun.XML singleton collapse is normalized (one bookmaker -> object not array)", () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version=\"1\" capacity-floor=\"1\"><bookmaker key=\"only\" name=\"Only\" feed=\"bun-xml\" endpoint=\"https://x/odds.xml\"><sport key=\"tennis_atp\"/></bookmaker></odds-registry>',
    );
    expect(cfg.bookmakers).toHaveLength(1);
    expect(cfg.bookmakers[0]!.key).toBe("only");
    expect(validateOddsRegistry(cfg).ok).toBe(true);
  });
});
