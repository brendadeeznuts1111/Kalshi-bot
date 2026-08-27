/**
 * feed-client + meta-blob tests: the registry XML meta drives per-bookmaker
 * feed connections (one book, one feed, one connection).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  connectBookmaker,
  loadOddsRegistryConfig,
  parseOddsRegistryXml,
  parseV3OddsWire,
  V3_SPORT_MAP,
} from "../../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("registry meta blob (Bun.XML-normalized)", () => {
  test("config meta blobs load into the bookmaker meta record", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const bet365 = cfg.bookmakers.find((b) => b.key === "bet365")!;
    expect(bet365.meta["v3-name"]).toBe("Bet365");
    expect(bet365.meta["api-key-ref"]).toBe("ODDS_API_KEY");
    const fonbet = cfg.bookmakers.find((b) => b.key === "fonbet")!;
    expect(fonbet.meta["ws-url"]).toContain("wss://");
    expect(fonbet.meta["auth-key-ref"]).toBe("ODDSCORP_AUTH_KEY");
  });

  test("meta is an empty record when absent (backward compatible)", async () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version="1" capacity-floor="1"><bookmaker key="x" name="X" feed="odds-api-v3"><sport key="soccer_epl"/></bookmaker></odds-registry>',
    );
    expect(cfg.bookmakers[0]!.meta).toEqual({});
  });

  test("meta element with @key/@value attributes wins over tag name", () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version="1" capacity-floor="1"><bookmaker key="x" name="X" feed="bun-xml"><sport key="tennis_atp"/><meta><endpoint key="feed-url" value="https://x/odds.xml"/></meta></bookmaker></odds-registry>',
    );
    expect(cfg.bookmakers[0]!.meta["feed-url"]).toBe("https://x/odds.xml");
    expect(cfg.bookmakers[0]!.meta["endpoint"]).toBeUndefined();
  });
});

describe("per-bookmaker feed client", () => {
  test("connectBookmaker rejects unknown keys and uncovered sports", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    await expect(connectBookmaker(cfg, "nope", "soccer_epl")).rejects.toThrow("unknown bookmaker key");
    await expect(connectBookmaker(cfg, "18bet", "tennis_atp")).rejects.toThrow("does not cover"); // 18bet: soccer_epl+basketball_nba only
  });

  test("bun-xml bookmaker without endpoint meta fails loudly", async () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version="1" capacity-floor="1"><bookmaker key="noep" name="NoEP" feed="bun-xml"><sport key="tennis_atp"/></bookmaker></odds-registry>',
    );
    await expect(connectBookmaker(cfg, "noep", "tennis_atp")).rejects.toThrow("endpoint");
  });

  test("fonbet-ws without ws-url meta fails loudly", async () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version="1" capacity-floor="1"><bookmaker key="fb" name="FB" feed="fonbet-ws"><sport key="tennis_atp"/></bookmaker></odds-registry>',
    );
    await expect(connectBookmaker(cfg, "fb", "tennis_atp")).rejects.toThrow("ws-url");
  });

  test("odds-api-v3 without a key throws the pinned 401 message", async () => {
    const cfg = parseOddsRegistryXml(
      '<odds-registry version="1" capacity-floor="1"><bookmaker key="v3" name="V3" feed="odds-api-v3"><sport key="soccer_epl"/><meta><v3-name>V3</v3-name></meta></bookmaker></odds-registry>',
    );
    await expect(connectBookmaker(cfg, "v3", "soccer_epl")).rejects.toThrow("ODDS_API_KEY required");
  });
});

describe("v3 wire normalization + sport map", () => {
  test("V3_SPORT_MAP covers every config sport", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const sports = new Set(cfg.bookmakers.flatMap((b) => b.sports));
    for (const s of sports) expect(V3_SPORT_MAP[s]).toBeTruthy();
  });

  test("parseV3OddsWire normalizes a sample wire into OddsEvent", () => {
    const wire = [{
      id: "evt-1",
      sport: "football",
      commence: "2026-09-01T19:00:00Z",
      home: "Alpha FC",
      away: "Beta FC",
      bookmakers: [{
        name: "Bet365",
        markets: [{ key: "h2h", outcomes: [{ name: "Alpha FC", price: -150 }, { name: "Beta FC", price: 130 }] }],
      }],
    }];
    const events = parseV3OddsWire(wire);
    expect(events).toHaveLength(1);
    expect(events[0]!.sportKey).toBe("soccer_epl"); // v3 slug football -> registry key
    expect(events[0]!.bookmakers[0]!.key).toBe("Bet365");
    expect(events[0]!.bookmakers[0]!.markets[0]!.outcomes[0]!.price).toBe(-150);
  });
});

