// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { KalshiMarketWire } from "../../src/bot/kalshi-events-api.ts";
import {
  attachItfLegBookDepth,
  buildItfCalendarRows,
  computeTradableScore,
  filterItfCalendarRows,
  summarizeItfCalendar,
  topItfEventsByVolume,
} from "../../src/institutions/event-store/itf-calendar.ts";
import { formatDepthColumn } from "../../src/institutions/event-store/itf-calendar-format.ts";

function wire(partial: Partial<KalshiMarketWire> & Pick<KalshiMarketWire, "ticker" | "event_ticker">): KalshiMarketWire {
  return {
    status: "active",
    ...partial,
  };
}

describe("itf-calendar", () => {
  test("buildItfCalendarRows uses both yes_sub_title legs for matchup", () => {
    const markets = [
      wire({
        ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY-DONMAR",
        event_ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY",
        yes_sub_title: "Dong / Markovina",
        yes_bid_dollars: "0.9300",
        yes_ask_dollars: "0.9600",
        yes_bid_size_fp: "12.00",
        yes_ask_size_fp: "8.00",
        volume_fp: "14663.78",
        volume_24h_fp: "1200.00",
        occurrence_datetime: "2026-07-21T12:39:32Z",
      }),
      wire({
        ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY-DELHOY",
        event_ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY",
        yes_sub_title: "Delaney / Ho Yap",
        yes_bid_dollars: "0.0100",
        yes_ask_dollars: "0.0300",
        yes_bid_size_fp: "100.00",
        yes_ask_size_fp: "45.00",
        volume_fp: "5634.71",
        volume_24h_fp: "400.00",
        occurrence_datetime: "2026-07-21T12:39:32Z",
      }),
    ];
    const [row] = buildItfCalendarRows(markets);
    expect(row!.matchup).toBe("Delaney / Ho Yap vs Dong / Markovina");
    expect(row!.favoriteLabel).toBe("Dong / Markovina");
    expect(row!.favoriteMidCents).toBe(95);
    expect(row!.underdogMidCents).toBe(2);
    expect(row!.favoriteSpreadCents).toBe(3);
    expect(row!.totalVolume24hFp).toBe(1600);
    expect(row!.underdogAskSize).toBe(45);
    expect(row!.legs).toHaveLength(2);
    expect(row!.tradableScore).toBeLessThan(50); // deep favorite penalized
    expect(formatDepthColumn(row!)).toContain("t1");
  });

  test("default tradable sort prefers mid-band over deep favorites", () => {
    const deep = buildItfCalendarRows([
      wire({
        ticker: "KXITFMATCH-26JUL22DEEP-A",
        event_ticker: "KXITFMATCH-26JUL22DEEP",
        yes_sub_title: "Fav",
        yes_bid_dollars: "0.9300",
        yes_ask_dollars: "0.9600",
        volume_fp: "10000",
        volume_24h_fp: "5000",
        yes_ask_size_fp: "10.00",
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22DEEP-B",
        event_ticker: "KXITFMATCH-26JUL22DEEP",
        yes_sub_title: "Dog",
        yes_bid_dollars: "0.0400",
        yes_ask_dollars: "0.0700",
        volume_fp: "1000",
        volume_24h_fp: "500",
        yes_ask_size_fp: "12.00",
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
    ]);
    const mid = buildItfCalendarRows([
      wire({
        ticker: "KXITFMATCH-26JUL22MID-A",
        event_ticker: "KXITFMATCH-26JUL22MID",
        yes_sub_title: "Left",
        yes_bid_dollars: "0.5400",
        yes_ask_dollars: "0.5600",
        volume_fp: "200",
        volume_24h_fp: "80",
        yes_ask_size_fp: "30.00",
        occurrence_datetime: "2026-07-22T11:00:00Z",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22MID-B",
        event_ticker: "KXITFMATCH-26JUL22MID",
        yes_sub_title: "Right",
        yes_bid_dollars: "0.4400",
        yes_ask_dollars: "0.4600",
        volume_fp: "200",
        volume_24h_fp: "80",
        yes_ask_size_fp: "25.00",
        occurrence_datetime: "2026-07-22T11:00:00Z",
      }),
    ]);
    const ranked = filterItfCalendarRows([...deep, ...mid], { sort: "tradable" });
    expect(ranked[0]!.eventTicker).toBe("KXITFMATCH-26JUL22MID");
    expect(ranked[0]!.tradableScore).toBeGreaterThan(ranked[1]!.tradableScore);
  });

  test("filterItfCalendarRows supports volume sort and min volume", () => {
    const rows = buildItfCalendarRows([
      wire({
        ticker: "KXITFMATCH-26JUL22A-B",
        event_ticker: "KXITFMATCH-26JUL22A",
        yes_sub_title: "A",
        volume_fp: "100",
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22A-A",
        event_ticker: "KXITFMATCH-26JUL22A",
        yes_sub_title: "B",
        volume_fp: "50",
        occurrence_datetime: "2026-07-22T10:00:00Z",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22C-D",
        event_ticker: "KXITFMATCH-26JUL22C",
        yes_sub_title: "C",
        volume_fp: "5000",
        occurrence_datetime: "2026-07-22T11:00:00Z",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22C-C",
        event_ticker: "KXITFMATCH-26JUL22C",
        yes_sub_title: "D",
        volume_fp: "5000",
        occurrence_datetime: "2026-07-22T11:00:00Z",
      }),
    ]);
    const filtered = filterItfCalendarRows(rows, { minVolume: 1000, sort: "volume", limit: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.totalVolumeFp).toBe(10000);
    const stats = summarizeItfCalendar(rows, 4);
    expect(stats.openEvents).toBe(2);
    expect(stats.totalVolume24hFp).toBe(0);
  });

  test("topItfEventsByVolume ranks by total event volume", () => {
    const rows = buildItfCalendarRows([
      wire({ ticker: "KXITFMATCH-26JUL22X-A", event_ticker: "E1", yes_sub_title: "A", volume_fp: "1" }),
      wire({ ticker: "KXITFMATCH-26JUL22X-B", event_ticker: "E1", yes_sub_title: "B", volume_fp: "9999" }),
      wire({ ticker: "KXITFMATCH-26JUL22Y-C", event_ticker: "E2", yes_sub_title: "C", volume_fp: "5000" }),
      wire({ ticker: "KXITFMATCH-26JUL22Y-D", event_ticker: "E2", yes_sub_title: "D", volume_fp: "5000" }),
    ]);
    expect(topItfEventsByVolume(rows, 1)[0]!.eventTicker).toBe("E1");
  });

  test("attachItfLegBookDepth sums top-3 levels", () => {
    const [row] = buildItfCalendarRows([
      wire({
        ticker: "KXITFMATCH-26JUL22SANALV-SAN",
        event_ticker: "KXITFMATCH-26JUL22SANALV",
        yes_sub_title: "San",
        yes_bid_dollars: "0.08",
        yes_ask_dollars: "0.12",
        yes_ask_size_fp: "5.00",
      }),
      wire({
        ticker: "KXITFMATCH-26JUL22SANALV-ALV",
        event_ticker: "KXITFMATCH-26JUL22SANALV",
        yes_sub_title: "Alv",
        yes_bid_dollars: "0.88",
        yes_ask_dollars: "0.92",
        yes_ask_size_fp: "9.00",
      }),
    ]);
    const leg = row!.legs[0]!;
    attachItfLegBookDepth(leg, {
      ts: 1,
      seq: 0,
      bids: [
        { priceCents: 8, size: 10 },
        { priceCents: 7, size: 20 },
        { priceCents: 6, size: 30 },
        { priceCents: 5, size: 999 },
      ],
      asks: [
        { priceCents: 12, size: 4 },
        { priceCents: 13, size: 5 },
        { priceCents: 14, size: 6 },
        { priceCents: 15, size: 999 },
      ],
    });
    expect(leg.bidDepthTop3).toBe(60);
    expect(leg.askDepthTop3).toBe(15);
    expect(formatDepthColumn(row!)).toContain("Σ3");
  });

  test("computeTradableScore rewards mid-band", () => {
    const mid = computeTradableScore({
      favoriteMidCents: 55,
      underdogMidCents: 45,
      favoriteSpreadCents: 2,
      totalVolume24hFp: 100,
      underdogAskSize: 40,
    });
    const deep = computeTradableScore({
      favoriteMidCents: 95,
      underdogMidCents: 5,
      favoriteSpreadCents: 3,
      totalVolume24hFp: 100,
      underdogAskSize: 40,
    });
    expect(mid).toBeGreaterThan(deep);
  });
});
