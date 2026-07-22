// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { joinPath } from "../src/research/paths.ts";
import { asFeedEventId } from "../src/alpha/odds-types.ts";
import type { OddsEvent } from "../src/alpha/odds-types.ts";
import { buildPinnacleSignalContext } from "../src/alpha/signal-context.ts";
import { resetTickerMapperCache } from "../src/alpha/ticker-mapper.ts";
import { tempSqlitePath, unlinkSqlite } from "./tmp-db.ts";

describe("signal-context", () => {
  const tmpOverrides = joinPath(import.meta.dir, ".tmp-signal-overrides.json");
  const openDbs: string[] = [];

  function memDb(): string {
    const path = tempSqlitePath("signal");
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

  const nbaEvent: OddsEvent = {
    id: asFeedEventId("b8723516c8b44a2f9e7d4b1a0c3e5f6a"),
    sportKey: "basketball_nba",
    commenceTime: "2026-01-15T03:00:00Z",
    homeTeam: "Los Angeles Lakers",
    awayTeam: "Boston Celtics",
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        lastUpdate: "2026-01-15T02:00:00Z",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Los Angeles Lakers", price: -110 },
              { name: "Boston Celtics", price: 100 },
            ],
          },
        ],
      },
    ],
  };

  test("buildPinnacleSignalContext maps ticker and returns components", async () => {
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

    const ctx = await buildPinnacleSignalContext({
      kalshiTicker: "KXNBAGAME-26JAN15LALBOS",
      book: {
        ts: Date.now(),
        bids: [{ priceCents: 52, size: 50 }],
        asks: [{ priceCents: 55, size: 100 }],
        seq: 1,
      },
      events: [nbaEvent],
      kalshiPriceCents: 55,
      mapperOptions: { dbPath: memDb(), overridesPath: tmpOverrides },
    });

    expect(ctx).not.toBeNull();
    expect(ctx!.eventId).toBe(asFeedEventId("b8723516c8b44a2f9e7d4b1a0c3e5f6a"));
    expect(ctx!.components.pinnacle_novig_home).toBeGreaterThan(0);
    expect(ctx!.components.pinnacle_novig_away).toBeGreaterThan(0);
    expect(ctx!.pModel).toBe(ctx!.components.pinnacle_novig_home);
  });
});
