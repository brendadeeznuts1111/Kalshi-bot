// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import {
  isCrossedKalshiBook,
  midFromBookSnapshot,
  parseKalshiOrderbookWire,
  yesAsksFromNoBids,
} from "../../src/bot/kalshi-book-parse.ts";
import { fetchKalshiOrderbookWire } from "../../src/bot/kalshi-market-data.ts";
import { asKalshiMarketTicker } from "../../src/institutions/event-store/brands.ts";

describe("kalshi-book-parse", () => {
  test("NO bids convert to YES asks via reciprocity", () => {
    const asks = yesAsksFromNoBids([{ priceCents: 7, size: 10 }]);
    expect(asks[0]?.priceCents).toBe(93);
    expect(isCrossedKalshiBook(94, 7)).toBe(true);
    expect(isCrossedKalshiBook(44, 55)).toBe(false);
  });

  test("detects crossed yes/no bids and nulls mid", () => {
    const book = parseKalshiOrderbookWire({
      orderbook: {
        yes: [[60, 10]],
        no: [[50, 10]],
      },
    });
    expect(book.crossed).toBe(true);
    expect(midFromBookSnapshot(book)).toBeNull();
  });

  test("parseKalshiOrderbookWire builds best-first book", async () => {
    const wire = await Bun.file(
      joinPath(import.meta.dir, "../fixtures/kalshi-orderbook-fp.json"),
    ).json();
    const book = parseKalshiOrderbookWire(wire);
    expect(book.bids[0]?.priceCents).toBe(44);
    expect(book.asks[0]?.priceCents).toBe(45);
    expect(midFromBookSnapshot(book)).toBe(Math.round((44 + 45) / 2));
  });

  test("fetchKalshiOrderbookWire uses mock fetch", async () => {
    const wire = await Bun.file(
      joinPath(import.meta.dir, "../fixtures/kalshi-orderbook-fp.json"),
    ).json();
    const json = await fetchKalshiOrderbookWire(asKalshiMarketTicker("KXTEST"), {
      fetchImpl: async () =>
        new Response(JSON.stringify(wire), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    expect(json).toEqual(wire);
  });
});
