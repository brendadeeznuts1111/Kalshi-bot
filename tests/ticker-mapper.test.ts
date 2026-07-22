// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { joinPath } from "../src/research/paths.ts";
import { asFeedEventId } from "../src/alpha/odds-types.ts";
import {
  extractKalshiDateToken,
  extractTeamHints,
  mapTickerOrThrow,
  matchTicker,
  parseKalshiDateToken,
  parseNbaGameTeamCodes,
  resetTickerMapperCache,
  TickerMappingError,
  validateTickerMapping,
} from "../src/alpha/ticker-mapper.ts";
import { tempSqlitePath, unlinkSqlite } from "./tmp-db.ts";

describe("ticker-mapper", () => {
  const tmpOverrides = joinPath(import.meta.dir, ".tmp-ticker-overrides.json");
  const openDbs: string[] = [];

  function memDb(): string {
    const path = tempSqlitePath("ticker");
    openDbs.push(path);
    return path;
  }

  afterEach(async () => {
    resetTickerMapperCache();
    for (const path of openDbs.splice(0)) unlinkSqlite(path);
    try {
      await Bun.file(tmpOverrides).delete();
    } catch {
      /* ok */
    }
  });

  test("extractKalshiDateToken parses embedded date", () => {
    expect(extractKalshiDateToken("KXNBAGAME-26JAN15LALBOS")).toBe("26JAN15");
  });

  test("parseKalshiDateToken maps to UTC date", () => {
    const d = parseKalshiDateToken("26JAN15");
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(0);
    expect(d?.getUTCDate()).toBe(15);
  });

  test("parseNbaGameTeamCodes splits home+away suffix", () => {
    expect(parseNbaGameTeamCodes("KXNBAGAME-26JAN15LALBOS")).toEqual(["LAL", "BOS"]);
  });

  test("matchTicker auto-matches on date + team hints with validation", async () => {
    await Bun.write(tmpOverrides, "{}");
    const mapped = await matchTicker(
      "KXNBAGAME-26JAN15LALBOS",
      [
        {
          eventId: asFeedEventId("evt-1"),
          homeTeam: "Los Angeles Lakers",
          awayTeam: "Boston Celtics",
          commenceTime: "2026-01-15T00:30:00Z",
        },
      ],
      { dbPath: memDb(), overridesPath: tmpOverrides },
    );
    expect(mapped?.eventId).toBe(asFeedEventId("evt-1"));
    expect(mapped?.source).toBe("auto");
  });

  test("validateTickerMapping hard-fails on team mismatch", () => {
    expect(() =>
      validateTickerMapping("KXNBAGAME-26JAN15LALBOS", {
        kalshiTicker: "KXNBAGAME-26JAN15LALBOS",
        eventId: asFeedEventId("evt-1"),
        homeTeam: "Los Angeles Lakers",
        awayTeam: "Boston Celtics",
        commenceTime: "2026-01-15T00:30:00Z",
        matchScore: 2,
        source: "auto",
      }),
    ).not.toThrow();

    expect(() =>
      validateTickerMapping("KXNBAGAME-26JAN15LALBOS", {
        kalshiTicker: "KXNBAGAME-26JAN15LALBOS",
        eventId: asFeedEventId("evt-1"),
        homeTeam: "Miami Heat",
        awayTeam: "Boston Celtics",
        commenceTime: "2026-01-15T00:30:00Z",
        matchScore: 2,
        source: "auto",
      }),
    ).toThrow(TickerMappingError);
  });

  test("validateTickerMapping hard-fails on implied-prob gap", () => {
    expect(() =>
      validateTickerMapping(
        "KXNBAGAME-26JAN15LALBOS",
        {
          kalshiTicker: "KXNBAGAME-26JAN15LALBOS",
          eventId: asFeedEventId("evt-1"),
          homeTeam: "Los Angeles Lakers",
          awayTeam: "Boston Celtics",
          commenceTime: "2026-01-15T00:30:00Z",
          matchScore: 2,
          source: "auto",
        },
        { pinnacleProb: 0.58, kalshiPriceCents: 55 },
      ),
    ).not.toThrow();

    expect(() =>
      validateTickerMapping(
        "KXNBAGAME-26JAN15LALBOS",
        {
          kalshiTicker: "KXNBAGAME-26JAN15LALBOS",
          eventId: asFeedEventId("evt-1"),
          homeTeam: "Los Angeles Lakers",
          awayTeam: "Boston Celtics",
          commenceTime: "2026-01-15T00:30:00Z",
          matchScore: 2,
          source: "auto",
        },
        { pinnacleProb: 0.58, kalshiPriceCents: 30 },
      ),
    ).toThrow(TickerMappingError);
  });

  test("matchTicker records unmapped when score too low", async () => {
    const mapped = await matchTicker(
      "KXNBAGAME-26JAN15ZZZZZZ",
      [
        {
          eventId: asFeedEventId("evt-1"),
          homeTeam: "Los Angeles Lakers",
          awayTeam: "Boston Celtics",
          commenceTime: "2026-06-01T00:00:00Z",
        },
      ],
      { dbPath: memDb() },
    );
    expect(mapped).toBeNull();
  });

  test("override maps KXNBAGAME to Pinnacle event with validation", async () => {
    await Bun.write(
      tmpOverrides,
      JSON.stringify({
        "KXNBAGAME-26JAN15LALBOS": {
          eventId: "b8723516c8b44a2f9e7d4b1a0c3e5f6a",
          home: "Los Angeles Lakers",
          away: "Boston Celtics",
          start: "2026-01-15T03:00:00Z",
        },
      }),
    );
    const mapped = await mapTickerOrThrow(
      "KXNBAGAME-26JAN15LALBOS",
      [],
      { dbPath: memDb(), overridesPath: tmpOverrides },
    );
    expect(mapped.eventId).toBe(asFeedEventId("b8723516c8b44a2f9e7d4b1a0c3e5f6a"));
    expect(mapped.source).toBe("override");
  });

  test("extractTeamHints pulls NBA codes from suffix", () => {
    expect(extractTeamHints("KXNBAGAME-26JAN15LALBOS")).toEqual(["LAL", "BOS"]);
  });
});
