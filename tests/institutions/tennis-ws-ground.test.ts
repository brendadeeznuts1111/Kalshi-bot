// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { describe, expect, test } from "bun:test";
import {
  captureTennisWsGround,
  loadLatestWsGround,
  persistTennisWsGroundArtifact,
} from "../../src/institutions/event-store/tennis-ws-ground.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
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

  test("captureTennisWsGround writes HTML without launching WebView", async () => {
    const startTs = new Date(Date.now() - 2 * 60_000).toISOString();
    const db = openEventStore({ dbPath: ":memory:" });
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round, best_of,
         player_a, player_b, winner, loser, start_ts, outcome, score_text,
         source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
       ) VALUES (
         'evt1', 'ITF-M', '', '', '', '', '', '', NULL,
         'A', 'B', '', '', $start_ts, 'scheduled', '',
         'kalshi-api', '', 0, 'h1', 0, 'trading'
       )`,
    ).run({ $start_ts: startTs });
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
         competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
       ) VALUES (
         'm1', 'evt1', 'kalshi', 'KXITFMATCH-26JUL22AAA-BBB', 'KXITFMATCH', 'match_winner',
         'A', 'AAA', NULL, '', NULL, 'kalshi-api', '', 0
       )`,
    ).run();
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
       ) VALUES (
         'evt1', 'KXITFMATCH-26JUL22AAA-BBB', 'match_winner', 1000, 1000, 'recv', 1,
         '{"ts":1000,"seq":1,"bids":[{"priceCents":40,"size":10}],"asks":[{"priceCents":45,"size":8}]}',
         'kalshi-ws', '')`,
    ).run();

    const outDir = tempSqlitePath("tennis-ws-ground-capture").replace(/\.db$/, "");
    try {
      const artifact = await captureTennisWsGround(db, {
        leadMinutes: 60,
        limit: 10,
        outDir,
        htmlOnly: true,
      });
      expect(await Bun.file(artifact.dashboardHtml).exists()).toBe(true);
      const html = await Bun.file(artifact.dashboardHtml).text();
      expect(html).toContain("kalshi-ws ticks");
      expect(artifact.webview).toBe(false);
      expect(artifact.image).toBe(false);
    } finally {
      await Bun.$`rm -rf ${outDir}`.nothrow().quiet();
    }
  });
});
