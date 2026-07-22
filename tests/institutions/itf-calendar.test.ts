// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { KalshiMarketWire } from "../../src/bot/kalshi-events-api.ts";
import {
  buildItfCalendarRows,
  filterItfCalendarRows,
  summarizeItfCalendar,
  topItfEventsByVolume,
} from "../../src/institutions/event-store/itf-calendar.ts";

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
        volume_fp: "14663.78",
        occurrence_datetime: "2026-07-21T12:39:32Z",
      }),
      wire({
        ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY-DELHOY",
        event_ticker: "KXITFDOUBLES-26JUL21DONMARDELHOY",
        yes_sub_title: "Delaney / Ho Yap",
        yes_bid_dollars: "0.0100",
        yes_ask_dollars: "0.0300",
        volume_fp: "5634.71",
        occurrence_datetime: "2026-07-21T12:39:32Z",
      }),
    ];
    const [row] = buildItfCalendarRows(markets);
    expect(row!.matchup).toBe("Delaney / Ho Yap vs Dong / Markovina");
    expect(row!.favoriteLabel).toBe("Dong / Markovina");
    expect(row!.favoriteMidCents).toBe(95);
    expect(row!.legs).toHaveLength(2);
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
});
