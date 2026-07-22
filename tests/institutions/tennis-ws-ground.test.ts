// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
import { describe, expect, test } from "bun:test";
import {
  loadLatestWsGround,
  persistTennisWsGroundArtifact,
} from "../../src/institutions/event-store/tennis-ws-ground.ts";
import { tempSqlitePath } from "../tmp-db.ts";

describe("tennis-ws-ground artifact", () => {
  test("persist + loadLatestWsGround round-trip (isolated path)", async () => {
    const latestPath = tempSqlitePath("tennis-ws-ground-latest").replace(/\.db$/, ".json");
    try {
      const latest = await persistTennisWsGroundArtifact(
        {
          at: "2026-07-22T12:00:00.000Z",
          dashboardHtml: "research/cache/tennis-ws-ground/dashboard.html",
          dashboardPng: "research/cache/tennis-ws-ground/dashboard.png",
          thumbWebp: "research/cache/tennis-ws-ground/dashboard-thumb.webp",
          webview: true,
          image: true,
          model: {
            at: "2026-07-22T12:00:00.000Z",
            watchEvents: 2,
            watchTickers: 4,
            wsTicks: 10,
            restTicks: 100,
            coverage: {
              watchEvents: 2,
              watchTickers: 4,
              watchWithWs: 1,
              watchWithRest: 4,
              watchWithBoth: 1,
              watchWithNeither: 0,
              wsTicksTotal: 10,
              restTicksTotal: 100,
              wsExchangeClockTicks: 0,
              wsExchangeClockPct: 0,
              linkedEventsWithWs: 0,
              linkedEventsTotal: 498,
            },
            rows: [],
          },
        },
        latestPath,
      );
      expect(latest.wsTicks).toBe(10);
      const loaded = await loadLatestWsGround(latestPath);
      expect(loaded?.at).toBe("2026-07-22T12:00:00.000Z");
      expect(loaded?.webview).toBe(true);
      expect(loaded?.watchTickers).toBe(4);
      expect(await Bun.file(latestPath).exists()).toBe(true);
    } finally {
      await Bun.$`rm -f ${latestPath}`.nothrow().quiet();
    }
  });
});
