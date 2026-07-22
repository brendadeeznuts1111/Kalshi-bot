// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { computeEdgeBreakdown, kalshiFee } from "../src/alpha/edge.ts";
import {
  fetchOdds,
  getModelProb,
  listPinnacleSnapshots,
  resetOddsFeedCache,
} from "../src/alpha/odds-feed.ts";
import { asFeedEventId, parseOddsEventsWire } from "../src/alpha/odds-types.ts";

const SAMPLE_WIRE = [
  {
    id: "evt-1",
    sport_key: "basketball_nba",
    commence_time: "2026-01-15T00:30:00Z",
    home_team: "Los Angeles Lakers",
    away_team: "Boston Celtics",
    bookmakers: [
      {
        key: "pinnacle",
        title: "Pinnacle",
        last_update: "2026-01-14T18:00:00Z",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Los Angeles Lakers", price: -110 },
              { name: "Boston Celtics", price: +100 },
            ],
          },
        ],
      },
      {
        key: "draftkings",
        title: "DraftKings",
        last_update: "2026-01-14T17:00:00Z",
        markets: [{ key: "h2h", outcomes: [{ name: "Los Angeles Lakers", price: -105 }] }],
      },
    ],
  },
];

describe("odds-feed", () => {
  afterEach(() => {
    resetOddsFeedCache();
  });

  test("parseOddsEventsWire maps interior types", () => {
    const events = parseOddsEventsWire(SAMPLE_WIRE);
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(asFeedEventId("evt-1"));
    expect(events[0]!.bookmakers[0]!.key).toBe("pinnacle");
  });

  test("pinnacleSnapshot strips vig from h2h", () => {
    const events = parseOddsEventsWire(SAMPLE_WIRE);
    const snaps = listPinnacleSnapshots(events);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.probabilities.home + snaps[0]!.probabilities.away).toBeCloseTo(1, 6);
    expect(snaps[0]!.lastUpdate).toBe("2026-01-14T18:00:00Z");
  });

  test("getModelProb returns home/away probabilities", () => {
    const events = parseOddsEventsWire(SAMPLE_WIRE);
    const home = getModelProb(events[0]!, "home");
    const away = getModelProb(events[0]!, "away");
    expect(home).not.toBeNull();
    expect(away).not.toBeNull();
    expect(home! + away!).toBeCloseTo(1, 6);
  });

  test("fetchOdds caches ETag and serves 304 from sqlite", async () => {
    const { tempSqlitePath, unlinkSqlite } = await import("./tmp-db.ts");
    const dbPath = tempSqlitePath("odds-etag");
    try {
      let calls = 0;
      const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify(SAMPLE_WIRE), {
            status: 200,
            headers: { etag: '"abc"', "content-type": "application/json" },
          });
        }
        expect(init?.headers instanceof Headers && init.headers.get("If-None-Match")).toBe('"abc"');
        return new Response(null, { status: 304 });
      };

      const opts = { fetchImpl, dbPath, apiKey: "test-key" };
      const first = await fetchOdds("basketball_nba", opts);
      expect(first.fromCache).toBe(false);
      expect(first.events).toHaveLength(1);

      const second = await fetchOdds("basketball_nba", opts);
      expect(second.fromCache).toBe(true);
      expect(second.events[0]!.homeTeam).toBe("Los Angeles Lakers");
      expect(calls).toBe(2);
    } finally {
      resetOddsFeedCache(dbPath);
      unlinkSqlite(dbPath);
    }
  });
});

describe("edge", () => {
  test("computeEdgeBreakdown does not double-count fees", () => {
    const b = computeEdgeBreakdown(0.55, 0.5, 0.02, 5);
    expect(b.rawEdge).toBeCloseTo(0.05, 6);
    expect(b.fees).toBeCloseTo(kalshiFee(0.5, 5), 4);
    expect(b.wouldTrade).toBe(b.rawEdge > b.fees + b.slippageMargin);
  });
});
