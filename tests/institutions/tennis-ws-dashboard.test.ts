// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  asKalshiEventTicker,
  asKalshiMarketTicker,
} from "../../src/institutions/event-store/brands.ts";
import {
  loadTennisWsDashboardModel,
  renderTennisWsDashboardHtml,
} from "../../src/institutions/event-store/tennis-ws-dashboard.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";

describe("tennis-ws-dashboard", () => {
  test("loadTennisWsDashboardModel brands watch-set book rows", () => {
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

    const model = loadTennisWsDashboardModel(db, { leadMinutes: 60, limit: 10 });
    expect(model.watchTickers).toBe(1);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]!.ticker).toBe(asKalshiMarketTicker("KXITFMATCH-26JUL22AAA-BBB"));
    expect(model.rows[0]!.eventTicker).toBe(asKalshiEventTicker("KXITFMATCH-26JUL22AAA"));
    expect(model.rows[0]!.midCents).toBe(43);
  });

  test("renderTennisWsDashboardHtml is self-contained for WebView data: URL", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const model = loadTennisWsDashboardModel(db);
    const html = renderTennisWsDashboardHtml(model);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Kalshi tennis");
    expect(html).toContain("kalshi-ws ticks");
    expect(html).not.toContain("<script");
  });
});
