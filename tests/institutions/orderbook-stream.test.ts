// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  advanceOrderbookStreamSeq,
  createOrderbookStreamState,
  resetOrderbookStreamSeq,
} from "../../src/institutions/event-store/orderbook-stream.ts";
import { handleOrderbookWire } from "../../src/institutions/event-store/kalshi-ws-recorder.ts";

describe("orderbook-stream", () => {
  test("interleaved multi-ticker burst advances monotonic sid seq without false gaps", () => {
    const stream = createOrderbookStreamState(42);
    const books = new Map();
    const tickers = ["T-A", "T-B", "T-C"];

    for (let i = 0; i < tickers.length; i++) {
      const seq = i + 1;
      const result = handleOrderbookWire(
        null,
        books,
        {
          type: "orderbook_snapshot",
          sid: 42,
          seq,
          msg: {
            market_ticker: tickers[i]!,
            yes_dollars_fp: [["0.40", "10.00"]],
            no_dollars_fp: [["0.50", "10.00"]],
          },
        },
        1_000 + i,
        { stream },
      );
      expect(result.kind).toBe("snapshot");
    }

    expect(stream.lastSeq).toBe(3);
    expect(books.size).toBe(3);

    const delta = handleOrderbookWire(
      null,
      books,
      {
        type: "orderbook_delta",
        sid: 42,
        seq: 4,
        msg: {
          market_ticker: "T-B",
          price_dollars: "0.41",
          delta_fp: "2.00",
          side: "yes",
        },
      },
      2_000,
      { stream },
    );
    expect(delta.kind).toBe("delta");
    expect(stream.lastSeq).toBe(4);
  });

  test("duplicate seq is ignored; gap resets on resync path", () => {
    const stream = createOrderbookStreamState();
    expect(advanceOrderbookStreamSeq(stream, 1)).toBe("ok");
    expect(advanceOrderbookStreamSeq(stream, 2)).toBe("ok");
    expect(advanceOrderbookStreamSeq(stream, 2)).toBe("duplicate");
    expect(advanceOrderbookStreamSeq(stream, 5)).toBe("gap");
    resetOrderbookStreamSeq(stream);
    expect(stream.lastSeq).toBe(0);
    expect(advanceOrderbookStreamSeq(stream, 10)).toBe("ok");
  });
});
