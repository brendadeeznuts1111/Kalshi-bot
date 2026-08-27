/**
 * data-source tests — the event source ladder: live feeds (opt-in) merged
 * across books by match identity, degrading to the reference feed and then
 * declarations_only. Live fetch is injected — no network in tests.
 */
import { describe, expect, test } from "bun:test";
import { mergeFeedEvents, parseOddsXmlEvents } from "../../../src/institutions/odds-registry/index.ts";
import { loadReportEvents } from "../../../src/institutions/odds-registry/data-source.ts";
import type { FeedClientResult } from "../../../src/institutions/odds-registry/feed-client.ts";
import type { OddsRegistryConfig } from "../../../src/institutions/odds-registry/types.ts";

const CFG: OddsRegistryConfig = {
  bookmakers: [
    { key: "bet365", name: "Bet365", feed: "bun-xml", sports: ["soccer_epl"], meta: {} },
    { key: "pinnacle", name: "Pinnacle", feed: "bun-xml", sports: ["soccer_epl"], meta: {} },
  ],
} as unknown as OddsRegistryConfig;

const bookFeed = (book: string, priceA: number) =>
  `<odds-heat><cluster venue="51.5074,-0.1278" book="${book}" commence="2026-09-01T19:00:00Z">`
    + `<home team="Alpha FC"/><away team="Beta FC"/>`
    + `<print name="Alpha FC" american="${priceA}"/><print name="Beta FC" american="+150"/></cluster></odds-heat>`;

const result = (book: string, xml: string): FeedClientResult =>
  ({
    bookmakerKey: book,
    feed: "bun-xml",
    sportKey: "soccer_epl",
    events: parseOddsXmlEvents(xml, { sportKey: "soccer_epl", source: "live" }),
    fromCache: false,
    meta: {},
  }) as FeedClientResult;

describe("mergeFeedEvents", () => {
  test("per-book feeds merge into ONE event by match identity", () => {
    const merged = mergeFeedEvents([
      parseOddsXmlEvents(bookFeed("bet365", -200), { sportKey: "soccer_epl", source: "live" }),
      parseOddsXmlEvents(bookFeed("pinnacle", -190), { sportKey: "soccer_epl", source: "live" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.bookmakers.map((b) => b.key)).toEqual(["bet365", "pinnacle"]);
    expect(merged[0]!.source).toBe("live");
  });

  test("identity-less events stay standalone", () => {
    const noIdentity = parseOddsXmlEvents(
      '<odds-heat><cluster venue="51.5074,-0.1278" book="x"><print american="-110"/></cluster></odds-heat>',
    );
    const merged = mergeFeedEvents([noIdentity, noIdentity]);
    expect(merged).toHaveLength(2);
  });
});

describe("loadReportEvents ladder", () => {
  const root = "/nonexistent-root"; // no reference feed -> exercises fallbacks

  test("live enabled: merged live events, dataState live", async () => {
    const fetchLive = (() =>
      Promise.resolve([
        result("bet365", bookFeed("bet365", -200)),
        result("pinnacle", bookFeed("pinnacle", -190)),
      ])) as unknown as typeof import("../../../src/institutions/odds-registry/feed-client.ts").connectAllBookmakers;
    const r = await loadReportEvents(root, CFG, { live: true, fetchLive });
    expect(r.dataState).toBe("live");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.bookmakers).toHaveLength(2);
    expect(r.sourceDetail).toContain("2 book feed(s) live");
  });

  test("live enabled but all feeds dead -> falls back (empty here -> declarations_only)", async () => {
    const fetchLive = (() => Promise.resolve([
      { bookmakerKey: "bet365", feed: "bun-xml", sportKey: "soccer_epl", events: [], fromCache: false, meta: {} } as FeedClientResult,
    ])) as unknown as typeof import("../../../src/institutions/odds-registry/feed-client.ts").connectAllBookmakers;
    const r = await loadReportEvents(root, CFG, { live: true, fetchLive });
    expect(r.dataState).toBe("declarations_only");
    expect(r.events).toHaveLength(0);
  });

  test("live disabled -> reference feed when present", async () => {
    const r = await loadReportEvents(import.meta.dir + "/../../..", CFG, { live: false });
    expect(r.dataState).toBe("reference_feed");
    expect(r.events.length).toBeGreaterThan(0);
  });
});
