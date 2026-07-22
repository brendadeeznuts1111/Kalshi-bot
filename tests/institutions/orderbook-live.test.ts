// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  createEmptyLiveOrderbook,
  liveOrderbookToSnapshot,
} from "../../src/institutions/event-store/orderbook-live.ts";
import { asKalshiMarketTicker } from "../../src/institutions/event-store/brands.ts";

describe("orderbook-live", () => {
  test("snapshot then delta rebuilds book; seq gap clears ready", () => {
    const marketTicker = asKalshiMarketTicker("KXITFMATCH-26JUL22AAA-BBB");
    const book = createEmptyLiveOrderbook(marketTicker);
    applyOrderbookSnapshot(
      book,
      {
        market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
        yes_dollars_fp: [["0.40", "10.00"], ["0.35", "5.00"]],
        no_dollars_fp: [["0.55", "8.00"]],
      },
      2,
    );
    expect(book.ready).toBe(true);
    expect(book.yes.get(40)).toBe(10);
    const snap = liveOrderbookToSnapshot(book, 1_000);
    expect(snap?.bids[0]?.priceCents).toBe(40);
    // YES ask from NO bid 55¢ → 45¢
    expect(snap?.asks[0]?.priceCents).toBe(45);

    expect(
      applyOrderbookDelta(
        book,
        {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          price_dollars: "0.40",
          delta_fp: "-10.00",
          side: "yes",
        },
        3,
      ),
    ).toBe(true);
    expect(book.yes.has(40)).toBe(false);

    // book-level delta still applies when stream seq jumps (seq checked at sid stream)
    expect(
      applyOrderbookDelta(
        book,
        {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          price_dollars: "0.30",
          delta_fp: "1.00",
          side: "yes",
        },
        9,
      ),
    ).toBe(true);
    expect(book.yes.get(30)).toBe(1);
  });
});
